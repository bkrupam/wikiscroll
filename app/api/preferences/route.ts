import { NextRequest, NextResponse } from 'next/server'
import { boostExplicit } from '@/lib/algorithm'

/**
 * Explicit topic selection from the settings modal.
 * Body: { add: string[]; remove?: string[] }   — node ids, not names.
 *
 * `add` applies a +5 alpha boost on the node + tapered boost up the chain
 * (see boostExplicit in lib/algorithm.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const { add = [] } = await req.json() as { add?: string[] }
    for (const nodeId of add) await boostExplicit(nodeId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/preferences] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
