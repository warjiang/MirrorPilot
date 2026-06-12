import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import type { AppEnv } from '../types'
import { profiles, userProfiles } from '../db/schema'
import {
  apiHostFor,
  manifestExists,
  parseRef,
  pingRegistry,
  requestToken,
} from '../lib/registry'

// --- check-registry --------------------------------------------------------

interface CheckRegistryResponse {
  reachable: { ok: boolean; message: string }
  auth: { ok: boolean; message: string }
}

async function checkRegistry(
  registry: string,
  username?: string,
  password?: string
): Promise<CheckRegistryResponse> {
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
    const tok = await requestToken(ping.authChallenge, repo, 'push,pull', username, password)
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

export const checkRegistryRoutes = new Hono<AppEnv>()

checkRegistryRoutes.post('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')

  let body: { registry?: string; username?: string; password?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  if (!body.registry) {
    return c.json({ error: 'registry is required' }, 400)
  }

  let username = body.username
  let password = body.password

  // If not provided in request, try to load saved credentials
  if (!username && user) {
    const rows = await db
      .select({ destUser: profiles.username, destPass: profiles.passwordSecret })
      .from(userProfiles)
      .innerJoin(profiles, eq(profiles.id, userProfiles.profileId))
      .where(and(eq(userProfiles.userId, user.id), eq(profiles.registry, body.registry), eq(userProfiles.enabled, 1)))
      .limit(1)
    if (rows[0]) {
      username = rows[0].destUser
      password = rows[0].destPass
    }
  }

  const result = await checkRegistry(body.registry, username, password)
  return c.json(result)
})

checkRegistryRoutes.options('/', (c) =>
  c.body(null, 200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
)

// --- detect -----------------------------------------------------------------

type CheckState = 'ok' | 'exists' | 'missing' | 'failed' | 'unreachable' | 'error' | 'skipped'

interface CheckResult {
  state: CheckState
  message: string
  detail?: string
}

interface DetectRequest {
  source: string
  targetRegistry: string
  target: string
  username?: string
  password?: string
}

function buildFullTarget(registry: string, target: string): string {
  const reg = registry.replace(/\/+$/, '').trim()
  const t = target.replace(/^\/+/, '').trim()
  if (reg === '') return t
  if (t === '') return reg
  return `${reg}/${t}`
}

async function checkSource(source: string): Promise<CheckResult> {
  if (!source.trim()) return { state: 'skipped', message: 'no source provided' }
  const res = await manifestExists(source)
  if (res.status === 0) {
    return {
      state: 'unreachable',
      message: 'source registry unreachable',
      detail: res.error,
    }
  }
  if (res.status === 200) {
    return { state: 'exists', message: 'source image found' }
  }
  if (res.status === 404) {
    return { state: 'missing', message: 'source image not found' }
  }
  if (res.status === 401 || res.status === 403) {
    return {
      state: 'error',
      message: 'source requires authentication',
      detail: `HTTP ${res.status}`,
    }
  }
  return { state: 'error', message: `unexpected status ${res.status}` }
}

async function checkTargetReachable(targetRegistry: string): Promise<CheckResult> {
  if (!targetRegistry.trim())
    return { state: 'skipped', message: 'no target registry configured' }
  const ref = parseRef(buildFullTarget(targetRegistry, 'probe'))
  const ping = await pingRegistry(ref.apiHost)
  if (!ping.reachable) {
    return {
      state: 'unreachable',
      message: `cannot reach ${ref.apiHost}`,
      detail: ping.error,
    }
  }
  return {
    state: 'ok',
    message: `registry reachable (HTTP ${ping.status})`,
  }
}

async function checkTargetExists(
  targetRegistry: string,
  target: string,
  username?: string,
  password?: string
): Promise<CheckResult> {
  const full = buildFullTarget(targetRegistry, target)
  if (!targetRegistry.trim() || !target.trim())
    return { state: 'skipped', message: 'target not fully configured' }
  const res = await manifestExists(full, username, password)
  if (res.status === 0) {
    return {
      state: 'unreachable',
      message: 'target registry unreachable',
      detail: res.error,
    }
  }
  if (res.status === 200) {
    return { state: 'exists', message: 'mirror image already present' }
  }
  if (res.status === 404) {
    return { state: 'missing', message: 'mirror image not yet synced' }
  }
  if (res.status === 401 || res.status === 403) {
    return {
      state: 'error',
      message: 'authentication required to read target',
      detail: `HTTP ${res.status}`,
    }
  }
  return { state: 'error', message: `unexpected status ${res.status}` }
}

async function checkAuth(
  targetRegistry: string,
  target: string,
  username?: string,
  password?: string
): Promise<CheckResult> {
  if (!username && !password)
    return { state: 'skipped', message: 'no credentials provided' }
  if (!targetRegistry.trim())
    return { state: 'skipped', message: 'no target registry configured' }

  const full = buildFullTarget(targetRegistry, target || 'probe')
  const ref = parseRef(full)
  const ping = await pingRegistry(ref.apiHost)
  if (!ping.reachable) {
    return {
      state: 'unreachable',
      message: 'target registry unreachable',
      detail: ping.error,
    }
  }
  if (!ping.authChallenge) {
    return {
      state: 'ok',
      message: 'registry does not require authentication',
    }
  }
  // Request a push-scoped token: this validates the credentials are accepted
  // and are authorised to write to the mirror repository.
  const tok = await requestToken(ping.authChallenge, ref.repository, 'pull,push', username, password)
  if (tok.ok) {
    return { state: 'ok', message: 'credentials accepted' }
  }
  if (tok.status === 401 || tok.status === 403) {
    return {
      state: 'failed',
      message: 'credentials rejected',
      detail: `HTTP ${tok.status}`,
    }
  }
  if (tok.status === 0) {
    return {
      state: 'unreachable',
      message: 'auth endpoint unreachable',
      detail: tok.error,
    }
  }
  return { state: 'error', message: `unexpected status ${tok.status}` }
}

export const detectRoutes = new Hono<AppEnv>()

detectRoutes.post('/', async (c) => {
  let body: DetectRequest
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  const source = (body.source ?? '').trim()
  const targetRegistry = (body.targetRegistry ?? '').trim()
  const target = (body.target ?? '').trim()
  const username = body.username?.trim() || undefined
  const password = body.password || undefined

  if (!source && !targetRegistry) {
    return c.json({ error: 'source or targetRegistry is required' }, 400)
  }

  const [src, reachable, targetExists, auth] = await Promise.all([
    checkSource(source),
    checkTargetReachable(targetRegistry),
    checkTargetExists(targetRegistry, target, username, password),
    checkAuth(targetRegistry, target, username, password),
  ])

  return c.json({ source: src, targetReachable: reachable, targetExists, auth })
})

detectRoutes.options('/', (c) =>
  c.body(null, 204, {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
)
