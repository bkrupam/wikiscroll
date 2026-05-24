import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateArms } from '@/lib/algorithm'

export async function POST(req: NextRequest) {
  try {
    const { cardId } = await req.json() as { cardId: string }
    if (!cardId) {
      return NextResponse.json({ ok: false, error: 'cardId required' }, { status: 400 })
    }

    const card = await db.card.findUnique({ where: { id: cardId } })
    if (!card) {
      return NextResponse.json({ ok: false, error: 'Card not found' }, { status: 404 })
    }

    const categories = JSON.parse(card.categories) as string[]

    await db.interaction.create({
      data: { cardId, type: 'LIKE' },
    })

    await updateArms(categories, 'LIKE')

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/like] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
