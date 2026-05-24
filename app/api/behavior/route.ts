import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateArms } from '@/lib/algorithm'

export async function POST(req: NextRequest) {
  try {
    const { cardId, dwellSeconds } = await req.json() as {
      cardId: string
      dwellSeconds: number
    }

    if (!cardId || dwellSeconds === undefined) {
      return NextResponse.json(
        { ok: false, error: 'cardId and dwellSeconds required' },
        { status: 400 }
      )
    }

    const card = await db.card.findUnique({ where: { id: cardId } })
    if (!card) {
      // Card may have been cleaned up — silently ignore
      return NextResponse.json({ ok: true })
    }

    const categories = JSON.parse(card.categories) as string[]
    const type = dwellSeconds < 2 ? 'SKIP' : 'DWELL'

    await db.interaction.create({
      data: { cardId, type, dwellSeconds },
    })

    await updateArms(categories, type, dwellSeconds)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/behavior] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
