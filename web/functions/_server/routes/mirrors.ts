import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import { images, profiles } from '../db/schema'
import type { MirrorConfig, RegistryProfile, ImageEntry } from '../../../src/lib/types'

interface ImageRow {
  id: number
  source: string
  target: string
  profile: string
  enabled: number
  pinned: number
  synced: number
  status: string | null
  syncError: string | null
  notes: string
  createdAt: string
  syncedAt: string | null
}

function mapRowToImage(row: ImageRow): ImageEntry {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    profile: row.profile,
    enabled: row.enabled === 1,
    pinned: row.pinned === 1 ? true : undefined,
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
  id: images.id,
  source: images.source,
  target: images.target,
  profile: images.profile,
  enabled: images.enabled,
  pinned: images.pinned,
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

  const existingImageRows = await db
    .select({
      id: images.id,
      source: images.source,
      target: images.target,
      profile: images.profile,
      createdAt: images.createdAt,
    })
    .from(images)
    .where(eq(images.userId, userId))

  const existingImageIds = new Set(existingImageRows.map((row) => row.id))
  const keptImageIds = new Set<number>()
  const exactMatchIds = new Map<string, number[]>()
  const looseMatchIds = new Map<string, number[]>()
  const imageMatchKey = (source: string, target: string, profile: string, createdAt?: string | null) =>
    `${source}\u0000${target}\u0000${profile}\u0000${createdAt ?? ''}`
  const imageLooseMatchKey = (source: string, target: string, profile: string) =>
    `${source}\u0000${target}\u0000${profile}`
  for (const row of existingImageRows) {
    const exactKey = imageMatchKey(row.source, row.target, row.profile, row.createdAt)
    const looseKey = imageLooseMatchKey(row.source, row.target, row.profile)
    const exactList = exactMatchIds.get(exactKey)
    if (exactList) exactList.push(row.id)
    else exactMatchIds.set(exactKey, [row.id])
    const looseList = looseMatchIds.get(looseKey)
    if (looseList) looseList.push(row.id)
    else looseMatchIds.set(looseKey, [row.id])
  }

  const statements: BatchItem<'sqlite'>[] = [
    db.delete(profiles).where(eq(profiles.userId, userId)),
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
    let matchedId =
      typeof img.id === 'number' && Number.isFinite(img.id) && img.id > 0 ? Math.trunc(img.id) : null
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
          .update(images)
          .set({
            source: img.source,
            target: img.target,
            profile: img.profile ?? 'default',
            enabled: img.enabled !== false ? 1 : 0,
            pinned:
              typeof img.pinned === 'boolean'
                ? img.pinned
                  ? 1
                  : 0
                : sql`pinned`,
            notes: img.notes ?? '',
          })
          .where(and(eq(images.userId, userId), eq(images.id, matchedId)))
      )
      continue
    }

    statements.push(
      db.insert(images).values({
        userId,
        source: img.source,
        target: img.target,
        profile: img.profile ?? 'default',
        enabled: img.enabled !== false ? 1 : 0,
        pinned: img.pinned ? 1 : 0,
        synced: img.synced ? 1 : 0,
        status: img.status ?? (img.synced ? 'synced' : 'pending'),
        syncError: img.syncError ?? '',
        notes: img.notes ?? '',
        createdAt: img.createdAt ?? new Date().toISOString(),
        syncedAt: img.syncedAt ?? null,
      })
    )
  }

  const removedIds = [...existingImageIds].filter((id) => !keptImageIds.has(id))
  if (removedIds.length) {
    statements.push(
      db.delete(images).where(and(eq(images.userId, userId), inArray(images.id, removedIds)))
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
  if (!sortField) {
    return [
      asc(sql`CASE
        WHEN enabled = 1 AND status = 'pending' THEN 0
        WHEN status = 'syncing' THEN 1
        ELSE 2
      END`),
      desc(images.enabled),
      desc(sql`rowid`),
    ]
  }
  const rowid = asc(sql`rowid`)
  if (sortField === 'enabled') return [dir(images.enabled), rowid]
  if (sortField === 'createdAt') return [dir(images.createdAt), rowid]
  return [dir(images.syncedAt), rowid]
}

mirrorsRoutes.get('/search', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const q = (c.req.query('q') ?? '').trim()
  const page = parsePositiveInt(c.req.query('page'), 1)
  const pageSize = Math.min(parsePositiveInt(c.req.query('pageSize'), 20), 1000)
  const sortField = parseSortField(c.req.query('sortField'))
  const sortDir = parseSortDir(c.req.query('sortDir'))
  const includeProfiles = c.req.query('includeProfiles') === '1' || c.req.query('includeProfiles') === 'true'

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
    ...(includeProfiles
      ? {
          profiles: Object.fromEntries(
            (
              await db
                .select({
                  name: profiles.name,
                  registry: profiles.registry,
                  username: profiles.usernameEnv,
                  password: profiles.passwordEnv,
                })
                .from(profiles)
                .where(eq(profiles.userId, userId))
                .orderBy(asc(profiles.name))
            ).map((row) => [
              row.name,
              {
                registry: row.registry,
                username: row.username || undefined,
                password: row.password || undefined,
              } satisfies RegistryProfile,
            ])
          ),
        }
      : {}),
  })
})
