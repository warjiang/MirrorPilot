import type { Env } from '@functions/_env'
import { getUserId } from '../_auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getUserId(request, env)
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT id, status, github_run_id, image_total, image_success, image_failed,
              error, created_at, started_at, finished_at
       FROM jobs WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    ).bind(userId, limit, offset).all(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM jobs WHERE user_id = ?')
      .bind(userId).first<{ total: number }>(),
  ])

  return Response.json({
    jobs: rows.results,
    total: count?.total ?? 0,
    limit,
    offset,
  })
}
