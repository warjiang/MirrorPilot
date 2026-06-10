import type { Env } from '@functions/_env'

interface SyncResult {
  image_id: number
  success: boolean
  error?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${env.SYNC_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json<{ results: SyncResult[] }>()
  if (!body?.results?.length) {
    return Response.json({ error: 'Missing results' }, { status: 400 })
  }

  const statements: D1PreparedStatement[] = []
  for (const result of body.results) {
    if (result.success) {
      statements.push(
        env.DB.prepare(
          "UPDATE images SET status = 'synced', synced = 1, synced_at = datetime('now'), sync_error = '' WHERE id = ?"
        ).bind(result.image_id)
      )
      continue
    }

    statements.push(
      env.DB.prepare(
        "UPDATE images SET status = 'failed', sync_error = ? WHERE id = ?"
      ).bind(result.error || 'unknown error', result.image_id)
    )
  }

  await env.DB.batch(statements)
  return Response.json({ ok: true, processed: body.results.length })
}
