import type { Env } from '@functions/_env'
import { isSyncSecretAuthorized } from '../../../_auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!isSyncSecretAuthorized(request, env)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = params.id as string
  const body = await request.json<{ error?: string }>().catch(() => ({} as { error?: string }))

  const job = await env.DB.prepare('SELECT id, status FROM jobs WHERE id = ?')
    .bind(jobId).first<{ id: string; status: string }>()
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.status === 'cancelled') {
    return Response.json({ ok: true, status: 'cancelled' })
  }

  // Items never reported back are marked failed
  await env.DB.prepare(
    `UPDATE job_items SET status = 'failed', error = 'no result reported', finished_at = datetime('now')
     WHERE job_id = ? AND status IN ('pending', 'syncing')`
  ).bind(jobId).run()

  const counts = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM job_items WHERE job_id = ?`
  ).bind(jobId).first<{ success: number; failed: number }>()

  const success = counts?.success ?? 0
  const failed = counts?.failed ?? 0
  let status = 'succeeded'
  if (failed > 0) status = success > 0 ? 'partial' : 'failed'

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = ?, image_success = ?, image_failed = ?, error = ?, finished_at = datetime('now')
       WHERE id = ?`
    ).bind(status, success, failed, body?.error || '', jobId),
    // Images stuck in syncing whose items failed are marked failed too
    env.DB.prepare(
      `UPDATE images SET status = 'failed', sync_error = 'no result reported'
       WHERE status = 'syncing' AND id IN (SELECT image_id FROM job_items WHERE job_id = ? AND status = 'failed')`
    ).bind(jobId),
  ])

  return Response.json({ ok: true, status, success, failed })
}
