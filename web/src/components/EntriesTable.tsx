import { useState } from 'react'
import { Radar, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { PendingBadge, StatusBadge } from '@/components/StatusBadge'
import { detect } from '@/lib/api'
import { buildFullTarget } from '@/lib/image'
import type {
  DetectResponse,
  ImageEntry,
  RegistryProfile,
} from '@/lib/types'

export interface Credentials {
  username: string
  password: string
}

interface Props {
  entries: ImageEntry[]
  profiles: Record<string, RegistryProfile>
  credentials: Record<string, Credentials>
  onDelete: (index: number) => void
}

type RowState = {
  loading: boolean
  result?: DetectResponse
  error?: string
}

export function EntriesTable({
  entries,
  profiles,
  credentials,
  onDelete,
}: Props) {
  const [rows, setRows] = useState<Record<number, RowState>>({})

  async function runDetect(index: number, entry: ImageEntry) {
    const profile = profiles[entry.profile]
    const creds = credentials[entry.profile]
    setRows((r) => ({ ...r, [index]: { loading: true } }))
    try {
      const result = await detect({
        source: entry.source,
        targetRegistry: profile?.registry ?? '',
        target: entry.target,
        namespace: profile?.namespace,
        username: creds?.username,
        password: creds?.password,
      })
      setRows((r) => ({ ...r, [index]: { loading: false, result } }))
    } catch (e) {
      setRows((r) => ({
        ...r,
        [index]: {
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        },
      }))
    }
  }

  async function detectAll() {
    await Promise.all(entries.map((entry, i) => runDetect(i, entry)))
  }

  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No image entries yet. Add one above to get started.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={detectAll}>
          <Radar /> Detect all
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Source check</TableHead>
            <TableHead>Reachable</TableHead>
            <TableHead>Mirror</TableHead>
            <TableHead>Auth</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => {
            const state = rows[index]
            const fullTarget = buildFullTarget(
              profiles[entry.profile]?.registry ?? '',
              entry.target,
              profiles[entry.profile]?.namespace
            )
            return (
              <TableRow key={`${entry.source}-${entry.target}-${index}`}>
                <TableCell className="font-mono text-xs">
                  {entry.source}
                </TableCell>
                <TableCell
                  className="text-muted-foreground max-w-[220px] truncate font-mono text-xs"
                  title={fullTarget}
                >
                  {fullTarget}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{entry.profile}</Badge>
                </TableCell>
                {state?.error ? (
                  <TableCell colSpan={4} className="text-destructive text-xs">
                    {state.error}
                  </TableCell>
                ) : (
                  <>
                    <TableCell>
                      {state?.loading ? (
                        <PendingBadge />
                      ) : state?.result ? (
                        <StatusBadge result={state.result.source} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {state?.loading ? (
                        <PendingBadge />
                      ) : state?.result ? (
                        <StatusBadge result={state.result.targetReachable} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {state?.loading ? (
                        <PendingBadge />
                      ) : state?.result ? (
                        <StatusBadge result={state.result.targetExists} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {state?.loading ? (
                        <PendingBadge />
                      ) : state?.result ? (
                        <StatusBadge result={state.result.auth} />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Run detection"
                      onClick={() => runDetect(index, entry)}
                    >
                      <Radar />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete entry"
                      onClick={() => onDelete(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
