// Minimal Docker Registry v2 client used by the Cloudflare Pages Function.
// Implements the token-auth flow so we can probe image existence,
// registry reachability and credential validity without any third-party deps.

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.v1+json',
].join(', ')

const DEFAULT_TIMEOUT_MS = 10_000

export interface ParsedRef {
  registry: string
  apiHost: string
  repository: string
  reference: string
}

function looksLikeRegistryHost(part: string): boolean {
  return part.includes('.') || part.includes(':') || part === 'localhost'
}

/** Map a registry name to the host used for v2 API calls. */
export function apiHostFor(registry: string): string {
  if (registry === 'docker.io' || registry === 'index.docker.io') {
    return 'registry-1.docker.io'
  }
  return registry
}

/** Parse an image reference into registry/repo/tag, applying Docker defaults. */
export function parseRef(raw: string): ParsedRef {
  let ref = raw.trim()
  let reference = 'latest'
  let isDigest = false

  const at = ref.indexOf('@')
  if (at >= 0) {
    reference = ref.slice(at + 1)
    isDigest = true
    ref = ref.slice(0, at)
  }

  const lastSlash = ref.lastIndexOf('/')
  const lastColon = ref.lastIndexOf(':')
  if (!isDigest && lastColon > lastSlash) {
    reference = ref.slice(lastColon + 1)
    ref = ref.slice(0, lastColon)
  }

  const parts = ref.split('/').filter((p) => p !== '')
  let registry = 'docker.io'
  let repoParts = parts
  let isDefaultRegistry = true
  if (parts.length > 1 && looksLikeRegistryHost(parts[0])) {
    registry = parts[0]
    repoParts = parts.slice(1)
    isDefaultRegistry = false
  }

  let repository = repoParts.join('/')
  if (isDefaultRegistry && repoParts.length === 1) {
    repository = `library/${repository}`
  }

  return { registry, apiHost: apiHostFor(registry), repository, reference }
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(id) }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const { signal, cancel } = withTimeout(ms)
  try {
    return await fetch(url, { ...init, signal, redirect: 'follow' })
  } finally {
    cancel()
  }
}

interface Challenge {
  realm: string
  service?: string
  scope?: string
}

/** Parse a WWW-Authenticate challenge header. */
function parseChallenge(header: string | null): Challenge | null {
  if (!header) return null
  const lower = header.toLowerCase()
  if (!lower.startsWith('bearer')) return null
  const params: Record<string, string> = {}
  const re = /(\w+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) !== null) {
    params[m[1].toLowerCase()] = m[2]
  }
  if (!params.realm) return null
  return { realm: params.realm, service: params.service, scope: params.scope }
}

function basicAuth(username?: string, password?: string): string | null {
  if (!username && !password) return null
  return 'Basic ' + btoa(`${username ?? ''}:${password ?? ''}`)
}

export interface ReachResult {
  reachable: boolean
  status?: number
  authChallenge: Challenge | null
  error?: string
}

/** Probe the `/v2/` base endpoint to check reachability. */
export async function pingRegistry(apiHost: string): Promise<ReachResult> {
  try {
    const res = await fetchWithTimeout(`https://${apiHost}/v2/`, {
      method: 'GET',
    })
    return {
      reachable: true,
      status: res.status,
      authChallenge: parseChallenge(res.headers.get('www-authenticate')),
    }
  } catch (e) {
    return {
      reachable: false,
      authChallenge: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface TokenResult {
  ok: boolean
  status: number
  token?: string
  error?: string
}

/** Request a bearer token from the registry's auth realm. */
export async function requestToken(
  challenge: Challenge,
  repository: string,
  actions: string,
  username?: string,
  password?: string
): Promise<TokenResult> {
  const url = new URL(challenge.realm)
  if (challenge.service) url.searchParams.set('service', challenge.service)
  url.searchParams.set('scope', `repository:${repository}:${actions}`)

  const headers: Record<string, string> = {}
  const basic = basicAuth(username, password)
  if (basic) headers['Authorization'] = basic

  try {
    const res = await fetchWithTimeout(url.toString(), { headers })
    if (res.status !== 200) {
      return { ok: false, status: res.status }
    }
    const body = (await res.json()) as { token?: string; access_token?: string }
    return { ok: true, status: 200, token: body.token ?? body.access_token }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface ManifestResult {
  status: number
  error?: string
}

/** HEAD the manifest for an image reference, with optional bearer token. */
export async function headManifest(
  ref: ParsedRef,
  token?: string
): Promise<ManifestResult> {
  const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const url = `https://${ref.apiHost}/v2/${ref.repository}/manifests/${ref.reference}`
  try {
    let res = await fetchWithTimeout(url, { method: 'HEAD', headers })
    // Some registries don't support HEAD on manifests; fall back to GET.
    if (res.status === 405) {
      res = await fetchWithTimeout(url, { method: 'GET', headers })
    }
    return { status: res.status }
  } catch (e) {
    return {
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * High-level helper: check whether an image manifest exists, performing the
 * registry token-auth dance when required.
 */
export async function manifestExists(
  raw: string,
  username?: string,
  password?: string
): Promise<{ status: number; error?: string; ping: ReachResult }> {
  const ref = parseRef(raw)
  const ping = await pingRegistry(ref.apiHost)
  if (!ping.reachable) {
    return { status: 0, error: ping.error, ping }
  }

  let token: string | undefined
  if (ping.authChallenge) {
    const tok = await requestToken(
      ping.authChallenge,
      ref.repository,
      'pull',
      username,
      password
    )
    if (!tok.ok) {
      return { status: tok.status === 0 ? 0 : 401, error: tok.error, ping }
    }
    token = tok.token
  }

  const manifest = await headManifest(ref, token)
  return { status: manifest.status, error: manifest.error, ping }
}
