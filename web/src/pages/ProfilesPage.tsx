import { useState } from 'react'
import { Plus, Pencil, Trash2, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { Credentials } from '@/components/EntriesTable'
import type { MirrorConfig, RegistryProfile, CheckRegistryResponse } from '@/lib/types'

interface Props {
  config: MirrorConfig
  setConfig: (updater: MirrorConfig | ((prev: MirrorConfig) => MirrorConfig)) => void
  credentials: Record<string, Credentials>
  setCredentials: (updater: Record<string, Credentials> | ((prev: Record<string, Credentials>) => Record<string, Credentials>)) => void
}

interface FormState {
  name: string
  registry: string
  usernameEnv: string
  passwordEnv: string
}

const emptyForm: FormState = { name: '', registry: '', usernameEnv: '', passwordEnv: '' }

export function ProfilesPage({ config, setConfig, credentials, setCredentials }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [checkResults, setCheckResults] = useState<Record<string, { loading: boolean; result?: CheckRegistryResponse; error?: string }>>({})

  const profileNames = Object.keys(config.profiles)

  function startCreate() {
    setCreating(true)
    setEditing(null)
    setForm(emptyForm)
    setError(null)
  }

  function startEdit(name: string) {
    const p = config.profiles[name]
    setEditing(name)
    setCreating(false)
    setForm({ name, registry: p.registry, usernameEnv: p.usernameEnv ?? '', passwordEnv: p.passwordEnv ?? '' })
    setError(null)
  }

  function cancelForm() {
    setCreating(false)
    setEditing(null)
    setForm(emptyForm)
    setError(null)
  }

  function handleSave() {
    const trimmedName = form.name.trim()
    if (!trimmedName) { setError('Profile name is required'); return }
    if (!form.registry.trim()) { setError('Registry is required'); return }
    if (creating && config.profiles[trimmedName]) { setError('Profile already exists'); return }

    const profile: RegistryProfile = {
      registry: form.registry.trim(),
      usernameEnv: form.usernameEnv.trim() || undefined,
      passwordEnv: form.passwordEnv.trim() || undefined,
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
    cancelForm()
  }

  function handleDelete(name: string) {
    setConfig((c) => {
      const profiles = { ...c.profiles }
      delete profiles[name]
      const images = c.images.filter((img) => img.profile !== name)
      return { ...c, profiles, images }
    })
    setCredentials((cr) => {
      const next = { ...cr }
      delete next[name]
      return next
    })
  }

  async function checkRegistry(name: string) {
    const profile = config.profiles[name]
    const creds = credentials[name]
    setCheckResults((r) => ({ ...r, [name]: { loading: true } }))
    try {
      const res = await fetch('/api/check-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registry: profile.registry,
          username: creds?.username,
          password: creds?.password,
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
                Configure mirror destination registries and credential environment variables.
              </CardDescription>
            </div>
            <Button size="sm" onClick={startCreate} disabled={creating || !!editing}>
              <Plus /> Add Profile
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(creating || editing) && (
            <ProfileFormInline
              form={form}
              setForm={setForm}
              error={error}
              isCreate={creating}
              onSave={handleSave}
              onCancel={cancelForm}
            />
          )}

          {profileNames.length === 0 && !creating && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No profiles yet. Create one to get started.
            </p>
          )}

          {profileNames.map((name) => {
            if (editing === name) return null
            const p = config.profiles[name]
            const check = checkResults[name]
            const creds = credentials[name] ?? { username: '', password: '' }
            return (
              <div key={name} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      <Badge variant="outline" className="font-mono text-xs">{p.registry || '(not set)'}</Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Username (detection)</Label>
                        <Input
                          placeholder="registry username"
                          value={creds.username}
                          autoComplete="off"
                          onChange={(e) => setCredentials((cr) => ({ ...cr, [name]: { ...creds, username: e.target.value } }))}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs">Password (detection)</Label>
                        <Input
                          type="password"
                          placeholder="registry password"
                          value={creds.password}
                          autoComplete="off"
                          onChange={(e) => setCredentials((cr) => ({ ...cr, [name]: { ...creds, password: e.target.value } }))}
                        />
                      </div>
                    </div>
                    {check?.result && (
                      <div className="flex gap-3 text-xs">
                        <span className={check.result.reachable.ok ? 'text-green-600' : 'text-destructive'}>
                          Reachable: {check.result.reachable.message}
                        </span>
                        <span className={check.result.auth.ok ? 'text-green-600' : 'text-destructive'}>
                          Auth: {check.result.auth.message}
                        </span>
                      </div>
                    )}
                    {check?.error && (
                      <p className="text-destructive text-xs">{check.error}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" title="Check registry" onClick={() => checkRegistry(name)} disabled={check?.loading}>
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
              </div>
            )
          })}
        </CardContent>
      </Card>
    </>
  )
}

function ProfileFormInline({
  form, setForm, error, isCreate, onSave, onCancel,
}: {
  form: FormState
  setForm: (f: FormState) => void
  error: string | null
  isCreate: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3">
      <p className="text-sm font-medium">{isCreate ? 'New Profile' : `Edit: ${form.name}`}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label>Profile name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={!isCreate}
            placeholder="default"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Registry</Label>
          <Input
            value={form.registry}
            onChange={(e) => setForm({ ...form, registry: e.target.value })}
            placeholder="registry.cn-shanghai.aliyuncs.com/namespace"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Username env var</Label>
          <Input
            value={form.usernameEnv}
            onChange={(e) => setForm({ ...form, usernameEnv: e.target.value })}
            placeholder="DEST_REGISTRY_USER"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Password env var</Label>
          <Input
            value={form.passwordEnv}
            onChange={(e) => setForm({ ...form, passwordEnv: e.target.value })}
            placeholder="DEST_REGISTRY_PASSWORD"
          />
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
