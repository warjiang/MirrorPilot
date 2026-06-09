import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
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
  Circle,
  CircleAlert,
  CheckCircle2,
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

interface Props {
  config: MirrorConfig
  setConfig: (updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => void
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
        <Badge variant="secondary">
          <Circle />
          pending
        </Badge>
      )
  }
}

export function MirrorsPage({ config, setConfig }: Props) {
  const profileNames = useMemo(() => Object.keys(config.profiles), [config.profiles])
  const [formOpen, setFormOpen] = useState(false)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>({
    source: '', target: '', targetTouched: false,
    profile: profileNames[0] ?? 'default', notes: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [syncingNow, setSyncingNow] = useState(false)

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

  const filteredAndSortedImages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    const indexed = config.images.map((img, i) => ({ img, i }))

    const filtered = q
      ? indexed.filter(({ img }) => {
          const registry = config.profiles[img.profile]?.registry ?? ''
          const fullTarget = buildFullTarget(registry, img.target)
          return (
            img.source.toLowerCase().includes(q) ||
            fullTarget.toLowerCase().includes(q) ||
            img.target.toLowerCase().includes(q) ||
            img.profile.toLowerCase().includes(q) ||
            (img.notes?.toLowerCase().includes(q) ?? false)
          )
        })
      : indexed

    if (!sortField) return filtered
    filtered.sort((a, b) => {
      let cmp: number
      if (sortField === 'enabled') {
        cmp = (a.img.enabled ? 1 : 0) - (b.img.enabled ? 1 : 0)
      } else {
        const aVal = a.img[sortField] ?? ''
        const bVal = b.img[sortField] ?? ''
        cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return filtered
  }, [config.images, config.profiles, searchQuery, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function copyTarget(fullTarget: string, index: number) {
    navigator.clipboard.writeText(fullTarget).then(() => {
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 1500)
    })
  }

  function startCreate() {
    setFormOpen(true)
    setEditIndex(null)
    setForm({ source: '', target: '', targetTouched: false, profile: profileNames[0] ?? 'default', notes: '' })
    setFormError(null)
  }

  function startEdit(index: number) {
    const entry = config.images[index]
    setFormOpen(true)
    setEditIndex(index)
    setForm({ source: entry.source, target: entry.target, targetTouched: true, profile: entry.profile, notes: entry.notes ?? '' })
    setFormError(null)
  }

  function cancelForm() {
    setFormOpen(false)
    setEditIndex(null)
    setFormError(null)
  }

  function handleSave() {
    const srcErr = validateImageReference(form.source)
    if (srcErr) { setFormError(`Source: ${srcErr}`); return }
    const finalTarget = form.targetTouched && form.target.trim() ? form.target.trim() : deriveTarget(form.source)
    const tgtErr = validateImageReference(finalTarget)
    if (tgtErr) { setFormError(`Target: ${tgtErr}`); return }

    const now = new Date().toISOString()
    if (editIndex !== null) {
      const original = config.images[editIndex]
      const syncChanged =
        original.source !== form.source.trim() ||
        original.target !== finalTarget ||
        original.profile !== form.profile

      setConfig((c) => ({
        ...c,
        images: c.images.map((img, i) =>
          i === editIndex
            ? {
                ...img,
                source: form.source.trim(),
                target: finalTarget,
                profile: form.profile,
                notes: form.notes.trim() || undefined,
                ...(syncChanged
                  ? { synced: undefined, status: 'pending' as const, syncedAt: undefined, syncError: undefined }
                  : {}),
              }
            : img
        ),
      }))
      toast('Mirror entry updated')
    } else {
      const entry: ImageEntry = {
        source: form.source.trim(),
        target: finalTarget,
        profile: form.profile,
        enabled: true,
        status: 'pending',
        createdAt: now,
        notes: form.notes.trim() || undefined,
      }
      setConfig((c) => ({ ...c, images: [...c.images, entry] }))
      toast(`Added ${form.source.trim()}`)
    }
    cancelForm()
  }

  function deleteEntry(index: number) {
    setDeleteTarget(index)
  }

  function confirmDelete() {
    if (deleteTarget === null) return
    const entry = config.images[deleteTarget]
    setConfig((c) => ({ ...c, images: c.images.filter((_, i) => i !== deleteTarget) }))
    toast(`Removed ${entry.source}`)
    setDeleteTarget(null)
  }

  function toggleEnabled(index: number) {
    setConfig((c) => ({
      ...c,
      images: c.images.map((img, i) => (i === index ? { ...img, enabled: !img.enabled } : img)),
    }))
  }

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
      toast(`Sync triggered for ${result.count} image${result.count === 1 ? '' : 's'}`)
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
            <Button size="sm" variant="outline" onClick={handleTriggerSync} disabled={syncingNow}>
              {syncingNow ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
              Sync
            </Button>
            <Button size="sm" onClick={startCreate} disabled={formOpen}>
              <Plus /> Add Mirror
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {formOpen && (
          <div className="rounded-lg border border-dashed p-4 space-y-3">
            <p className="text-sm font-medium">{editIndex !== null ? 'Edit Mirror' : 'New Mirror'}</p>
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
                <Select value={form.profile} onValueChange={(v) => setForm((f) => ({ ...f, profile: v }))}>
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
              <Button size="sm" onClick={handleSave}>{editIndex !== null ? 'Save' : 'Add'}</Button>
              <Button size="sm" variant="outline" onClick={cancelForm}>Cancel</Button>
            </div>
          </div>
        )}

        {config.images.length === 0 && !formOpen && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No mirror entries yet. Click "Add Mirror" to get started.
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {filteredAndSortedImages.length}/{config.images.length}
              </span>
            </div>

            {filteredAndSortedImages.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No entries match "{searchQuery}".
              </p>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
                <Table className="table-fixed w-full min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="w-[68px] cursor-pointer select-none"
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
                      <TableHead className="w-[140px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAndSortedImages.map(({ img: entry, i: originalIndex }) => {
                      const fullTarget = buildFullTarget(config.profiles[entry.profile]?.registry ?? '', entry.target)
                      return (
                        <TableRow
                          key={`${entry.source}-${originalIndex}`}
                          className={!entry.enabled ? 'opacity-50' : ''}
                        >
                          <TableCell className="py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              <SyncStatusBadge entry={entry} />
                              {!entry.enabled ? (
                                <Badge variant="outline">off</Badge>
                              ) : null}
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
                                onClick={() => copyTarget(fullTarget, originalIndex)}
                              >
                                {copiedIndex === originalIndex
                                  ? <Check className="size-3.5 text-green-600" />
                                  : <Copy className="size-3.5" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="size-7" onClick={() => startEdit(originalIndex)}>
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-7" onClick={() => toggleEnabled(originalIndex)}>
                                {entry.enabled
                                  ? <ToggleRight className="size-3.5 text-primary" />
                                  : <ToggleLeft className="size-3.5 text-muted-foreground" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="size-7" onClick={() => deleteEntry(originalIndex)}>
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
