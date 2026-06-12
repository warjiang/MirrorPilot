import type { DetectRequest, DetectResponse } from './types'
import type { MirrorConfig } from './types'
import { toV2Payload } from './cloudflare'

interface TriggerSyncResponse {
  ok: boolean
  count?: number
  message?: string
  jobId?: string
}

export interface SyncJob {
  id: string
  status: string
  github_run_id: number | null
  image_total: number
  image_success: number
  image_failed: number
  error: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  run_url?: string | null
}

export interface SyncJobItem {
  id: number
  image_id: number
  source: string
  target: string
  status: string
  error: string
  duration_ms: number | null
  finished_at: string | null
}

export interface JobLogsResponse {
  available: boolean
  running?: boolean
  reason?: string
  run_url?: string
  steps?: Array<{
    job: string
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
  }>
  logs?: Array<{ name: string; content: string }>
}

async function jsonOrThrow<T>(res: Response, action: string): Promise<T> {
  const body = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) {
    throw new Error(body.error ? `${action} failed: ${body.error}` : `${action} failed (HTTP ${res.status})`)
  }
  return body
}

export async function listJobs(limit = 20, offset = 0): Promise<{ jobs: SyncJob[]; total: number }> {
  const res = await fetch(`/api/jobs?limit=${limit}&offset=${offset}`)
  return jsonOrThrow(res, 'list jobs')
}

export async function getJob(id: string): Promise<{ job: SyncJob; items: SyncJobItem[] }> {
  const res = await fetch(`/api/jobs/${id}`)
  return jsonOrThrow(res, 'get job')
}

export async function cancelJob(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
  return jsonOrThrow(res, 'cancel job')
}

export async function getJobLogs(id: string): Promise<JobLogsResponse> {
  const res = await fetch(`/api/jobs/${id}/logs`)
  return jsonOrThrow(res, 'get job logs')
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

export async function triggerSync(draft?: MirrorConfig): Promise<TriggerSyncResponse> {
  const res = await fetch('/api/sync/trigger', {
    method: 'POST',
    headers: draft ? { 'content-type': 'application/json' } : undefined,
    body: draft ? JSON.stringify({ draft: toV2Payload(draft) }) : undefined,
  })
  const body = await res.json().catch(() => ({})) as TriggerSyncResponse & { error?: string }
  if (!res.ok) {
    const detail = body.error ?? body.message
    throw new Error(detail ? `sync trigger failed: ${detail}` : `sync trigger failed (HTTP ${res.status})`)
  }
  return body
}
