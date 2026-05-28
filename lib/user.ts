import type { NextRequest, NextResponse } from 'next/server'
import { db } from './db'

const COOKIE = 'wikiscroll_uid'
const ONE_YEAR_S = 60 * 60 * 24 * 365

/**
 * Read the user cookie. If absent, create a new User row and return its id
 * plus a flag so the caller can attach a Set-Cookie header to the response.
 *
 * We do this per request rather than via middleware to keep DB writes
 * explicit and avoid edge-runtime constraints.
 */
export async function ensureUser(req: NextRequest): Promise<{ userId: string; isNew: boolean }> {
  const existing = req.cookies.get(COOKIE)?.value
  if (existing) {
    const found = await db.user.findUnique({ where: { id: existing } })
    if (found) return { userId: existing, isNew: false }
  }
  const user = await db.user.create({ data: {} })
  return { userId: user.id, isNew: true }
}

/** Attach the user cookie to a response. Called by routes that create new users. */
export function attachUserCookie(res: NextResponse, userId: string): NextResponse {
  res.cookies.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   ONE_YEAR_S,
  })
  return res
}
