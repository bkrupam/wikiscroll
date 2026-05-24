import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { maybeRefillQueue, fillQueue } from '@/lib/queue'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const exclude = searchParams.get('exclude')
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    const cards = await getPersonalizedCards(10, excludeIds)

    if (cards.length === 0) {
      // Queue is empty — kick off an aggressive fill immediately
      fillQueue().catch(console.error)
    } else {
      // Kick off background refill if queue is running low (fire & forget)
      maybeRefillQueue().catch(console.error)
    }

    return NextResponse.json({ cards })
  } catch (err) {
    console.error('[/api/cards] Error:', err)
    return NextResponse.json({ cards: [], error: String(err) }, { status: 500 })
  }
}
