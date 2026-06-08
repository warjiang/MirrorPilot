import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deriveTarget, validateImageReference } from '@/lib/image'
import type { ImageEntry } from '@/lib/types'

interface Props {
  profiles: string[]
  onAdd: (entry: ImageEntry) => void
}

export function AddEntryForm({ profiles, onAdd }: Props) {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [targetTouched, setTargetTouched] = useState(false)
  const [profile, setProfile] = useState(profiles[0] ?? 'default')
  const [error, setError] = useState<string | null>(null)

  const effectiveTarget =
    targetTouched && target.trim() !== ''
      ? target
      : source.trim()
        ? deriveTarget(source)
        : ''

  function handleSourceChange(value: string) {
    setSource(value)
    setError(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const srcErr = validateImageReference(source)
    if (srcErr) {
      setError(`source ${srcErr}`)
      return
    }
    const finalTarget = effectiveTarget
    const tgtErr = validateImageReference(finalTarget)
    if (tgtErr) {
      setError(`target ${tgtErr}`)
      return
    }
    onAdd({
      source: source.trim(),
      target: finalTarget.trim(),
      profile,
      enabled: true,
      createdAt: new Date().toISOString(),
    })
    setSource('')
    setTarget('')
    setTargetTouched(false)
    setError(null)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="source">Source image</Label>
          <Input
            id="source"
            placeholder="nginx:1.27"
            value={source}
            onChange={(e) => handleSourceChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target">Target path</Label>
          <Input
            id="target"
            placeholder={source ? deriveTarget(source) : 'mirror/nginx:1.27'}
            value={targetTouched ? target : effectiveTarget}
            onChange={(e) => {
              setTargetTouched(true)
              setTarget(e.target.value)
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile">Profile</Label>
          <Select value={profile} onValueChange={setProfile}>
            <SelectTrigger id="profile" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit">
          <Plus /> Add entry
        </Button>
        {error ? (
          <span className="text-destructive text-sm">{error}</span>
        ) : null}
      </div>
    </form>
  )
}
