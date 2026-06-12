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
import { triggerSync } from '@/lib/api'
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
  setConfig: (updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => void
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
const PAGE_SIZE = 20

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

export function ImagesPage({ config, setConfig, loading, lastSavedAt }: Props) {
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
  const [refreshingNow, setRefreshingNow] = useState(false)
  const [latestRun, setLatestRun] = useState<{ id: number; status: string; conclusion: string | null; url: string } | null>(null)
  const handledCompletedRunIdRef = useRef<number | null>(null)

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

  const visibleRows = useMemo(() => {
    return searchResult.items.map((entry) => {
      const originalIndex = typeof entry.id === 'number'
        ? (imageIndexById.get(entry.id) ?? -1)
        : config.images.findIndex((img) =>
            img.source === entry.source &&
            img.target === entry.target &&
            img.profile === entry.profile
          )
      return { img: entry, i: originalIndex }
    })
  }, [searchResult.items, imageIndexById, config.images])

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
    // Optimistically show the new entry at the top of the list right away.
    // The lastSavedAt-driven refresh replaces it with the authoritative row
    // (with its server-assigned id) once the save lands.
    if (!trimmedSearchQuery) {
      setSearchResult((prev) => ({
        ...prev,
        total: prev.total + 1,
        items: [entry, ...prev.items],
      }))
    }
    toast(`Added ${form.source.trim()}`)
    cancelForm()
  }

  function deleteEntry(index: number) {
    setDeleteTarget(index)
  }

  function confirmDelete() {
    if (deleteTarget === null) return
    const entry = config.images[deleteTarget]
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

      if (shouldReload) setListNonce((n) => n + 1)
      if (manual) toast('Refreshed')
    } catch (e) {
      if (manual) {
        const message = e instanceof Error ? e.message : 'Refresh failed'
        toast(message, 'error')
      }
    } finally {
      if (manual) setRefreshingNow(false)
    }
  }, [])

  const hasSyncingImages = useMemo(
    () => searchResult.items.some((img) => getImageSyncStatus(img) === 'syncing'),
    [searchResult.items]
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
    const timer = window.setInterval(() => { void tick() }, 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [hasSyncingImages, syncingNow, latestRun, refreshSyncState])

  async function handleTriggerSync() {
    setSyncingNow(true)
    try {
      const result = await triggerSync()
      if (!result.ok || !result.count) {
        throw new Error(result.message || 'No images to sync')
      }
      setConfig((c) => ({
        ...c,
        images: c.images.map((img) => {
          const status = getImageSyncStatus(img)
          if (!img.enabled || status === 'synced' || status === 'syncing') return img
          return {
            ...img,
            status: 'syncing',
            syncError: undefined,
          }
        }),
      }))
      toast(`Sync triggered for ${result.count} image${result.count === 1 ? '' : 's'} — track progress on the Jobs page`)
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
            <Button size="sm" variant="outline" onClick={handleTriggerSync} disabled={syncingNow}>
              {syncingNow ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
              Sync
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

        {config.images.length === 0 && !formOpen && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No image entries yet. Click "Add Image" to get started.
          </p>
        )}

        {config.images.length > 0 && (
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
                      const fullTarget = buildFullTarget(config.profiles[entry.profile]?.registry ?? '', entry.target)
                      const actionsDisabled = originalIndex < 0
                      return (
                        <TableRow
                          key={typeof entry.id === 'number' ? `${entry.id}` : `${entry.source}-${entry.target}-${entry.profile}`}
                          className={!entry.enabled ? 'opacity-50' : ''}
                        >
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
