import type { Env } from '../_env'
import { apiHostFor, pingRegistry, requestToken } from './_registry'

interface CheckRegistryRequest {
  registry: string
  username?: string
  password?: string
}

interface CheckRegistryResponse {
  reachable: { ok: boolean; message: string }
  auth: { ok: boolean; message: string }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function getUserIdFromSession(request: Request, db: D1Database): Promise<number | null> {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (!match) return null
  const session = await db.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).bind(match[1]).first<{ user_id: number }>()
  return session?.user_id ?? null
}

async function getUserIdFromDevEmail(db: D1Database, devEmail: string): Promise<number | null> {
  const user = await db.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(devEmail.toLowerCase().trim()).first<{ id: number }>()
  return user?.id ?? null
}

async function getCredentialsFromDb(db: D1Database, userId: number, registry: string): Promise<{ username: string; password: string } | null> {
  const result = await db.prepare(
    'SELECT dest_user, dest_pass FROM registry_secrets WHERE user_id = ? AND registry = ?'
  ).bind(userId, registry).first<{ dest_user: string; dest_pass: string }>()
  
  if (!result) return null
  return {
    username: result.dest_user,
    password: result.dest_pass,
  }
}

async function checkRegistry(registry: string, username?: string, password?: string): Promise<CheckRegistryResponse> {
  const registryHost = registry.split('/')[0]
  const apiHost = apiHostFor(registryHost)
  const ping = await pingRegistry(apiHost)

  if (!ping.reachable) {
    return {
      reachable: { ok: false, message: ping.error ?? 'unreachable' },
      auth: { ok: false, message: 'skipped (registry unreachable)' },
    }
  }

  let authResult: { ok: boolean; message: string } = { ok: true, message: 'no auth required' }

  if (ping.authChallenge && (username || password)) {
    const repo = registry.includes('/') ? registry.split('/').slice(1).join('/') + '/test' : 'test'
    const tok = await requestToken(
      ping.authChallenge,
      repo,
      'push,pull',
      username,
      password
    )
    if (tok.ok) {
      authResult = { ok: true, message: 'credentials accepted' }
    } else {
      authResult = { ok: false, message: tok.error ?? `auth failed (HTTP ${tok.status})` }
    }
  } else if (ping.authChallenge && !username) {
    authResult = { ok: false, message: 'registry requires auth but no credentials provided' }
  }

  return {
    reachable: { ok: true, message: `HTTP ${ping.status}` },
    auth: authResult,
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as CheckRegistryRequest
  if (!body.registry) {
    return json({ error: 'registry is required' }, 400)
  }

  // Try to get userId from session or dev email
  let userId = await getUserIdFromSession(context.request, context.env.DB)
  if (!userId && context.env.DEV_USER_EMAIL) {
    userId = await getUserIdFromDevEmail(context.env.DB, context.env.DEV_USER_EMAIL)
  }

  let username = body.username
  let password = body.password

  // If not provided in request, try to load from database
  if (!username && userId) {
    const creds = await getCredentialsFromDb(context.env.DB, userId, body.registry)
    if (creds) {
      username = creds.username
      password = creds.password
    }
  }

  const result = await checkRegistry(body.registry, username, password)
  return json(result)
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
