import { Badge } from '@/components/ui/badge'
import type { CheckResult, CheckState } from '@/lib/types'
import {
  CheckCircle2,
  CircleSlash,
  HelpCircle,
  Loader2,
  XCircle,
} from 'lucide-react'

const STATE_VARIANT: Record<
  CheckState,
  'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'
> = {
  ok: 'success',
  exists: 'success',
  missing: 'warning',
  failed: 'destructive',
  unreachable: 'destructive',
  error: 'destructive',
  skipped: 'secondary',
}

function StateIcon({ state }: { state: CheckState }) {
  switch (state) {
    case 'ok':
    case 'exists':
      return <CheckCircle2 className="size-3.5" />
    case 'missing':
      return <HelpCircle className="size-3.5" />
    case 'failed':
    case 'unreachable':
    case 'error':
      return <XCircle className="size-3.5" />
    default:
      return <CircleSlash className="size-3.5" />
  }
}

export function StatusBadge({ result }: { result: CheckResult }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={STATE_VARIANT[result.state]}>
        <StateIcon state={result.state} />
        {result.state}
      </Badge>
      <span className="text-muted-foreground text-xs">{result.message}</span>
      {result.detail ? (
        <span className="text-muted-foreground/70 text-[11px]">
          {result.detail}
        </span>
      ) : null}
    </div>
  )
}

export function PendingBadge() {
  return (
    <Badge variant="secondary">
      <Loader2 className="size-3.5 animate-spin" />
      checking
    </Badge>
  )
}
