import type { Env } from '../../_env'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // Get the latest web-sync workflow run
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/runs?event=repository_dispatch&per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MirrorPilot',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  )

  if (!res.ok) {
    return Response.json({ error: 'Failed to fetch workflow runs' }, { status: 502 })
  }

  const data = await res.json() as {
    workflow_runs: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      html_url: string
      created_at: string
      updated_at: string
    }>
  }

  // Filter to only web-sync runs
  const runs = data.workflow_runs
    .filter((r) => r.name === 'Web Sync')
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))

  return Response.json({ runs })
}
