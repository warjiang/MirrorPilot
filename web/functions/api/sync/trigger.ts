import type { Env } from '@functions/_env'

interface ImageRow {
  id: number
  source: string
  target: string
  profile: string
  registry: string | null
  username_env: string | null
  password_env: string | null
}

async function getUserId(request: Request, env: Env): Promise<number | null> {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (match) {
    const session = await env.DB.prepare(
      "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
    ).bind(match[1]).first<{ user_id: number }>()
    if (session) return session.user_id
  }
  if (env.DEV_USER_EMAIL) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(env.DEV_USER_EMAIL.toLowerCase().trim()).first<{ id: number }>()
    if (user) return user.id
  }
  return null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch images with their profile credentials in one query
  const result = await env.DB.prepare(`
    SELECT i.id, i.source, i.target, i.profile,
           p.registry, p.username_env, p.password_env
    FROM images i
    LEFT JOIN profiles p ON p.user_id = i.user_id AND p.name = i.profile
    WHERE i.user_id = ? AND i.enabled = 1 AND i.status NOT IN ('synced', 'syncing')
  `).bind(userId).all<ImageRow>()

  if (!result.results.length) {
    return Response.json({ ok: false, message: 'No images to sync' })
  }

  const images = result.results.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    registry: row.registry || '',
    username: row.username_env || '',
    password: row.password_env || '',
  }))

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
        user_id: userId,
        images,
      },
    }),
  })

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    return Response.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, { status: 502 })
  }

  // Mark images as syncing
  const imageIds = images.map((img) => img.id)
  const placeholders = imageIds.map(() => '?').join(',')
  await env.DB.prepare(
    `UPDATE images SET status = 'syncing' WHERE id IN (${placeholders})`
  ).bind(...imageIds).run()

  return Response.json({ ok: true, count: images.length })
}
