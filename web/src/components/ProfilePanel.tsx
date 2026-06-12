import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RegistryProfile } from '@/lib/types'
import type { Credentials } from '@/components/EntriesTable'

interface Props {
  profileName: string
  profile: RegistryProfile
  credentials: Credentials
  onProfileChange: (next: RegistryProfile) => void
  onCredentialsChange: (next: Credentials) => void
}

export function ProfilePanel({
  profile,
  credentials,
  onProfileChange,
  onCredentialsChange,
}: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="registry">Target registry</Label>
        <Input
          id="registry"
          placeholder="crpi-xxx.cn-shanghai.personal.cr.aliyuncs.com"
          value={profile.registry}
          onChange={(e) =>
            onProfileChange({ ...profile, registry: e.target.value })
          }
        />
        <p className="text-muted-foreground text-xs">
          Mirror destination registry host.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="namespace">Namespace</Label>
        <Input
          id="namespace"
          placeholder="e.g. warjiang"
          value={profile.namespace ?? ''}
          onChange={(e) =>
            onProfileChange({ ...profile, namespace: e.target.value })
          }
        />
        <p className="text-muted-foreground text-xs">
          Registry namespace prefix added to each target path.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          autoComplete="off"
          placeholder="registry username"
          value={credentials.username}
          onChange={(e) =>
            onCredentialsChange({ ...credentials, username: e.target.value })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password / token</Label>
        <Input
          id="password"
          type="password"
          autoComplete="off"
          placeholder="registry password or token"
          value={credentials.password}
          onChange={(e) =>
            onCredentialsChange({ ...credentials, password: e.target.value })
          }
        />
      </div>
      <p className="text-muted-foreground text-xs sm:col-span-2">
        Credentials are used only for live detection requests and are never
        persisted to storage or committed to config.
      </p>
    </div>
  )
}
