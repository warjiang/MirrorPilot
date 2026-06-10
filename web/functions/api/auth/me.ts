import type { Env } from '@functions/_env'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Dev bypass: return dev user when DEV_USER_EMAIL is configured
  if (env.DEV_USER_EMAIL) {
    const user = await env.DB.prepare(
      'SELECT id, email, name, avatar_url, is_admin FROM users WHERE email = ?'
    ).bind(env.DEV_USER_EMAIL.toLowerCase().trim()).first()
    return Response.json({ user: user || { id: 0, email: env.DEV_USER_EMAIL, name: 'Dev User', avatar_url: '', is_admin: 0 } })
  }

  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (!match) {
    return Response.json({ user: null }, { status: 401 })
  }

  const sessionId = match[1]
  const session = await env.DB.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).bind(sessionId).first<{ user_id: number }>()

  if (!session) {
    return Response.json({ user: null }, { status: 401 })
  }

  const user = await env.DB.prepare(
    'SELECT id, email, name, avatar_url, is_admin FROM users WHERE id = ?'
  ).bind(session.user_id).first()

  return Response.json({ user })
}
