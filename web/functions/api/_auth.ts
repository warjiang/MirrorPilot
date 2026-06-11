import type { Env } from '@functions/_env'

export async function getUserId(request: Request, env: Env): Promise<number | null> {
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

export function isSyncSecretAuthorized(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization')
  return Boolean(env.SYNC_SECRET) && auth === `Bearer ${env.SYNC_SECRET}`
}

export function githubHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MirrorPilot',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
