import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Search,
  RefreshCw,
  Loader2,
  CircleAlert,
  CheckCircle2,
  Clock3,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { triggerSync, deleteImage } from '@/lib/api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/components/Toaster'
import { buildFullTarget, deriveTarget, validateImageReference } from '@/lib/image'
import type { ImageEntry, MirrorConfig } from '@/lib/types'
import { searchImages } from '@/lib/cloudflare'

interface Props {
  config: MirrorConfig
  savedConfig: MirrorConfig
  setConfig: (updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => void
  reloadFromServer: () => Promise<void>
  markSaved?: (cfg: MirrorConfig) => void
  loading: boolean
  lastSavedAt: number
}

interface FormState {
  source: string
  target: string
  targetTouched: boolean
  profile: string
  notes: string
}

type SortField = 'enabled' | 'createdAt' | 'syncedAt'
type SortDir = 'asc' | 'desc'
type ImageSyncStatus = NonNullable<ImageEntry['status']>
type DraftChangeType = 'new' | 'updated'
const PAGE_SIZE = 20

function isSameImage(a: ImageEntry, b: ImageEntry): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.profile === b.profile &&
    a.enabled === b.enabled &&
    (a.notes || '') === (b.notes || '')
  )
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null
  return dir === 'asc'
    ? <ArrowUp className="inline size-3" />
    : <ArrowDown className="inline size-3" />
}

function formatTime(iso?: string) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function getImageSyncStatus(entry: ImageEntry): ImageSyncStatus {
  if (entry.status) return entry.status
  return entry.synced ? 'synced' : 'pending'
}

function SyncStatusBadge({ entry }: { entry: ImageEntry }) {
  const status = getImageSyncStatus(entry)
  const title = status === 'failed' && entry.syncError ? entry.syncError : undefined

  switch (status) {
    case 'syncing':
      return (
        <Badge variant="default" className="bg-blue-600 text-white dark:bg-blue-500">
          <Loader2 className="animate-spin" />
          syncing
        </Badge>
      )
    case 'synced':
      return (
        <Badge variant="success">
          <CheckCircle2 />
          synced
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="destructive" title={title}>
          <CircleAlert />
          failed
        </Badge>
      )
    default:
      return (
        <Badge variant="pending" className="font-semibold">
          <Clock3 />
          pending
        </Badge>
      )
  }
}

export function ImagesPage({ config, savedConfig, setConfig, reloadFromServer, loading, lastSavedAt }: Props) {
  const profileNames = useMemo(() => {
    const set = new Set<string>()
    for (const name of Object.keys(config.profiles)) {
      const trimmed = name.trim()
      if (trimmed) set.add(trimmed)
    }
    for (const img of config.images) {
      const trimmed = (img.profile || '').trim()
      if (trimmed) set.add(trimmed)
    }
    if (set.size === 0) set.add('default')
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [config.profiles, config.images])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>({
    source: '', target: '', targetTouched: false,
    profile: profileNames[0] ?? 'default', notes: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [listNonce, setListNonce] = useState(0)

  // Refresh the list once a config save has landed on the server,
  // so newly added images show up immediately (and in server order).
  useEffect(() => {
    if (!lastSavedAt) return
    const timer = window.setTimeout(() => setListNonce((n) => n + 1), 0)
    return () => window.clearTimeout(timer)
  }, [lastSavedAt])
  const [searchResult, setSearchResult] = useState<{
    total: number
    items: ImageEntry[]
    loading: boolean
    error: string | null
  }>({ total: 0, items: [], loading: true, error: null })
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [syncingNow, setSyncingNow] = useState(false)
  const [selectedImageIds, setSelectedImageIds] = useState<Set<number>>(new Set())
  const [selectedDraftKeys, setSelectedDraftKeys] = useState<Set<string>>(new Set())
  const [refreshingNow, setRefreshingNow] = useState(false)
  const [latestRun, setLatestRun] = useState<{ id: number; status: string; conclusion: string | null; url: string } | null>(null)
  const handledCompletedRunIdRef = useRef<number | null>(null)
  const configRef = useRef(config)
  useEffect(() => { configRef.current = config }, [config])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && formOpen) {
        cancelForm()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !formOpen) {
        e.preventDefault()
        startCreate()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen])

  const trimmedSearchQuery = searchQuery.trim()

  useEffect(() => {
    if (loading) return
    const controller = new AbortController()
    searchImages({
      q: trimmedSearchQuery,
      page,
      pageSize: PAGE_SIZE,
      sortField: sortField ?? undefined,
      sortDir,
    })
      .then((res) => {
        if (controller.signal.aborted) return
        setSearchResult({
          total: res.total,
          items: res.items,
          loading: false,
          error: null,
        })
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setSearchResult((prev) => ({
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }))
      })

    return () => controller.abort()
  }, [trimmedSearchQuery, page, sortField, sortDir, listNonce, loading])

  const totalPages = Math.max(1, Math.ceil(searchResult.total / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const imageIndexById = useMemo(() => {
    const idx = new Map<number, number>()
    for (let i = 0; i < config.images.length; i++) {
      const id = config.images[i].id
      if (typeof id === 'number') idx.set(id, i)
    }
    return idx
  }, [config.images])

  const localImageById = useMemo(() => {
    const map = new Map<number, ImageEntry>()
    for (const img of config.images) {
      if (typeof img.id === 'number') map.set(img.id, img)
    }
    return map
  }, [config.images])

  const savedImageById = useMemo(() => {
    const map = new Map<number, ImageEntry>()
    for (const img of savedConfig.images) {
      if (typeof img.id === 'number') map.set(img.id, img)
    }
    return map
  }, [savedConfig.images])

  const deletedSavedImageIds = useMemo(() => {
    const deleted = new Set<number>()
    for (const saved of savedConfig.images) {
      if (typeof saved.id !== 'number') continue
      if (!localImageById.has(saved.id)) deleted.add(saved.id)
    }
    return deleted
  }, [savedConfig.images, localImageById])

  const draftRows = useMemo(() => {
    const rows: Array<{ type: DraftChangeType; image: ImageEntry }> = []
    for (const img of config.images) {
      if (typeof img.id !== 'number') {
        rows.push({ type: 'new', image: img })
        continue
      }
      const saved = savedImageById.get(img.id)
      if (!saved) {
        rows.push({ type: 'new', image: img })
        continue
      }
      if (!isSameImage(img, saved)) {
        rows.push({ type: 'updated', image: img })
      }
    }
    return rows
  }, [config.images, savedImageById])

  const savedItemsMerged = useMemo(() => {
    return searchResult.items
      .filter((item) => !(typeof item.id === 'number' && deletedSavedImageIds.has(item.id)))
      .map((item) => {
        if (typeof item.id !== 'number') return item
        const local = localImageById.get(item.id)
        return local ?? item
      })
  }, [searchResult.items, deletedSavedImageIds, localImageById])

  const visibleRows = useMemo(() => {
    return savedItemsMerged.map((entry) => {
      const originalIndex = typeof entry.id === 'number'
        ? (imageIndexById.get(entry.id) ?? -1)
        : config.images.findIndex((img) =>
            img.source === entry.source &&
            img.target === entry.target &&
            img.profile === entry.profile
          )
      return { img: entry, i: originalIndex }
    })
  }, [savedItemsMerged, imageIndexById, config.images])

  function toggleSort(field: SortField) {
    setPage(1)
    setSearchResult((prev) => ({ ...prev, loading: true, error: null }))
    if (sortField === field) {
      if (sortDir === 'desc') {
        setSortDir('asc')
      } else {
        // Third click: back to the default priority ordering
        // (pending+enabled first, then syncing, then the rest)
        setSortField(null)
        setSortDir('desc')
      }
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  async function copyTarget(fullTarget: string, index: number) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullTarget)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = fullTarget
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!ok) {
          throw new Error('copy failed')
        }
      }
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 1500)
      toast('Target copied')
    } catch {
      toast('Copy failed. Please copy manually.', 'error')
    }
  }

  function startCreate() {
    setFormOpen(true)
    setForm({ source: '', target: '', targetTouched: false, profile: profileNames[0] ?? 'default', notes: '' })
    setFormError(null)
  }

  function cancelForm() {
    setFormOpen(false)
    setFormError(null)
  }

  function handleSave() {
    const srcErr = validateImageReference(form.source)
    if (srcErr) { setFormError(`Source: ${srcErr}`); return }
    const finalTarget = form.targetTouched && form.target.trim() ? form.target.trim() : deriveTarget(form.source)
    const tgtErr = validateImageReference(finalTarget)
    if (tgtErr) { setFormError(`Target: ${tgtErr}`); return }

    const now = new Date().toISOString()
    const selectedProfile = profileNames.includes(form.profile) ? form.profile : (profileNames[0] ?? 'default')
    const entry: ImageEntry = {
      source: form.source.trim(),
      target: finalTarget,
      profile: selectedProfile,
      enabled: true,
      status: 'pending',
      createdAt: now,
      notes: form.notes.trim() || undefined,
    }
    setConfig((c) => ({ ...c, images: [...c.images, entry] }))
    // Back to the default priority ordering so the new pending image is on top
    setSortField(null)
    setSortDir('desc')
    setPage(1)
    toast(`Added ${form.source.trim()}`)
    cancelForm()
  }

  function deleteEntry(index: number) {
    setDeleteTarget(index)
  }

  async function confirmDelete() {
    if (deleteTarget === null) return
    const entry = config.images[deleteTarget]

    if (typeof entry.id === 'number') {
      // Saved image — call API to delete from DB directly
      try {
        await deleteImage(entry.id)
      } catch (err) {
        toast(`Failed to delete: ${err instanceof Error ? err.message : 'unknown error'}`)
        setDeleteTarget(null)
        return
      }
    }

    // Remove from local config
    setConfig((c) => ({ ...c, images: c.images.filter((_, i) => i !== deleteTarget) }))
    setListNonce((n) => n + 1)
    toast(`Removed ${entry.source}`)
    setDeleteTarget(null)
  }

  function toggleEnabled(index: number) {
    setConfig((c) => ({
      ...c,
      images: c.images.map((img, i) => (i === index ? { ...img, enabled: !img.enabled } : img)),
    }))
    setListNonce((n) => n + 1)
  }

  const refreshSyncState = useCallback(async (opts?: { manual?: boolean; forceReload?: boolean; showCompleteToast?: boolean }) => {
    const manual = opts?.manual === true
    const forceReload = opts?.forceReload === true
    const showCompleteToast = opts?.showCompleteToast !== false
    if (manual) setRefreshingNow(true)
    try {
      const res = await fetch('/api/sync/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json() as {
        runs: Array<{ id: number; status: string; conclusion: string | null; url: string }>
      }
      const run = data.runs[0]
      let shouldReload = forceReload
      if (run) {
        setLatestRun(run)
        if (run.status === 'completed' && handledCompletedRunIdRef.current !== run.id) {
          handledCompletedRunIdRef.current = run.id
          shouldReload = true
          if (showCompleteToast) {
            if (run.conclusion === 'success') toast('Sync completed successfully!', 'success')
            else toast(`Sync finished with status: ${run.conclusion}`, 'error')
          }
        }
      }

      if (shouldReload) {
        setListNonce((n) => n + 1)
        const localDrafts = configRef.current.images.filter((img) => typeof img.id !== 'number')
        void reloadFromServer().then(() => {
          if (localDrafts.length > 0) {
            setConfig((c) => {
              const serverKeys = new Set(c.images.map((img) => `${img.source}\0${img.target}`))
              const toRestore = localDrafts.filter((d) => !serverKeys.has(`${d.source}\0${d.target}`))
              if (!toRestore.length) return c
              return { ...c, images: [...c.images, ...toRestore] }
            })
          }
        })
      }
      if (manual) toast('Refreshed')
    } catch (e) {
      if (manual) {
        const message = e instanceof Error ? e.message : 'Refresh failed'
        toast(message, 'error')
      }
    } finally {
      if (manual) setRefreshingNow(false)
    }
  }, [reloadFromServer, setConfig])

  const hasSyncingImages = useMemo(
    () => savedItemsMerged.some((img) => getImageSyncStatus(img) === 'syncing') || draftRows.some((d) => getImageSyncStatus(d.image) === 'syncing'),
    [savedItemsMerged, draftRows]
  )

  useEffect(() => {
    const shouldPoll =
      syncingNow ||
      hasSyncingImages ||
      (latestRun !== null && latestRun.status !== 'completed')
    if (!shouldPoll) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      await refreshSyncState({ showCompleteToast: true })
    }
    void tick()
    const scheduleNext = () => {
      const delay = 3000 + Math.random() * 2000
      return window.setTimeout(() => {
        void tick().then(() => { if (!stopped) timerId = scheduleNext() })
      }, delay)
    }
    let timerId = scheduleNext()
    return () => {
      stopped = true
      window.clearTimeout(timerId)
    }
  }, [hasSyncingImages, syncingNow, latestRun, refreshSyncState])

  async function handleTriggerSync() {
    setSyncingNow(true)
    try {
      // Collect selected saved image IDs
      const idsToSync = selectedImageIds.size > 0 ? [...selectedImageIds] : undefined

      // Collect selected draft images to materialize
      const selectedDrafts = draftRows
        .filter((row) => row.type === 'new' && selectedDraftKeys.has(`${row.image.source}\0${row.image.target}`))
        .map((row) => row.image)

      // Build a partial config containing only selected draft images for materialization
      let draftConfig: MirrorConfig | undefined
      if (selectedDrafts.length > 0) {
        draftConfig = {
          version: 'v2',
          profiles: config.profiles,
          images: selectedDrafts,
        }
      }

      const result = await triggerSync(draftConfig, idsToSync)
      if (!result.ok || !result.count) {
        throw new Error(result.message || 'No images to sync')
      }

      // Remove synced drafts from local config and update status
      const syncedDraftKeys = new Set(selectedDrafts.map((d) => `${d.source}\0${d.target}`))
      // Preserve remaining (unsynced) draft images before reload overwrites local state
      const remainingDrafts = config.images.filter(
        (img) => typeof img.id !== 'number' && !syncedDraftKeys.has(`${img.source}\0${img.target}`)
      )
      setConfig((c) => ({
        ...c,
        images: c.images
          .filter((img) => !(typeof img.id !== 'number' && syncedDraftKeys.has(`${img.source}\0${img.target}`)))
          .map((img) => {
            const status = getImageSyncStatus(img)
            if (status === 'synced' || status === 'syncing') return img
            if (idsToSync && typeof img.id === 'number' && !idsToSync.includes(img.id)) return img
            return { ...img, status: 'syncing', syncError: undefined }
          }),
      }))
      setSelectedImageIds(new Set())
      setSelectedDraftKeys(new Set())
      toast(`Sync triggered for ${result.count} image${result.count === 1 ? '' : 's'} — track progress on the Jobs page`)
      await reloadFromServer()
      // Merge back remaining draft images that only exist locally
      if (remainingDrafts.length > 0) {
        setConfig((c) => {
          const serverKeys = new Set(c.images.map((img) => `${img.source}\0${img.target}`))
          const toRestore = remainingDrafts.filter((d) => !serverKeys.has(`${d.source}\0${d.target}`))
          if (!toRestore.length) return c
          return { ...c, images: [...c.images, ...toRestore] }
        })
      }
      void refreshSyncState({ showCompleteToast: false })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to trigger sync'
      toast(message, 'error')
    } finally {
      setSyncingNow(false)
    }
  }

  const effectiveTarget = form.targetTouched && form.target.trim()
    ? form.target
    : form.source.trim() ? deriveTarget(form.source) : ''
  const selectedProfile = profileNames.includes(form.profile) ? form.profile : (profileNames[0] ?? 'default')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Mirror Entries</CardTitle>
            <CardDescription>
              Manage source → target image mirror mappings.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {latestRun && (
              <a
                href={latestRun.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-muted/50"
              >
                {latestRun.status === 'completed' ? (
                  latestRun.conclusion === 'success' ? (
                    <CheckCircle2 className="size-3 text-green-600" />
                  ) : (
                    <CircleAlert className="size-3 text-red-600" />
                  )
                ) : (
                  <Loader2 className="size-3 animate-spin" />
                )}
                <span>{latestRun.status === 'completed' ? latestRun.conclusion : latestRun.status}</span>
              </a>
            )}
            <Button size="sm" variant="outline" onClick={handleTriggerSync} disabled={syncingNow || (selectedImageIds.size === 0 && selectedDraftKeys.size === 0)}>
              {syncingNow ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
              Sync{(selectedImageIds.size + selectedDraftKeys.size) > 0 ? ` (${selectedImageIds.size + selectedDraftKeys.size})` : ''}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void refreshSyncState({ manual: true, forceReload: true, showCompleteToast: false }) }}
              disabled={refreshingNow}
            >
              {refreshingNow ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
            <Button size="sm" onClick={startCreate} disabled={formOpen}>
              <Plus /> Add Image
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {formOpen && (
          <div className="rounded-lg border border-dashed p-4 space-y-3">
            <p className="text-sm font-medium">New Mirror</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Source image</Label>
                <Input
                  autoFocus
                  placeholder="nginx:1.27"
                  value={form.source}
                  onChange={(e) => { setForm((f) => ({ ...f, source: e.target.value })); setFormError(null) }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Target path</Label>
                <Input
                  placeholder={form.source ? deriveTarget(form.source) : 'auto-derived'}
                  value={form.targetTouched ? form.target : effectiveTarget}
                  onChange={(e) => setForm((f) => ({ ...f, target: e.target.value, targetTouched: true }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Profile</Label>
                <Select value={selectedProfile} onValueChange={(v) => setForm((f) => ({ ...f, profile: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {profileNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Notes</Label>
                <Input
                  placeholder="optional note"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            {formError && <p className="text-destructive text-sm">{formError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>Add</Button>
              <Button size="sm" variant="outline" onClick={cancelForm}>Cancel</Button>
            </div>
          </div>
        )}

        {config.images.length === 0 && !formOpen && draftRows.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No image entries yet. Click "Add Image" to get started.
          </p>
        )}

        {(config.images.length > 0 || searchResult.total > 0 || draftRows.length > 0) && (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  placeholder="Filter by source, target, profile, notes..."
                  value={searchQuery}
                  onChange={(e) => {
                    const next = e.target.value
                    setSearchQuery(next)
                    setPage(1)
                    setSearchResult((prev) => ({ ...prev, loading: true, error: null }))
                  }}
                  className="pl-9"
                />
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {searchResult.total}
              </span>
            </div>

            {draftRows.length > 0 && (
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-sm font-medium">Draft Changes</p>
                  <Badge variant="pending">{draftRows.length}</Badge>
                </div>
                <div className="overflow-x-auto">
                  <Table className="table-fixed w-full min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[36px]">
                          <input
                            type="checkbox"
                            className="size-3.5 rounded accent-primary"
                            checked={draftRows.filter((r) => r.type === 'new').length > 0 && draftRows.filter((r) => r.type === 'new').every((r) => selectedDraftKeys.has(`${r.image.source}\0${r.image.target}`))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDraftKeys(new Set(draftRows.filter((r) => r.type === 'new').map((r) => `${r.image.source}\0${r.image.target}`)))
                              } else {
                                setSelectedDraftKeys(new Set())
                              }
                            }}
                          />
                        </TableHead>
                        <TableHead className="w-[80px]">Type</TableHead>
                        <TableHead className="w-[34%]">Source</TableHead>
                        <TableHead className="w-[34%]">Target</TableHead>
                        <TableHead className="w-[96px]">Profile</TableHead>
                        <TableHead className="w-[96px]">Status</TableHead>
                        <TableHead className="w-[48px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draftRows.map((row, idx) => {
                        const draftKey = `${row.image.source}\0${row.image.target}`
                        return (
                        <TableRow key={`${row.type}-${row.image.id ?? 'draft'}-${row.image.source}-${idx}`}>
                          <TableCell className="py-2 pr-1">
                            {row.type === 'new' && (
                              <input
                                type="checkbox"
                                className="size-3.5 rounded accent-primary"
                                checked={selectedDraftKeys.has(draftKey)}
                                onChange={(e) => {
                                  setSelectedDraftKeys((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(draftKey)
                                    else next.delete(draftKey)
                                    return next
                                  })
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge variant={row.type === 'new' ? 'success' : 'outline'}>
                              {row.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate font-mono text-xs" title={row.image.source}>{row.image.source}</span>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate font-mono text-xs text-muted-foreground" title={row.image.target}>
                              {buildFullTarget(config.profiles[row.image.profile]?.registry ?? '', row.image.target, config.profiles[row.image.profile]?.namespace)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate text-xs text-muted-foreground" title={row.image.profile}>{row.image.profile}</span>
                          </TableCell>
                          <TableCell className="py-2">
                            <SyncStatusBadge entry={row.image} />
                          </TableCell>
                          <TableCell className="py-2">
                            <button
                              type="button"
                              className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-destructive"
                              title="Remove"
                              onClick={() => {
                                const idx2 = config.images.findIndex((img) =>
                                  img.source === row.image.source && img.target === row.image.target
                                )
                                if (idx2 >= 0) {
                                  setConfig((c) => ({ ...c, images: c.images.filter((_, i) => i !== idx2) }))
                                  setSelectedDraftKeys((prev) => {
                                    const next = new Set(prev)
                                    next.delete(draftKey)
                                    return next
                                  })
                                  setListNonce((n) => n + 1)
                                }
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {searchResult.loading ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Searching...
              </p>
            ) : searchResult.total === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {trimmedSearchQuery ? `No entries match "${searchQuery}".` : 'No image entries yet.'}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto -mx-6 px-6">
                  <Table className="table-fixed w-full min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[36px]">
                        <input
                          type="checkbox"
                          className="size-3.5 rounded accent-primary"
                          checked={visibleRows.length > 0 && visibleRows.every(({ img }) => typeof img.id === 'number' && selectedImageIds.has(img.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedImageIds(new Set(visibleRows.map(({ img }) => img.id).filter((id): id is number => typeof id === 'number')))
                            } else {
                              setSelectedImageIds(new Set())
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead
                        className="w-[96px] cursor-pointer select-none"
                        onClick={() => toggleSort('enabled')}
                      >
                        Status <SortIndicator active={sortField === 'enabled'} dir={sortDir} />
                      </TableHead>
                      <TableHead className="w-[32%]">Source</TableHead>
                      <TableHead className="w-[32%]">Target</TableHead>
                      <TableHead className="w-[72px]">Profile</TableHead>
                      <TableHead
                        className="w-[96px] cursor-pointer select-none"
                        onClick={() => toggleSort('syncedAt')}
                      >
                        Synced <SortIndicator active={sortField === 'syncedAt'} dir={sortDir} />
                      </TableHead>
                      <TableHead className="w-[112px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map(({ img: entry, i: originalIndex }) => {
                      const fullTarget = buildFullTarget(config.profiles[entry.profile]?.registry ?? '', entry.target, config.profiles[entry.profile]?.namespace)
                      const actionsDisabled = originalIndex < 0
                      return (
                        <TableRow
                          key={typeof entry.id === 'number' ? `${entry.id}` : `${entry.source}-${entry.target}-${entry.profile}`}
                          className={!entry.enabled ? 'opacity-50' : ''}
                        >
                          <TableCell className="py-2 pr-1">
                            {typeof entry.id === 'number' && (
                              <input
                                type="checkbox"
                                className="size-3.5 rounded accent-primary"
                                checked={selectedImageIds.has(entry.id)}
                                onChange={(e) => {
                                  setSelectedImageIds((prev) => {
                                    const next = new Set(prev)
                                    if (e.target.checked) next.add(entry.id!)
                                    else next.delete(entry.id!)
                                    return next
                                  })
                                }}
                              />
                            )}
                          </TableCell>
                          <TableCell className="py-2 pr-3">
                            <div className="flex flex-nowrap items-center">
                              <SyncStatusBadge entry={entry} />
                            </div>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate font-mono text-xs" title={entry.source}>
                              {entry.source}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate font-mono text-xs text-muted-foreground" title={fullTarget}>
                              {fullTarget}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 overflow-hidden">
                            <span className="block truncate text-xs text-muted-foreground" title={entry.profile}>
                              {entry.profile}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-muted-foreground text-xs whitespace-nowrap">
                            <span className="inline-block pr-2">{formatTime(entry.syncedAt) ?? '—'}</span>
                          </TableCell>
                          <TableCell className="py-2 text-right">
                            <div className="flex justify-end gap-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label="Copy target address"
                                onClick={() => {
                                  if (actionsDisabled) return
                                  copyTarget(fullTarget, originalIndex)
                                }}
                                disabled={actionsDisabled}
                                title={actionsDisabled ? 'Loading latest item mapping...' : 'Copy target address'}
                              >
                                {copiedIndex === originalIndex
                                  ? <Check className="size-3.5 text-green-600" />
                                  : <Copy className="size-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => {
                                  if (actionsDisabled) return
                                  toggleEnabled(originalIndex)
                                }}
                                disabled={actionsDisabled}
                                title={actionsDisabled ? 'Loading latest item mapping...' : 'Enable/disable'}
                              >
                                {entry.enabled
                                  ? <ToggleRight className="size-3.5 text-primary" />
                                  : <ToggleLeft className="size-3.5 text-muted-foreground" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => {
                                  if (actionsDisabled) return
                                  deleteEntry(originalIndex)
                                }}
                                disabled={actionsDisabled}
                                title={actionsDisabled ? 'Loading latest item mapping...' : 'Delete'}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-muted-foreground text-xs">
                    Page {currentPage}/{totalPages}
                  </span>
                  {searchResult.loading ? (
                    <span className="text-muted-foreground text-xs">Searching...</span>
                  ) : searchResult.error ? (
                    <span className="text-destructive text-xs">{searchResult.error}</span>
                  ) : null}
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPage((p) => Math.max(1, Math.min(totalPages, p) - 1))
                        setSearchResult((prev) => ({ ...prev, loading: true, error: null }))
                      }}
                      disabled={currentPage <= 1}
                    >
                      Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPage((p) => Math.min(totalPages, Math.min(totalPages, p) + 1))
                        setSearchResult((prev) => ({ ...prev, loading: true, error: null }))
                      }}
                      disabled={currentPage >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete mirror entry"
        description={deleteTarget !== null ? `Remove "${config.images[deleteTarget]?.source}" from configuration?` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  )
}
