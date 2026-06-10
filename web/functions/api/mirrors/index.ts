import type { Env } from '../../_env'
import type { MirrorConfig, RegistryProfile, ImageEntry } from '../../../src/lib/types'

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

async function getUserIdFromSession(request: Request, db: D1Database): Promise<number | null> {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/mp_session=([^;]+)/)
  if (!match) return null
  const session = await db.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).bind(match[1]).first<{ user_id: number }>()
  return session?.user_id ?? null
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
  username: string
  password: string
}

interface ImageRow {
  id: number
  source: string
  target: string
  profile: string
  enabled: number
  synced: number
  status: string | null
  sync_error: string | null
  notes: string
  created_at: string
  synced_at: string | null
}

interface ExistingImageRow {
  id: number
  source: string
  target: string
  profile: string
  created_at: string
}

function imageMatchKey(source: string, target: string, profile: string, createdAt?: string | null): string {
  return `${source}\u0000${target}\u0000${profile}\u0000${createdAt ?? ''}`
}

function imageLooseMatchKey(source: string, target: string, profile: string): string {
  return `${source}\u0000${target}\u0000${profile}`
}

async function handleGet(db: D1Database, userId: number): Promise<Response> {
  const [profileResult, imageResult] = await Promise.all([
    db
      .prepare('SELECT name, registry, username_env AS username, password_env AS password FROM profiles WHERE user_id = ? ORDER BY name ASC')
      .bind(userId)
      .all<ProfileRow>(),
    db
      .prepare('SELECT id, source, target, profile, enabled, synced, status, sync_error, notes, created_at, synced_at FROM images WHERE user_id = ? ORDER BY rowid ASC')
      .bind(userId)
      .all<ImageRow>(),
  ])

  const profiles: Record<string, RegistryProfile> = {}
  for (const row of profileResult.results) {
    profiles[row.name] = {
      registry: row.registry,
      username: row.username || undefined,
      password: row.password || undefined,
    }
  }

  const images: ImageEntry[] = imageResult.results.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    profile: row.profile,
    enabled: row.enabled === 1,
    synced: row.synced === 1 ? true : undefined,
    status: row.status === 'pending' || row.status === 'syncing' || row.status === 'synced' || row.status === 'failed'
      ? row.status
      : undefined,
    syncError: row.sync_error || undefined,
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
  const existingImageRows = await db
    .prepare('SELECT id, source, target, profile, created_at FROM images WHERE user_id = ?')
    .bind(userId)
    .all<ExistingImageRow>()
  const existingImageIds = new Set(existingImageRows.results.map((row) => row.id))
  const keptImageIds = new Set<number>()
  const exactMatchIds = new Map<string, number[]>()
  const looseMatchIds = new Map<string, number[]>()
  for (const row of existingImageRows.results) {
    const exactKey = imageMatchKey(row.source, row.target, row.profile, row.created_at)
    const looseKey = imageLooseMatchKey(row.source, row.target, row.profile)
    const exactList = exactMatchIds.get(exactKey)
    if (exactList) exactList.push(row.id)
    else exactMatchIds.set(exactKey, [row.id])
    const looseList = looseMatchIds.get(looseKey)
    if (looseList) looseList.push(row.id)
    else looseMatchIds.set(looseKey, [row.id])
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
  ]

  for (const [name, p] of Object.entries(profiles)) {
    statements.push(
      db
        .prepare('INSERT INTO profiles (user_id, name, registry, username_env, password_env) VALUES (?, ?, ?, ?, ?)')
        .bind(userId, name, p.registry ?? '', p.username ?? '', p.password ?? '')
    )
  }

  for (const img of images) {
    let matchedId = typeof img.id === 'number' && Number.isFinite(img.id) && img.id > 0
      ? Math.trunc(img.id)
      : null
    if (matchedId !== null && !existingImageIds.has(matchedId)) {
      matchedId = null
    }
    if (matchedId === null) {
      const exactKey = imageMatchKey(img.source, img.target, img.profile ?? 'default', img.createdAt)
      const looseKey = imageLooseMatchKey(img.source, img.target, img.profile ?? 'default')
      const exactList = exactMatchIds.get(exactKey)
      while (exactList?.length) {
        const candidate = exactList.shift()!
        if (!keptImageIds.has(candidate)) {
          matchedId = candidate
          break
        }
      }
      if (matchedId === null) {
        const looseList = looseMatchIds.get(looseKey)
        while (looseList?.length) {
          const candidate = looseList.shift()!
          if (!keptImageIds.has(candidate)) {
            matchedId = candidate
            break
          }
        }
      }
    }
    if (matchedId !== null && existingImageIds.has(matchedId)) {
      keptImageIds.add(matchedId)
      statements.push(
        db
          .prepare(
            'UPDATE images SET source = ?, target = ?, profile = ?, enabled = ?, notes = ? WHERE user_id = ? AND id = ?'
          )
          .bind(
            img.source,
            img.target,
            img.profile ?? 'default',
            img.enabled !== false ? 1 : 0,
            img.notes ?? '',
            userId,
            matchedId,
          )
      )
      continue
    }

    statements.push(
      db
        .prepare(
          'INSERT INTO images (user_id, source, target, profile, enabled, synced, status, sync_error, notes, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          userId,
          img.source,
          img.target,
          img.profile ?? 'default',
          img.enabled !== false ? 1 : 0,
          img.synced ? 1 : 0,
          img.status ?? (img.synced ? 'synced' : 'pending'),
          img.syncError ?? '',
          img.notes ?? '',
          img.createdAt ?? new Date().toISOString(),
          img.syncedAt ?? null,
        )
    )
  }

  const removedIds = [...existingImageIds].filter((id) => !keptImageIds.has(id))
  if (removedIds.length) {
    const placeholders = removedIds.map(() => '?').join(',')
    statements.push(
      db
        .prepare(`DELETE FROM images WHERE user_id = ? AND id IN (${placeholders})`)
        .bind(userId, ...removedIds)
    )
  }

  await db.batch(statements)
  return json({ ok: true })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const sessionUserId = await getUserIdFromSession(context.request, context.env.DB)
  if (sessionUserId) {
    return handleGet(context.env.DB, sessionUserId)
  }
  const email = getEmail(context.request, context.env)
  if (!email) return json({ error: 'unauthenticated' }, 401)
  const userId = await getOrCreateUser(context.env.DB, email)
  return handleGet(context.env.DB, userId)
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const sessionUserId = await getUserIdFromSession(context.request, context.env.DB)
  if (sessionUserId) {
    return handlePut(context.env.DB, sessionUserId, context.request)
  }
  const email = getEmail(context.request, context.env)
  if (!email) return json({ error: 'unauthenticated' }, 401)
  const userId = await getOrCreateUser(context.env.DB, email)
  return handlePut(context.env.DB, userId, context.request)
}
