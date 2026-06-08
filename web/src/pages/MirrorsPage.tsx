import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ArrowUp, ArrowDown, Copy, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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

function formatTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
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

  function copyTarget(fullTarget: string, index: number) {
    navigator.clipboard.writeText(fullTarget).then(() => {
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 1500)
    })
  }

  const sortedImages = useMemo(() => {
    const indexed = config.images.map((img, i) => ({ img, i }))
    if (!sortField) return indexed
    indexed.sort((a, b) => {
      let cmp = 0
      if (sortField === 'enabled') {
        cmp = (a.img.enabled ? 1 : 0) - (b.img.enabled ? 1 : 0)
      } else {
        const aVal = a.img[sortField] ?? ''
        const bVal = b.img[sortField] ?? ''
        cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return indexed
  }, [config.images, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
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
      setConfig((c) => ({
        ...c,
        images: c.images.map((img, i) =>
          i === editIndex
            ? { ...img, source: form.source.trim(), target: finalTarget, profile: form.profile, notes: form.notes.trim() || undefined }
            : img
        ),
      }))
    } else {
      const entry: ImageEntry = {
        source: form.source.trim(),
        target: finalTarget,
        profile: form.profile,
        enabled: true,
        createdAt: now,
        notes: form.notes.trim() || undefined,
      }
      setConfig((c) => ({ ...c, images: [...c.images, entry] }))
    }
    cancelForm()
  }

  function deleteEntry(index: number) {
    setConfig((c) => ({ ...c, images: c.images.filter((_, i) => i !== index) }))
  }

  function toggleEnabled(index: number) {
    setConfig((c) => ({
      ...c,
      images: c.images.map((img, i) => (i === index ? { ...img, enabled: !img.enabled } : img)),
    }))
  }

  const effectiveTarget = form.targetTouched && form.target.trim()
    ? form.target
    : form.source.trim() ? deriveTarget(form.source) : ''

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null
    return sortDir === 'asc'
      ? <ArrowUp className="inline size-3" />
      : <ArrowDown className="inline size-3" />
  }

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
          <Button size="sm" onClick={startCreate} disabled={formOpen}>
            <Plus /> Add Mirror
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {formOpen && (
          <>
            <div className="rounded-lg border border-dashed p-4 space-y-3">
              <p className="text-sm font-medium">{editIndex !== null ? 'Edit Mirror' : 'New Mirror'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Source image</Label>
                  <Input
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
            <Separator />
          </>
        )}

        {config.images.length === 0 && !formOpen && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No mirror entries yet. Add one to get started.
          </p>
        )}

        {config.images.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('enabled')}>
                  Enabled <SortIcon field="enabled" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('createdAt')}>
                  Created <SortIcon field="createdAt" />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('syncedAt')}>
                  Synced <SortIcon field="syncedAt" />
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedImages.map(({ img: entry, i: originalIndex }) => {
                const fullTarget = buildFullTarget(config.profiles[entry.profile]?.registry ?? '', entry.target)
                return (
                  <TableRow key={`${entry.source}-${entry.target}-${originalIndex}`} className={!entry.enabled ? 'opacity-50' : ''}>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate" title={entry.source}>
                      {entry.source}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs max-w-[200px] truncate" title={fullTarget}>
                      {fullTarget}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.profile}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.enabled ? 'default' : 'secondary'} className="text-xs">
                        {entry.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatTime(entry.syncedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Copy full target address" onClick={() => copyTarget(fullTarget, originalIndex)}>
                          {copiedIndex === originalIndex ? <Check className="text-green-600" /> : <Copy />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => startEdit(originalIndex)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={entry.enabled ? 'Disable' : 'Enable'}
                          onClick={() => toggleEnabled(originalIndex)}
                        >
                          {entry.enabled
                            ? <ToggleRight className="text-primary" />
                            : <ToggleLeft className="text-muted-foreground" />
                          }
                        </Button>
                        <Button variant="ghost" size="icon" title="Delete" onClick={() => deleteEntry(originalIndex)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
