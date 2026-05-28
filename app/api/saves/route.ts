import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureUser, attachUserCookie } from '@/lib/user'

/**
 * Saved cards live in the DB (per-user), not localStorage.
 *
 *  GET    → { ids: string[], cards: ServedCard[]-shape }
 *  POST   { add?: string[], remove?: string[] }  → updates
 */

export async function GET(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)

    const saves = await db.savedCard.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      include: { card: true },
    })

    // Resolve nodeId paths → names for display.
    const allIds = new Set<string>()
    for (const s of saves) for (const id of JSON.parse(s.card.categories) as string[]) allIds.add(id)

    let nameById = new Map<string, string>()
    if (allIds.size > 0) {
      const nodes = await db.topicNode.findMany({
        where:  { id: { in: [...allIds] } },
        select: { id: true, name: true },
      })
      nameById = new Map(nodes.map((n) => [n.id, n.name]))
    }

    const cards = saves.map((s) => ({
      id:         s.card.id,
      hookText:   s.card.hookText,
      wikiTitle:  s.card.wikiTitle,
      wikiUrl:    s.card.wikiUrl,
      categories: (JSON.parse(s.card.categories) as string[])
                    .map((id) => nameById.get(id))
                    .filter((n): n is string => Boolean(n)),
      gradientId: s.card.gradientId,
      tier:       s.card.tier,
      savedAt:    s.createdAt.toISOString(),
    }))

    const res = NextResponse.json({ ids: saves.map((s) => s.cardId), cards })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/saves GET] Error:', err)
    return NextResponse.json({ ids: [], cards: [], error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)
    const { add = [], remove = [] } = await req.json() as {
      add?:    string[]
      remove?: string[]
    }

    for (const cardId of add) {
      await db.savedCard.upsert({
        where:  { userId_cardId: { userId, cardId } },
        create: { userId, cardId },
        update: {},
      })
    }
    for (const cardId of remove) {
      await db.savedCard.deleteMany({ where: { userId, cardId } })
    }

    const res = NextResponse.json({ ok: true })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/saves POST] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
