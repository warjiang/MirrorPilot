import { eq, gt, and, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { sessions, users } from '../db/schema'

export const SESSION_COOKIE = 'mp_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function getSessionId(request: Request): string | null {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  return match ? match[1] : null
}

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export async function createSession(db: Db, userId: number): Promise<string> {
  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await db.insert(sessions).values({ id: sessionId, userId, expiresAt })
  return sessionId
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

export async function renewSession(db: Db, sessionId: string): Promise<void> {
  const newExpiry = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  await db
    .update(sessions)
    .set({ expiresAt: newExpiry })
    .where(eq(sessions.id, sessionId))
}

export async function getSessionUser(db: Db, sessionId: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, sql`datetime('now')`)))
    .limit(1)
  return rows[0] ?? null
}

export async function getUserByEmail(db: Db, email: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isAdmin: users.isAdmin,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return rows[0] ?? null
}

export async function getOrCreateUserByEmail(db: Db, email: string) {
  await db.insert(users).values({ email }).onConflictDoNothing({ target: users.email })
  const user = await getUserByEmail(db, email)
  if (!user) throw new Error('failed to create user')
  return user
}

export async function getOrCreateUserByEmailWithAdmin(
  db: Db,
  email: string,
  adminEmail?: string
) {
  const normalized = email.toLowerCase().trim()
  const isAdmin = !!adminEmail && normalized === adminEmail.toLowerCase().trim()

  await db.insert(users).values({ email: normalized }).onConflictDoNothing({ target: users.email })
  const user = await getUserByEmail(db, normalized)
  if (!user) throw new Error('failed to create user')

  if (isAdmin && (user.isAdmin !== 1 || user.status !== 'active')) {
    await db
      .update(users)
      .set({ isAdmin: 1, status: 'active' })
      .where(eq(users.id, user.id))
    const refreshed = await getUserByEmail(db, normalized)
    if (!refreshed) throw new Error('failed to refresh user')
    return refreshed
  }

  return user
}
