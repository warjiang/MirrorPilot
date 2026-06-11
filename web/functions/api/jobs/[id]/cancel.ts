import type { Env } from '@functions/_env'
import { getUserId, githubHeaders } from '../../_auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = params.id as string
  const job = await env.DB.prepare(
    'SELECT id, status, github_run_id FROM jobs WHERE id = ? AND user_id = ?'
  ).bind(jobId, userId).first<{ id: string; status: string; github_run_id: number | null }>()

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }
  if (!['pending', 'dispatched', 'running'].includes(job.status)) {
    return Response.json({ error: `Job is already ${job.status}` }, { status: 409 })
  }

  // Cancel the GitHub workflow run if it exists
  if (job.github_run_id) {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}/cancel`,
      { method: 'POST', headers: githubHeaders(env) }
    )
    // 202 = accepted; 409 = run already completed — treat both as ok
    if (!res.ok && res.status !== 409) {
      const text = await res.text()
      return Response.json(
        { error: `GitHub cancel failed: ${text}` },
        { status: 502 }
      )
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?`
    ).bind(jobId),
    env.DB.prepare(
      `UPDATE job_items SET status = 'cancelled', finished_at = datetime('now')
       WHERE job_id = ? AND status IN ('pending', 'syncing')`
    ).bind(jobId),
    // Reset images that were waiting on this job back to pending
    env.DB.prepare(
      `UPDATE images SET status = 'pending'
       WHERE status = 'syncing' AND id IN (SELECT image_id FROM job_items WHERE job_id = ? AND status = 'cancelled')`
    ).bind(jobId),
  ])

  return Response.json({ ok: true })
}
