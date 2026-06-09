import type { MirrorConfig } from './types'
import type { ImageEntry } from './types'

export async function loadConfig(): Promise<MirrorConfig> {
  const res = await fetch('/api/mirrors')
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = `: ${body.error}`
    } catch { /* ignore non-JSON */ }
    throw new Error(`Failed to load config (HTTP ${res.status})${detail}`)
  }
  return res.json() as Promise<MirrorConfig>
}

export async function saveConfig(config: MirrorConfig): Promise<void> {
  const res = await fetch('/api/mirrors', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
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

export interface MirrorsSearchParams {
  q: string
  page: number
  pageSize: number
  sortField?: 'enabled' | 'createdAt' | 'syncedAt'
  sortDir?: 'asc' | 'desc'
}

export interface MirrorsSearchResponse {
  q: string
  page: number
  pageSize: number
  total: number
  items: ImageEntry[]
}

export async function searchMirrors(params: MirrorsSearchParams): Promise<MirrorsSearchResponse> {
  const query = new URLSearchParams({
    q: params.q,
    page: String(params.page),
    pageSize: String(params.pageSize),
  })
  if (params.sortField) query.set('sortField', params.sortField)
  if (params.sortDir) query.set('sortDir', params.sortDir)

  const res = await fetch(`/api/mirrors/search?${query.toString()}`)
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = `: ${body.error}`
    } catch { /* ignore */ }
    throw new Error(`Failed to search mirrors (HTTP ${res.status})${detail}`)
  }
  return res.json() as Promise<MirrorsSearchResponse>
}
