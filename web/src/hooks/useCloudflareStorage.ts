import { useCallback, useEffect, useRef, useState } from 'react'
import { saveConfig } from '@/lib/cloudflare'
import { emptyConfig } from '@/lib/types'
import type { MirrorConfig } from '@/lib/types'
import { toast } from '@/components/Toaster'

const CONFIG_KEY = 'mirrorpilot.config.v1'

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
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number>(0)
  const mountedRef = useRef(true)
  const pendingSaveRef = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    } catch { /* ignore */ }
  }, [config])

  // Auto-save to backend when config changes (debounced via pending flag)
  useEffect(() => {
    if (!pendingSaveRef.current) return
    pendingSaveRef.current = false
    const controller = new AbortController()
    setSyncing(true)
    saveConfig(config)
      .then(() => {
        if (mountedRef.current) {
          setLastSavedAt(Date.now())
          toast('Config saved')
        }
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        toast(msg, 'error')
      })
      .finally(() => {
        if (mountedRef.current) setSyncing(false)
      })
    return () => controller.abort()
  }, [config])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    return
  }, [])

  const save = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await saveConfig(config)
      setLastSavedAt(Date.now())
      toast('Pushed config to Cloudflare')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast(msg, 'error')
    } finally {
      setSyncing(false)
    }
  }, [config])

  const setConfig = useCallback((updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => {
    pendingSaveRef.current = true
    setConfigState((prev) => typeof updater === 'function' ? updater(prev) : updater)
  }, [])

  return { config, setConfig, loading, syncing, error, load, save, lastSavedAt }
}
