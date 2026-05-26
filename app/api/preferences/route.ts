import { NextRequest, NextResponse } from 'next/server'
import { boostExplicit, dampenExplicit } from '@/lib/algorithm'

/**
 * Explicit topic add / remove from the settings modal.
 * Body: { add?: string[]; remove?: string[] }   — TopicNode ids.
 *
 *   add[]    → +5 α on the node + tapered α boost up the chain
 *   remove[] → +5 β on the node only (no chain propagation)
 */
export async function POST(req: NextRequest) {
  try {
    const { add = [], remove = [] } = await req.json() as {
      add?:    string[]
      remove?: string[]
    }
    for (const nodeId of add)    await boostExplicit(nodeId)
    for (const nodeId of remove) await dampenExplicit(nodeId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/preferences] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
