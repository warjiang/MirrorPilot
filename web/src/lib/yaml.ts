import yaml from 'js-yaml'
import type { ImageEntry, MirrorConfig, RegistryProfile } from './types'

interface YamlProfile {
  registry: string
  username_env?: string
  password_env?: string
}

interface YamlImage {
  source: string
  target: string
  profile?: string
  enabled?: boolean
  synced?: boolean
  created_at?: string
  synced_at?: string
  notes?: string
}

interface YamlConfig {
  version: string
  profiles: Record<string, YamlProfile>
  images: YamlImage[]
}

export function parseYaml(content: string): MirrorConfig {
  const raw = yaml.load(content) as YamlConfig | null
  if (!raw) return { version: 'v1', profiles: {}, images: [] }

  const profiles: Record<string, RegistryProfile> = {}
  if (raw.profiles) {
    for (const [name, p] of Object.entries(raw.profiles)) {
      profiles[name] = {
        registry: p.registry ?? '',
        usernameEnv: p.username_env ?? '',
        passwordEnv: p.password_env ?? '',
      }
    }
  }

  const images: ImageEntry[] = (raw.images ?? []).map((img) => ({
    source: img.source,
    target: img.target,
    profile: img.profile ?? 'default',
    enabled: img.enabled !== false,
    synced: img.synced,
    createdAt: img.created_at,
    syncedAt: img.synced_at,
    notes: img.notes,
  }))

  return { version: raw.version ?? 'v1', profiles, images }
}

export function serializeYaml(config: MirrorConfig): string {
  const profiles: Record<string, YamlProfile> = {}
  for (const [name, p] of Object.entries(config.profiles)) {
    profiles[name] = {
      registry: p.registry,
      username_env: p.usernameEnv || undefined,
      password_env: p.passwordEnv || undefined,
    }
  }

  const images: YamlImage[] = config.images.map((img) => {
    const entry: YamlImage = {
      source: img.source,
      target: img.target,
      profile: img.profile !== 'default' ? img.profile : undefined,
      enabled: img.enabled === false ? false : undefined,
      synced: img.synced || undefined,
      created_at: img.createdAt || undefined,
      synced_at: img.syncedAt || undefined,
      notes: img.notes || undefined,
    }
    return entry
  })

  const doc: YamlConfig = { version: config.version, profiles, images }
  return yaml.dump(doc, { lineWidth: -1, noRefs: true, sortKeys: false })
}
