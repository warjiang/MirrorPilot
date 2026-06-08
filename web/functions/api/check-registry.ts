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

export const onRequestPost: PagesFunction = async ({ request }) => {
  const body = (await request.json()) as CheckRegistryRequest
  if (!body.registry) {
    return Response.json({ error: 'registry is required' }, { status: 400 })
  }

  const registryHost = body.registry.split('/')[0]
  const apiHost = apiHostFor(registryHost)
  const ping = await pingRegistry(apiHost)

  if (!ping.reachable) {
    const res: CheckRegistryResponse = {
      reachable: { ok: false, message: ping.error ?? 'unreachable' },
      auth: { ok: false, message: 'skipped (registry unreachable)' },
    }
    return Response.json(res)
  }

  let authResult: { ok: boolean; message: string } = { ok: true, message: 'no auth required' }

  if (ping.authChallenge && (body.username || body.password)) {
    const repo = body.registry.includes('/') ? body.registry.split('/').slice(1).join('/') + '/test' : 'test'
    const tok = await requestToken(
      ping.authChallenge,
      repo,
      'push,pull',
      body.username,
      body.password
    )
    if (tok.ok) {
      authResult = { ok: true, message: 'credentials accepted' }
    } else {
      authResult = { ok: false, message: tok.error ?? `auth failed (HTTP ${tok.status})` }
    }
  } else if (ping.authChallenge && !body.username) {
    authResult = { ok: false, message: 'registry requires auth but no credentials provided' }
  }

  const res: CheckRegistryResponse = {
    reachable: { ok: true, message: `HTTP ${ping.status}` },
    auth: authResult,
  }
  return Response.json(res)
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
