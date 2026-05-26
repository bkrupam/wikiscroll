import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { generateOneCardDirect, generateRelatedCard, maybeRefillQueue } from '@/lib/queue'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const exclude   = searchParams.get('exclude')
    const relatedTo = searchParams.get('relatedTo')   // rabbit hole: follow links from this article
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    // ── Rabbit hole path ───────────────────────────────────────────────────
    // User has been dwelling long — serve a card linked from the article they
    // were reading instead of the Thompson-ranked buffer.
    if (relatedTo) {
      const related = await generateRelatedCard(relatedTo)
      if (related) {
        maybeRefillQueue().catch(console.error)
        return NextResponse.json({ card: related })
      }
      // If no linked article produced a good hook, fall through to normal path.
    }

    // ── Fast path ──────────────────────────────────────────────────────────
    const existing = await getPersonalizedCards(1, excludeIds)
    if (existing.length > 0) {
      maybeRefillQueue().catch(console.error)
      return NextResponse.json({ card: existing[0] })
    }

    // ── Slow path ──────────────────────────────────────────────────────────
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await generateOneCardDirect()
      if (ok) {
        const fresh = await getPersonalizedCards(1, excludeIds)
        if (fresh.length > 0) {
          maybeRefillQueue().catch(console.error)
          return NextResponse.json({ card: fresh[0] })
        }
      }
    }

    return NextResponse.json({ card: null }, { status: 503 })
  } catch (err) {
    console.error('[/api/card/next] Error:', err)
    return NextResponse.json({ card: null, error: String(err) }, { status: 500 })
  }
}
