import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { users } from '../db/schema'
import { hashPassword, verifyPassword } from '../lib/password'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getSessionId,
  getSessionUser,
  getUserByEmail,
  sessionCookie,
} from '../lib/session'

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isAdminEmail(email: string, adminEmail?: string): boolean {
  return adminEmail ? email.toLowerCase() === adminEmail.toLowerCase().trim() : false
}

function toApiUser(user: {
  id: number
  email: string
  name: string
  avatarUrl: string
  isAdmin: number
  status: string
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatarUrl,
    is_admin: user.isAdmin,
    status: user.status,
  }
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/github', (c) => {
  const url = new URL(c.req.url)
  const redirectUri = `${url.origin}/api/auth/callback`
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`, 302)
})

authRoutes.get('/callback', async (c) => {
  const db = c.get('db')
  const code = c.req.query('code')
  if (!code) {
    return c.text('Missing code', 400)
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = (await tokenRes.json()) as TokenResponse
  if (!tokenData.access_token) {
    return c.text(`OAuth error: ${tokenData.error || 'unknown'}`, 400)
  }

  const token = tokenData.access_token

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'MirrorPilot',
    },
  })
  const ghUser = (await userRes.json()) as GitHubUser

  let email = ghUser.email
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MirrorPilot',
      },
    })
    const emails = (await emailsRes.json()) as GitHubEmail[]
    const primary = emails.find((entry) => entry.primary && entry.verified)
    email = primary?.email || emails[0]?.email || `${ghUser.id}@github.noreply`
  }

  const existing = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.githubId, ghUser.id))
    .limit(1)
  const existingUser = existing[0]

  const isAdmin = isAdminEmail(email, c.env.ADMIN_EMAIL)

  let userId: number
  let status: string
  if (existingUser) {
    status = isAdmin ? 'active' : existingUser.status
    await db
      .update(users)
      .set({
        email,
        name: ghUser.login,
        avatarUrl: ghUser.avatar_url,
        isAdmin: isAdmin ? 1 : 0,
        status,
      })
      .where(eq(users.id, existingUser.id))
    userId = existingUser.id
  } else {
    status = isAdmin ? 'active' : 'pending'
    const inserted = await db
      .insert(users)
      .values({
        email,
        githubId: ghUser.id,
        name: ghUser.login,
        avatarUrl: ghUser.avatar_url,
        isAdmin: isAdmin ? 1 : 0,
        status,
      })
      .returning({ id: users.id })
    userId = inserted[0].id
  }

  if (status !== 'active') {
    const reason = status === 'pending' ? 'pending' : 'disabled'
    return c.redirect(`/?auth_error=${reason}`, 302)
  }

  const sessionId = await createSession(db, userId)
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/mirrors',
      'Set-Cookie': sessionCookie(sessionId),
    },
  })
})

authRoutes.post('/register', async (c) => {
  const db = c.get('db')
  let body: { email?: string; password?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const email = (body.email || '').toLowerCase().trim()
  const password = body.password || ''

  if (!EMAIL_RE.test(email)) {
    return c.json({ error: 'Invalid email address' }, 400)
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const existing = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const isAdmin = isAdminEmail(email, c.env.ADMIN_EMAIL)
  const status = isAdmin ? 'active' : 'pending'
  const passwordHash = await hashPassword(password)

  if (existing[0]) {
    if (existing[0].passwordHash) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    // Existing OAuth user adding a password
    await db.update(users).set({ passwordHash }).where(eq(users.id, existing[0].id))
    return c.json({ ok: true, status: existing[0].status })
  }

  await db.insert(users).values({
    email,
    name: email.split('@')[0],
    passwordHash,
    isAdmin: isAdmin ? 1 : 0,
    status,
  })

  return c.json({ ok: true, status })
})

authRoutes.post('/login', async (c) => {
  const db = c.get('db')
  let body: { email?: string; password?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const email = (body.email || '').toLowerCase().trim()
  const password = body.password || ''
  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  const user = rows[0]

  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  if (user.status === 'pending') {
    return c.json({ error: 'Account pending admin approval' }, 403)
  }
  if (user.status === 'disabled') {
    return c.json({ error: 'Account disabled' }, 403)
  }

  const sessionId = await createSession(db, user.id)
  return c.json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(sessionId) })
})

authRoutes.post('/logout', async (c) => {
  const db = c.get('db')
  const sessionId = getSessionId(c.req.raw)
  if (sessionId) {
    await deleteSession(db, sessionId)
  }
  return c.body(null, 200, { 'Set-Cookie': clearSessionCookie() })
})

authRoutes.get('/me', async (c) => {
  const db = c.get('db')

  // Dev bypass: return dev user when DEV_USER_EMAIL is configured
  if (c.env.DEV_USER_EMAIL) {
    const user = await getUserByEmail(db, c.env.DEV_USER_EMAIL.toLowerCase().trim())
    return c.json({
      user: user
        ? toApiUser(user)
        : { id: 0, email: c.env.DEV_USER_EMAIL, name: 'Dev User', avatar_url: '', is_admin: 0, status: 'active' },
    })
  }

  const sessionId = getSessionId(c.req.raw)
  if (!sessionId) {
    return c.json({ user: null }, 401)
  }

  const user = await getSessionUser(db, sessionId)
  if (!user || user.status !== 'active') {
    return c.json({ user: null }, 401)
  }

  return c.json({ user: toApiUser(user) })
})
