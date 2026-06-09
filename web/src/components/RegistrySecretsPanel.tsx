import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface RegistrySecret {
  registry: string
  destUser: string
  destPass: string
}

export function RegistrySecretsPanel() {
  const [secrets, setSecrets] = useState<RegistrySecret[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState({ registry: '', destUser: '', destPass: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSecrets()
  }, [])

  async function fetchSecrets() {
    try {
      setLoading(true)
      const res = await fetch('/api/secrets/registry')
      if (!res.ok) {
        throw new Error('Failed to fetch secrets')
      }
      const data = await res.json() as { secrets: RegistrySecret[] }
      setSecrets(data.secrets)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!newSecret.registry || !newSecret.destUser || !newSecret.destPass) {
      setError('All fields are required')
      return
    }

    try {
      setSaving(true)
      const res = await fetch('/api/secrets/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSecret),
      })
      if (!res.ok) {
        const data = await res.json() as { error: string }
        throw new Error(data.error || 'Failed to save secret')
      }
      setNewSecret({ registry: '', destUser: '', destPass: '' })
      await fetchSecrets()
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(registry: string) {
    if (!confirm(`Delete secret for ${registry}?`)) return

    try {
      const res = await fetch(`/api/secrets/registry?registry=${encodeURIComponent(registry)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        throw new Error('Failed to delete secret')
      }
      await fetchSecrets()
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registry Credentials</CardTitle>
        <CardDescription>
          Store and manage destination registry credentials used for sync operations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        {/* New Secret Form */}
        <form onSubmit={handleSave} className="space-y-4 p-4 border rounded bg-slate-50">
          <h3 className="font-semibold text-sm">Add Registry Credential</h3>
          
          <div>
            <Label htmlFor="registry" className="text-xs">
              Registry URL
            </Label>
            <Input
              id="registry"
              placeholder="registry.example.com"
              value={newSecret.registry}
              onChange={(e) => setNewSecret({ ...newSecret, registry: e.target.value })}
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="destUser" className="text-xs">
              Username
            </Label>
            <Input
              id="destUser"
              placeholder="username"
              value={newSecret.destUser}
              onChange={(e) => setNewSecret({ ...newSecret, destUser: e.target.value })}
              className="text-sm"
            />
          </div>

          <div>
            <Label htmlFor="destPass" className="text-xs">
              Password
            </Label>
            <Input
              id="destPass"
              type="password"
              placeholder="password"
              value={newSecret.destPass}
              onChange={(e) => setNewSecret({ ...newSecret, destPass: e.target.value })}
              className="text-sm"
            />
          </div>

          <Button type="submit" disabled={saving} size="sm">
            {saving ? 'Saving...' : 'Save Credential'}
          </Button>
        </form>

        {/* Secrets List */}
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Configured Registries</h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : secrets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credentials configured yet.</p>
          ) : (
            <div className="space-y-2">
              {secrets.map((secret) => (
                <div
                  key={secret.registry}
                  className="flex items-center justify-between p-3 border rounded bg-white"
                >
                  <div className="flex-1">
                    <p className="font-mono text-sm">{secret.registry}</p>
                    <p className="text-xs text-muted-foreground">User: {secret.destUser}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(secret.registry)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
