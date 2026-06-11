import { Hono } from 'hono'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import { images, jobItems, jobs, profiles, registrySecrets } from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { githubHeaders } from '../lib/github'

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

// --- per-job CI callbacks (SYNC_SECRET auth) -------------------------------

syncRoutes.post('/jobs/:id/start', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const jobId = c.req.param('id')
  const body = await c.req.json<{ run_id?: number }>().catch(() => null)
  if (!body?.run_id) {
    return c.json({ error: 'Missing run_id' }, 400)
  }

  const db = c.get('db')
  const result = await db
    .update(jobs)
    .set({ status: 'running', githubRunId: body.run_id, startedAt: sql`datetime('now')` })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ['pending', 'dispatched'])))

  if (!result.meta.changes) {
    return c.json({ error: 'Job not found or not startable' }, 404)
  }
  return c.json({ ok: true })
})

interface SyncEvent {
  image_id: number
  success: boolean
  error?: string
  duration_ms?: number
}

syncRoutes.post('/jobs/:id/events', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const jobId = c.req.param('id')
  const body = await c.req.json<{ events: SyncEvent[] }>().catch(() => null)
  if (!body?.events?.length) {
    return c.json({ error: 'Missing events' }, 400)
  }

  const db = c.get('db')
  const job = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
  if (!job.length) {
    return c.json({ error: 'Job not found' }, 404)
  }

  const statements: BatchItem<'sqlite'>[] = []
  let success = 0
  let failed = 0
  for (const ev of body.events) {
    if (ev.success) {
      success++
      statements.push(
        db
          .update(jobItems)
          .set({ status: 'succeeded', error: '', durationMs: ev.duration_ms ?? null, finishedAt: sql`datetime('now')` })
          .where(and(eq(jobItems.jobId, jobId), eq(jobItems.imageId, ev.image_id))),
        db
          .update(images)
          .set({ status: 'synced', synced: 1, syncedAt: sql`datetime('now')`, syncError: '' })
          .where(eq(images.id, ev.image_id))
      )
    } else {
      failed++
      statements.push(
        db
          .update(jobItems)
          .set({
            status: 'failed',
            error: ev.error || 'unknown error',
            durationMs: ev.duration_ms ?? null,
            finishedAt: sql`datetime('now')`,
          })
          .where(and(eq(jobItems.jobId, jobId), eq(jobItems.imageId, ev.image_id))),
        db
          .update(images)
          .set({ status: 'failed', syncError: ev.error || 'unknown error' })
          .where(eq(images.id, ev.image_id))
      )
    }
  }
  statements.push(
    db
      .update(jobs)
      .set({
        imageSuccess: sql`image_success + ${success}`,
        imageFailed: sql`image_failed + ${failed}`,
      })
      .where(eq(jobs.id, jobId))
  )

  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return c.json({ ok: true, processed: body.events.length })
})

syncRoutes.post('/jobs/:id/complete', async (c) => {
  if (!validSyncSecret(c.req.header('Authorization'), c.env.SYNC_SECRET)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const jobId = c.req.param('id')
  const body = await c.req.json<{ error?: string }>().catch(() => ({}) as { error?: string })

  const db = c.get('db')
  const rows = await db.select({ id: jobs.id, status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
  const job = rows[0]
  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }
  if (job.status === 'cancelled') {
    return c.json({ ok: true, status: 'cancelled' })
  }

  // Items never reported back are marked failed
  await db
    .update(jobItems)
    .set({ status: 'failed', error: 'no result reported', finishedAt: sql`datetime('now')` })
    .where(and(eq(jobItems.jobId, jobId), inArray(jobItems.status, ['pending', 'syncing'])))

  const countRows = await db
    .select({
      success: sql<number>`SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))

  const success = countRows[0]?.success ?? 0
  const failed = countRows[0]?.failed ?? 0
  let status = 'succeeded'
  if (failed > 0) status = success > 0 ? 'partial' : 'failed'

  await db.batch([
    db
      .update(jobs)
      .set({
        status,
        imageSuccess: success,
        imageFailed: failed,
        error: body?.error || '',
        finishedAt: sql`datetime('now')`,
      })
      .where(eq(jobs.id, jobId)),
    // Images stuck in syncing whose items failed are marked failed too
    db
      .update(images)
      .set({ status: 'failed', syncError: 'no result reported' })
      .where(
        and(
          eq(images.status, 'syncing'),
          inArray(
            images.id,
            db
              .select({ id: jobItems.imageId })
              .from(jobItems)
              .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, 'failed')))
          )
        )
      ),
  ])

  return c.json({ ok: true, status, success, failed })
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

  // Create job + items before dispatching so the workflow can report back
  const jobId = crypto.randomUUID()
  const jobStatements: BatchItem<'sqlite'>[] = [
    db.insert(jobs).values({ id: jobId, userId, status: 'pending', imageTotal: payload.length }),
  ]
  for (const row of rows) {
    const fullTarget = row.registry ? `${row.registry}/${row.target}` : row.target
    jobStatements.push(
      db.insert(jobItems).values({ jobId, imageId: row.id, source: row.source, target: fullTarget })
    )
  }
  await db.batch(jobStatements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

  const dispatchRes = await fetch(`https://api.github.com/repos/${c.env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      ...githubHeaders(c.env),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'web-sync',
      client_payload: {
        user_id: userId,
        job_id: jobId,
        images: payload,
      },
    }),
  })

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    await db
      .update(jobs)
      .set({ status: 'failed', error: `GitHub dispatch failed: ${text}`, finishedAt: sql`datetime('now')` })
      .where(eq(jobs.id, jobId))
    return c.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, 502)
  }

  // Mark images as syncing and job as dispatched
  await db.batch([
    db
      .update(images)
      .set({ status: 'syncing' })
      .where(inArray(images.id, payload.map((img) => img.id))),
    db.update(jobs).set({ status: 'dispatched' }).where(eq(jobs.id, jobId)),
  ])

  return c.json({ ok: true, count: payload.length, jobId })
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
