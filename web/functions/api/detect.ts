import {
  manifestExists,
  parseRef,
  pingRegistry,
  requestToken,
} from './_registry'

type CheckState =
  | 'ok'
  | 'exists'
  | 'missing'
  | 'failed'
  | 'unreachable'
  | 'error'
  | 'skipped'

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function buildFullTarget(registry: string, target: string): string {
  const reg = registry.replace(/\/+$/, '').trim()
  const t = target.replace(/^\/+/, '').trim()
  if (reg === '') return t
  if (t === '') return reg
  return `${reg}/${t}`
}

// --- individual checks ---------------------------------------------------

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

async function checkTargetReachable(
  targetRegistry: string
): Promise<CheckResult> {
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
  const tok = await requestToken(
    ping.authChallenge,
    ref.repository,
    'pull,push',
    username,
    password
  )
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

// --- handler -------------------------------------------------------------

export const onRequestPost: PagesFunction = async (context) => {
  let body: DetectRequest
  try {
    body = (await context.request.json()) as DetectRequest
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  const source = (body.source ?? '').trim()
  const targetRegistry = (body.targetRegistry ?? '').trim()
  const target = (body.target ?? '').trim()
  const username = body.username?.trim() || undefined
  const password = body.password || undefined

  if (!source && !targetRegistry) {
    return json({ error: 'source or targetRegistry is required' }, 400)
  }

  const [src, reachable, targetExists, auth] = await Promise.all([
    checkSource(source),
    checkTargetReachable(targetRegistry),
    checkTargetExists(targetRegistry, target, username, password),
    checkAuth(targetRegistry, target, username, password),
  ])

  return json({ source: src, targetReachable: reachable, targetExists, auth })
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
