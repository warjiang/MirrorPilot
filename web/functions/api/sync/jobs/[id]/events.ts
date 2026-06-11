import type { Env } from '@functions/_env'
import { isSyncSecretAuthorized } from '../../../_auth'

interface SyncEvent {
  image_id: number
  success: boolean
  error?: string
  duration_ms?: number
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!isSyncSecretAuthorized(request, env)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = params.id as string
  const body = await request.json<{ events: SyncEvent[] }>().catch(() => null)
  if (!body?.events?.length) {
    return Response.json({ error: 'Missing events' }, { status: 400 })
  }

  const job = await env.DB.prepare('SELECT id FROM jobs WHERE id = ?')
    .bind(jobId).first<{ id: string }>()
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  const statements: D1PreparedStatement[] = []
  let success = 0
  let failed = 0
  for (const ev of body.events) {
    if (ev.success) {
      success++
      statements.push(
        env.DB.prepare(
          `UPDATE job_items SET status = 'succeeded', error = '', duration_ms = ?, finished_at = datetime('now')
           WHERE job_id = ? AND image_id = ?`
        ).bind(ev.duration_ms ?? null, jobId, ev.image_id),
        env.DB.prepare(
          "UPDATE images SET status = 'synced', synced = 1, synced_at = datetime('now'), sync_error = '' WHERE id = ?"
        ).bind(ev.image_id)
      )
    } else {
      failed++
      statements.push(
        env.DB.prepare(
          `UPDATE job_items SET status = 'failed', error = ?, duration_ms = ?, finished_at = datetime('now')
           WHERE job_id = ? AND image_id = ?`
        ).bind(ev.error || 'unknown error', ev.duration_ms ?? null, jobId, ev.image_id),
        env.DB.prepare(
          "UPDATE images SET status = 'failed', sync_error = ? WHERE id = ?"
        ).bind(ev.error || 'unknown error', ev.image_id)
      )
    }
  }
  statements.push(
    env.DB.prepare(
      'UPDATE jobs SET image_success = image_success + ?, image_failed = image_failed + ? WHERE id = ?'
    ).bind(success, failed, jobId)
  )

  await env.DB.batch(statements)
  return Response.json({ ok: true, processed: body.events.length })
}
