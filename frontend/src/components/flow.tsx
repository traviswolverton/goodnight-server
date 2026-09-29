import type { ReactNode } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One small picture-and-a-few-words panel of a "how it works" guide. The
 *  picture is decorative; `summary` says the same thing for a screen reader. */
export function FlowPanel({ n, title, summary, caption, children }: { n: number; title: string; summary: string; caption?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-lg border bg-muted/30 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-5 place-items-center rounded-full bg-accent text-xs text-accent-foreground" aria-hidden="true">
          {n}
        </span>
        {title}
      </h3>
      <p className="sr-only">{summary}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3" aria-hidden="true">
        {children}
      </div>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </section>
  )
}

/** A labelled icon tile. */
export function FlowNode({ icon: Icon, label, accent = false }: { icon: LucideIcon; label: string; accent?: boolean }) {
  return (
    <div className="grid w-[4.5rem] justify-items-center gap-1.5 text-center">
      <span className={cn('grid size-12 place-items-center rounded-xl border bg-card', accent && 'border-primary/40 bg-accent text-accent-foreground')}>
        <Icon className="size-6" />
      </span>
      <span className="text-xs leading-tight font-medium">{label}</span>
    </div>
  )
}

/** Points right; `downOnPhone` turns it to point down where the panel stacks. */
export function FlowArrow({ label, downOnPhone = false }: { label?: string; downOnPhone?: boolean }) {
  return (
    <div className={cn('grid justify-items-center gap-0.5 text-muted-foreground', downOnPhone && 'max-sm:ml-6 max-sm:flex max-sm:items-center max-sm:gap-1.5')}>
      {label && <span className="text-[10px] leading-none tracking-wide uppercase">{label}</span>}
      <ArrowRight className={cn('size-5', downOnPhone && 'max-sm:rotate-90')} />
    </div>
  )
}

/** A small pill with an icon: one kind of reading, one sound. */
export function FlowChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </span>
  )
}

/** The device's eight buttons, one of them pressed. */
export function ButtonsGraphic({ label }: { label: string }) {
  return (
    <div className="grid w-[4.5rem] justify-items-center gap-1.5 text-center">
      <span className="grid size-12 grid-cols-4 content-center gap-1 rounded-xl border bg-card p-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={cn('aspect-square rounded-[3px]', i === 1 ? 'bg-primary' : 'bg-muted-foreground/25')} />
        ))}
      </span>
      <span className="text-xs leading-tight font-medium">{label}</span>
    </div>
  )
}
