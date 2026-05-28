import { NextRequest, NextResponse } from 'next/server'
import { boostExplicit, dampenExplicit } from '@/lib/algorithm'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function POST(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)
    const { add = [], remove = [] } = await req.json() as {
      add?:    string[]
      remove?: string[]
    }
    for (const nodeId of add)    await boostExplicit(userId, nodeId)
    for (const nodeId of remove) await dampenExplicit(userId, nodeId)

    const res = NextResponse.json({ ok: true })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/preferences] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
