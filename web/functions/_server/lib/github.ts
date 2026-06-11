import type { Env } from '../env'

export function githubHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'MirrorPilot',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}
