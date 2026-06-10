import type { Env } from '@functions/_env'

interface PendingImageRow {
  id: number
  source: string
  target: string
  profile: string
  registry: string | null
  username_env: string | null
  password_env: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${env.SYNC_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id')
  if (!userId) {
    return Response.json({ error: 'Missing user_id' }, { status: 400 })
  }

  const images = await env.DB.prepare(`
    SELECT i.id, i.source, i.target, i.profile,
           p.registry, p.username_env, p.password_env
    FROM images i
    LEFT JOIN profiles p ON p.user_id = i.user_id AND p.name = i.profile
    WHERE i.user_id = ? AND i.status = 'syncing'
  `).bind(Number(userId)).all<PendingImageRow>()

  return Response.json({ images: images.results })
}
