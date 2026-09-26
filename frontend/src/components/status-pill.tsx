import { useRef, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

const LABEL: Record<AnyStatus, string> = { ok: 'OK', warn: 'Warning', down: 'Down', unknown: 'Not polled yet' }

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

const MEANING: Partial<Record<AnyStatus, string>> = {
  warn: 'Still working, but something needs a look.',
  down: 'This service couldn’t be read on the last poll.',
  unknown: 'Nothing has been polled from it since the app started.',
}

/** A StatusPill that explains itself: hover, focus or tap it for the reason.
 *  A popover rather than a tooltip, so it works on a phone too. Plain pill
 *  when there's nothing worth explaining (ok). */
export function ExplainedStatusPill({
  status,
  reason,
  subject,
  className,
}: {
  status: AnyStatus
  reason?: string | null
  /** What the status is about, for the button's accessible name. */
  subject: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  if (status === 'ok') return <StatusPill status={status} className={className} />

  const hoverOpen = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hoverClose = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn('rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)}
        aria-label={`${subject}: ${LABEL[status]} — why?`}
        onMouseEnter={hoverOpen}
        onMouseLeave={hoverClose}
        // Always open, never toggle: with a mouse, hovering has usually
        // opened it already, and a click would otherwise shut it again.
        // It closes on Escape, a click outside, or the mouse leaving.
        onClick={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
      >
        <StatusPill status={status} className="cursor-help" />
      </PopoverTrigger>
      <PopoverContent align="end" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
        <p className="flex items-center gap-2 font-medium">
          <StatusGlyph status={status} /> {LABEL[status]}
        </p>
        {reason && <p className="mt-1.5">{reason}</p>}
        {MEANING[status] && <p className="mt-1.5 text-xs text-muted-foreground">{MEANING[status]}</p>}
      </PopoverContent>
    </Popover>
  )
}
