import type { ReactNode } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A region that slides open. Closed, it's `inert` (out of the tab order and
 *  the accessibility tree's reach) but still in the DOM, so an input can keep
 *  pointing `aria-describedby` at text inside it. */
export function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <div
      id={id}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden" inert={!open}>
        {children}
      </div>
    </div>
  )
}

/** The chevron that opens a row's details. */
export function ChevronToggle({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  return (
    <Button variant="ghost" size="icon" className="size-8" aria-expanded={open} aria-controls={controls} aria-label={label} onClick={onToggle}>
      <ChevronDown className={cn('transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
    </Button>
  )
}

/** A small (i) beside a label that shows or hides its explanation. */
export function InfoToggle({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls: string; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'grid size-6 place-items-center rounded-full text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        open && 'bg-accent text-accent-foreground',
      )}
    >
      <Info className="size-4" aria-hidden="true" />
    </button>
  )
}
