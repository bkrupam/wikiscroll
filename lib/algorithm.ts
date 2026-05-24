import { db } from './db'
import type { Card } from '@prisma/client'

/**
 * Thompson Sampling — Beta Distribution
 *
 * Each category has (alpha, beta) params representing positive/negative engagement.
 * We sample from Beta(alpha, beta) for each category and rank by sample value.
 * Categories with more positive signal will reliably sample high.
 * New/unseen categories occasionally sample high by chance = natural exploration.
 *
 * Reference: bgalbraith/bandits, akhadangi/Multi-armed-Bandits
 */

type DbCard = Card

/** Approximate a sample from Beta(alpha, beta) */
function sampleBeta(alpha: number, beta: number): number {
  const g1 = sampleGamma(alpha)
  const g2 = sampleGamma(beta)
  return g1 / (g1 + g2)
}

/** Approximate Gamma(shape) using Marsaglia-Tsang method */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(1 + shape) * Math.pow(Math.random(), 1 / shape)
  }
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

/** Standard normal using Box-Muller */
function randn(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Score delta constants */
const DELTA = {
  LIKE:       2.0,
  DWELL_LONG: 1.0,
  DWELL_MED:  0.3,
  SKIP:       1.0,
}

/** Update category arm scores after an interaction */
export async function updateArms(
  categories: string[],
  type: 'LIKE' | 'DWELL' | 'SKIP',
  dwellSeconds?: number
): Promise<void> {
  for (const category of categories) {
    let alphaInc = 0
    let betaInc  = 0

    if (type === 'LIKE') {
      alphaInc = DELTA.LIKE
    } else if (type === 'DWELL' && dwellSeconds !== undefined) {
      if (dwellSeconds >= 8)      alphaInc = DELTA.DWELL_LONG
      else if (dwellSeconds >= 3) alphaInc = DELTA.DWELL_MED
      else if (dwellSeconds < 2)  betaInc  = DELTA.SKIP
    } else if (type === 'SKIP') {
      betaInc = DELTA.SKIP
    }

    if (alphaInc === 0 && betaInc === 0) continue

    await db.categoryArm.upsert({
      where: { category },
      create: {
        category,
        alpha: 1.0 + alphaInc,
        beta:  1.0 + betaInc,
        totalPulls: 1,
      },
      update: {
        alpha:      { increment: alphaInc },
        beta:       { increment: betaInc },
        totalPulls: { increment: 1 },
      },
    })
  }
}

/** Rank categories by Thompson Sampling score */
export async function rankCategories(): Promise<string[]> {
  const arms = await db.categoryArm.findMany()
  if (!arms.length) return []

  const scored: Array<{ category: string; sample: number }> = arms.map((arm) => ({
    category: arm.category,
    sample: sampleBeta(arm.alpha, arm.beta),
  }))

  scored.sort((a, b) => b.sample - a.sample)
  return scored.map((s) => s.category)
}

function mapCard(c: DbCard) {
  return {
    id:         c.id,
    hookText:   c.hookText,
    wikiTitle:  c.wikiTitle,
    wikiUrl:    c.wikiUrl,
    categories: JSON.parse(c.categories) as string[],
    gradientId: c.gradientId,
    tier:       c.tier,
  }
}

/**
 * Fetch the next batch of personalised cards.
 * Uses Thompson Sampling to weight toward high-engagement categories.
 * Wildcards (20%) ensure natural exploration.
 */
export async function getPersonalizedCards(
  limit: number = 10,
  excludeIds: string[] = []
): Promise<ReturnType<typeof mapCard>[]> {
  const rankedCategories = await rankCategories()
  const totalInteractions = await db.interaction.count()

  let cards: DbCard[]

  if (totalInteractions < 20 || rankedCategories.length === 0) {
    // Cold start: serve seeds first, then broad
    cards = await db.card.findMany({
      where:   { served: false, id: { notIn: excludeIds } },
      orderBy: [{ tier: 'asc' }, { hookScore: 'desc' }],
      take:    limit,
    }) as DbCard[]
  } else {
    const topCategories      = rankedCategories.slice(0, 5)
    const wildcardCategories = rankedCategories.slice(5, 10)

    const mainLimit     = Math.ceil(limit * 0.8)
    const wildcardLimit = limit - mainLimit

    // Fetch main cards first, then wildcards (avoids circular reference in Promise.all)
    const mainCards = await db.card.findMany({
      where: {
        served: false,
        id: { notIn: excludeIds },
        OR: topCategories.map((cat) => ({ categories: { contains: cat } })),
      },
      orderBy: { hookScore: 'desc' },
      take: mainLimit,
    }) as DbCard[]

    const mainIds = mainCards.map((c) => c.id)

    const wildcardCards: DbCard[] = wildcardLimit > 0
      ? await db.card.findMany({
          where: {
            served: false,
            id: { notIn: [...excludeIds, ...mainIds] },
            OR: wildcardCategories.length
              ? wildcardCategories.map((cat) => ({ categories: { contains: cat } }))
              : [{ tier: { lte: 2 } }],
          },
          take: wildcardLimit,
        }) as DbCard[]
      : []

    // Interleave: every 4 main cards, insert 1 wildcard
    cards = []
    let wi = 0
    for (let i = 0; i < mainCards.length; i++) {
      cards.push(mainCards[i])
      if ((i + 1) % 4 === 0 && wi < wildcardCards.length) {
        cards.push(wildcardCards[wi++])
      }
    }
  }

  // Fill remainder with any unserved cards
  if (cards.length < limit) {
    const served = cards.map((c) => c.id)
    const fallback = await db.card.findMany({
      where:   { served: false, id: { notIn: [...excludeIds, ...served] } },
      orderBy: { createdAt: 'asc' },
      take:    limit - cards.length,
    }) as DbCard[]
    cards.push(...fallback)
  }

  // Mark as served
  if (cards.length > 0) {
    await db.card.updateMany({
      where: { id: { in: cards.map((c) => c.id) } },
      data:  { served: true },
    })
  }

  return cards.map(mapCard)
}
