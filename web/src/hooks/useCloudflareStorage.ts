import { useCallback, useEffect, useState } from 'react'
import { loadConfig, saveConfig } from '@/lib/cloudflare'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
    } catch { /* ignore */ }
  }, [config])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fetched = await loadConfig()
      setConfigState(fetched)
      toast('Pulled latest config from Cloudflare')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      await saveConfig(config)
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
    setConfigState((prev) => typeof updater === 'function' ? updater(prev) : updater)
  }, [])

  return { config, setConfig, loading, syncing, error, load, save }
}
