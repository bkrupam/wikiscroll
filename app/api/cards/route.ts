import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { maybeRefillQueue, fillQueue } from '@/lib/queue'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function GET(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)

    const { searchParams } = new URL(req.url)
    const exclude = searchParams.get('exclude')
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    const cards = await getPersonalizedCards(userId, 10, excludeIds)

    if (cards.length === 0) fillQueue().catch(console.error)
    else                    maybeRefillQueue().catch(console.error)

    const res = NextResponse.json({ cards })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/cards] Error:', err)
    return NextResponse.json({ cards: [], error: String(err) }, { status: 500 })
  }
}
