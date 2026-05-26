import { db } from './db'
import { extractHookAndPath } from './groq'
import { ROOT_TOPICS, seedRootTopics, upsertNode } from './topics'
import {
  fetchArticleByTitle,
  fetchRandomArticle,
  fetchRandomFromCategory,
  fetchLinkedArticles,
} from './wikipedia'
import { SEED_ARTICLES, BROAD_CATEGORIES } from '@/data/seeds'

/**
 * Resolve a Groq-returned [root, sub, subsub] path to TopicNode ids, creating
 * the depth-1 / depth-2 nodes lazily if they don't yet exist under the root.
 */
async function resolvePath(path: [string, string, string]): Promise<string[]> {
  await seedRootTopics()

  const [rootName, subName, subSubName] = path
  const rootNode = await db.topicNode.findFirst({
    where: { name: rootName, depth: 0 },
  })
  if (!rootNode) return []

  const subNode    = await upsertNode(subName,    1, rootNode.id)
  const subSubNode = await upsertNode(subSubName, 2, subNode.id)

  return [rootNode.id, subNode.id, subSubNode.id]
}

/** Target number of unserved cards to keep in the queue.
 *  Small enough that cold-start fill finishes in seconds, big enough that
 *  the algorithm has multiple candidates to rank via Thompson Sampling. */
const QUEUE_TARGET = 5

/** In-memory mutex preventing two refills from running concurrently —
 *  parallel refills would burst Groq's rate limit and trigger 503 cascades. */
let isRefilling = false

/** Global async mutex around every call to generateOneCard.
 *  Without this, the endpoint's slow-path generate and the background refill
 *  hit Groq simultaneously, burst the 30 RPM rate limit, and trigger the
 *  withRetry exponential backoff (1.5s → 3s → 6s → 12s). Serialising every
 *  generation keeps us safely under the per-minute limit. */
let generationChain: Promise<void> = Promise.resolve()

async function withGenerationLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = generationChain
  let release!: () => void
  generationChain = new Promise<void>((resolve) => { release = resolve })
  await previous.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
  }
}

/** 6 gradient variants — assigned round-robin, never two in a row */
const GRADIENT_COUNT = 6

/** Track which seeds have already been queued (in-memory across calls in the same process) */
const usedSeeds = new Set<string>()

/** Generate a gradient ID that differs from the last one used */
function pickGradient(lastGradientId?: number): number {
  let id: number
  do {
    id = Math.floor(Math.random() * GRADIENT_COUNT) + 1
  } while (id === lastGradientId)
  return id
}

/** Determine which tier a new card should be based on existing card count */
async function determineTier(): Promise<1 | 2 | 3> {
  const tier1Count = await db.card.count({ where: { tier: 1 } })
  const tier2Count = await db.card.count({ where: { tier: 2 } })
  const totalInteractions = await db.interaction.count()

  if (tier1Count < 15) return 1
  if (tier2Count < 45 || totalInteractions < 60) return 2
  return 3
}

/** Get the gradient ID of the most recently created card */
async function getLastGradientId(): Promise<number | undefined> {
  const last = await db.card.findFirst({ orderBy: { createdAt: 'desc' } })
  return last?.gradientId ?? undefined
}

/** Shuffle an array in-place (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Generate a single card for background refill — serialised through the mutex
 * so multiple refill calls never burst Groq simultaneously.
 */
export async function generateOneCard(): Promise<boolean> {
  return withGenerationLock(_generateOneCardImpl)
}

/**
 * Generate a single card immediately, bypassing the refill queue.
 * Use this in the endpoint's slow path so an urgent user request isn't blocked
 * behind up to 5 background refill cards (which would cause 30s+ waits).
 * At most 2 concurrent Groq calls can result (1 refill + 1 urgent), which is
 * well within the 30 RPM limit.
 */
export async function generateOneCardDirect(): Promise<boolean> {
  return _generateOneCardImpl()
}

async function _generateOneCardImpl(): Promise<boolean> {
  const tier = await determineTier()
  const lastGradientId = await getLastGradientId()

  let article: Awaited<ReturnType<typeof fetchArticleByTitle>> = null

  // ── Tier 1: hand-picked seed articles ─────────────────────────────────────
  if (tier === 1) {
    const available = SEED_ARTICLES.filter((s) => !usedSeeds.has(s))
    if (available.length > 0) {
      const title = available[Math.floor(Math.random() * available.length)]
      usedSeeds.add(title)
      article = await fetchArticleByTitle(title)
    }
    // If seeds exhausted or article fetch failed, fall through to category logic
  }

  // ── Tier 2+: try categories one by one until we get a real article ─────────
  // Shuffle so we don't hammer the same category every time, then walk the list.
  // Many BROAD_CATEGORIES entries may be valid Wikipedia categories that happen
  // to return a stub on this pick — cycling through several gives us a good
  // article without ever touching the truly-random fallback.
  if (!article) {
    const candidates = shuffle([...BROAD_CATEGORIES])
    for (const category of candidates) {
      article = await fetchRandomFromCategory(category)
      if (article) break
    }
  }

  // ── Absolute last resort: random article ──────────────────────────────────
  // Wikipedia has 6.7 M articles; most are stubs or biography filler and will
  // fail the Groq hook check. This path exists only as a final safety net —
  // the category loop above should almost always succeed first.
  if (!article) {
    article = await fetchRandomArticle()
  }

  if (!article) return false

  const hookResult = await extractHookAndPath(article.title, article.extract, ROOT_TOPICS)
  if (!hookResult) return false

  const pathIds = await resolvePath(hookResult.path)
  if (pathIds.length === 0) return false

  const gradientId = pickGradient(lastGradientId)

  await db.card.create({
    data: {
      hookText:   hookResult.hook,
      wikiTitle:  article.title,
      wikiUrl:    article.url,
      categories: JSON.stringify(pathIds),
      gradientId,
      hookScore:  hookResult.score,
      tier,
    },
  })

  return true
}

export interface GeneratedCard {
  id: string
  hookText: string
  wikiTitle: string
  wikiUrl: string
  categories: string[]
  gradientId: number
  tier: number
}

/**
 * Generate a card that is topically related to `fromTitle` by following
 * that article's own Wikipedia links. Used by rabbit hole mode.
 *
 * - Bypasses the mutex (same reasoning as generateOneCardDirect).
 * - Returns the card directly and marks it served immediately so
 *   the normal buffer fetch doesn't accidentally grab it first.
 * - Falls back to a normal direct generation if no suitable linked
 *   article produces a good hook (e.g. all links are stubs).
 */
export async function generateRelatedCard(fromTitle: string): Promise<GeneratedCard | null> {
  const links = await fetchLinkedArticles(fromTitle)

  // Try up to 15 linked articles in shuffled order before giving up
  const candidates = shuffle([...links]).slice(0, 15)

  for (const title of candidates) {
    const article = await fetchArticleByTitle(title)
    if (!article) continue

    const hookResult = await extractHookAndPath(article.title, article.extract, ROOT_TOPICS)
    if (!hookResult) continue

    const pathIds = await resolvePath(hookResult.path)
    if (pathIds.length === 0) continue

    const lastGradientId = await getLastGradientId()
    const gradientId = pickGradient(lastGradientId)

    const card = await db.card.create({
      data: {
        hookText:   hookResult.hook,
        wikiTitle:  article.title,
        wikiUrl:    article.url,
        categories: JSON.stringify(pathIds),
        gradientId,
        hookScore:  hookResult.score,
        tier:       2,
        served:     true,   // mark served immediately — bypasses the buffer
      },
    })

    return {
      id:         card.id,
      hookText:   card.hookText,
      wikiTitle:  card.wikiTitle,
      wikiUrl:    card.wikiUrl,
      categories: [...hookResult.path],
      gradientId: card.gradientId,
      tier:       card.tier,
    }
  }

  return null  // caller falls through to normal generation
}

/** Fill the queue up to QUEUE_TARGET unserved cards. Runs sequentially to avoid hammering APIs. */
export async function fillQueue(): Promise<{ added: number; total: number }> {
  await seedRootTopics()  // ensure roots exist before the very first card

  const unservedCount = await db.card.count({ where: { served: false } })
  const needed = Math.max(0, QUEUE_TARGET - unservedCount)

  let added = 0
  for (let i = 0; i < needed; i++) {
    const ok = await generateOneCard()
    if (ok) added++
    // Tiny breather — the mutex already serialises Groq calls, so the
    // previous 300ms pause is no longer needed for rate-limit protection.
    await new Promise((r) => setTimeout(r, 50))
  }

  const total = await db.card.count({ where: { served: false } })
  return { added, total }
}

/** Check if the queue needs topping up. Safe to call concurrently — the mutex
 *  ensures only one fill ever runs at a time, which protects Groq's rate limit. */
export async function maybeRefillQueue(): Promise<void> {
  if (isRefilling) return

  const unservedCount = await db.card.count({ where: { served: false } })
  if (unservedCount >= QUEUE_TARGET) return

  isRefilling = true
  try {
    await fillQueue()
  } finally {
    isRefilling = false
  }
}
