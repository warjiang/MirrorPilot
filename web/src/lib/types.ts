// Types mirroring the Go config model in internal/config/config.go.

export interface RegistryProfile {
  registry: string
  usernameEnv?: string
  passwordEnv?: string
}

export interface ImageEntry {
  source: string
  target: string
  profile: string
  enabled: boolean
  synced?: boolean
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
    version: 'v1',
    profiles: {
      [DEFAULT_PROFILE]: {
        registry: 'registry.example.com/namespace',
        usernameEnv: 'DEST_REGISTRY_USER',
        passwordEnv: 'DEST_REGISTRY_PASSWORD',
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
