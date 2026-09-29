import { cn } from '@/lib/utils'
import type { Status } from '@/lib/types'

export type AnyStatus = Status | 'unknown'

/** Status is never conveyed by colour alone: each level has its own shape and a text label. */
export function StatusGlyph({ status, className }: { status: AnyStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0',
        status === 'ok' && 'rounded-full bg-success',
        status === 'warn' && 'bg-warning [clip-path:polygon(50%_0,100%_100%,0_100%)]',
        status === 'down' && 'rounded-[2px] bg-destructive',
        status === 'unknown' && 'rounded-full border border-dashed border-muted-foreground',
        className,
      )}
    />
  )
}

const LABEL: Record<AnyStatus, string> = { ok: 'OK', warn: 'Warning', down: 'Down', unknown: 'Unknown' }

export function StatusPill({ status, label, className }: { status: AnyStatus; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      <StatusGlyph status={status} />
      {label ?? LABEL[status]}
    </span>
  )
}
