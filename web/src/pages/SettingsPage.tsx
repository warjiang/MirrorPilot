import { useState } from 'react'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { testConnection } from '@/lib/github'
import type { GitHubSettings } from '@/lib/types'

interface Props {
  settings: GitHubSettings | null
  onSave: (s: GitHubSettings | null) => void
}

export function SettingsPage({ settings, onSave }: Props) {
  const [form, setForm] = useState<GitHubSettings>(
    settings ?? { pat: '', owner: '', repo: '', branch: 'main', configPath: 'mirrorpilot.yaml' }
  )
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  function handleOwnerRepo(value: string) {
    const parts = value.split('/')
    if (parts.length >= 2) {
      setForm((f) => ({ ...f, owner: parts[0], repo: parts.slice(1).join('/') }))
    } else {
      setForm((f) => ({ ...f, owner: value, repo: '' }))
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection(form)
    setTestResult(result)
    setTesting(false)
  }

  function handleSave() {
    if (!form.pat.trim() || !form.owner.trim() || !form.repo.trim()) return
    onSave(form)
  }

  function handleDisconnect() {
    onSave(null)
    setForm({ pat: '', owner: '', repo: '', branch: 'main', configPath: 'mirrorpilot.yaml' })
    setTestResult(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub Storage</CardTitle>
        <CardDescription>
          Connect to a GitHub repository to persist your mirror configuration as a YAML file,
          compatible with the MirrorPilot Go CLI.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="pat">Personal Access Token</Label>
            <Input
              id="pat"
              type="password"
              placeholder="ghp_..."
              value={form.pat}
              autoComplete="off"
              onChange={(e) => setForm((f) => ({ ...f, pat: e.target.value }))}
            />
            <p className="text-muted-foreground text-xs">
              Requires <code>repo</code> scope (or <code>contents:write</code> for fine-grained tokens).
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ownerrepo">Repository (owner/repo)</Label>
            <Input
              id="ownerrepo"
              placeholder="warjiang/MirrorPilot"
              value={form.owner && form.repo ? `${form.owner}/${form.repo}` : form.owner}
              onChange={(e) => handleOwnerRepo(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="branch">Branch</Label>
            <Input
              id="branch"
              placeholder="main"
              value={form.branch}
              onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="configpath">Config file path</Label>
            <Input
              id="configpath"
              placeholder="mirrorpilot.yaml"
              value={form.configPath}
              onChange={(e) => setForm((f) => ({ ...f, configPath: e.target.value }))}
            />
          </div>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {testResult.ok ? <CheckCircle className="size-4" /> : <XCircle className="size-4" />}
            {testResult.message}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleTest} disabled={testing || !form.pat.trim() || !form.owner.trim() || !form.repo.trim()} variant="outline">
            {testing && <Loader2 className="animate-spin" />}
            Test Connection
          </Button>
          <Button onClick={handleSave} disabled={!form.pat.trim() || !form.owner.trim() || !form.repo.trim()}>
            Save Settings
          </Button>
          {settings && (
            <Button variant="destructive" onClick={handleDisconnect}>
              Disconnect
            </Button>
          )}
        </div>

        <p className="text-muted-foreground text-xs">
          Settings are stored in your browser's localStorage. The PAT is never sent to any server
          other than api.github.com.
        </p>
      </CardContent>
    </Card>
  )
}
