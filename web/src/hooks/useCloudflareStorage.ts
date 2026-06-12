import { useCallback, useEffect, useRef, useState } from 'react'
import { loadConfig, saveConfig } from '@/lib/cloudflare'
import { emptyConfig } from '@/lib/types'
import type { MirrorConfig } from '@/lib/types'

const CONFIG_KEY = 'mirrorpilot.config.v2'
const SAVE_DEBOUNCE_MS = 1500

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
  const [syncing, setSyncing] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number>(0)
  const mountedRef = useRef(true)
  const editsRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingConfigRef = useRef<MirrorConfig | null>(null)

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
    return () => {
      mountedRef.current = false
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const persistToServer = useCallback(async (cfg: MirrorConfig) => {
    setSyncing(true)
    setError(null)
    try {
      await saveConfig(cfg)
      if (mountedRef.current) {
        setSavedConfig(cfg)
        setLastSavedAt(Date.now())
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    } finally {
      if (mountedRef.current) setSyncing(false)
    }
  }, [])

  const load = useCallback(async () => {
    await refreshFromServer()
  }, [refreshFromServer])

  const setConfig = useCallback((updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => {
    editsRef.current += 1
    setError(null)
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      pendingConfigRef.current = next
      // Debounce server save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (pendingConfigRef.current) {
          void persistToServer(pendingConfigRef.current)
          pendingConfigRef.current = null
        }
      }, SAVE_DEBOUNCE_MS)
      return next
    })
  }, [persistToServer])

  return { config, savedConfig, setConfig, loading, syncing, error, load, lastSavedAt }
}
