import { useCallback, useEffect, useRef, useState } from 'react'
import { loadConfig } from '@/lib/cloudflare'
import { emptyConfig } from '@/lib/types'
import type { MirrorConfig } from '@/lib/types'

const CONFIG_KEY = 'mirrorpilot.config.v2'

export function useCloudflareStorage() {
  const [config, setConfigState] = useState<MirrorConfig>(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY)
      return raw ? (JSON.parse(raw) as MirrorConfig) : emptyConfig()
    } catch {
      return emptyConfig()
    }
  })
  const loading = false
  const [savedConfig, setSavedConfig] = useState<MirrorConfig>(() => emptyConfig())
  const [error, setError] = useState<string | null>(null)
  const syncing = false
  const [lastSavedAt, setLastSavedAt] = useState<number>(0)
  const mountedRef = useRef(true)
  const editsRef = useRef(0)

  // Reload config from the server (source of truth, includes server-assigned ids).
  // Skipped if the user edited the config while the request was in flight.
  const refreshFromServer = useCallback(async () => {
    const editsBefore = editsRef.current
    try {
      const fresh = await loadConfig()
      if (mountedRef.current && editsRef.current === editsBefore) {
        setConfigState(fresh)
        setSavedConfig(fresh)
        setLastSavedAt(Date.now())
      }
    } catch {
      // keep local copy when the server is unreachable
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshFromServer(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshFromServer])

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    } catch { /* ignore */ }
  }, [config])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    await refreshFromServer()
  }, [refreshFromServer])

  const setConfig = useCallback((updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => {
    editsRef.current += 1
    setError(null)
    setConfigState((prev) => typeof updater === 'function' ? updater(prev) : updater)
  }, [])

  return { config, savedConfig, setConfig, loading, syncing, error, load, lastSavedAt }
}
