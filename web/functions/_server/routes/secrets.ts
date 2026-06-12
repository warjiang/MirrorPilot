import { Hono } from 'hono'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { profiles, userProfiles } from '../db/schema'

export const secretsRoutes = new Hono<AppEnv>()

secretsRoutes.get('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const rows = await db
    .select({
      profileId: profiles.id,
      profileName: profiles.name,
      registry: profiles.registry,
      destUser: profiles.username,
      enabled: userProfiles.enabled,
    })
    .from(userProfiles)
    .innerJoin(profiles, eq(profiles.id, userProfiles.profileId))
    .where(eq(userProfiles.userId, userId))
    .orderBy(asc(profiles.registry), asc(profiles.name))

  const secrets = rows
    .filter((row) => row.enabled === 1)
    .map((row) => ({
      profileId: row.profileId,
      profileName: row.profileName,
      registry: row.registry,
      destUser: row.destUser,
      destPass: '***',
    }))

  return c.json({ secrets })
})

secretsRoutes.post('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  let body: { registry?: string; destUser?: string; destPass?: string; profileName?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  if (!body.registry || !body.destUser || !body.destPass) {
    return c.json({ error: 'registry, destUser, and destPass are required' }, 400)
  }

  try {
    new URL(`https://${body.registry}`)
  } catch {
    return c.json({ error: 'invalid registry format' }, 400)
  }

  let profileName = (body.profileName || '').trim()
  if (!profileName) {
    const existing = await db
      .select({ name: profiles.name })
      .from(userProfiles)
      .innerJoin(profiles, eq(profiles.id, userProfiles.profileId))
      .where(and(eq(userProfiles.userId, userId), eq(profiles.registry, body.registry)))
      .orderBy(asc(profiles.id))
      .limit(1)

    profileName = existing[0]?.name || `profile-${body.registry.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
  }

  await db
    .insert(profiles)
    .values({
      name: profileName,
      registry: body.registry,
      authType: 'basic',
      username: body.destUser,
      passwordSecret: body.destPass,
      isActive: 1,
    })
    .onConflictDoUpdate({
      target: profiles.name,
      set: {
        registry: body.registry,
        username: body.destUser,
        passwordSecret: body.destPass,
        authType: 'basic',
        isActive: 1,
        updatedAt: sql`datetime('now')`,
      },
    })

  const profile = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.name, profileName))
    .limit(1)

  if (!profile[0]) {
    return c.json({ error: 'failed to create profile' }, 500)
  }

  await db
    .insert(userProfiles)
    .values({
      userId,
      profileId: profile[0].id,
      enabled: 1,
      grantedBy: userId,
    })
    .onConflictDoUpdate({
      target: [userProfiles.userId, userProfiles.profileId],
      set: {
        enabled: 1,
        updatedAt: sql`datetime('now')`,
      },
    })

  return c.json({ ok: true, profileName })
})

secretsRoutes.delete('/registry', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const registry = c.req.query('registry')
  if (!registry) {
    return c.json({ error: 'registry query parameter is required' }, 400)
  }

  const rows = await db
    .select({ profileId: profiles.id })
    .from(userProfiles)
    .innerJoin(profiles, eq(profiles.id, userProfiles.profileId))
    .where(and(eq(userProfiles.userId, userId), eq(profiles.registry, registry)))

  if (rows.length) {
    await db.batch([
      db
        .update(profiles)
        .set({ username: '', passwordSecret: '', updatedAt: sql`datetime('now')` })
        .where(inArray(profiles.id, rows.map((row) => row.profileId))),
    ])
  }

  return c.json({ ok: true })
})
