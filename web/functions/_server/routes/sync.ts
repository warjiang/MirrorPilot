import { Hono } from 'hono'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import { images, profiles, registrySecrets } from '../db/schema'
import { authMiddleware } from '../middleware/auth'

export const syncRoutes = new Hono<AppEnv>()

function validSyncSecret(authHeader: string | undefined, secret: string): boolean {
  return authHeader === `Bearer ${secret}`
}

// --- CI-facing endpoints (SYNC_SECRET auth, no session) -------------------

syncRoutes.get('/pending', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const userId = c.req.query('user_id')
  if (!userId) {
    return c.json({ error: 'Missing user_id' }, 400)
  }

  const db = c.get('db')
  const rows = await db
    .select({
      id: images.id,
      source: images.source,
      target: images.target,
      profile: images.profile,
      registry: profiles.registry,
      username_env: profiles.usernameEnv,
      password_env: profiles.passwordEnv,
    })
    .from(images)
    .leftJoin(profiles, and(eq(profiles.userId, images.userId), eq(profiles.name, images.profile)))
    .where(and(eq(images.userId, Number(userId)), eq(images.status, 'syncing')))

  return c.json({ images: rows })
})

syncRoutes.post('/complete', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const db = c.get('db')
  const body = await c.req.json<{ results: Array<{ image_id: number; success: boolean; error?: string }> }>()
  if (!body?.results?.length) {
    return c.json({ error: 'Missing results' }, 400)
  }

  const statements: BatchItem<'sqlite'>[] = body.results.map((result) =>
    result.success
      ? db
          .update(images)
          .set({
            status: 'synced',
            synced: 1,
            syncedAt: sql`datetime('now')`,
            syncError: '',
          })
          .where(eq(images.id, result.image_id))
      : db
          .update(images)
          .set({ status: 'failed', syncError: result.error || 'unknown error' })
          .where(eq(images.id, result.image_id))
  )

  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return c.json({ ok: true, processed: body.results.length })
})

// CI secret lookup (kept under /api/secrets/ci historically)
export const ciSecretsRoutes = new Hono<AppEnv>()

ciSecretsRoutes.get('/', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  const registry = c.req.query('registry')
  if (!registry) {
    return c.json({ error: 'registry query parameter is required' }, 400)
  }

  const db = c.get('db')
  const rows = await db
    .select({ destUser: registrySecrets.destUser, destPass: registrySecrets.destPass })
    .from(registrySecrets)
    .where(eq(registrySecrets.registry, registry))
    .limit(1)

  if (!rows[0]) {
    return c.json({ error: 'registry secret not found' }, 404)
  }

  return c.json({ destUser: rows[0].destUser, destPass: rows[0].destPass })
})

// --- user-facing endpoints (session auth) ----------------------------------

syncRoutes.post('/trigger', authMiddleware, async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  // Fetch images with their profile credentials in one query
  const rows = await db
    .select({
      id: images.id,
      source: images.source,
      target: images.target,
      profile: images.profile,
      registry: profiles.registry,
      username_env: profiles.usernameEnv,
      password_env: profiles.passwordEnv,
    })
    .from(images)
    .leftJoin(profiles, and(eq(profiles.userId, images.userId), eq(profiles.name, images.profile)))
    .where(
      and(
        eq(images.userId, userId),
        eq(images.enabled, 1),
        notInArray(images.status, ['synced', 'syncing'])
      )
    )

  if (!rows.length) {
    return c.json({ ok: false, message: 'No images to sync' })
  }

  const payload = rows.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    registry: row.registry || '',
    username: row.username_env || '',
    password: row.password_env || '',
  }))

  const dispatchRes = await fetch(`https://api.github.com/repos/${c.env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'MirrorPilot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'web-sync',
      client_payload: {
        user_id: userId,
        images: payload,
      },
    }),
  })

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    return c.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, 502)
  }

  // Mark images as syncing
  await db
    .update(images)
    .set({ status: 'syncing' })
    .where(inArray(images.id, payload.map((img) => img.id)))

  return c.json({ ok: true, count: payload.length })
})

syncRoutes.get('/status', authMiddleware, async (c) => {
  // Get the latest web-sync workflow runs
  const res = await fetch(
    `https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/runs?event=repository_dispatch&per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MirrorPilot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )

  if (!res.ok) {
    return c.json({ error: 'Failed to fetch workflow runs' }, 502)
  }

  const data = (await res.json()) as {
    workflow_runs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      html_url: string
      created_at: string
      updated_at: string
    }>
  }

  const runs = data.workflow_runs
    .filter((r) => r.name === 'Web Sync')
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

  return c.json({ runs })
})
