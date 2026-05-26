import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { updateArms } from '@/lib/algorithm'

export async function POST(req: NextRequest) {
  try {
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
      // Card may have been cleaned up — silently ignore
      return NextResponse.json({ ok: true })
    }

    const categories = JSON.parse(card.categories) as string[]

    // Determine interaction type
    let type: 'DWELL' | 'SKIP' | 'SAVE'
    if (action === 'SAVE') {
      type = 'SAVE'
    } else if (action === 'SKIP') {
      type = 'SKIP'
    } else {
      if (dwellSeconds === undefined) {
        return NextResponse.json({ ok: false, error: 'dwellSeconds required' }, { status: 400 })
      }
      type = dwellSeconds < 2 ? 'SKIP' : 'DWELL'
    }

    await db.interaction.create({
      data: { cardId, type, dwellSeconds: dwellSeconds ?? null },
    })

    await updateArms(categories, type, dwellSeconds)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/behavior] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
