import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  Eye,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from '@/components/Toaster'
import {
  cancelJob,
  getJob,
  getJobLogs,
  listJobs,
  type JobLogsResponse,
  type SyncJob,
  type SyncJobItem,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const ACTIVE_STATUSES = ['pending', 'dispatched', 'running']

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' | 'pending'
> = {
  pending: 'pending',
  dispatched: 'pending',
  running: 'secondary',
  syncing: 'secondary',
  succeeded: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'outline',
}

function JobStatusBadge({ status }: { status: string }) {
  const icon = (() => {
    switch (status) {
      case 'succeeded':
        return <CheckCircle2 className="size-3.5" />
      case 'failed':
        return <XCircle className="size-3.5" />
      case 'partial':
        return <XCircle className="size-3.5" />
      case 'cancelled':
        return <Ban className="size-3.5" />
      case 'running':
      case 'syncing':
        return <Loader2 className="size-3.5 animate-spin" />
      default:
        return <CircleSlash className="size-3.5" />
    }
  })()
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>
      {icon}
      {status}
    </Badge>
  )
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  // D1 stores UTC without timezone marker
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatDuration(job: SyncJob): string {
  const start = job.started_at || job.created_at
  if (!start) return '—'
  const end = job.finished_at
  if (!end) return ACTIVE_STATUSES.includes(job.status) ? 'running…' : '—'
  const ms =
    new Date(`${end.replace(' ', 'T')}Z`).getTime() -
    new Date(`${start.replace(' ', 'T')}Z`).getTime()
  if (Number.isNaN(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function JobDetailDialog({
  jobId,
  onClose,
  onCancelled,
}: {
  jobId: string
  onClose: () => void
  onCancelled: () => void
}) {
  const [tab, setTab] = useState<'progress' | 'logs'>('progress')
  const [job, setJob] = useState<SyncJob | null>(null)
  const [items, setItems] = useState<SyncJobItem[]>([])
  const [logs, setLogs] = useState<JobLogsResponse | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const isActive = job ? ACTIVE_STATUSES.includes(job.status) : true

  const refresh = useCallback(async () => {
    try {
      const data = await getJob(jobId)
      setJob(data.job)
      setItems(data.items)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load job', 'error')
    }
  }, [jobId])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      setLogs(await getJobLogs(jobId))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load logs', 'error')
    } finally {
      setLogsLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!isActive) return
    const timer = window.setInterval(() => {
      void refresh()
      if (tab === 'logs') void loadLogs()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [isActive, tab, refresh, loadLogs])

  useEffect(() => {
    if (tab !== 'logs' || logs || logsLoading) return
    const timer = window.setTimeout(() => void loadLogs(), 0)
    return () => window.clearTimeout(timer)
  }, [tab, logs, logsLoading, loadLogs])

  async function handleCancel() {
    setCancelling(true)
    try {
      await cancelJob(jobId)
      toast('Job cancelled')
      await refresh()
      onCancelled()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to cancel job', 'error')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono text-sm">{jobId.slice(0, 8)}</span>
            {job && <JobStatusBadge status={job.status} />}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3">
            {job && (
              <>
                <span>
                  {job.image_success}/{job.image_total} succeeded
                  {job.image_failed > 0 && `, ${job.image_failed} failed`}
                </span>
                <span>· {formatDuration(job)}</span>
                {job.run_url && (
                  <a
                    href={job.run_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    GitHub run <ExternalLink className="size-3" />
                  </a>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {(['progress', 'logs'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t === 'progress' ? 'Progress' : 'Logs'}
              </button>
            ))}
          </div>
          {job && isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancel job
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'progress' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[240px] truncate font-mono text-xs" title={item.source}>
                      {item.source}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-mono text-xs" title={item.target}>
                      {item.target}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <JobStatusBadge status={item.status} />
                        {item.error && (
                          <span className="text-destructive text-[11px]">{item.error}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {item.duration_ms != null ? `${(item.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No items
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col gap-3">
              {logsLoading && !logs && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading logs…
                </div>
              )}
              {logs && !logs.available && logs.running && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground">
                    Workflow is still running — full logs will be available when it finishes.
                    {logs.run_url && (
                      <>
                        {' '}
                        <a href={logs.run_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          View live logs on GitHub
                        </a>
                      </>
                    )}
                  </p>
                  {logs.steps && logs.steps.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Step</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logs.steps.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-sm">{s.name}</TableCell>
                            <TableCell>
                              <JobStatusBadge
                                status={
                                  s.status === 'completed'
                                    ? s.conclusion === 'success'
                                      ? 'succeeded'
                                      : s.conclusion || 'failed'
                                    : s.status === 'in_progress'
                                      ? 'running'
                                      : s.status
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
              {logs && !logs.available && !logs.running && (
                <p className="text-sm text-muted-foreground">
                  {logs.reason || 'Logs are not available.'}
                  {logs.run_url && (
                    <>
                      {' '}
                      <a href={logs.run_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        View on GitHub
                      </a>
                    </>
                  )}
                </p>
              )}
              {logs?.available &&
                (logs.logs || []).map((file) => (
                  <div key={file.name} className="flex flex-col gap-1">
                    <h4 className="text-sm font-medium">{file.name}</h4>
                    <pre className="bg-secondary/50 max-h-[400px] overflow-auto rounded-md p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                      {file.content}
                    </pre>
                  </div>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function JobsPage() {
  const [jobs, setJobs] = useState<SyncJob[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const limit = 20

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const data = await listJobs(limit, offset)
      setJobs(data.jobs)
      setTotal(data.total)
      if (manual) toast('Refreshed')
    } catch (e) {
      if (manual) toast(e instanceof Error ? e.message : 'Failed to load jobs', 'error')
    } finally {
      setLoading(false)
      if (manual) setRefreshing(false)
    }
  }, [offset])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const hasActiveJobs = useMemo(
    () => jobs.some((j) => ACTIVE_STATUSES.includes(j.status)),
    [jobs]
  )

  useEffect(() => {
    if (!hasActiveJobs) return
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs, refresh])

  async function handleCancel(job: SyncJob) {
    try {
      await cancelJob(job.id)
      toast('Job cancelled')
      void refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to cancel job', 'error')
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Sync Jobs</CardTitle>
              <CardDescription>
                Each sync trigger dispatches a GitHub Actions job. Track status, inspect logs, or cancel running jobs.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading jobs…
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-mono text-xs">{job.id.slice(0, 8)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <JobStatusBadge status={job.status} />
                          {job.error && (
                            <span className="text-destructive max-w-[200px] truncate text-[11px]" title={job.error}>
                              {job.error}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {job.image_success + job.image_failed}/{job.image_total}
                        {job.image_failed > 0 && (
                          <span className="text-destructive ml-1 text-xs">({job.image_failed} failed)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTime(job.created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDuration(job)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="View details"
                            onClick={() => setSelectedJobId(job.id)}
                          >
                            <Eye className="size-4" />
                          </Button>
                          {ACTIVE_STATUSES.includes(job.status) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancel job"
                              onClick={() => void handleCancel(job)}
                            >
                              <Ban className="text-destructive size-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!jobs.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No sync jobs yet. Trigger a sync from the Mirrors page.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {total > limit && (
                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {offset + 1}–{Math.min(offset + limit, total)} of {total}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - limit))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + limit >= total}
                      onClick={() => setOffset(offset + limit)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selectedJobId && (
        <JobDetailDialog
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
          onCancelled={() => void refresh()}
        />
      )}
    </>
  )
}
