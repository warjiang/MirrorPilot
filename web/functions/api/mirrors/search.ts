import type { Env } from '../../_env'
import type { ImageEntry } from '../../../src/lib/types'

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

interface ImageRow {
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

interface CountRow {
  total: number
}

type SortField = 'enabled' | 'createdAt' | 'syncedAt'
type SortDir = 'asc' | 'desc'

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function parseSortField(raw: string | null): SortField | null {
  if (raw === 'enabled' || raw === 'createdAt' || raw === 'syncedAt') return raw
  return null
}

function parseSortDir(raw: string | null): SortDir {
  return raw === 'asc' ? 'asc' : 'desc'
}

function buildOrderBy(sortField: SortField | null, sortDir: SortDir): string {
  if (!sortField) {
    return 'i.enabled DESC, i.rowid ASC'
  }

  if (sortField === 'enabled') {
    return `i.enabled ${sortDir.toUpperCase()}, i.rowid ASC`
  }

  if (sortField === 'createdAt') {
    return `i.created_at ${sortDir.toUpperCase()}, i.rowid ASC`
  }

  return `i.synced_at ${sortDir.toUpperCase()}, i.rowid ASC`
}

function mapRowToImage(row: ImageRow): ImageEntry {
  return {
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
  }
}

async function handleSearch(db: D1Database, userId: number, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = parsePositiveInt(url.searchParams.get('page'), 1)
  const pageSize = Math.min(parsePositiveInt(url.searchParams.get('pageSize'), 20), 100)
  const sortField = parseSortField(url.searchParams.get('sortField'))
  const sortDir = parseSortDir(url.searchParams.get('sortDir'))

  const whereSql = q
    ? `WHERE i.user_id = ? AND (
        i.source LIKE ? OR
        i.target LIKE ? OR
        i.profile LIKE ? OR
        i.notes LIKE ?
      )`
    : 'WHERE i.user_id = ?'

  const like = `%${q}%`
  const params = q
    ? [userId, like, like, like, like]
    : [userId]

  const countStmt = db.prepare(`SELECT COUNT(*) AS total FROM images i ${whereSql}`).bind(...params)
  const count = await countStmt.first<CountRow>()
  const total = count?.total ?? 0

  const offset = (page - 1) * pageSize
  const orderBy = buildOrderBy(sortField, sortDir)
  const rows = await db
    .prepare(
      `SELECT i.source, i.target, i.profile, i.enabled, i.synced, i.status, i.sync_error, i.notes, i.created_at, i.synced_at
       FROM images i
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .bind(...params, pageSize, offset)
    .all<ImageRow>()

  return json({
    q,
    page,
    pageSize,
    total,
    items: rows.results.map(mapRowToImage),
  })
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const sessionUserId = await getUserIdFromSession(context.request, context.env.DB)
  if (sessionUserId) {
    return handleSearch(context.env.DB, sessionUserId, context.request)
  }

  const email = getEmail(context.request, context.env)
  if (!email) return json({ error: 'unauthenticated' }, 401)
  const userId = await getOrCreateUser(context.env.DB, email)
  return handleSearch(context.env.DB, userId, context.request)
}
