import { db } from './db'
import type { Card } from '@prisma/client'

/**
 * Hierarchical Thompson Sampling, per-user.
 *
 * Every card carries a path of TopicNode ids: [d0, d1, d2].
 * Each (user, node) has its own (alpha, beta) bandit arm.
 *
 *   score(card) = W0·sample(d0) + W1·sample(d1) + W2·sample(d2)
 *
 * Signal propagation along a card's path:
 *   leaf      α += Δ × 1.00
 *   parent    α += Δ × 0.50
 *   root      α += Δ × 0.25
 *
 * Skip propagates β with the same multipliers.
 *
 * Opportunistic decay: at most once per 24h per user, every arm is pulled
 * back toward the prior so old enthusiasms fade.
 *   α ← 1 + (α − 1) · 0.95
 *   β ← 1 + (β − 1) · 0.95
 */

const LEVEL_WEIGHT = [0.25, 0.50, 1.00] as const

const DELTA = {
  SAVE:       3.0,
  LIKE:       2.0,
  DWELL_LONG: 1.0,
  DWELL_MED:  0.3,
  SKIP:       1.0,
}

const DECAY_FACTOR     = 0.95
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000

/* ── sampling helpers ────────────────────────────────────────────────────── */

function sampleBeta(alpha: number, beta: number): number {
  const g1 = sampleGamma(alpha)
  const g2 = sampleGamma(beta)
  return g1 / (g1 + g2)
}

function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number, v: number
    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/* ── decay ───────────────────────────────────────────────────────────────── */

async function maybeApplyDecay(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return
  const since = Date.now() - user.lastDecayAt.getTime()
  if (since < DECAY_INTERVAL_MS) return

  const arms = await db.categoryArm.findMany({ where: { userId } })
  for (const arm of arms) {
    const newAlpha = 1 + (arm.alpha - 1) * DECAY_FACTOR
    const newBeta  = 1 + (arm.beta  - 1) * DECAY_FACTOR
    await db.categoryArm.update({
      where: { userId_nodeId: { userId, nodeId: arm.nodeId } },
      data:  { alpha: newAlpha, beta: newBeta },
    })
  }
  await db.user.update({ where: { id: userId }, data: { lastDecayAt: new Date() } })
}

/* ── arm helpers ─────────────────────────────────────────────────────────── */

async function bumpArm(
  userId: string,
  nodeId: string,
  alphaInc: number,
  betaInc:  number,
): Promise<void> {
  if (alphaInc === 0 && betaInc === 0) return
  await db.categoryArm.upsert({
    where:  { userId_nodeId: { userId, nodeId } },
    create: {
      userId, nodeId,
      alpha: 1.0 + alphaInc,
      beta:  1.0 + betaInc,
      totalPulls: 1,
    },
    update: {
      alpha:      { increment: alphaInc },
      beta:       { increment: betaInc  },
      totalPulls: { increment: 1 },
    },
  })
}

/* ── arm updates from card interactions ──────────────────────────────────── */

export async function updateArms(
  userId: string,
  path: string[],
  type: 'LIKE' | 'DWELL' | 'SKIP' | 'SAVE',
  dwellSeconds?: number,
  skipStreakMultiplier = 1,
): Promise<void> {
  let baseAlpha = 0
  let baseBeta  = 0

  if (type === 'SAVE')      baseAlpha = DELTA.SAVE
  else if (type === 'LIKE') baseAlpha = DELTA.LIKE
  else if (type === 'SKIP') baseBeta  = DELTA.SKIP * skipStreakMultiplier
  else if (type === 'DWELL' && dwellSeconds !== undefined) {
    if (dwellSeconds >= 8)      baseAlpha = DELTA.DWELL_LONG
    else if (dwellSeconds >= 3) baseAlpha = DELTA.DWELL_MED
    else if (dwellSeconds < 2)  baseBeta  = DELTA.SKIP * skipStreakMultiplier
  }

  if (baseAlpha === 0 && baseBeta === 0) return

  for (let i = 0; i < path.length && i < 3; i++) {
    const w = LEVEL_WEIGHT[i] ?? 1.0
    await bumpArm(userId, path[i], baseAlpha * w, baseBeta * w)
  }
}

/** Explicit manual selection from the settings modal: big α on the leaf
 *  + tapered boost up the chain. */
export async function boostExplicit(userId: string, nodeId: string): Promise<void> {
  const node = await db.topicNode.findUnique({ where: { id: nodeId } })
  if (!node) return

  const chain: { id: string; weight: number }[] = [{ id: node.id, weight: 5.0 }]

  let cursor = node
  let weight = 1.0
  while (cursor.parentId) {
    const parent = await db.topicNode.findUnique({ where: { id: cursor.parentId } })
    if (!parent) break
    chain.push({ id: parent.id, weight })
    weight *= 0.5
    cursor = parent
  }

  for (const { id, weight } of chain) {
    await bumpArm(userId, id, weight, 0)
  }
}

/** Inverse: explicit "remove this topic". Heavy β on the chosen node only. */
export async function dampenExplicit(userId: string, nodeId: string): Promise<void> {
  await bumpArm(userId, nodeId, 0, 5.0)
}

/* ── feed generation ─────────────────────────────────────────────────────── */

type DbCard = Card

export interface ServedCard {
  id:         string
  hookText:   string
  wikiTitle:  string
  wikiUrl:    string
  /** Human-readable topic names along the card's path. */
  categories: string[]
  gradientId: number
  tier:       number
  /** Caption: which topic on the user's profile this card was matched on. */
  becauseOf:  string | null
}

/**
 * Pull the next batch of cards for `userId`.
 *
 * 1. Optional 24h decay pass.
 * 2. Read every arm into a sample map.
 * 3. Score each unserved card by Σ w_i · sample(path[i]).
 * 4. Wildcard ~20% of slots from the bottom half.
 * 5. Annotate each served card with the topic name that drove its rank.
 */
export async function getPersonalizedCards(
  userId: string,
  limit: number = 10,
  excludeIds: string[] = [],
): Promise<ServedCard[]> {
  await maybeApplyDecay(userId)

  const arms = await db.categoryArm.findMany({ where: { userId } })
  const totalInteractions = await db.interaction.count({ where: { userId } })

  // No-signal cold start — pull seeds + broad cards in tier order.
  if (arms.length === 0 || totalInteractions < 8) {
    return fallbackCards(limit, excludeIds)
  }

  // Pre-sample every arm once so all candidates are scored against the same draw.
  const sampleByNode = new Map<string, number>()
  const meanByNode   = new Map<string, number>()
  for (const arm of arms) {
    sampleByNode.set(arm.nodeId, sampleBeta(arm.alpha, arm.beta))
    meanByNode.set(arm.nodeId, arm.alpha / (arm.alpha + arm.beta))
  }

  const candidates = await db.card.findMany({
    where: { served: false, id: { notIn: excludeIds } },
    take: 200,
    orderBy: { createdAt: 'desc' },
  })
  if (candidates.length === 0) return []

  const wildcardCount = Math.max(1, Math.floor(limit * 0.2))
  const mainCount     = limit - wildcardCount

  const scored = candidates.map((c) => {
    const path = (JSON.parse(c.categories) as string[]).slice(0, 3)
    let score = 0
    // The arm that contributed the most to this card's score becomes its "because".
    let topContribIdx = -1
    let topContribValue = -Infinity
    for (let i = 0; i < path.length; i++) {
      const w = LEVEL_WEIGHT[i] ?? 1.0
      const s = sampleByNode.get(path[i]) ?? 0.5
      const contrib = w * s
      if (contrib > topContribValue) {
        topContribValue = contrib
        topContribIdx   = i
      }
      score += contrib
    }
    return { card: c, score, becauseNodeId: topContribIdx >= 0 ? path[topContribIdx] : null }
  })

  scored.sort((a, b) => b.score - a.score)

  const mainSelections = scored.slice(0, mainCount)
  const mainIds        = new Set(mainSelections.map((s) => s.card.id))
  const wildcardPool   = scored
    .slice(Math.floor(scored.length / 2))
    .filter((s) => !mainIds.has(s.card.id))
  shuffleInPlace(wildcardPool)
  const wildcardSelections = wildcardPool.slice(0, wildcardCount)

  // Interleave: every 4 main cards, drop in a wildcard
  const ordered: typeof scored = []
  let wi = 0
  for (let i = 0; i < mainSelections.length; i++) {
    ordered.push(mainSelections[i])
    if ((i + 1) % 4 === 0 && wi < wildcardSelections.length) {
      ordered.push(wildcardSelections[wi++])
    }
  }
  while (wi < wildcardSelections.length) ordered.push(wildcardSelections[wi++])

  const final = ordered.slice(0, limit)
  if (final.length === 0) return []

  await db.card.updateMany({
    where: { id: { in: final.map((s) => s.card.id) } },
    data:  { served: true },
  })

  return resolveServedCards(final.map((s) => ({ card: s.card, becauseNodeId: s.becauseNodeId })))
}

/** Cold-start / no-signal fallback. */
async function fallbackCards(limit: number, excludeIds: string[]): Promise<ServedCard[]> {
  const cards = await db.card.findMany({
    where:   { served: false, id: { notIn: excludeIds } },
    orderBy: [{ tier: 'asc' }, { hookScore: 'desc' }],
    take:    limit,
  })
  if (cards.length === 0) return []
  await db.card.updateMany({
    where: { id: { in: cards.map((c) => c.id) } },
    data:  { served: true },
  })
  return resolveServedCards(cards.map((c) => ({ card: c, becauseNodeId: null })))
}

/** Resolve nodeId paths and `becauseOf` into human names in a single DB roundtrip. */
async function resolveServedCards(
  items: Array<{ card: DbCard; becauseNodeId: string | null }>,
): Promise<ServedCard[]> {
  const ids = new Set<string>()
  for (const { card, becauseNodeId } of items) {
    for (const id of JSON.parse(card.categories) as string[]) ids.add(id)
    if (becauseNodeId) ids.add(becauseNodeId)
  }
  let nameById = new Map<string, string>()
  if (ids.size > 0) {
    const nodes = await db.topicNode.findMany({
      where:  { id: { in: [...ids] } },
      select: { id: true, name: true },
    })
    nameById = new Map(nodes.map((n) => [n.id, n.name]))
  }

  return items.map(({ card, becauseNodeId }) => ({
    id:         card.id,
    hookText:   card.hookText,
    wikiTitle:  card.wikiTitle,
    wikiUrl:    card.wikiUrl,
    categories: (JSON.parse(card.categories) as string[])
                  .map((id) => nameById.get(id))
                  .filter((n): n is string => Boolean(n)),
    gradientId: card.gradientId,
    tier:       card.tier,
    becauseOf:  becauseNodeId ? nameById.get(becauseNodeId) ?? null : null,
  }))
}

/* ── skip streak helper ──────────────────────────────────────────────────── */

/**
 * Detect a skip streak for the given leaf node id. Walks the last 6 SKIP/DWELL<2
 * interactions for this user; if 3+ in a row share the same leaf, multiplier
 * grows linearly. Returns a multiplier ≥ 1.
 */
export async function skipStreakMultiplier(
  userId: string,
  leafNodeId: string | null,
): Promise<number> {
  if (!leafNodeId) return 1
  const recent = await db.interaction.findMany({
    where: { userId, type: 'SKIP' },
    orderBy: { createdAt: 'desc' },
    take: 6,
  })
  let streak = 0
  for (const r of recent) {
    if (r.leafNodeId === leafNodeId) streak++
    else break
  }
  if (streak >= 3) return 1 + (streak - 2) * 0.75   // 1.75x, 2.5x, 3.25x …
  return 1
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
