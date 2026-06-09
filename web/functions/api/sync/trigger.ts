import type { Env } from '../../_env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (!match) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const session = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).bind(match[1]).first<{ user_id: number }>()

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const images = await env.DB.prepare(
    "SELECT id FROM images WHERE user_id = ? AND enabled = 1 AND status NOT IN ('synced', 'syncing')"
  ).bind(session.user_id).all<{ id: number }>()

  if (!images.results.length) {
    return Response.json({ ok: false, message: 'No images to sync' })
  }

  const imageIds = images.results.map((image) => image.id)
  const dispatchRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'MirrorPilot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'web-sync',
      client_payload: {
        user_id: session.user_id,
        image_ids: imageIds,
      },
    }),
  })

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    return Response.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, { status: 502 })
  }

  const placeholders = imageIds.map(() => '?').join(',')
  await env.DB.prepare(
    `UPDATE images SET status = 'syncing' WHERE id IN (${placeholders})`
  ).bind(...imageIds).run()

  return Response.json({ ok: true, count: imageIds.length })
}
