import type { Env } from '../../_env'

interface RegistrySecret {
  registry: string
  destUser: string
  destPass: string
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

async function handleGet(db: D1Database, userId: number): Promise<Response> {
  const result = await db
    .prepare('SELECT registry, dest_user, dest_pass FROM registry_secrets WHERE user_id = ? ORDER BY registry ASC')
    .bind(userId)
    .all<{ registry: string; dest_user: string; dest_pass: string }>()

  const secrets = result.results.map((row) => ({
    registry: row.registry,
    destUser: row.dest_user,
    // Don't return the password
    destPass: '***',
  }))

  return json({ secrets })
}

async function handlePost(db: D1Database, userId: number, request: Request): Promise<Response> {
  let body: RegistrySecret
  try {
    body = await request.json() as RegistrySecret
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  if (!body.registry || !body.destUser || !body.destPass) {
    return json({ error: 'registry, destUser, and destPass are required' }, 400)
  }

  // Validate registry format (should be a valid registry URL)
  try {
    new URL(`https://${body.registry}`)
  } catch {
    return json({ error: 'invalid registry format' }, 400)
  }

  // Save to database
  await db.prepare(
    'INSERT INTO registry_secrets (user_id, registry, dest_user, dest_pass, created_at, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'), datetime(\'now\')) ON CONFLICT(user_id, registry) DO UPDATE SET dest_user = excluded.dest_user, dest_pass = excluded.dest_pass, updated_at = datetime(\'now\')'
  ).bind(userId, body.registry, body.destUser, body.destPass).run()

  return json({ ok: true })
}

async function handleDelete(db: D1Database, userId: number, registry: string): Promise<Response> {
  if (!registry) {
    return json({ error: 'registry is required' }, 400)
  }

  await db.prepare('DELETE FROM registry_secrets WHERE user_id = ? AND registry = ?')
    .bind(userId, registry)
    .run()

  return json({ ok: true })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = await getUserIdFromSession(context.request, context.env.DB)
  if (!userId) {
    return json({ error: 'unauthenticated' }, 401)
  }
  return handleGet(context.env.DB, userId)
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const userId = await getUserIdFromSession(context.request, context.env.DB)
  if (!userId) {
    return json({ error: 'unauthenticated' }, 401)
  }
  return handlePost(context.env.DB, userId, context.request)
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const userId = await getUserIdFromSession(context.request, context.env.DB)
  if (!userId) {
    return json({ error: 'unauthenticated' }, 401)
  }
  const url = new URL(context.request.url)
  const registry = url.searchParams.get('registry')
  if (!registry) {
    return json({ error: 'registry query parameter is required' }, 400)
  }
  return handleDelete(context.env.DB, userId, registry)
}
