import type { Env } from '@functions/_env'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/api/auth/callback`
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
  })

  return Response.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`, 302)
}
