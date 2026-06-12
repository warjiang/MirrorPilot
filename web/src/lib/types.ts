// Types mirroring the Go config model in internal/config/config.go.

export interface RegistryProfile {
  registry: string
  username?: string
  password?: string
}

export interface ImageEntry {
  id?: number
  source: string
  target: string
  profile: string
  enabled: boolean
  pinned?: boolean
  synced?: boolean
  status?: 'pending' | 'syncing' | 'synced' | 'failed'
  syncError?: string
  createdAt?: string
  syncedAt?: string
  notes?: string
}

export interface MirrorConfig {
  version: string
  profiles: Record<string, RegistryProfile>
  images: ImageEntry[]
}

export const DEFAULT_PROFILE = 'default'

export function emptyConfig(): MirrorConfig {
  return {
    version: 'v2',
    profiles: {
      [DEFAULT_PROFILE]: {
        registry: '',
      },
    },
    images: [],
  }
}

// Detection result shapes shared with the Pages Function API.
export type CheckState =
  | 'ok'
  | 'exists'
  | 'missing'
  | 'failed'
  | 'unreachable'
  | 'error'
  | 'skipped'

export interface CheckResult {
  state: CheckState
  message: string
  detail?: string
}

export interface DetectResponse {
  source: CheckResult
  targetReachable: CheckResult
  targetExists: CheckResult
  auth: CheckResult
}

export interface DetectRequest {
  source: string
  targetRegistry: string
  target: string
  username?: string
  password?: string
}

export interface CheckRegistryRequest {
  registry: string
  username?: string
  password?: string
}

export interface CheckRegistryResponse {
  reachable: { ok: boolean; message: string }
  auth: { ok: boolean; message: string }
}
