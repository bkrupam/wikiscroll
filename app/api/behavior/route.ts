import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateArms, skipStreakMultiplier } from '@/lib/algorithm'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function POST(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)
    const body = await req.json() as {
      cardId: string
      dwellSeconds?: number
      action?: 'SAVE' | 'SKIP'
    }
    const { cardId, dwellSeconds, action } = body
    if (!cardId) {
      return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 })
    }

    const card = await db.card.findUnique({ where: { id: cardId } })
    if (!card) {
      // Card may have been wiped — silently ignore so beacons don't error
      return NextResponse.json({ ok: true })
    }

    const path = JSON.parse(card.categories) as string[]
    const leaf = path[path.length - 1] ?? null

    let type: 'DWELL' | 'SKIP' | 'SAVE'
    if (action === 'SAVE')      type = 'SAVE'
    else if (action === 'SKIP') type = 'SKIP'
    else {
      if (dwellSeconds === undefined) {
        return NextResponse.json({ ok: false, error: 'dwellSeconds required' }, { status: 400 })
      }
      type = dwellSeconds < 2 ? 'SKIP' : 'DWELL'
    }

    // Skip streak: amplify β if the user keeps brushing past the same leaf.
    const skipMultiplier = type === 'SKIP'
      ? await skipStreakMultiplier(userId, leaf)
      : 1

    await db.interaction.create({
      data: {
        userId, cardId, type,
        dwellSeconds: dwellSeconds ?? null,
        leafNodeId:   leaf,
      },
    })

    await updateArms(userId, path, type, dwellSeconds, skipMultiplier)

    const res = NextResponse.json({ ok: true })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/behavior] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
