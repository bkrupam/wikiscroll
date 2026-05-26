import { db } from './db'
import type { Card } from '@prisma/client'

/**
 * Hierarchical Thompson Sampling over a 3-level topic taxonomy.
 *
 * Every card carries a path of TopicNode ids: [d0, d1, d2].
 * Each node has its own (alpha, beta) bandit arm.
 *
 * Scoring (per card) at request time:
 *   score = W0 * sample(d0) + W1 * sample(d1) + W2 * sample(d2)
 * The leaf gets the most weight because a long dwell on "Neuroplasticity"
 * is a far more specific taste signal than the parent "Psychology".
 *
 * Signal propagation on like / long-dwell / save:
 *   leaf      α += Δ × 1.00
 *   parent    α += Δ × 0.50
 *   root      α += Δ × 0.25
 * Skip applies β with the same multipliers.
 */

const LEVEL_WEIGHT = [0.25, 0.50, 1.00] as const  // d0, d1, d2

const DELTA = {
  SAVE:       3.0,
  LIKE:       2.0,
  DWELL_LONG: 1.0,
  DWELL_MED:  0.3,
  SKIP:       1.0,
}

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

/* ── arm updates ─────────────────────────────────────────────────────────── */

/**
 * Update arms along a card's path with depth-weighted multipliers.
 * `path` is the [d0, d1, d2] array of node ids stored on the card.
 */
export async function updateArms(
  path: string[],
  type: 'LIKE' | 'DWELL' | 'SKIP' | 'SAVE',
  dwellSeconds?: number,
): Promise<void> {
  // Decide the base delta from the signal type
  let baseAlpha = 0
  let baseBeta  = 0

  if (type === 'SAVE')      baseAlpha = DELTA.SAVE
  else if (type === 'LIKE') baseAlpha = DELTA.LIKE
  else if (type === 'SKIP') baseBeta  = DELTA.SKIP
  else if (type === 'DWELL' && dwellSeconds !== undefined) {
    if (dwellSeconds >= 8)      baseAlpha = DELTA.DWELL_LONG
    else if (dwellSeconds >= 3) baseAlpha = DELTA.DWELL_MED
    else if (dwellSeconds < 2)  baseBeta  = DELTA.SKIP
  }

  if (baseAlpha === 0 && baseBeta === 0) return

  for (let i = 0; i < path.length && i < 3; i++) {
    const nodeId = path[i]
    if (!nodeId) continue
    const w = LEVEL_WEIGHT[i] ?? 1.0
    const aInc = baseAlpha * w
    const bInc = baseBeta  * w
    if (aInc === 0 && bInc === 0) continue

    await db.categoryArm.update({
      where: { nodeId },
      data: {
        alpha:      { increment: aInc },
        beta:       { increment: bInc },
        totalPulls: { increment: 1 },
      },
    }).catch(() => {/* arm may not exist for legacy data — ignore */})
  }
}

/**
 * Apply an explicit manual selection from the settings modal.
 * Heavy boost on the chosen node + a small bump on its ancestors so the
 * higher-level arm sees context too.
 */
export async function boostExplicit(nodeId: string): Promise<void> {
  const node = await db.topicNode.findUnique({ where: { id: nodeId } })
  if (!node) return

  // Walk up the chain, biggest boost on the clicked node itself.
  const chain: { id: string; weight: number }[] = []
  chain.push({ id: node.id, weight: 5.0 })

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
    await db.categoryArm.update({
      where: { nodeId: id },
      data:  {
        alpha:      { increment: weight },
        totalPulls: { increment: 1 },
      },
    }).catch(() => {})
  }
}

/* ── feed generation ─────────────────────────────────────────────────────── */

type DbCard = Card

function mapCard(c: DbCard) {
  return {
    id:         c.id,
    hookText:   c.hookText,
    wikiTitle:  c.wikiTitle,
    wikiUrl:    c.wikiUrl,
    categories: JSON.parse(c.categories) as string[],   // path of node ids
    gradientId: c.gradientId,
    tier:       c.tier,
  }
}

/**
 * Score and pull the next batch of cards.
 *
 * 1. Read every arm into a map { nodeId -> sample }.
 * 2. For each unserved card, sum the weighted samples along its path.
 * 3. Sort descending, take top N — but reserve ~20% wildcard slots
 *    (random unserved cards) so exploration never dies.
 */
export async function getPersonalizedCards(
  limit: number = 10,
  excludeIds: string[] = [],
): Promise<ReturnType<typeof mapCard>[]> {
  const arms = await db.categoryArm.findMany()
  if (arms.length === 0) {
    return fallbackCards(limit, excludeIds)
  }

  // Pre-sample every arm once so all cards are scored against the same draw.
  const sampleByNode = new Map<string, number>()
  for (const arm of arms) {
    sampleByNode.set(arm.nodeId, sampleBeta(arm.alpha, arm.beta))
  }

  const totalInteractions = await db.interaction.count()

  // Cold start — barely any signal — just serve seeds + broad
  if (totalInteractions < 20) {
    return fallbackCards(limit, excludeIds)
  }

  const candidates = await db.card.findMany({
    where: { served: false, id: { notIn: excludeIds } },
    take: 200,
    orderBy: { createdAt: 'desc' },
  })

  if (candidates.length === 0) return []

  const wildcardCount = Math.max(1, Math.floor(limit * 0.2))
  const mainCount     = limit - wildcardCount

  // Score every candidate
  const scored = candidates.map((c) => {
    const path = (JSON.parse(c.categories) as string[]).slice(0, 3)
    let s = 0
    for (let i = 0; i < path.length; i++) {
      const w = LEVEL_WEIGHT[i] ?? 1.0
      const sample = sampleByNode.get(path[i]) ?? 0.5  // unknown node → neutral
      s += w * sample
    }
    return { card: c, score: s }
  })

  scored.sort((a, b) => b.score - a.score)
  const mainCards = scored.slice(0, mainCount).map((s) => s.card)
  const mainIds   = new Set(mainCards.map((c) => c.id))

  // Wildcards: pick from the *bottom half* of the score distribution
  // so they actually diverge from what we just picked.
  const wildcardPool = scored.slice(Math.floor(scored.length / 2))
    .map((s) => s.card)
    .filter((c) => !mainIds.has(c.id))
  shuffleInPlace(wildcardPool)
  const wildcardCards = wildcardPool.slice(0, wildcardCount)

  // Interleave: every 4 main cards, drop in a wildcard
  const out: DbCard[] = []
  let wi = 0
  for (let i = 0; i < mainCards.length; i++) {
    out.push(mainCards[i])
    if ((i + 1) % 4 === 0 && wi < wildcardCards.length) {
      out.push(wildcardCards[wi++])
    }
  }
  while (wi < wildcardCards.length) out.push(wildcardCards[wi++])

  // Top up if we came up short
  if (out.length < limit) {
    const have = new Set(out.map((c) => c.id))
    for (const c of candidates) {
      if (out.length >= limit) break
      if (!have.has(c.id)) out.push(c)
    }
  }

  const final = out.slice(0, limit)

  if (final.length > 0) {
    await db.card.updateMany({
      where: { id: { in: final.map((c) => c.id) } },
      data:  { served: true },
    })
  }

  return final.map(mapCard)
}

/** Cold-start / no-arm fallback: pull by tier order. */
async function fallbackCards(limit: number, excludeIds: string[]) {
  const cards = await db.card.findMany({
    where:   { served: false, id: { notIn: excludeIds } },
    orderBy: [{ tier: 'asc' }, { hookScore: 'desc' }],
    take:    limit,
  })

  if (cards.length > 0) {
    await db.card.updateMany({
      where: { id: { in: cards.map((c) => c.id) } },
      data:  { served: true },
    })
  }
  return cards.map(mapCard)
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
