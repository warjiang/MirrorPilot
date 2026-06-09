import type { Env } from './_env'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/auth/')) {
    return next()
  }

  if (url.pathname.startsWith('/api/')) {
    // Dev bypass: skip auth when DEV_USER_EMAIL is configured
    if (env.DEV_USER_EMAIL) {
      return next()
    }

    const cookie = request.headers.get('Cookie') || ''
    const match = cookie.match(/mp_session=([^;]+)/)
    if (!match) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await env.DB.prepare(
      "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
    )
      .bind(match[1])
      .first<{ user_id: number }>()

    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const newExpiry = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString()
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .bind(newExpiry, match[1])
      .run()

    return next()
  }

  return next()
}
