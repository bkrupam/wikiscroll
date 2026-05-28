import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateArms } from '@/lib/algorithm'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function POST(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)
    const { cardId } = await req.json() as { cardId: string }
    if (!cardId) {
      return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 })
    }

    const card = await db.card.findUnique({ where: { id: cardId } })
    if (!card) {
      return NextResponse.json({ ok: false, error: 'Card not found' }, { status: 404 })
    }

    const path = JSON.parse(card.categories) as string[]

    await db.interaction.create({
      data: {
        userId, cardId,
        type: 'LIKE',
        leafNodeId: path[path.length - 1] ?? null,
      },
    })

    await updateArms(userId, path, 'LIKE')

    const res = NextResponse.json({ ok: true })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/like] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
