import { Hono } from 'hono'
import { unzipSync, strFromU8 } from 'fflate'
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import type { Db } from '../db'
import type { Env } from '../env'
import { jobItems, jobs, syncJobEvents, userImages } from '../db/schema'
import { githubHeaders } from '../lib/github'

export const jobsRoutes = new Hono<AppEnv>()

const jobSelection = {
  id: jobs.id,
  status: jobs.status,
  github_run_id: jobs.githubRunId,
  image_total: jobs.imageTotal,
  image_success: jobs.imageSuccess,
  image_failed: jobs.imageFailed,
  error: jobs.error,
  created_at: jobs.createdAt,
  started_at: jobs.startedAt,
  finished_at: jobs.finishedAt,
}

type JobRow = {
  id: string
  status: string
  github_run_id: number | null
  image_total: number
  image_success: number
  image_failed: number
  error: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

const STALE_MINUTES = 30

async function reconcile(db: Db, env: Env, job: JobRow): Promise<JobRow> {
  if (!['dispatched', 'running'].includes(job.status)) return job

  if (!job.github_run_id) {
    const stale = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, job.id), lt(jobs.createdAt, sql`datetime('now', ${`-${STALE_MINUTES} minutes`})`)))
      .limit(1)
    if (stale.length) {
      await db
        .update(jobs)
        .set({ status: 'failed', error: 'workflow never started', finishedAt: sql`datetime('now')` })
        .where(eq(jobs.id, job.id))
      return { ...job, status: 'failed', error: 'workflow never started' }
    }
    return job
  }

  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}`,
    { headers: githubHeaders(env) }
  )
  if (!res.ok) return job
  const run = (await res.json()) as { status: string; conclusion: string | null }
  if (run.status !== 'completed') return job

  const countRows = await db
    .select({
      success: sql<number>`SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)`,
      failed: sql<number>`SUM(CASE WHEN status NOT IN ('succeeded') THEN 1 ELSE 0 END)`,
    })
    .from(jobItems)
    .where(eq(jobItems.jobId, job.id))
  const success = countRows[0]?.success ?? 0
  const failed = countRows[0]?.failed ?? 0

  let status: string
  let error = job.error
  if (run.conclusion === 'cancelled') {
    status = 'cancelled'
  } else if (failed > 0) {
    status = success > 0 ? 'partial' : 'failed'
    error = error || `workflow concluded: ${run.conclusion || 'unknown'}`
  } else {
    status = 'succeeded'
  }

  const statements: BatchItem<'sqlite'>[] = [
    db
      .update(jobItems)
      .set({
        status: run.conclusion === 'cancelled' ? 'cancelled' : 'failed',
        finishedAt: sql`datetime('now')`,
      })
      .where(and(eq(jobItems.jobId, job.id), inArray(jobItems.status, ['pending', 'syncing']))),
    db
      .update(jobs)
      .set({
        status,
        imageSuccess: success,
        imageFailed: failed,
        error,
        finishedAt: sql`datetime('now')`,
      })
      .where(eq(jobs.id, job.id)),
    db
      .update(userImages)
      .set({
        lastSyncStatus: status === 'cancelled' ? 'pending' : 'failed',
        lastError: status === 'cancelled' ? '' : (error || 'workflow completed without item callback'),
      })
      .where(
        and(
          eq(userImages.lastSyncStatus, 'syncing'),
          inArray(
            userImages.imageId,
            db.select({ id: jobItems.imageId }).from(jobItems).where(eq(jobItems.jobId, job.id))
          )
        )
      ),
    db.insert(syncJobEvents).values({
      jobId: job.id,
      eventType: 'job_reconciled',
      eventSource: 'poller',
      payloadJson: JSON.stringify({ status, success, failed, runConclusion: run.conclusion }),
      message: 'job reconciled from GitHub run state',
    }),
  ]
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

  return { ...job, status, image_success: success, image_failed: failed, error }
}

jobsRoutes.get('/', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10) || 20, 1), 100)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

  const [rows, countRows] = await Promise.all([
    db
      .select(jobSelection)
      .from(jobs)
      .where(eq(jobs.userId, userId))
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`COUNT(*)` }).from(jobs).where(eq(jobs.userId, userId)),
  ])

  return c.json({
    jobs: rows,
    total: countRows[0]?.total ?? 0,
    limit,
    offset,
  })
})

jobsRoutes.get('/:id', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const userId = user.id
  const jobId = c.req.param('id')

  const rows = await db
    .select(jobSelection)
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1)
  let job = rows[0]
  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }

  job = await reconcile(db, c.env, job)

  const items = await db
    .select({
      id: jobItems.id,
      image_id: jobItems.imageId,
      source: jobItems.source,
      target: jobItems.target,
      status: jobItems.status,
      error: jobItems.error,
      duration_ms: jobItems.durationMs,
      finished_at: jobItems.finishedAt,
    })
    .from(jobItems)
    .where(eq(jobItems.jobId, jobId))
    .orderBy(sql`id`)

  const runUrl = user.isAdmin === 1 && job.github_run_id
    ? `https://github.com/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}`
    : null

  return c.json({ job: { ...job, run_url: runUrl }, items })
})

jobsRoutes.get('/:id/events', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id
  const jobId = c.req.param('id')

  const exists = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1)
  if (!exists[0]) {
    return c.json({ error: 'Job not found' }, 404)
  }

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500)
  const beforeId = Math.max(parseInt(c.req.query('beforeId') || '0', 10) || 0, 0)

  const eventRows = await db
    .select({
      id: syncJobEvents.id,
      job_item_id: syncJobEvents.jobItemId,
      event_type: syncJobEvents.eventType,
      event_source: syncJobEvents.eventSource,
      payload_json: syncJobEvents.payloadJson,
      http_status: syncJobEvents.httpStatus,
      message: syncJobEvents.message,
      created_at: syncJobEvents.createdAt,
    })
    .from(syncJobEvents)
    .where(
      beforeId > 0
        ? and(eq(syncJobEvents.jobId, jobId), lt(syncJobEvents.id, beforeId))
        : eq(syncJobEvents.jobId, jobId)
    )
    .orderBy(sql`id DESC`)
    .limit(limit)

  const items = eventRows.map((row) => ({
    ...row,
    payload: (() => {
      try {
        return JSON.parse(row.payload_json || '{}')
      } catch {
        return { raw: row.payload_json }
      }
    })(),
  }))

  return c.json({
    events: items,
    nextBeforeId: items.length ? items[items.length - 1].id : null,
  })
})

jobsRoutes.post('/:id/cancel', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id
  const jobId = c.req.param('id')

  const rows = await db
    .select({ id: jobs.id, status: jobs.status, github_run_id: jobs.githubRunId })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1)
  const job = rows[0]
  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }
  if (!['pending', 'dispatched', 'running'].includes(job.status)) {
    return c.json({ error: `Job is already ${job.status}` }, 409)
  }

  if (job.github_run_id) {
    const res = await fetch(
      `https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}/cancel`,
      { method: 'POST', headers: githubHeaders(c.env) }
    )
    if (!res.ok && res.status !== 409) {
      const text = await res.text()
      return c.json({ error: `GitHub cancel failed: ${text}` }, 502)
    }
  }

  await db.batch([
    db
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: sql`datetime('now')` })
      .where(eq(jobs.id, jobId)),
    db
      .update(jobItems)
      .set({ status: 'cancelled', finishedAt: sql`datetime('now')` })
      .where(and(eq(jobItems.jobId, jobId), inArray(jobItems.status, ['pending', 'syncing']))),
    db
      .update(userImages)
      .set({ lastSyncStatus: 'pending', lastError: '', lastSyncAt: null })
      .where(
        and(
          eq(userImages.lastSyncStatus, 'syncing'),
          inArray(
            userImages.imageId,
            db
              .select({ id: jobItems.imageId })
              .from(jobItems)
              .where(eq(jobItems.jobId, jobId))
          )
        )
      ),
    db.insert(syncJobEvents).values({
      jobId,
      eventType: 'job_cancelled',
      eventSource: 'manual',
      payloadJson: JSON.stringify({ githubRunId: job.github_run_id }),
      message: 'job cancelled by user',
    }),
  ])

  return c.json({ ok: true })
})

interface RunJob {
  name: string
  status: string
  conclusion: string | null
  steps?: Array<{
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
  }>
}

jobsRoutes.get('/:id/logs', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const userId = user.id
  const jobId = c.req.param('id')

  const rows = await db
    .select({ id: jobs.id, status: jobs.status, github_run_id: jobs.githubRunId })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1)
  const job = rows[0]
  if (!job) {
    return c.json({ error: 'Job not found' }, 404)
  }
  if (!job.github_run_id) {
    return c.json({ available: false, reason: 'Workflow has not started yet' })
  }

  const runUrl = user.isAdmin === 1
    ? `https://github.com/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}`
    : null

  const runRes = await fetch(
    `https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}`,
    { headers: githubHeaders(c.env) }
  )
  if (!runRes.ok) {
    return c.json({ error: 'Failed to query workflow run' }, 502)
  }
  const run = (await runRes.json()) as { status: string }

  if (run.status !== 'completed') {
    const jobsRes = await fetch(
      `https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}/jobs`,
      { headers: githubHeaders(c.env) }
    )
    const steps = jobsRes.ok
      ? (((await jobsRes.json()) as { jobs: RunJob[] }).jobs || []).flatMap((j) =>
          (j.steps || []).map((s) => ({
            job: j.name,
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            started_at: s.started_at,
            completed_at: s.completed_at,
          }))
        )
      : []
    return c.json({ available: false, running: true, run_url: runUrl, steps })
  }

  const logsRes = await fetch(
    `https://api.github.com/repos/${c.env.GITHUB_REPO}/actions/runs/${job.github_run_id}/logs`,
    { headers: githubHeaders(c.env), redirect: 'follow' }
  )
  if (!logsRes.ok) {
    return c.json({
      available: false,
      run_url: runUrl,
      reason: logsRes.status === 410 ? 'Logs have expired' : 'Failed to download logs',
    })
  }

  const zipData = new Uint8Array(await logsRes.arrayBuffer())
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipData)
  } catch {
    return c.json({ available: false, run_url: runUrl, reason: 'Failed to extract logs archive' })
  }

  const logs = Object.keys(files)
    .filter((name) => !name.includes('/') && name.endsWith('.txt'))
    .sort()
    .map((name) => ({
      name: name.replace(/\.txt$/, '').replace(/^\d+_/, ''),
      content: strFromU8(files[name]),
    }))

  return c.json({ available: true, run_url: runUrl, logs })
})
