import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { expandChildren } from '@/lib/groq'
import { upsertNode } from '@/lib/topics'

/**
 * Lazy-load children of a TopicNode.
 *  - If children already exist in the DB → return them.
 *  - If not, ask Groq to propose 6 children, insert them, return them.
 *
 * GET /api/taste/children?nodeId=xxx
 */
export async function GET(req: NextRequest) {
  try {
    const nodeId = req.nextUrl.searchParams.get('nodeId')
    if (!nodeId) {
      return NextResponse.json({ children: [], error: 'nodeId required' }, { status: 400 })
    }

    const parent = await db.topicNode.findUnique({ where: { id: nodeId } })
    if (!parent) {
      return NextResponse.json({ children: [], error: 'node not found' }, { status: 404 })
    }
    if (parent.depth >= 2) {
      // Leaf — no further children.
      return NextResponse.json({ children: [] })
    }

    const existing = await db.topicNode.findMany({
      where:   { parentId: nodeId },
      include: { arm: true, children: { select: { id: true } } },
      orderBy: { name: 'asc' },
    })

    let nodes = existing

    if (existing.length === 0) {
      const names = await expandChildren(parent.name, parent.depth, [])
      for (const name of names) {
        await upsertNode(name, parent.depth + 1, parent.id)
      }
      nodes = await db.topicNode.findMany({
        where:   { parentId: nodeId },
        include: { arm: true, children: { select: { id: true } } },
        orderBy: { name: 'asc' },
      })
    }

    const result = nodes.map((n) => ({
      id:          n.id,
      name:        n.name,
      depth:       n.depth,
      hasChildren: n.children.length > 0 || n.depth < 2,
      alpha:       n.arm?.alpha ?? 1,
      beta:        n.arm?.beta  ?? 1,
      totalPulls:  n.arm?.totalPulls ?? 0,
      mean:        n.arm ? n.arm.alpha / (n.arm.alpha + n.arm.beta) : 0.5,
    }))

    return NextResponse.json({ children: result })
  } catch (err) {
    console.error('[/api/taste/children] Error:', err)
    return NextResponse.json({ children: [], error: String(err) }, { status: 500 })
  }
}
