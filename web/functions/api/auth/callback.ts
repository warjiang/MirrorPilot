import type { Env } from '@functions/_env'

interface TokenResponse {
  access_token?: string
  error?: string
}

interface GitHubUser {
  id: number
  login: string
  email: string | null
  avatar_url: string
}

interface GitHubEmail {
  email: string
  primary: boolean
  verified: boolean
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return new Response('Missing code', { status: 400 })
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = await tokenRes.json<TokenResponse>()
  if (!tokenData.access_token) {
    return new Response(`OAuth error: ${tokenData.error || 'unknown'}`, { status: 400 })
  }

  const token = tokenData.access_token

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MirrorPilot',
    },
  })
  const ghUser = await userRes.json<GitHubUser>()

  let email = ghUser.email
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MirrorPilot',
      },
    })
    const emails = await emailsRes.json<GitHubEmail[]>()
    const primary = emails.find((entry) => entry.primary && entry.verified)
    email = primary?.email || emails[0]?.email || `${ghUser.id}@github.noreply`
  }

  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE github_id = ?')
    .bind(ghUser.id)
    .first<{ id: number }>()

  // Determine if user should be admin
  const isAdmin = env.ADMIN_EMAIL ? 
    email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase() : 
    false

  let userId: number
  if (existingUser) {
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, is_admin = ? WHERE id = ?')
      .bind(email, ghUser.login, ghUser.avatar_url, isAdmin ? 1 : 0, existingUser.id)
      .run()
    userId = existingUser.id
  } else {
    const result = await env.DB.prepare('INSERT INTO users (email, github_id, name, avatar_url, is_admin) VALUES (?, ?, ?, ?, ?)')
      .bind(email, ghUser.id, ghUser.login, ghUser.avatar_url, isAdmin ? 1 : 0)
      .run()
    userId = result.meta.last_row_id as number
  }

  const sessionId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(sessionId, userId, expiresAt)
    .run()

  const cookie = `mp_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/mirrors',
      'Set-Cookie': cookie,
    },
  })
}
