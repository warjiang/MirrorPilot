import type { Env } from '@functions/_env'
import { getUserId } from '../_auth'

interface ImageRow {
  id: number
  source: string
  target: string
  profile: string
  registry: string | null
  username_env: string | null
  password_env: string | null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch images with their profile credentials in one query
  const result = await env.DB.prepare(`
    SELECT i.id, i.source, i.target, i.profile,
           p.registry, p.username_env, p.password_env
    FROM images i
    LEFT JOIN profiles p ON p.user_id = i.user_id AND p.name = i.profile
    WHERE i.user_id = ? AND i.enabled = 1 AND i.status NOT IN ('synced', 'syncing')
  `).bind(userId).all<ImageRow>()

  if (!result.results.length) {
    return Response.json({ ok: false, message: 'No images to sync' })
  }

  const images = result.results.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    registry: row.registry || '',
    username: row.username_env || '',
    password: row.password_env || '',
  }))

  // Create job + items before dispatching so the workflow can report back
  const jobId = crypto.randomUUID()
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO jobs (id, user_id, status, image_total) VALUES (?, ?, 'pending', ?)"
    ).bind(jobId, userId, images.length),
  ]
  for (const row of result.results) {
    const fullTarget = row.registry ? `${row.registry}/${row.target}` : row.target
    statements.push(
      env.DB.prepare(
        'INSERT INTO job_items (job_id, image_id, source, target) VALUES (?, ?, ?, ?)'
      ).bind(jobId, row.id, row.source, fullTarget)
    )
  }
  await env.DB.batch(statements)

  const dispatchRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'MirrorPilot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'web-sync',
      client_payload: {
        user_id: userId,
        job_id: jobId,
        images,
      },
    }),
  })

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text()
    await env.DB.prepare(
      "UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ?"
    ).bind(`GitHub dispatch failed: ${text}`, jobId).run()
    return Response.json({ ok: false, message: `GitHub dispatch failed: ${text}` }, { status: 502 })
  }

  // Mark images as syncing and job as dispatched
  const imageIds = images.map((img) => img.id)
  const placeholders = imageIds.map(() => '?').join(',')
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE images SET status = 'syncing' WHERE id IN (${placeholders})`
    ).bind(...imageIds),
    env.DB.prepare(
      "UPDATE jobs SET status = 'dispatched' WHERE id = ?"
    ).bind(jobId),
  ])

  return Response.json({ ok: true, count: images.length, jobId })
}
