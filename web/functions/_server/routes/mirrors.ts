import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import { images, profiles } from '../db/schema'
import type { MirrorConfig, RegistryProfile, ImageEntry } from '../../../src/lib/types'

interface ImageRow {
  source: string
  target: string
  profile: string
  enabled: number
  synced: number
  status: string | null
  syncError: string | null
  notes: string
  createdAt: string
  syncedAt: string | null
}

function mapRowToImage(row: ImageRow): ImageEntry {
  return {
    source: row.source,
    target: row.target,
    profile: row.profile,
    enabled: row.enabled === 1,
    synced: row.synced === 1 ? true : undefined,
    status:
      row.status === 'pending' || row.status === 'syncing' || row.status === 'synced' || row.status === 'failed'
        ? row.status
        : undefined,
    syncError: row.syncError || undefined,
    notes: row.notes || undefined,
    createdAt: row.createdAt,
    syncedAt: row.syncedAt ?? undefined,
  }
}

const imageSelection = {
  source: images.source,
  target: images.target,
  profile: images.profile,
  enabled: images.enabled,
  synced: images.synced,
  status: images.status,
  syncError: images.syncError,
  notes: images.notes,
  createdAt: images.createdAt,
  syncedAt: images.syncedAt,
}

export const mirrorsRoutes = new Hono<AppEnv>()

export const getConfigHandler = async (c: Context<AppEnv>) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const [profileRows, imageRows] = await Promise.all([
    db
      .select({
        name: profiles.name,
        registry: profiles.registry,
        username: profiles.usernameEnv,
        password: profiles.passwordEnv,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .orderBy(asc(profiles.name)),
    db
      .select(imageSelection)
      .from(images)
      .where(eq(images.userId, userId))
      .orderBy(asc(sql`rowid`)),
  ])

  const profileMap: Record<string, RegistryProfile> = {}
  for (const row of profileRows) {
    profileMap[row.name] = {
      registry: row.registry,
      username: row.username || undefined,
      password: row.password || undefined,
    }
  }

  const config: MirrorConfig = {
    version: 'v1',
    profiles: profileMap,
    images: imageRows.map(mapRowToImage),
  }
  return c.json(config)
}

export const putConfigHandler = async (c: Context<AppEnv>) => {
  const db = c.get('db')
  const userId = c.get('user').id

  let body: MirrorConfig
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'config must be a JSON object' }, 400)
  }

  const profileEntries = Object.entries(body.profiles ?? {})
  const imageEntries = body.images ?? []

  const statements: BatchItem<'sqlite'>[] = [
    db.delete(profiles).where(eq(profiles.userId, userId)),
    db.delete(images).where(eq(images.userId, userId)),
  ]

  for (const [name, p] of profileEntries) {
    statements.push(
      db.insert(profiles).values({
        userId,
        name,
        registry: p.registry ?? '',
        usernameEnv: p.username ?? '',
        passwordEnv: p.password ?? '',
      })
    )
  }

  for (const img of imageEntries) {
    statements.push(
      db.insert(images).values({
        userId,
        source: img.source,
        target: img.target,
        profile: img.profile ?? 'default',
        enabled: img.enabled !== false ? 1 : 0,
        synced: img.synced ? 1 : 0,
        status: img.status ?? (img.synced ? 'synced' : 'pending'),
        syncError: img.syncError ?? '',
        notes: img.notes ?? '',
        createdAt: img.createdAt ?? new Date().toISOString(),
        syncedAt: img.syncedAt ?? null,
      })
    )
  }

  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  return c.json({ ok: true })
}

mirrorsRoutes.get('/', getConfigHandler)
mirrorsRoutes.put('/', putConfigHandler)

type SortField = 'enabled' | 'createdAt' | 'syncedAt'
type SortDir = 'asc' | 'desc'

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

function parseSortField(raw: string | undefined): SortField | null {
  if (raw === 'enabled' || raw === 'createdAt' || raw === 'syncedAt') return raw
  return null
}

function parseSortDir(raw: string | undefined): SortDir {
  return raw === 'asc' ? 'asc' : 'desc'
}

function buildOrderBy(sortField: SortField | null, sortDir: SortDir) {
  const dir = sortDir === 'asc' ? asc : desc
  const rowid = asc(sql`rowid`)
  if (!sortField) return [desc(images.enabled), rowid]
  if (sortField === 'enabled') return [dir(images.enabled), rowid]
  if (sortField === 'createdAt') return [dir(images.createdAt), rowid]
  return [dir(images.syncedAt), rowid]
}

mirrorsRoutes.get('/search', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const q = (c.req.query('q') ?? '').trim()
  const page = parsePositiveInt(c.req.query('page'), 1)
  const pageSize = Math.min(parsePositiveInt(c.req.query('pageSize'), 20), 100)
  const sortField = parseSortField(c.req.query('sortField'))
  const sortDir = parseSortDir(c.req.query('sortDir'))

  const pattern = `%${q}%`
  const where = q
    ? and(
        eq(images.userId, userId),
        or(
          like(images.source, pattern),
          like(images.target, pattern),
          like(images.profile, pattern),
          like(images.notes, pattern)
        )
      )
    : eq(images.userId, userId)

  const countRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(images)
    .where(where)
  const total = countRows[0]?.total ?? 0

  const offset = (page - 1) * pageSize
  const rows = await db
    .select(imageSelection)
    .from(images)
    .where(where)
    .orderBy(...buildOrderBy(sortField, sortDir))
    .limit(pageSize)
    .offset(offset)

  return c.json({
    q,
    page,
    pageSize,
    total,
    items: rows.map(mapRowToImage),
  })
})
