import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Wifi, Search, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast } from '@/components/Toaster'
import type { MirrorConfig, RegistryProfile, CheckRegistryResponse } from '@/lib/types'

interface Props {
  config: MirrorConfig
  setConfig: (updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => void
}

interface FormState {
  name: string
  registry: string
  namespace: string
  username: string
  password: string
}

const emptyForm: FormState = { name: '', registry: '', namespace: '', username: '', password: '' }

export function ProfilesPage({ config, setConfig }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [checkResults, setCheckResults] = useState<Record<string, { loading: boolean; result?: CheckRegistryResponse; error?: string }>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const profileNames = Object.keys(config.profiles)

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return profileNames
    return profileNames.filter((name) => {
      const p = config.profiles[name]
      return (
        name.toLowerCase().includes(q) ||
        p.registry.toLowerCase().includes(q) ||
        (p.namespace?.toLowerCase().includes(q) ?? false) ||
        (p.username?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [profileNames, config.profiles, searchQuery])

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function startCreate() {
    setCreating(true)
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowPassword(false)
  }

  function startEdit(name: string) {
    const p = config.profiles[name]
    setEditing(name)
    setCreating(false)
    setForm({ name, registry: p.registry, namespace: p.namespace ?? '', username: p.username ?? '', password: p.password ?? '' })
    setError(null)
    setShowPassword(false)
  }

  function cancelForm() {
    setCreating(false)
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowPassword(false)
  }

  function handleSave() {
    const trimmedName = form.name.trim()
    if (!trimmedName) { setError('Profile name is required'); return }
    if (!form.registry.trim()) { setError('Registry URL is required'); return }
    if (creating && config.profiles[trimmedName]) { setError('Profile already exists'); return }

    const profile: RegistryProfile = {
      registry: form.registry.trim(),
      namespace: form.namespace.trim() || undefined,
      username: form.username.trim() || undefined,
      password: form.password || undefined,
    }

    setConfig((c) => {
      const profiles = { ...c.profiles }
      if (editing && editing !== trimmedName) {
        delete profiles[editing]
        const images = c.images.map((img) =>
          img.profile === editing ? { ...img, profile: trimmedName } : img
        )
        return { ...c, profiles: { ...profiles, [trimmedName]: profile }, images }
      }
      return { ...c, profiles: { ...profiles, [trimmedName]: profile } }
    })
    toast(creating ? `Created profile "${trimmedName}"` : `Updated profile "${trimmedName}"`)
    cancelForm()
  }

  function handleDelete(name: string) {
    setDeleteTarget(name)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    const imageCount = config.images.filter((img) => img.profile === deleteTarget).length
    setConfig((c) => {
      const profiles = { ...c.profiles }
      delete profiles[deleteTarget]
      const images = c.images.filter((img) => img.profile !== deleteTarget)
      return { ...c, profiles, images }
    })
    toast(`Deleted profile "${deleteTarget}"${imageCount ? ` and ${imageCount} linked image${imageCount > 1 ? 's' : ''}` : ''}`)
    setDeleteTarget(null)
  }

  async function checkRegistry(name: string) {
    const profile = config.profiles[name]
    setCheckResults((r) => ({ ...r, [name]: { loading: true } }))
    try {
      const res = await fetch('/api/check-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registry: profile.registry,
          username: profile.username,
          password: profile.password,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = (await res.json()) as CheckRegistryResponse
      setCheckResults((r) => ({ ...r, [name]: { loading: false, result } }))
    } catch (e) {
      setCheckResults((r) => ({ ...r, [name]: { loading: false, error: e instanceof Error ? e.message : String(e) } }))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Registry Profiles</CardTitle>
              <CardDescription>
                Each profile defines a destination registry and its authentication credentials.
                Images are mirrored to the registry configured in their assigned profile.
              </CardDescription>
            </div>
            <Button size="sm" onClick={startCreate} disabled={creating || !!editing}>
              <Plus /> Add Profile
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(creating || editing) && (
            <ProfileForm
              form={form}
              setForm={setForm}
              error={error}
              isCreate={creating}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              onSave={handleSave}
              onCancel={cancelForm}
            />
          )}

          {profileNames.length === 0 && !creating && (
            <div className="py-12 text-center">
              <p className="text-foreground font-medium">No registry profiles yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                A profile defines where your mirrored images are pushed — registry URL + credentials.
              </p>
              <Button size="sm" onClick={startCreate} className="mt-4">
                <Plus /> Create your first profile
              </Button>
            </div>
          )}

          {profileNames.length > 0 && (
            <div className="relative">
              <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                placeholder="Filter profiles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {profileNames.length > 0 && filteredProfiles.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No profiles match "{searchQuery}".
            </p>
          )}

          {filteredProfiles.map((name) => {
            if (editing === name) return null
            const p = config.profiles[name]
            const check = checkResults[name]
            const isExpanded = expanded.has(name)
            const imageCount = config.images.filter((img) => img.profile === name).length
            return (
              <div key={name} className="rounded-lg border">
                <div
                  className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleExpanded(name)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronDown className="size-4 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
                    <span className="font-medium truncate">{name}</span>
                    {imageCount > 0 && (
                      <span className="text-muted-foreground text-xs shrink-0">{imageCount} image{imageCount !== 1 ? 's' : ''}</span>
                    )}
                    {check?.result && (
                      <Badge variant={check.result.reachable.ok && check.result.auth.ok ? 'success' : 'destructive'} className="text-xs shrink-0">
                        {check.result.reachable.ok && check.result.auth.ok ? 'healthy' : 'issue'}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" title="Check connectivity" onClick={() => checkRegistry(name)} disabled={check?.loading}>
                      <Wifi className={check?.loading ? 'animate-pulse' : ''} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => startEdit(name)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => handleDelete(name)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-2 bg-muted/30">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Registry</span>
                        <p className="font-mono">{p.registry || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Namespace</span>
                        <p className="font-mono">{p.namespace || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Username</span>
                        <p className="font-mono">{p.username || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Password</span>
                        <p className="font-mono">{p.password ? '••••••••' : '—'}</p>
                      </div>
                    </div>
                    {check?.result && (
                      <div className="flex gap-3 text-xs pt-2 border-t">
                        <span className={check.result.reachable.ok ? 'text-green-600' : 'text-red-600'}>
                          Reachable: {check.result.reachable.message}
                        </span>
                        <span className={check.result.auth.ok ? 'text-green-600' : 'text-red-600'}>
                          Auth: {check.result.auth.message}
                        </span>
                      </div>
                    )}
                    {check?.error && (
                      <p className="text-red-600 text-xs">{check.error}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete profile"
        description={deleteTarget ? `This will remove the "${deleteTarget}" profile and all ${config.images.filter((img) => img.profile === deleteTarget).length} linked image entries. This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}

function ProfileForm({
  form, setForm, error, isCreate, showPassword, setShowPassword, onSave, onCancel,
}: {
  form: FormState
  setForm: (f: FormState) => void
  error: string | null
  isCreate: boolean
  showPassword: boolean
  setShowPassword: (v: boolean) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed p-4 space-y-4">
      <p className="text-sm font-medium">{isCreate ? 'New Profile' : `Edit: ${form.name}`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Profile Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={!isCreate}
            placeholder="e.g. aliyun-prod"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Registry URL</Label>
          <Input
            value={form.registry}
            onChange={(e) => setForm({ ...form, registry: e.target.value })}
            placeholder="e.g. crpi-xxx.cn-shanghai.personal.cr.aliyuncs.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Namespace</Label>
          <Input
            value={form.namespace}
            onChange={(e) => setForm({ ...form, namespace: e.target.value })}
            placeholder="e.g. warjiang"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Username</Label>
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Registry username"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Password</Label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Registry password or token"
              className="pr-10"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave}>{isCreate ? 'Create' : 'Save'}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
