import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { imageProfiles, images, profiles, sessions, userImages, userProfiles, users } from '../db/schema'
import { defaultAvatarUrl } from '../lib/avatar'

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
      image_count: sql<number>`(SELECT COUNT(*) FROM ${userImages} WHERE ${userImages.userId} = ${users.id} AND ${userImages.deletedAt} IS NULL)`,
    })
    .from(users)
    .orderBy(desc(users.createdAt))

  return c.json({
    users: rows.map((u) => ({ ...u, avatar_url: u.avatar_url || defaultAvatarUrl(u.email) })),
  })
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
  const u = updated[0]
  return c.json({ user: { ...u, avatar_url: u.avatar_url || defaultAvatarUrl(u.email) } })
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
    db.delete(userProfiles).where(eq(userProfiles.userId, targetId)),
    db.delete(userImages).where(eq(userImages.userId, targetId)),
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
      synced: sql<number>`CASE WHEN ${images.lastSyncStatus} = 'synced' THEN 1 ELSE 0 END`,
      notes: images.notes,
      created_at: images.createdAt,
      synced_at: images.lastSyncAt,
      owner_email: users.email,
      owner_name: users.name,
    })
    .from(userImages)
    .innerJoin(images, eq(images.id, userImages.imageId))
    .innerJoin(users, eq(users.id, userImages.userId))
    .where(isNull(userImages.deletedAt))
    .orderBy(desc(images.createdAt))

  const imageIds = [...new Set(rows.map((r) => r.id))]
  const profileRows = imageIds.length
    ? await db
        .select({
          image_id: imageProfiles.imageId,
          profile_name: profiles.name,
          is_default: imageProfiles.isDefault,
          priority: imageProfiles.priority,
        })
        .from(imageProfiles)
        .innerJoin(profiles, eq(profiles.id, imageProfiles.profileId))
        .where(and(inArray(imageProfiles.imageId, imageIds), eq(imageProfiles.enabled, 1)))
        .orderBy(desc(imageProfiles.isDefault), asc(imageProfiles.priority))
    : []

  const profileByImageId = new Map<number, string>()
  for (const row of profileRows) {
    if (!profileByImageId.has(row.image_id)) {
      profileByImageId.set(row.image_id, row.profile_name)
    }
  }

  return c.json({
    images: rows.map((row) => ({
      ...row,
      profile: profileByImageId.get(row.id) || 'default',
    })),
  })
})
