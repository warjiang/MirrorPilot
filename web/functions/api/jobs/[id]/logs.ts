import { unzipSync, strFromU8 } from 'fflate'
import type { Env } from '@functions/_env'
import { getUserId, githubHeaders } from '../../_auth'

interface RunJob {
  name: string
  status: string
  conclusion: string | null
  steps?: Array<{
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
  }>
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = params.id as string
  const job = await env.DB.prepare(
    'SELECT id, status, github_run_id FROM jobs WHERE id = ? AND user_id = ?'
  ).bind(jobId, userId).first<{ id: string; status: string; github_run_id: number | null }>()

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }
  if (!job.github_run_id) {
    return Response.json({ available: false, reason: 'Workflow has not started yet' })
  }

  const runUrl = `https://github.com/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}`

  // While running, full logs are not downloadable — return step progress instead
  const runRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}`,
    { headers: githubHeaders(env) }
  )
  if (!runRes.ok) {
    return Response.json({ error: 'Failed to query workflow run' }, { status: 502 })
  }
  const run = await runRes.json() as { status: string }

  if (run.status !== 'completed') {
    const jobsRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}/jobs`,
      { headers: githubHeaders(env) }
    )
    const steps = jobsRes.ok
      ? ((await jobsRes.json() as { jobs: RunJob[] }).jobs || []).flatMap((j) =>
          (j.steps || []).map((s) => ({
            job: j.name,
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            started_at: s.started_at,
            completed_at: s.completed_at,
          }))
        )
      : []
    return Response.json({ available: false, running: true, run_url: runUrl, steps })
  }

  // Completed: download the logs archive (zip) and extract text
  const logsRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs/${job.github_run_id}/logs`,
    { headers: githubHeaders(env), redirect: 'follow' }
  )
  if (!logsRes.ok) {
    return Response.json({
      available: false,
      run_url: runUrl,
      reason: logsRes.status === 410 ? 'Logs have expired' : 'Failed to download logs',
    })
  }

  const zipData = new Uint8Array(await logsRes.arrayBuffer())
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipData)
  } catch {
    return Response.json({ available: false, run_url: runUrl, reason: 'Failed to extract logs archive' })
  }

  // Top-level files like "0_Sync images from Web UI.txt" contain the merged per-job log
  const logs = Object.keys(files)
    .filter((name) => !name.includes('/') && name.endsWith('.txt'))
    .sort()
    .map((name) => ({
      name: name.replace(/\.txt$/, '').replace(/^\d+_/, ''),
      content: strFromU8(files[name]),
    }))

  return Response.json({ available: true, run_url: runUrl, logs })
}
