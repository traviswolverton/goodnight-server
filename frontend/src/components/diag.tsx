import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A result box for Preview output. Content is React text, never parsed as HTML.
 *  `aside` sits at the right, e.g. a length count. */
export function Diag({ kind, aside, children }: { kind: 'ok' | 'warn' | 'blank' | 'error'; aside?: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mb-2 rounded-md border-l-[3px] px-3 py-2 font-mono text-xs',
        aside ? 'flex items-baseline justify-between gap-3' : 'whitespace-pre-wrap',
        kind === 'ok' && 'border-success bg-success/10',
        kind === 'warn' && 'border-warning bg-warning/10',
        kind === 'blank' && 'border-muted-foreground bg-muted text-muted-foreground',
        kind === 'error' && 'border-destructive bg-destructive/10',
      )}
    >
      {aside ? (
        <>
          <span className="min-w-0 break-all whitespace-pre-wrap">{children}</span>
          <span className="shrink-0">{aside}</span>
        </>
      ) : (
        children
      )}
    </div>
  )
}
