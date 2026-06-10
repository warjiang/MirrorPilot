import type { Env } from '@functions/_env'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function validateSecret(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) {
    return false
  }
  
  const [scheme, token] = authHeader.split(' ')
  if (scheme !== 'Bearer') {
    return false
  }
  
  return token === env.SYNC_SECRET
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // Validate SYNC_SECRET
  if (!(await validateSecret(context.request, context.env))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const url = new URL(context.request.url)
  const registry = url.searchParams.get('registry')
  if (!registry) {
    return json({ error: 'registry query parameter is required' }, 400)
  }

  // Get registry secret from any user (for CI/CD use)
  // In production, you might want to scope this differently
  const result = await context.env.DB
    .prepare('SELECT dest_user, dest_pass FROM registry_secrets WHERE registry = ? LIMIT 1')
    .bind(registry)
    .first<{ dest_user: string; dest_pass: string }>()

  if (!result) {
    return json({ error: 'registry secret not found' }, 404)
  }

  return json({
    destUser: result.dest_user,
    destPass: result.dest_pass,
  })
}
