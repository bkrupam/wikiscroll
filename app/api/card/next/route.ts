import { NextRequest, NextResponse } from 'next/server'
import { getPersonalizedCards } from '@/lib/algorithm'
import { generateOneCardDirect, generateRelatedCard, maybeRefillQueue } from '@/lib/queue'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function GET(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)

    const { searchParams } = new URL(req.url)
    const exclude   = searchParams.get('exclude')
    const relatedTo = searchParams.get('relatedTo')
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : []

    const respond = (body: object, status = 200) => {
      const res = NextResponse.json(body, { status })
      if (isNew) attachUserCookie(res, userId)
      return res
    }

    // Rabbit hole path
    if (relatedTo) {
      const related = await generateRelatedCard(relatedTo)
      if (related) {
        maybeRefillQueue().catch(console.error)
        return respond({ card: related })
      }
    }

    // Fast path: pull from the served-queue with Thompson ranking
    const existing = await getPersonalizedCards(userId, 1, excludeIds)
    if (existing.length > 0) {
      maybeRefillQueue().catch(console.error)
      return respond({ card: existing[0] })
    }

    // Slow path: queue is empty — synthesize one
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await generateOneCardDirect()
      if (ok) {
        const fresh = await getPersonalizedCards(userId, 1, excludeIds)
        if (fresh.length > 0) {
          maybeRefillQueue().catch(console.error)
          return respond({ card: fresh[0] })
        }
      }
    }

    return respond({ card: null }, 503)
  } catch (err) {
    console.error('[/api/card/next] Error:', err)
    return NextResponse.json({ card: null, error: String(err) }, { status: 500 })
  }
}
