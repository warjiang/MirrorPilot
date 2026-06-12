import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import type { Db } from '../db'
import {
  imageProfiles,
  images,
  jobItems,
  jobs,
  profiles,
  syncJobEvents,
  userImages,
  userProfiles,
} from '../db/schema'
import { authMiddleware } from '../middleware/auth'
import { githubHeaders } from '../lib/github'
import { isV2ConfigPayload } from './images'
import type { V2ConfigPayload } from './images'

/**
 * Additively materialize draft images from a V2ConfigPayload without deleting
 * existing user data. Only inserts new profiles/images/associations that don't
 * already exist.
 */
async function materializeDraftImages(db: Db, userId: number, body: V2ConfigPayload): Promise<number[]> {
  const newImageIds: number[] = []
  const profileIdsByName = new Map<string, number>()

  // Upsert profiles (same logic as full materialize but without delete)
  for (const p of body.profiles) {
    const name = String(p.name || '').trim()
    if (!name) continue

    await db
      .insert(profiles)
      .values({
        name,
        registry: String(p.registry || '').trim(),
        namespace: String(p.namespace || '').trim(),
        authType: String(p.auth_type || 'basic'),
        username: String(p.username || ''),
        passwordSecret: String(p.password_secret || ''),
        isActive: typeof p.is_active === 'boolean' ? (p.is_active ? 1 : 0) : (p.is_active ?? 1),
      })
      .onConflictDoUpdate({
        target: profiles.name,
        set: {
          registry: String(p.registry || '').trim(),
          namespace: String(p.namespace || '').trim(),
          authType: String(p.auth_type || 'basic'),
          username: String(p.username || ''),
          passwordSecret: String(p.password_secret || ''),
          isActive: typeof p.is_active === 'boolean' ? (p.is_active ? 1 : 0) : (p.is_active ?? 1),
          updatedAt: sql`datetime('now')`,
        },
      })
  }

  // Resolve profile names to IDs
  const profileNames = body.profiles.map((p) => String(p.name || '').trim()).filter(Boolean)
  if (profileNames.length > 0) {
    const existingProfiles = await db
      .select({ id: profiles.id, name: profiles.name })
      .from(profiles)
      .where(inArray(profiles.name, profileNames))
    for (const row of existingProfiles) {
      profileIdsByName.set(row.name, row.id)
    }
  }

  // Insert images and user associations additively
  for (const img of body.images) {
    const source = String(img.source || '').trim()
    const target = String(img.default_target || '').trim()
    if (!source || !target) continue

    // Check if image already exists
    const byKey = await db
      .select({ id: images.id })
      .from(images)
      .where(and(eq(images.source, source), eq(images.target, target)))
      .limit(1)

    let imageId: number | null
    if (byKey[0]) {
      imageId = byKey[0].id
    } else {
      const inserted = await db
        .insert(images)
        .values({
          source,
          target,
          isActive: typeof img.is_active === 'boolean' ? (img.is_active ? 1 : 0) : (img.is_active ?? 1),
          notes: String(img.notes || ''),
        })
        .returning({ id: images.id })
      imageId = inserted[0]?.id || null
    }

    if (!imageId) continue
    newImageIds.push(imageId)

    // Insert user_images association if not exists (handle soft-delete restore)
    const existing = await db
      .select({ imageId: userImages.imageId, deletedAt: userImages.deletedAt })
      .from(userImages)
      .where(and(eq(userImages.userId, userId), eq(userImages.imageId, imageId)))
      .limit(1)

    if (existing[0]) {
      if (existing[0].deletedAt) {
        // Restore soft-deleted association
        await db
          .update(userImages)
          .set({ deletedAt: null })
          .where(and(eq(userImages.userId, userId), eq(userImages.imageId, imageId)))
      }
    } else {
      await db.insert(userImages).values({ userId, imageId })
    }

    // Ensure user_profiles link exists
    for (const profileId of profileIdsByName.values()) {
      await db
        .insert(userProfiles)
        .values({ userId, profileId, enabled: 1, grantedBy: userId })
        .onConflictDoNothing()
    }

    // Set up image_profiles for this image
    // Match by client-side image_id (from body.images index) to find the profile assignment
    const clientImageId = typeof img.id === 'number' && Number.isFinite(img.id) ? img.id : null
    const ipEntry = clientImageId
      ? body.image_profiles.find((ip) => ip.image_id === clientImageId)
      : body.image_profiles.find((ip) => ip.source === img.source && ip.default_target === img.default_target)
    const profileNameForImage = ipEntry?.profile_name
    const profileIdForImage = profileNameForImage
      ? profileIdsByName.get(profileNameForImage)
      : (ipEntry?.profile_id
        ? [...profileIdsByName.values()].find((id) => id === ipEntry.profile_id)
        : null)
    const resolvedProfileId = profileIdForImage ?? (profileIdsByName.values().next().value ?? null)

    if (resolvedProfileId) {
      const ipExists = await db
        .select({ imageId: imageProfiles.imageId })
        .from(imageProfiles)
        .where(and(eq(imageProfiles.imageId, imageId), eq(imageProfiles.profileId, resolvedProfileId)))
        .limit(1)

      if (!ipExists[0]) {
        await db.insert(imageProfiles).values({
          imageId,
          profileId: resolvedProfileId,
          enabled: 1,
          priority: 0,
          isDefault: 1,
        })
      }
    }
  }

  return newImageIds
}

export const syncRoutes = new Hono<AppEnv>()

function validSyncSecret(authHeader: string | undefined, secret: string): boolean {
  return authHeader === `Bearer ${secret}`
}

async function appendJobEvent(
  c: Context<AppEnv>,
  opts: {
    jobId: string
    jobItemId?: number | null
    eventType: string
    eventSource?: string
    payload?: unknown
    httpStatus?: number | null
    message?: string
  }
) {
  const db = c.get('db')
  await db.insert(syncJobEvents).values({
    jobId: opts.jobId,
    jobItemId: opts.jobItemId ?? null,
    eventType: opts.eventType,
    eventSource: opts.eventSource || 'manual',
    payloadJson: JSON.stringify(opts.payload ?? {}),
    httpStatus: opts.httpStatus ?? null,
    message: opts.message || '',
  })
}

async function loadProfileChoiceForImages(db: Db, userId: number, imageIds: number[]) {
  if (!imageIds.length) return new Map<number, {
    profileId: number
    profileName: string
    registry: string
    namespace: string
    username: string
    password: string
  }>()

  const rows = await db
    .select({
      imageId: imageProfiles.imageId,
      profileId: profiles.id,
      profileName: profiles.name,
      registry: profiles.registry,
      namespace: profiles.namespace,
      username: profiles.username,
      password: profiles.passwordSecret,
      isDefault: imageProfiles.isDefault,
      priority: imageProfiles.priority,
    })
    .from(imageProfiles)
    .innerJoin(profiles, eq(profiles.id, imageProfiles.profileId))
    .where(
      and(
        inArray(imageProfiles.imageId, imageIds),
        eq(imageProfiles.enabled, 1),
        eq(profiles.isActive, 1)
      )
    )
    .orderBy(
      asc(imageProfiles.imageId),
      desc(imageProfiles.isDefault),
      asc(imageProfiles.priority),
      asc(profiles.id)
    )

  const picked = new Map<number, {
    profileId: number
    profileName: string
    registry: string
    namespace: string
    username: string
    password: string
  }>()

  for (const row of rows) {
    if (!picked.has(row.imageId)) {
      picked.set(row.imageId, {
        profileId: row.profileId,
        profileName: row.profileName,
        registry: row.registry,
        namespace: row.namespace,
        username: row.username,
        password: row.password,
      })
    }
  }

  return picked
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
  const uiRows = await db
    .select({
      imageId: userImages.imageId,
      source: images.source,
      target: images.target,
    })
    .from(userImages)
    .innerJoin(images, eq(images.id, userImages.imageId))
    .where(
      and(
        eq(userImages.userId, Number(userId)),
        isNull(userImages.deletedAt),
        eq(images.lastSyncStatus, 'syncing')
      )
    )

  const profileChoices = await loadProfileChoiceForImages(
    db,
    Number(userId),
    uiRows.map((r) => r.imageId)
  )

  const rows = uiRows.map((row) => {
    const profile = profileChoices.get(row.imageId)
    const target = row.target
    const targetWithNs = profile?.namespace ? `${profile.namespace}/${target}` : target
    return {
      id: row.imageId,
      source: row.source,
      target: targetWithNs,
      profile: profile?.profileName || 'default',
      registry: profile?.registry || '',
      username_env: profile?.username || '',
      password_env: profile?.password || '',
    }
  })

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
            lastSyncStatus: 'synced',
            lastSyncAt: sql`datetime('now')`,
            lastError: '',
            updatedAt: sql`datetime('now')`,
          })
          .where(eq(images.id, result.image_id))
      : db
          .update(images)
          .set({
            lastSyncStatus: 'failed',
            lastError: result.error || 'unknown error',
            updatedAt: sql`datetime('now')`,
          })
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

  await appendJobEvent(c, {
    jobId,
    eventType: 'job_started',
    eventSource: 'webhook',
    payload: body,
    message: `workflow run ${body.run_id} started`,
  })

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

  const itemRows = await db
    .select({
      id: jobItems.id,
      imageId: jobItems.imageId,
      userId: jobItems.userId,
    })
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))

  const itemByImageId = new Map(itemRows.map((r) => [r.imageId, r]))

  const statements: BatchItem<'sqlite'>[] = []
  let success = 0
  let failed = 0

  for (const ev of body.events) {
    const item = itemByImageId.get(ev.image_id)
    if (!item) continue

    if (ev.success) {
      success++
      statements.push(
        db
          .update(jobItems)
          .set({ status: 'succeeded', error: '', durationMs: ev.duration_ms ?? null, finishedAt: sql`datetime('now')` })
          .where(eq(jobItems.id, item.id)),
        db
          .update(images)
          .set({
            lastSyncStatus: 'synced',
            lastSyncAt: sql`datetime('now')`,
            lastError: '',
            updatedAt: sql`datetime('now')`,
          })
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
          .where(eq(jobItems.id, item.id)),
        db
          .update(images)
          .set({
            lastSyncStatus: 'failed',
            lastError: ev.error || 'unknown error',
            updatedAt: sql`datetime('now')`,
          })
          .where(eq(images.id, ev.image_id))
      )
    }

    statements.push(
      db.insert(syncJobEvents).values({
        jobId,
        jobItemId: item.id,
        eventType: ev.success ? 'item_succeeded' : 'item_failed',
        eventSource: 'webhook',
        payloadJson: JSON.stringify(ev),
        message: ev.success ? 'item sync succeeded' : (ev.error || 'item sync failed'),
      })
    )
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
    db
      .update(images)
      .set({
        lastSyncStatus: 'failed',
        lastError: 'no result reported',
        updatedAt: sql`datetime('now')`,
      })
      .where(
        and(
          inArray(
            images.id,
            db
              .select({ imageId: jobItems.imageId })
              .from(jobItems)
              .where(and(eq(jobItems.jobId, jobId), eq(jobItems.status, 'failed')))
          ),
          eq(images.lastSyncStatus, 'syncing')
        )
      ),
    db.insert(syncJobEvents).values({
      jobId,
      eventType: 'job_completed',
      eventSource: 'webhook',
      payloadJson: JSON.stringify({ status, success, failed, error: body?.error || '' }),
      message: `job completed with status=${status}`,
    }),
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
    .select({ destUser: profiles.username, destPass: profiles.passwordSecret })
    .from(profiles)
    .where(
      and(
        eq(profiles.registry, registry),
        eq(profiles.isActive, 1),
        isNotNull(profiles.passwordSecret)
      )
    )
    .orderBy(asc(profiles.id))
    .limit(1)

  if (!rows[0] || !rows[0].destUser || !rows[0].destPass) {
    return c.json({ error: 'registry secret not found' }, 404)
  }

  return c.json({ destUser: rows[0].destUser, destPass: rows[0].destPass })
})

// --- user-facing endpoints (session auth) ----------------------------------

syncRoutes.post('/trigger', authMiddleware, async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id
  const contentType = c.req.header('content-type') || ''

  let requestedImageIds: number[] | null = null

  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ draft?: V2ConfigPayload; image_ids?: number[] } | V2ConfigPayload>().catch(() => null)
    if (body && typeof body === 'object') {
      const draft = 'draft' in body ? body.draft : body
      if (isV2ConfigPayload(draft)) {
        // Use additive materialization to avoid wiping existing images
        const materializedIds = await materializeDraftImages(db, userId, draft)
        // Include newly materialized image IDs in the sync request
        if (materializedIds.length > 0) {
          if (!requestedImageIds) requestedImageIds = []
          requestedImageIds.push(...materializedIds)
        }
      }
      if ('image_ids' in body && Array.isArray(body.image_ids)) {
        const ids = body.image_ids.filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
        if (!requestedImageIds) requestedImageIds = ids
        else requestedImageIds.push(...ids)
      }
    }
  }

  // Deduplicate requested image IDs
  if (requestedImageIds?.length) {
    requestedImageIds = [...new Set(requestedImageIds)]
  }

  const baseFilter = and(eq(userImages.userId, userId), isNull(userImages.deletedAt), eq(images.isActive, 1))
  const whereClause = requestedImageIds?.length
    ? and(baseFilter, inArray(userImages.imageId, requestedImageIds))
    : baseFilter

  const uiRows = await db
    .select({
      imageId: userImages.imageId,
      source: images.source,
      defaultTarget: images.target,
      lastSyncStatus: images.lastSyncStatus,
    })
    .from(userImages)
    .innerJoin(images, eq(images.id, userImages.imageId))
    .where(whereClause)

  // Filter out already synced/syncing images
  const syncableRows = uiRows.filter((r) => r.lastSyncStatus !== 'synced' && r.lastSyncStatus !== 'syncing')

  const profileChoices = await loadProfileChoiceForImages(
    db,
    userId,
    syncableRows.map((r) => r.imageId)
  )

  const rows = syncableRows
    .map((row) => {
      const profile = profileChoices.get(row.imageId)
      if (!profile) return null

      return {
        id: row.imageId,
        source: row.source,
        target: row.defaultTarget,
        profileId: profile.profileId,
        profile: profile.profileName,
        registry: profile.registry,
        namespace: profile.namespace,
        username_env: profile.username,
        password_env: profile.password,
      }
    })
    .filter((row): row is NonNullable<typeof row> => !!row)

  if (!rows.length) {
    return c.json({ ok: false, message: 'No images to sync' })
  }

  const payload = rows.map((row) => {
    const targetWithNs = row.namespace ? `${row.namespace}/${row.target}` : row.target
    return {
      id: row.id,
      source: row.source,
      target: targetWithNs,
      registry: row.registry || '',
      username: row.username_env || '',
      password: row.password_env || '',
    }
  })

  const jobId = crypto.randomUUID()
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID()
  const jobStatements: BatchItem<'sqlite'>[] = [
    db.insert(jobs).values({
      id: jobId,
      userId,
      requestId,
      status: 'pending',
      imageTotal: payload.length,
    }),
  ]

  for (const row of rows) {
    const targetWithNs = row.namespace ? `${row.namespace}/${row.target}` : row.target
    const fullTarget = row.registry ? `${row.registry}/${targetWithNs}` : targetWithNs
    jobStatements.push(
      db.insert(jobItems).values({
        jobId,
        userId,
        imageId: row.id,
        profileId: row.profileId,
        source: row.source,
        target: fullTarget,
      })
    )
  }

  jobStatements.push(
    db.insert(syncJobEvents).values({
      jobId,
      eventType: 'job_triggered',
      eventSource: 'manual',
      payloadJson: JSON.stringify({ payloadCount: payload.length }),
      message: 'sync trigger accepted',
    })
  )

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
    await db.batch([
      db
        .update(jobs)
        .set({ status: 'failed', error: `GitHub dispatch failed: ${text}`, finishedAt: sql`datetime('now')` })
        .where(eq(jobs.id, jobId)),
      db.insert(syncJobEvents).values({
        jobId,
        eventType: 'dispatch_failed',
        eventSource: 'manual',
        payloadJson: JSON.stringify({ error: text }),
        httpStatus: dispatchRes.status,
        message: 'GitHub dispatch failed',
      }),
    ])

    return c.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, 502)
  }

  await db.batch([
    db
      .update(images)
      .set({ lastSyncStatus: 'syncing', lastError: '', updatedAt: sql`datetime('now')` })
      .where(inArray(images.id, payload.map((img) => img.id))),
    db
      .update(jobItems)
      .set({ status: 'syncing' })
      .where(eq(jobItems.jobId, jobId)),
    db.update(jobs).set({ status: 'dispatched' }).where(eq(jobs.id, jobId)),
    db.insert(syncJobEvents).values({
      jobId,
      eventType: 'job_dispatched',
      eventSource: 'manual',
      payloadJson: JSON.stringify({ payloadCount: payload.length }),
      message: 'dispatched to GitHub Actions',
    }),
  ])

  return c.json({ ok: true, count: payload.length, jobId })
})

syncRoutes.get('/status', authMiddleware, async (c) => {
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
