import type { Env } from '@functions/_env'
import { getUserId, githubHeaders } from '../../_auth'

interface JobRow {
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

async function reconcile(env: Env, job: JobRow): Promise<JobRow> {
  if (!['dispatched', 'running'].includes(job.status)) return job

  // Dispatched but never started: mark failed after timeout
  if (!job.github_run_id) {
    const stale = await env.DB.prepare(
      `SELECT 1 AS stale FROM jobs WHERE id = ? AND created_at < datetime('now', ?)`
    ).bind(job.id, `-${STALE_MINUTES} minutes`).first<{ stale: number }>()
    if (stale) {
      await env.DB.prepare(
        `UPDATE jobs SET status = 'failed', error = 'workflow never started', finished_at = datetime('now') WHERE id = ?`
      ).bind(job.id).run()
      return { ...job, status: 'failed', error: 'workflow never started' }
    }
    return job
  }

  // Running: check whether the GitHub run already finished
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}`,
    { headers: githubHeaders(env) }
  )
  if (!res.ok) return job
  const run = await res.json() as { status: string; conclusion: string | null }
  if (run.status !== 'completed') return job

  // Run finished but no complete callback arrived — finalize from item counts
  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success,
       SUM(CASE WHEN status NOT IN ('succeeded') THEN 1 ELSE 0 END) AS failed
     FROM job_items WHERE job_id = ?`
  ).bind(job.id).first<{ success: number; failed: number }>()
  const success = counts?.success ?? 0
  const failed = counts?.failed ?? 0

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

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE job_items SET status = ?, finished_at = datetime('now')
       WHERE job_id = ? AND status IN ('pending', 'syncing')`
    ).bind(run.conclusion === 'cancelled' ? 'cancelled' : 'failed', job.id),
    env.DB.prepare(
      `UPDATE jobs SET status = ?, image_success = ?, image_failed = ?, error = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).bind(status, success, failed, error, job.id),
    env.DB.prepare(
      `UPDATE images SET status = 'pending'
       WHERE status = 'syncing' AND id IN (SELECT image_id FROM job_items WHERE job_id = ?)`
    ).bind(job.id),
  ])
  return { ...job, status, image_success: success, image_failed: failed, error }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = params.id as string
  let job = await env.DB.prepare(
    `SELECT id, status, github_run_id, image_total, image_success, image_failed,
            error, created_at, started_at, finished_at
     FROM jobs WHERE id = ? AND user_id = ?`
  ).bind(jobId, userId).first<JobRow>()

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  job = await reconcile(env, job)

  const items = await env.DB.prepare(
    `SELECT id, image_id, source, target, status, error, duration_ms, finished_at
     FROM job_items WHERE job_id = ? ORDER BY id`
  ).bind(jobId).all()

  const runUrl = job.github_run_id
    ? `https://github.com/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}`
    : null

  return Response.json({ job: { ...job, run_url: runUrl }, items: items.results })
}
