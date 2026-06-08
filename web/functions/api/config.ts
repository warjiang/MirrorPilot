import type { Env } from '../_env'
import type { MirrorConfig, RegistryProfile, ImageEntry } from '../../src/lib/types'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function getEmail(request: Request, env: Env): string | null {
  const fromHeader = request.headers.get('Cf-Access-Authenticated-User-Email')
  if (fromHeader) return fromHeader.toLowerCase().trim()
  if (env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL.toLowerCase().trim()
  return null
}

async function getOrCreateUser(db: D1Database, email: string): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO users (email, created_at) VALUES (?, datetime('now'))")
    .bind(email)
    .run()
  const row = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>()
  return row!.id
}

interface ProfileRow {
  name: string
  registry: string
  username_env: string
  password_env: string
}

interface ImageRow {
  source: string
  target: string
  profile: string
  enabled: number
  synced: number
  notes: string
  created_at: string
  synced_at: string | null
}

async function handleGet(db: D1Database, userId: number): Promise<Response> {
  const [profileResult, imageResult] = await Promise.all([
    db
      .prepare('SELECT name, registry, username_env, password_env FROM profiles WHERE user_id = ? ORDER BY name ASC')
      .bind(userId)
      .all<ProfileRow>(),
    db
      .prepare('SELECT source, target, profile, enabled, synced, notes, created_at, synced_at FROM images WHERE user_id = ? ORDER BY rowid ASC')
      .bind(userId)
      .all<ImageRow>(),
  ])

  const profiles: Record<string, RegistryProfile> = {}
  for (const row of profileResult.results) {
    profiles[row.name] = {
      registry: row.registry,
      usernameEnv: row.username_env || undefined,
      passwordEnv: row.password_env || undefined,
    }
  }

  const images: ImageEntry[] = imageResult.results.map((row) => ({
    source: row.source,
    target: row.target,
    profile: row.profile,
    enabled: row.enabled === 1,
    synced: row.synced === 1 ? true : undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    syncedAt: row.synced_at ?? undefined,
  }))

  const config: MirrorConfig = { version: 'v1', profiles, images }
  return json(config)
}

async function handlePut(db: D1Database, userId: number, request: Request): Promise<Response> {
  let body: MirrorConfig
  try {
    body = await request.json() as MirrorConfig
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return json({ error: 'config must be a JSON object' }, 400)
  }

  const profiles = body.profiles ?? {}
  const images = body.images ?? []

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM images WHERE user_id = ?').bind(userId),
  ]

  for (const [name, p] of Object.entries(profiles)) {
    statements.push(
      db
        .prepare('INSERT INTO profiles (user_id, name, registry, username_env, password_env) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, name, p.registry ?? '', p.usernameEnv ?? '', p.passwordEnv ?? '')
    )
  }

  for (const img of images) {
    statements.push(
      db
        .prepare(
          'INSERT INTO images (user_id, source, target, profile, enabled, synced, notes, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          userId,
          img.source,
          img.target,
          img.profile ?? 'default',
          img.enabled !== false ? 1 : 0,
          img.synced ? 1 : 0,
          img.notes ?? '',
          img.createdAt ?? new Date().toISOString(),
          img.syncedAt ?? null,
        )
    )
  }

  await db.batch(statements)
  return json({ ok: true })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const email = getEmail(context.request, context.env)
  if (!email) return json({ error: 'unauthenticated' }, 401)
  const userId = await getOrCreateUser(context.env.DB, email)
  return handleGet(context.env.DB, userId)
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const email = getEmail(context.request, context.env)
  if (!email) return json({ error: 'unauthenticated' }, 401)
  const userId = await getOrCreateUser(context.env.DB, email)
  return handlePut(context.env.DB, userId, context.request)
}
