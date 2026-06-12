import type { MirrorConfig } from './types'
import type { ImageEntry } from './types'
import { DEFAULT_PROFILE } from './types'

interface ConfigV2Profile {
  id: number
  name: string
  registry: string
  auth_type: string
  username: string
  password_secret: string
  is_active: number
  created_at: string
  updated_at: string
}

interface ConfigV2Image {
  id: number
  source: string
  default_target: string
  is_active: number
  notes: string
  created_at: string
  updated_at: string
}

interface ConfigV2UserProfile {
  user_id: number
  profile_id: number
  enabled: number
  granted_by: number | null
  created_at: string
  updated_at: string
}

interface ConfigV2UserImage {
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

interface ConfigV2ImageProfile {
  image_id: number
  profile_id: number
  enabled: number
  priority: number
  is_default: number
  created_at: string
  updated_at: string
}

export interface ConfigV2Response {
  version: string
  profiles: ConfigV2Profile[]
  images: ConfigV2Image[]
  user_profiles: ConfigV2UserProfile[]
  user_images: ConfigV2UserImage[]
  image_profiles: ConfigV2ImageProfile[]
}

function normalizeStatus(status: string): ImageEntry['status'] {
  return status === 'pending' || status === 'syncing' || status === 'synced' || status === 'failed'
    ? status
    : 'pending'
}

function fromV2(payload: ConfigV2Response): MirrorConfig {
  const profilesById = new Map<number, ConfigV2Profile>()
  for (const p of payload.profiles || []) profilesById.set(Number(p.id), p)

  const profileMap: MirrorConfig['profiles'] = {}
  for (const link of payload.user_profiles || []) {
    if (Number(link.enabled) !== 1) continue
    const profile = profilesById.get(Number(link.profile_id))
    if (!profile?.name) continue
    profileMap[profile.name] = {
      registry: String(profile.registry || ''),
      username: profile.username || undefined,
      password: profile.password_secret || undefined,
    }
  }

  const imagesById = new Map<number, ConfigV2Image>()
  for (const img of payload.images || []) imagesById.set(Number(img.id), img)

  const defaultProfileByImageId = new Map<number, string>()
  const sortedImageProfiles = [...(payload.image_profiles || [])].sort((a, b) => {
    if (a.image_id !== b.image_id) return a.image_id - b.image_id
    if (a.is_default !== b.is_default) return b.is_default - a.is_default
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.profile_id - b.profile_id
  })

  for (const link of sortedImageProfiles) {
    if (Number(link.enabled) !== 1) continue
    if (defaultProfileByImageId.has(Number(link.image_id))) continue
    const profile = profilesById.get(Number(link.profile_id))
    if (!profile?.name) continue
    defaultProfileByImageId.set(Number(link.image_id), profile.name)
  }

  const imageList: ImageEntry[] = (payload.user_images || []).map((ui) => {
    const image = imagesById.get(Number(ui.image_id))
    const status = String(ui.last_sync_status || 'pending')
    return {
      id: Number(ui.image_id),
      source: String(image?.source || ''),
      target: String(ui.target_override || image?.default_target || ''),
      profile: defaultProfileByImageId.get(Number(ui.image_id)) || DEFAULT_PROFILE,
      enabled: Number(ui.enabled) === 1,
      pinned: Number(ui.pinned) === 1 ? true : undefined,
      synced: status === 'synced' ? true : undefined,
      status: normalizeStatus(status),
      syncError: ui.last_error || undefined,
      notes: ui.notes || image?.notes || undefined,
      createdAt: image?.created_at || undefined,
      syncedAt: ui.last_sync_at || undefined,
    }
  }).filter((img) => img.source)

  return {
    version: payload.version || 'v2',
    profiles: profileMap,
    images: imageList,
  }
}

export function toV2Payload(config: MirrorConfig): ConfigV2Response {
  const profileNames = Object.keys(config.profiles)

  const profiles: ConfigV2Profile[] = profileNames.map((name, i) => {
    const p = config.profiles[name]
    return {
      id: i + 1,
      name,
      registry: p.registry || '',
      auth_type: 'basic',
      username: p.username || '',
      password_secret: p.password || '',
      is_active: 1,
      created_at: '',
      updated_at: '',
    }
  })

  const profileIdByName = new Map(profiles.map((p) => [p.name, p.id]))

  const images: ConfigV2Image[] = config.images.map((img, i) => ({
    id: typeof img.id === 'number' ? img.id : (1000000 + i),
    source: img.source,
    default_target: img.target,
    is_active: img.enabled ? 1 : 0,
    notes: img.notes || '',
    created_at: img.createdAt || '',
    updated_at: '',
  }))

  const user_profiles: ConfigV2UserProfile[] = profiles.map((p) => ({
    user_id: 0,
    profile_id: p.id,
    enabled: 1,
    granted_by: null,
    created_at: '',
    updated_at: '',
  }))

  const user_images: ConfigV2UserImage[] = config.images.map((img, i) => ({
    user_id: 0,
    image_id: typeof img.id === 'number' ? img.id : (1000000 + i),
    enabled: img.enabled ? 1 : 0,
    pinned: img.pinned ? 1 : 0,
    target_override: img.target,
    notes: img.notes || '',
    last_sync_status: img.status || (img.synced ? 'synced' : 'pending'),
    last_sync_at: img.syncedAt || null,
    last_error: img.syncError || '',
    created_at: img.createdAt || '',
    updated_at: '',
  }))

  const image_profiles: ConfigV2ImageProfile[] = config.images.map((img, i) => ({
    image_id: typeof img.id === 'number' ? img.id : (1000000 + i),
    profile_id: profileIdByName.get(img.profile) || profileIdByName.get(DEFAULT_PROFILE) || 1,
    enabled: 1,
    priority: 0,
    is_default: 1,
    created_at: '',
    updated_at: '',
  }))

  return {
    version: 'v2',
    profiles,
    images,
    user_profiles,
    user_images,
    image_profiles,
  }
}

export async function loadConfig(): Promise<MirrorConfig> {
  const res = await fetch('/api/config')
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = `: ${body.error}`
    } catch { /* ignore non-JSON */ }
    throw new Error(`Failed to load config (HTTP ${res.status})${detail}`)
  }

  const payload = await res.json() as ConfigV2Response
  return fromV2(payload)
}

export async function saveConfig(config: MirrorConfig): Promise<void> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toV2Payload(config)),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = `: ${body.error}`
    } catch { /* ignore */ }
    throw new Error(`Failed to save config (HTTP ${res.status})${detail}`)
  }
}

export interface ImagesSearchParams {
  q: string
  page: number
  pageSize: number
  sortField?: 'enabled' | 'createdAt' | 'syncedAt'
  sortDir?: 'asc' | 'desc'
}

export interface ImagesSearchResponse {
  q: string
  page: number
  pageSize: number
  total: number
  items: ImageEntry[]
}

export async function searchImages(params: ImagesSearchParams): Promise<ImagesSearchResponse> {
  const query = new URLSearchParams({
    q: params.q,
    page: String(params.page),
    pageSize: String(params.pageSize),
  })
  if (params.sortField) {
    query.set('sortField', params.sortField)
    if (params.sortDir) query.set('sortDir', params.sortDir)
  }

  const res = await fetch(`/api/images/search?${query.toString()}`)
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = `: ${body.error}`
    } catch { /* ignore */ }
    throw new Error(`Failed to search mirrors (HTTP ${res.status})${detail}`)
  }
  return res.json() as Promise<ImagesSearchResponse>
}

export async function loadConfigViaSearch(pageSize = 20): Promise<MirrorConfig> {
  const size = Number.isFinite(pageSize) && pageSize > 0
    ? Math.min(Math.trunc(pageSize), 1000)
    : 20

  const res = await searchImages({
    q: '',
    page: 1,
    pageSize: size,
  })

  return {
    version: 'v2',
    profiles: { [DEFAULT_PROFILE]: { registry: '' } },
    images: res.items,
  }
}
