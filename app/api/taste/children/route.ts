import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { expandChildren } from '@/lib/groq'
import { upsertNode } from '@/lib/topics'
import { ensureUser, attachUserCookie } from '@/lib/user'

export async function GET(req: NextRequest) {
  try {
    const { userId, isNew } = await ensureUser(req)

    const nodeId = req.nextUrl.searchParams.get('nodeId')
    if (!nodeId) {
      return NextResponse.json({ children: [], error: 'nodeId required' }, { status: 400 })
    }

    const parent = await db.topicNode.findUnique({ where: { id: nodeId } })
    if (!parent) {
      return NextResponse.json({ children: [], error: 'node not found' }, { status: 404 })
    }
    if (parent.depth >= 2) {
      const res = NextResponse.json({ children: [] })
      if (isNew) attachUserCookie(res, userId)
      return res
    }

    let nodes = await db.topicNode.findMany({
      where:   { parentId: nodeId },
      include: { arms: { where: { userId } }, children: { select: { id: true } } },
      orderBy: { name: 'asc' },
    })

    if (nodes.length === 0) {
      const names = await expandChildren(parent.name, parent.depth, [])
      for (const name of names) {
        await upsertNode(name, parent.depth + 1, parent.id)
      }
      nodes = await db.topicNode.findMany({
        where:   { parentId: nodeId },
        include: { arms: { where: { userId } }, children: { select: { id: true } } },
        orderBy: { name: 'asc' },
      })
    }

    const result = nodes.map((n) => {
      const arm = n.arms[0]
      const alpha = arm?.alpha ?? 1
      const beta  = arm?.beta  ?? 1
      return {
        id:          n.id,
        name:        n.name,
        depth:       n.depth,
        hasChildren: n.children.length > 0 || n.depth < 2,
        alpha,
        beta,
        totalPulls:  arm?.totalPulls ?? 0,
        mean:        alpha / (alpha + beta),
      }
    })

    const res = NextResponse.json({ children: result })
    if (isNew) attachUserCookie(res, userId)
    return res
  } catch (err) {
    console.error('[/api/taste/children] Error:', err)
    return NextResponse.json({ children: [], error: String(err) }, { status: 500 })
  }
}
