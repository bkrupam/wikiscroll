import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { generateOneCardDirect, maybeRefillQueue } from '@/lib/queue'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const exclude = searchParams.get('exclude')
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    // ── Fast path ──────────────────────────────────────────────────────────
    // Most requests hit this — the buffer keeps 5 unserved cards ready,
    // and Thompson Sampling picks the one best matched to the user's arms.
    const existing = await getPersonalizedCards(1, excludeIds)
    if (existing.length > 0) {
      // Fire-and-forget background refill so the next request hits fast path too.
      maybeRefillQueue().catch(console.error)
      return NextResponse.json({ card: existing[0] })
    }

    // ── Slow path ──────────────────────────────────────────────────────────
    // Buffer is genuinely empty (first ever request, or pathological case).
    // Generate on the spot, then trigger refill so we don't repeat this.
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
