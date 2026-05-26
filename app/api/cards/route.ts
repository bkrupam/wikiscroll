import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { maybeRefillQueue, fillQueue } from '@/lib/queue'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const exclude = searchParams.get('exclude')
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    const cards = await getPersonalizedCards(10, excludeIds)

    // The algorithm stores TopicNode ids on the card; the UI wants names.
    // Batch-resolve all referenced node ids in a single query.
    const allIds = new Set<string>()
    for (const c of cards) for (const id of c.categories) allIds.add(id)

    let nameById = new Map<string, string>()
    if (allIds.size > 0) {
      const nodes = await db.topicNode.findMany({
        where:  { id: { in: [...allIds] } },
        select: { id: true, name: true },
      })
      nameById = new Map(nodes.map((n) => [n.id, n.name]))
    }

    const enriched = cards.map((c) => ({
      ...c,
      categories: c.categories
        .map((id) => nameById.get(id))
        .filter((n): n is string => Boolean(n)),
    }))

    if (cards.length === 0) {
      fillQueue().catch(console.error)
    } else {
      maybeRefillQueue().catch(console.error)
    }

    return NextResponse.json({ cards: enriched })
  } catch (err) {
    console.error('[/api/cards] Error:', err)
    return NextResponse.json({ cards: [], error: String(err) }, { status: 500 })
  }
}
