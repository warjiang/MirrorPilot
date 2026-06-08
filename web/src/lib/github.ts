import type { GitHubSettings } from './types'

interface FileResponse {
  content: string
  sha: string
}

export async function fetchFile(settings: GitHubSettings): Promise<FileResponse> {
  const { pat, owner, repo, branch, configPath } = settings
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${configPath}?ref=${branch}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  if (res.status === 404) {
    return { content: '', sha: '' }
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${body}`)
  }
  const json = (await res.json()) as { content: string; sha: string }
  const content = atob(json.content.replace(/\n/g, ''))
  return { content, sha: json.sha }
}

export async function saveFile(
  settings: GitHubSettings,
  content: string,
  sha: string,
  message?: string
): Promise<string> {
  const { pat, owner, repo, branch, configPath } = settings
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${configPath}`
  const body: Record<string, string> = {
    message: message ?? `chore: update ${configPath} via MirrorPilot Web`,
    content: btoa(content),
    branch,
  }
  if (sha) body.sha = sha

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }
  const json = (await res.json()) as { content: { sha: string } }
  return json.content.sha
}

export async function testConnection(settings: GitHubSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const { pat, owner, repo } = settings
    const url = `https://api.github.com/repos/${owner}/${repo}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: cannot access repository` }
    }
    return { ok: true, message: 'Connected successfully' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
