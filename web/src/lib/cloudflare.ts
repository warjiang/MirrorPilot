import type { MirrorConfig } from './types'

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
  return res.json() as Promise<MirrorConfig>
}

export async function saveConfig(config: MirrorConfig): Promise<void> {
  const res = await fetch('/api/config', {
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
