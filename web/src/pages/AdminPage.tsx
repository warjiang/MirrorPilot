import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

interface AdminUserRow {
  id: number
  email: string
  name: string
  avatar_url: string
  is_admin: number
  status: string
  created_at: string
  has_github: number
  has_password: number
  image_count: number
}

interface AdminImageRow {
  id: number
  source: string
  target: string
  profile: string
  enabled: number
  synced: number
  notes: string
  created_at: string
  synced_at: string | null
  owner_email: string
  owner_name: string
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="secondary">active</Badge>
  if (status === 'pending') return <Badge variant="outline">pending</Badge>
  return <Badge variant="destructive">disabled</Badge>
}

export function AdminPage() {
  const { user, loading: authLoading } = useAuth()
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [images, setImages] = useState<AdminImageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null)

  const load = useCallback(async () => {
    try {
      const [usersRes, imagesRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/images'),
      ])
      if (!usersRes.ok || !imagesRes.ok) {
        throw new Error('Failed to load admin data')
      }
      const usersData = (await usersRes.json()) as { users: AdminUserRow[] }
      const imagesData = (await imagesRes.json()) as { images: AdminImageRow[] }
      setUsers(usersData.users)
      setImages(imagesData.images)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user || user.is_admin !== 1) {
    return <Navigate to="/mirrors" replace />
  }

  const patchUser = async (id: number, body: { status?: string; is_admin?: boolean }) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Update failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const deleteUser = async (id: number) => {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Admin</h2>
          <p className="text-sm text-muted-foreground">
            Manage users and review all mirror entries.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          disabled={loading}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-md px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            Users ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Images</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelf = u.id === user.id
                const busy = busyId === u.id
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt={u.name} className="size-6 rounded-full border object-cover" />
                        ) : (
                          <span className="flex size-6 items-center justify-center rounded-full border bg-muted text-xs uppercase">
                            {u.email[0]}
                          </span>
                        )}
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{u.name || u.email}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={u.status} /></TableCell>
                    <TableCell>
                      {u.is_admin ? <Badge>admin</Badge> : <span className="text-sm text-muted-foreground">user</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[u.has_github ? 'GitHub' : null, u.has_password ? 'Password' : null]
                        .filter(Boolean)
                        .join(' + ') || '—'}
                    </TableCell>
                    <TableCell className="text-sm">{u.image_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.created_at}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {u.status === 'pending' && (
                          <Button size="sm" disabled={busy} onClick={() => void patchUser(u.id, { status: 'active' })}>
                            Approve
                          </Button>
                        )}
                        {u.status === 'active' && !isSelf && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void patchUser(u.id, { status: 'disabled' })}>
                            Disable
                          </Button>
                        )}
                        {u.status === 'disabled' && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void patchUser(u.id, { status: 'active' })}>
                            Enable
                          </Button>
                        )}
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void patchUser(u.id, { is_admin: !u.is_admin })}
                          >
                            {u.is_admin ? 'Revoke admin' : 'Make admin'}
                          </Button>
                        )}
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!loading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All mirror entries ({images.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Synced</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {images.map((img) => (
                <TableRow key={img.id}>
                  <TableCell className="text-xs text-muted-foreground">{img.owner_email}</TableCell>
                  <TableCell className="font-mono text-xs">{img.source}</TableCell>
                  <TableCell className="font-mono text-xs">{img.target}</TableCell>
                  <TableCell className="text-sm">{img.profile}</TableCell>
                  <TableCell>
                    {img.enabled ? <Badge variant="secondary">yes</Badge> : <Badge variant="outline">no</Badge>}
                  </TableCell>
                  <TableCell>
                    {img.synced ? <Badge variant="secondary">synced</Badge> : <Badge variant="outline">pending</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{img.created_at}</TableCell>
                </TableRow>
              ))}
              {!loading && images.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No mirror entries found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete user"
        description={`Delete ${deleteTarget?.email}? This removes their profiles, images, credentials, and sessions. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) void deleteUser(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
