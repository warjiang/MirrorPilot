import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { AppEnv } from '../types'
import type { Db } from '../db'
import {
  imageProfiles,
  images,
  profiles,
  userImages,
  userProfiles,
} from '../db/schema'
import type { RegistryProfile, ImageEntry } from '../../../src/lib/types'

interface ProfileEntity {
  id: number
  name: string
  registry: string
  namespace: string
  auth_type: string
  username: string
  password_secret: string
  is_active: number
  created_at: string
  updated_at: string
}

interface UserProfileLink {
  user_id: number
  profile_id: number
  enabled: number
  granted_by: number | null
  created_at: string
  updated_at: string
}

interface ImageEntity {
  id: number
  source: string
  default_target: string
  is_active: number
  notes: string
  created_at: string
  updated_at: string
}

interface UserImageLink {
  user_id: number
  image_id: number
  enabled: number
  pinned: number
  target_override: string | null
  notes: string
  last_sync_status: string
  last_sync_at: string | null
  last_error: string
  created_at: string
  updated_at: string
}

interface ImageProfileLink {
  image_id: number
  profile_id: number
  enabled: number
  priority: number
  is_default: number
  created_at: string
  updated_at: string
}

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

export interface V2ConfigPayload {
  version?: string
  profiles: Array<{
    id?: number
    name: string
    registry?: string
    namespace?: string
    auth_type?: string
    username?: string
    password_secret?: string
    is_active?: number | boolean
  }>
  images: Array<{
    id?: number
    source: string
    default_target: string
    is_active?: number | boolean
    notes?: string
  }>
  user_profiles?: Array<{
    profile_id?: number
    profile_name?: string
    enabled?: number | boolean
    granted_by?: number
  }>
  user_images: Array<{
    image_id?: number
    source?: string
    default_target?: string
    target_override?: string | null
    enabled?: number | boolean
    pinned?: number | boolean
    notes?: string
    last_sync_status?: string
    last_sync_at?: string | null
    last_error?: string
  }>
  image_profiles: Array<{
    image_id?: number
    source?: string
    default_target?: string
    profile_id?: number
    profile_name?: string
    enabled?: number | boolean
    priority?: number
    is_default?: number | boolean
  }>
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

export const imagesRoutes = new Hono<AppEnv>()

async function loadDefaultProfileByImageId(
  db: Db,
  imageIds: number[]
): Promise<Map<number, { id: number; name: string }>> {
  if (!imageIds.length) return new Map()

  const rows = await db
    .select({
      imageId: imageProfiles.imageId,
      profileId: imageProfiles.profileId,
      profileName: profiles.name,
      enabled: imageProfiles.enabled,
      isDefault: imageProfiles.isDefault,
      priority: imageProfiles.priority,
    })
    .from(imageProfiles)
    .innerJoin(profiles, eq(profiles.id, imageProfiles.profileId))
    .where(and(inArray(imageProfiles.imageId, imageIds), eq(imageProfiles.enabled, 1)))
    .orderBy(
      asc(imageProfiles.imageId),
      desc(imageProfiles.isDefault),
      asc(imageProfiles.priority),
      asc(imageProfiles.profileId)
    )

  const picked = new Map<number, { id: number; name: string }>()
  for (const row of rows) {
    if (!picked.has(row.imageId)) {
      picked.set(row.imageId, { id: row.profileId, name: row.profileName })
    }
  }
  return picked
}

async function loadUserState(db: Db, userId: number) {
  const [profileRows, userProfileRows, imageRows, userImageRows, imageProfileRows] = await Promise.all([
    db
      .select({
        id: profiles.id,
        name: profiles.name,
        registry: profiles.registry,
        namespace: profiles.namespace,
        auth_type: profiles.authType,
        username: profiles.username,
        password_secret: profiles.passwordSecret,
        is_active: profiles.isActive,
        created_at: profiles.createdAt,
        updated_at: profiles.updatedAt,
      })
      .from(profiles)
      .orderBy(asc(profiles.name)),
    db
      .select({
        user_id: userProfiles.userId,
        profile_id: userProfiles.profileId,
        enabled: userProfiles.enabled,
        granted_by: userProfiles.grantedBy,
        created_at: userProfiles.createdAt,
        updated_at: userProfiles.updatedAt,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .orderBy(asc(userProfiles.profileId)),
    db
      .select({
        id: images.id,
        source: images.source,
        default_target: images.target,
        is_active: images.isActive,
        notes: images.notes,
        created_at: images.createdAt,
        updated_at: images.updatedAt,
      })
      .from(images)
      .orderBy(asc(images.id)),
    db
      .select({
        user_id: userImages.userId,
        image_id: userImages.imageId,
        enabled: userImages.enabled,
        pinned: userImages.pinned,
        target_override: userImages.targetOverride,
        notes: userImages.notes,
        last_sync_status: userImages.lastSyncStatus,
        last_sync_at: userImages.lastSyncAt,
        last_error: userImages.lastError,
        created_at: userImages.createdAt,
        updated_at: userImages.updatedAt,
      })
      .from(userImages)
      .where(eq(userImages.userId, userId))
      .orderBy(desc(userImages.pinned), desc(userImages.updatedAt)),
    db
      .select({
        image_id: imageProfiles.imageId,
        profile_id: imageProfiles.profileId,
        enabled: imageProfiles.enabled,
        priority: imageProfiles.priority,
        is_default: imageProfiles.isDefault,
        created_at: imageProfiles.createdAt,
        updated_at: imageProfiles.updatedAt,
      })
      .from(imageProfiles)
      .orderBy(asc(imageProfiles.imageId), asc(imageProfiles.priority)),
  ])

  return {
    profileRows: profileRows as ProfileEntity[],
    userProfileRows: userProfileRows as UserProfileLink[],
    imageRows: imageRows as ImageEntity[],
    userImageRows: userImageRows as UserImageLink[],
    imageProfileRows: imageProfileRows as ImageProfileLink[],
  }
}

function asBool01(value: number | boolean | undefined, fallback = 1): number {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value ? 1 : 0
  return value ? 1 : 0
}

function imageKey(source: string, target: string): string {
  return `${source}\u0000${target}`
}

export const getConfigHandler = async (c: Context<AppEnv>) => {
  const db = c.get('db')
  const user = c.get('user')

  const { profileRows, userProfileRows, imageRows, userImageRows, imageProfileRows } = await loadUserState(db, user.id)

  return c.json({
    version: 'v2',
    profiles: profileRows,
    images: imageRows,
    user_profiles: userProfileRows,
    user_images: userImageRows,
    image_profiles: imageProfileRows,
  })
}

export function isV2ConfigPayload(body: unknown): body is V2ConfigPayload {
  if (!body || typeof body !== 'object') return false
  const maybe = body as Partial<V2ConfigPayload>
  return (
    Array.isArray(maybe.profiles) &&
    Array.isArray(maybe.images) &&
    Array.isArray(maybe.user_images) &&
    Array.isArray(maybe.image_profiles)
  )
}

export async function materializeV2Config(db: Db, userId: number, body: V2ConfigPayload) {
  const profileIdsByName = new Map<string, number>()
  const imageIdByKey = new Map<string, number>()
  const imageIdByClientId = new Map<number, number>()
  const profileIdByClientId = new Map<number, number>()

  for (const p of body.profiles) {
    const name = String(p.name || '').trim()
    if (!name) continue

    await db
      .insert(profiles)
      .values({
        name,
        registry: String(p.registry || '').trim(),
        namespace: String(p.namespace || '').trim(),
        authType: String(p.auth_type || 'basic'),
        username: String(p.username || ''),
        passwordSecret: String(p.password_secret || ''),
        isActive: asBool01(p.is_active, 1),
      })
      .onConflictDoUpdate({
        target: profiles.name,
        set: {
          registry: String(p.registry || '').trim(),
          namespace: String(p.namespace || '').trim(),
          authType: String(p.auth_type || 'basic'),
          username: String(p.username || ''),
          passwordSecret: String(p.password_secret || ''),
          isActive: asBool01(p.is_active, 1),
          updatedAt: sql`datetime('now')`,
        },
      })
  }

  const profileNames = body.profiles.map((p) => String(p.name || '').trim()).filter(Boolean)
  if (profileNames.length > 0) {
    const existingProfiles = await db
      .select({ id: profiles.id, name: profiles.name })
      .from(profiles)
      .where(inArray(profiles.name, profileNames))

    for (const row of existingProfiles) {
      profileIdsByName.set(row.name, row.id)
    }
  }

  for (const p of body.profiles) {
    const name = String(p.name || '').trim()
    if (!name) continue
    if (typeof p.id === 'number' && Number.isFinite(p.id) && p.id > 0) {
      const resolved = profileIdsByName.get(name)
      if (resolved) profileIdByClientId.set(Math.trunc(p.id), resolved)
    }
  }

  for (const img of body.images) {
    const source = String(img.source || '').trim()
    const target = String(img.default_target || '').trim()
    if (!source || !target) continue

    let currentId: number | null = null

    if (typeof img.id === 'number' && Number.isFinite(img.id) && img.id > 0) {
      const requestedId = Math.trunc(img.id)
      const byId = await db
        .select({ id: images.id })
        .from(images)
        .where(eq(images.id, requestedId))
        .limit(1)
      if (byId[0]) {
        currentId = byId[0].id
        await db
          .update(images)
          .set({
            source,
            target,
            isActive: asBool01(img.is_active, 1),
            notes: String(img.notes || ''),
            updatedAt: sql`datetime('now')`,
          })
          .where(eq(images.id, currentId))
      }
    }

    if (!currentId) {
      const byKey = await db
        .select({ id: images.id })
        .from(images)
        .where(and(eq(images.source, source), eq(images.target, target)))
        .orderBy(desc(images.id))
        .limit(1)
      if (byKey[0]) {
        currentId = byKey[0].id
        await db
          .update(images)
          .set({
            isActive: asBool01(img.is_active, 1),
            notes: String(img.notes || ''),
            updatedAt: sql`datetime('now')`,
          })
          .where(eq(images.id, currentId))
      }
    }

    if (!currentId) {
      const inserted = await db
        .insert(images)
        .values({
          source,
          target,
          isActive: asBool01(img.is_active, 1),
          notes: String(img.notes || ''),
        })
        .returning({ id: images.id })
      currentId = inserted[0]?.id || null
    }

    if (currentId) {
      imageIdByKey.set(imageKey(source, target), currentId)
      if (typeof img.id === 'number' && Number.isFinite(img.id) && img.id > 0) {
        imageIdByClientId.set(Math.trunc(img.id), currentId)
      }
    }
  }

  const resolveImageId = (row: { image_id?: number; source?: string; default_target?: string; target_override?: string | null }): number | null => {
    if (typeof row.image_id === 'number' && Number.isFinite(row.image_id) && row.image_id > 0) {
      const mapped = imageIdByClientId.get(Math.trunc(row.image_id))
      if (mapped) return mapped
    }

    const source = String(row.source || '').trim()
    const defaultTarget = String(row.default_target || row.target_override || '').trim()
    if (!source || !defaultTarget) return null
    return imageIdByKey.get(imageKey(source, defaultTarget)) || null
  }

  const resolveProfileId = (row: { profile_id?: number; profile_name?: string }): number | null => {
    if (typeof row.profile_id === 'number' && Number.isFinite(row.profile_id) && row.profile_id > 0) {
      const mapped = profileIdByClientId.get(Math.trunc(row.profile_id))
      if (mapped) return mapped
      const byName = [...profileIdsByName.values()].includes(Math.trunc(row.profile_id))
      if (byName) return Math.trunc(row.profile_id)
    }

    const name = String(row.profile_name || '').trim()
    if (!name) return null
    return profileIdsByName.get(name) || null
  }

  const statements: BatchItem<'sqlite'>[] = [
    db.delete(userProfiles).where(eq(userProfiles.userId, userId)),
    db.delete(userImages).where(eq(userImages.userId, userId)),
  ]

  const upRows = Array.isArray(body.user_profiles) ? body.user_profiles : []
  if (upRows.length) {
    for (const up of upRows) {
      const profileId = resolveProfileId(up)
      if (!profileId) continue
      statements.push(
        db.insert(userProfiles).values({
          userId,
          profileId,
          enabled: asBool01(up.enabled, 1),
          grantedBy: typeof up.granted_by === 'number' ? Math.trunc(up.granted_by) : userId,
        })
      )
    }
  } else {
    for (const profileId of profileIdsByName.values()) {
      statements.push(
        db.insert(userProfiles).values({ userId, profileId, enabled: 1, grantedBy: userId })
      )
    }
  }

  const touchedImageIds = new Set<number>()
  for (const ui of body.user_images) {
    const imageId = resolveImageId(ui)
    if (!imageId) continue
    touchedImageIds.add(imageId)
    statements.push(
      db.insert(userImages).values({
        userId,
        imageId,
        enabled: asBool01(ui.enabled, 1),
        pinned: asBool01(ui.pinned, 0),
        targetOverride: ui.target_override ?? null,
        notes: String(ui.notes || ''),
        lastSyncStatus: String(ui.last_sync_status || 'pending'),
        lastSyncAt: ui.last_sync_at ?? null,
        lastError: String(ui.last_error || ''),
      })
    )
  }

  if (touchedImageIds.size > 0) {
    statements.push(
      db.delete(imageProfiles).where(inArray(imageProfiles.imageId, [...touchedImageIds]))
    )
  }

  for (const ip of body.image_profiles) {
    const imageId = resolveImageId(ip)
    const profileId = resolveProfileId(ip)
    if (!imageId || !profileId) continue
    statements.push(
      db.insert(imageProfiles).values({
        imageId,
        profileId,
        enabled: asBool01(ip.enabled, 1),
        priority: typeof ip.priority === 'number' && Number.isFinite(ip.priority) ? Math.trunc(ip.priority) : 100,
        isDefault: asBool01(ip.is_default, 0),
      })
    )
  }

  if (statements.length) {
    await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  }
}

export const putConfigHandler = async (c: Context<AppEnv>) => {
  const db = c.get('db')
  const userId = c.get('user').id

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  if (!isV2ConfigPayload(body)) {
    return c.json({ error: 'V2 payload requires profiles/images/user_images/image_profiles arrays' }, 400)
  }
  await materializeV2Config(db, userId, body)

  return c.json({ ok: true })
}

imagesRoutes.get('/', getConfigHandler)
imagesRoutes.put('/', putConfigHandler)
imagesRoutes.post('/materialize', putConfigHandler)

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

imagesRoutes.get('/search', async (c) => {
  const db = c.get('db')
  const userId = c.get('user').id

  const q = (c.req.query('q') ?? '').trim()
  const page = parsePositiveInt(c.req.query('page'), 1)
  const pageSize = Math.min(parsePositiveInt(c.req.query('pageSize'), 20), 1000)
  const sortField = parseSortField(c.req.query('sortField'))
  const sortDir = parseSortDir(c.req.query('sortDir'))
  const includeProfiles = c.req.query('includeProfiles') === '1' || c.req.query('includeProfiles') === 'true'

  const pattern = `%${q}%`
  const filterExpr = q
    ? and(
        eq(userImages.userId, userId),
        or(
          like(images.source, pattern),
          like(images.target, pattern),
          like(userImages.targetOverride, pattern),
          like(userImages.notes, pattern)
        )
      )
    : eq(userImages.userId, userId)

  const userRows = await db
    .select({
      imageId: userImages.imageId,
      enabled: userImages.enabled,
      pinned: userImages.pinned,
      targetOverride: userImages.targetOverride,
      notes: userImages.notes,
      lastSyncStatus: userImages.lastSyncStatus,
      lastSyncAt: userImages.lastSyncAt,
      lastError: userImages.lastError,
      imageSource: images.source,
      imageTarget: images.target,
      imageCreatedAt: images.createdAt,
    })
    .from(userImages)
    .innerJoin(images, eq(images.id, userImages.imageId))
    .where(filterExpr)

  const defaultProfiles = await loadDefaultProfileByImageId(
    db,
    userRows.map((r) => r.imageId)
  )

  const mappedRows: ImageRow[] = userRows.map((row) => {
    const profile = defaultProfiles.get(row.imageId)
    return {
      id: row.imageId,
      source: row.imageSource,
      target: row.targetOverride || row.imageTarget,
      profile: profile?.name || 'default',
      enabled: row.enabled,
      pinned: row.pinned,
      synced: row.lastSyncStatus === 'synced' ? 1 : 0,
      status: row.lastSyncStatus,
      syncError: row.lastError,
      notes: row.notes,
      createdAt: row.imageCreatedAt,
      syncedAt: row.lastSyncAt,
    }
  })

  const multiplier = sortDir === 'asc' ? 1 : -1
  mappedRows.sort((a, b) => {
    if (!sortField) {
      const scoreA = a.status === 'pending' && a.enabled === 1 ? 0 : (a.status === 'syncing' ? 1 : 2)
      const scoreB = b.status === 'pending' && b.enabled === 1 ? 0 : (b.status === 'syncing' ? 1 : 2)
      if (scoreA !== scoreB) return scoreA - scoreB
      if (a.enabled !== b.enabled) return b.enabled - a.enabled
      return b.id - a.id
    }

    if (sortField === 'enabled') return multiplier * (a.enabled - b.enabled || a.id - b.id)
    if (sortField === 'createdAt') return multiplier * (a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    return multiplier * ((a.syncedAt || '').localeCompare(b.syncedAt || '') || a.id - b.id)
  })

  const total = mappedRows.length
  const offset = (page - 1) * pageSize
  const items = mappedRows.slice(offset, offset + pageSize).map(mapRowToImage)

  const extraProfiles = includeProfiles
    ? Object.fromEntries(
        (
          await db
            .select({
              name: profiles.name,
              registry: profiles.registry,
              namespace: profiles.namespace,
              username: profiles.username,
              password: profiles.passwordSecret,
            })
            .from(profiles)
            .where(eq(profiles.isActive, 1))
            .orderBy(asc(profiles.name))
        ).map((row) => [
          row.name,
          {
            registry: row.registry,
            namespace: row.namespace || undefined,
            username: row.username || undefined,
            password: row.password || undefined,
          } satisfies RegistryProfile,
        ])
      )
    : undefined

  return c.json({
    q,
    page,
    pageSize,
    total,
    items,
    ...(extraProfiles ? { profiles: extraProfiles } : {}),
  })
})
