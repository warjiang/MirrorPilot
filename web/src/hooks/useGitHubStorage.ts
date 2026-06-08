import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFile, saveFile } from '@/lib/github'
import { parseYaml, serializeYaml } from '@/lib/yaml'
import type { GitHubSettings, MirrorConfig } from '@/lib/types'
import { emptyConfig } from '@/lib/types'

const SETTINGS_KEY = 'mirrorpilot.github.settings'
const CONFIG_KEY = 'mirrorpilot.config.v1'

export function useGitHubSettings() {
  const [settings, setSettings] = useState<GitHubSettings | null>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      return raw ? (JSON.parse(raw) as GitHubSettings) : null
    } catch {
      return null
    }
  })

  const save = useCallback((s: GitHubSettings | null) => {
    setSettings(s)
    if (s) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    } else {
      localStorage.removeItem(SETTINGS_KEY)
    }
  }, [])

  return [settings, save] as const
}

export function useGitHubStorage(settings: GitHubSettings | null) {
  const [config, setConfigState] = useState<MirrorConfig>(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY)
      return raw ? (JSON.parse(raw) as MirrorConfig) : emptyConfig()
    } catch {
      return emptyConfig()
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const shaRef = useRef('')

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    } catch { /* ignore */ }
  }, [config])

  const load = useCallback(async () => {
    if (!settings) return
    setLoading(true)
    setError(null)
    try {
      const { content, sha } = await fetchFile(settings)
      shaRef.current = sha
      if (content) {
        const parsed = parseYaml(content)
        setConfigState(parsed)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [settings])

  const save = useCallback(async () => {
    if (!settings) return
    setSyncing(true)
    setError(null)
    try {
      const yamlContent = serializeYaml(config)
      const newSha = await saveFile(settings, yamlContent, shaRef.current)
      shaRef.current = newSha
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }, [settings, config])

  const setConfig = useCallback((updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => {
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return next
    })
  }, [])

  return { config, setConfig, loading, syncing, error, load, save }
}
