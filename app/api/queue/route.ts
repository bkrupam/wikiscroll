import { NextResponse } from 'next/server'
import { fillQueue } from '@/lib/queue'

export async function POST() {
  try {
    const result = await fillQueue()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[/api/queue] Error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  return POST()
}
