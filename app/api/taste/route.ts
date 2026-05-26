import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedRootTopics } from '@/lib/topics'

/**
 * Returns the user's taste tree.
 *  - `roots`: every depth-0 TopicNode with its arm stats.
 *  - Children are NOT included here; the client lazy-loads via /api/taste/children.
 */
export async function GET() {
  try {
    await seedRootTopics()

    const roots = await db.topicNode.findMany({
      where:   { depth: 0 },
      include: { arm: true, children: { select: { id: true } } },
      orderBy: { name: 'asc' },
    })

    const result = roots.map((n) => ({
      id:           n.id,
      name:         n.name,
      depth:        n.depth,
      hasChildren:  n.children.length > 0,
      alpha:        n.arm?.alpha ?? 1,
      beta:         n.arm?.beta  ?? 1,
      totalPulls:   n.arm?.totalPulls ?? 0,
      mean:         n.arm ? n.arm.alpha / (n.arm.alpha + n.arm.beta) : 0.5,
    }))

    return NextResponse.json({ roots: result })
  } catch (err) {
    console.error('[/api/taste] Error:', err)
    return NextResponse.json({ roots: [] }, { status: 500 })
  }
}
