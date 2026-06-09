import type { Env } from '../../_env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (match) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(match[1]).run()
  }

  return new Response(null, {
    status: 200,
    headers: {
      'Set-Cookie': 'mp_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    },
  })
}
