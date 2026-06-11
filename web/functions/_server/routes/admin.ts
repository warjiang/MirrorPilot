import { Hono } from 'hono'
import { desc, eq, isNotNull, sql } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { images, profiles, registrySecrets, sessions, users } from '../db/schema'

const VALID_STATUSES = ['pending', 'active', 'disabled']

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.get('/users', async (c) => {
  const db = c.get('db')
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar_url: users.avatarUrl,
      is_admin: users.isAdmin,
      status: users.status,
      created_at: users.createdAt,
      has_github: sql<number>`(${isNotNull(users.githubId)})`,
      has_password: sql<number>`(${isNotNull(users.passwordHash)})`,
      image_count: sql<number>`(SELECT COUNT(*) FROM ${images} WHERE ${images.userId} = ${users.id})`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))

  return c.json({ users: rows })
})

adminRoutes.patch('/users/:id', async (c) => {
  const db = c.get('db')
  const authUser = c.get('user')

  const targetId = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400)
  }

  let body: { status?: string; is_admin?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)
  if (!target[0]) {
    return c.json({ error: 'User not found' }, 404)
  }

  const isSelf = targetId === authUser.id

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return c.json({ error: 'Invalid status' }, 400)
    }
    if (isSelf && body.status !== 'active') {
      return c.json({ error: 'Cannot change your own status' }, 400)
    }
    await db.update(users).set({ status: body.status }).where(eq(users.id, targetId))
    if (body.status === 'disabled') {
      await db.delete(sessions).where(eq(sessions.userId, targetId))
    }
  }

  if (body.is_admin !== undefined) {
    if (isSelf && !body.is_admin) {
      return c.json({ error: 'Cannot remove your own admin role' }, 400)
    }
    await db
      .update(users)
      .set({ isAdmin: body.is_admin ? 1 : 0 })
      .where(eq(users.id, targetId))
  }

  const updated = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatar_url: users.avatarUrl,
      is_admin: users.isAdmin,
      status: users.status,
      created_at: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)
  return c.json({ user: updated[0] })
})

adminRoutes.delete('/users/:id', async (c) => {
  const db = c.get('db')
  const authUser = c.get('user')

  const targetId = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(targetId)) {
    return c.json({ error: 'Invalid user id' }, 400)
  }
  if (targetId === authUser.id) {
    return c.json({ error: 'Cannot delete your own account' }, 400)
  }

  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetId))
    .limit(1)
  if (!target[0]) {
    return c.json({ error: 'User not found' }, 404)
  }

  await db.batch([
    db.delete(sessions).where(eq(sessions.userId, targetId)),
    db.delete(images).where(eq(images.userId, targetId)),
    db.delete(profiles).where(eq(profiles.userId, targetId)),
    db.delete(registrySecrets).where(eq(registrySecrets.userId, targetId)),
    db.delete(users).where(eq(users.id, targetId)),
  ])

  return c.json({ ok: true })
})

adminRoutes.get('/images', async (c) => {
  const db = c.get('db')
  const rows = await db
    .select({
      id: images.id,
      source: images.source,
      target: images.target,
      profile: images.profile,
      enabled: images.enabled,
      synced: images.synced,
      notes: images.notes,
      created_at: images.createdAt,
      synced_at: images.syncedAt,
      owner_email: users.email,
      owner_name: users.name,
    })
    .from(images)
    .innerJoin(users, eq(users.id, images.userId))
    .orderBy(desc(images.createdAt))

  return c.json({ images: rows })
})
