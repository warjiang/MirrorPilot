import type { DetectRequest, DetectResponse } from './types'

interface TriggerSyncResponse {
  ok: boolean
  count?: number
  message?: string
}

/**
 * Call the Cloudflare Pages Function that performs source detection.
 * In local `vite dev` (without `wrangler pages dev`) this endpoint is not
 * available; callers should surface a helpful error in that case.
 */
export async function detect(req: DetectRequest): Promise<DetectResponse> {
  const res = await fetch('/api/detect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ? `: ${body.error}` : ''
    } catch {
      // ignore non-JSON bodies
    }
    throw new Error(`detection request failed (HTTP ${res.status})${detail}`)
  }
  return (await res.json()) as DetectResponse
}

export async function triggerSync(): Promise<TriggerSyncResponse> {
  const res = await fetch('/api/sync/trigger', {
    method: 'POST',
  })
  const body = await res.json().catch(() => ({})) as TriggerSyncResponse & { error?: string }
  if (!res.ok) {
    const detail = body.error ?? body.message
    throw new Error(detail ? `sync trigger failed: ${detail}` : `sync trigger failed (HTTP ${res.status})`)
  }
  return body
}
