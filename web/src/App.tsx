import { useMemo, useState } from 'react'
import { Container, ExternalLink } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { AddEntryForm } from '@/components/AddEntryForm'
import { ProfilePanel } from '@/components/ProfilePanel'
import { EntriesTable, type Credentials } from '@/components/EntriesTable'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { emptyConfig, type ImageEntry, type MirrorConfig } from '@/lib/types'

const STORAGE_KEY = 'mirrorpilot.config.v1'

export default function App() {
  const [config, setConfig] = useLocalStorage<MirrorConfig>(
    STORAGE_KEY,
    emptyConfig()
  )
  // Credentials live only in memory for the active session.
  const [credentials, setCredentials] = useState<Record<string, Credentials>>(
    {}
  )

  const profileNames = useMemo(
    () => Object.keys(config.profiles),
    [config.profiles]
  )
  const [activeProfile, setActiveProfile] = useState(
    profileNames[0] ?? 'default'
  )

  const currentProfile =
    config.profiles[activeProfile] ?? config.profiles[profileNames[0]]
  const currentCreds = credentials[activeProfile] ?? {
    username: '',
    password: '',
  }

  function addEntry(entry: ImageEntry) {
    setConfig((c) => ({ ...c, images: [...c.images, entry] }))
  }

  function deleteEntry(index: number) {
    setConfig((c) => ({
      ...c,
      images: c.images.filter((_, i) => i !== index),
    }))
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Container className="size-6" />
            <div>
              <h1 className="text-lg font-semibold">MirrorPilot Web</h1>
              <p className="text-muted-foreground text-xs">
                Manage container mirror entries and run source detection
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://github.com/warjiang/MirrorPilot"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink /> GitHub
            </a>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Registry profile</CardTitle>
                <CardDescription>
                  Configure the mirror destination and detection credentials.
                </CardDescription>
              </div>
              {profileNames.length > 1 ? (
                <Select value={activeProfile} onValueChange={setActiveProfile}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {profileNames.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {currentProfile ? (
              <ProfilePanel
                profileName={activeProfile}
                profile={currentProfile}
                credentials={currentCreds}
                onProfileChange={(next) =>
                  setConfig((c) => ({
                    ...c,
                    profiles: { ...c.profiles, [activeProfile]: next },
                  }))
                }
                onCredentialsChange={(next) =>
                  setCredentials((cr) => ({ ...cr, [activeProfile]: next }))
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mirror entries</CardTitle>
            <CardDescription>
              Add source → target mappings. Detection probes whether the source
              image exists, the mirror registry is reachable, the mirror image
              is already synced, and your credentials are accepted.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <AddEntryForm profiles={profileNames} onAdd={addEntry} />
            <Separator />
            <EntriesTable
              entries={config.images}
              profiles={config.profiles}
              credentials={credentials}
              onDelete={deleteEntry}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
