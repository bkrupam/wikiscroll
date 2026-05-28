import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedRootTopics } from '@/lib/topics'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function GET(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)
    await seedRootTopics()

    const roots = await db.topicNode.findMany({
      where:   { depth: 0 },
      include: {
        children: { select: { id: true } },
        arms:     { where: { userId } },
      },
      orderBy: { name: 'asc' },
    })

    const result = roots.map((n) => {
      const arm = n.arms[0]
      const alpha = arm?.alpha ?? 1
      const beta  = arm?.beta  ?? 1
      return {
        id:           n.id,
        name:         n.name,
        depth:        n.depth,
        hasChildren:  n.children.length > 0,
        alpha,
        beta,
        totalPulls:   arm?.totalPulls ?? 0,
        mean:         alpha / (alpha + beta),
      }
    })

    const res = NextResponse.json({ roots: result })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/taste] Error:', err)
    return NextResponse.json({ roots: [], error: String(err) }, { status: 500 })
  }
}
