import type { Env } from '@functions/_env'
import { isSyncSecretAuthorized } from '../../../_auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!isSyncSecretAuthorized(request, env)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = params.id as string
  const body = await request.json<{ run_id?: number }>().catch(() => null)
  if (!body?.run_id) {
    return Response.json({ error: 'Missing run_id' }, { status: 400 })
  }

  const result = await env.DB.prepare(
    `UPDATE jobs SET status = 'running', github_run_id = ?, started_at = datetime('now')
     WHERE id = ? AND status IN ('pending', 'dispatched')`
  ).bind(body.run_id, jobId).run()

  if (!result.meta.changes) {
    return Response.json({ error: 'Job not found or not startable' }, { status: 404 })
  }
  return Response.json({ ok: true })
}
