import { useId, useState, type ReactNode } from 'react'
import { BookOpen, type LucideIcon } from 'lucide-react'
import { ChevronToggle, Collapse } from '@/components/disclosure'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** A card at the top of a page that explains it, and opens and closes.
 *  Pages open it for a first visit and leave it closed after that. */
export function GuideCard({
  title,
  description,
  icon: Icon = BookOpen,
  defaultOpen,
  children,
}: {
  title: string
  description: string
  icon?: LucideIcon
  defaultOpen: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panel = useId()
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 flex-1 gap-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <ChevronToggle open={open} onToggle={() => setOpen((v) => !v)} controls={panel} label={`Details: ${title}`} />
      </CardHeader>
      <Collapse open={open} id={panel}>
        <CardContent className="grid gap-6 border-t px-4 py-5 sm:px-6">{children}</CardContent>
      </Collapse>
    </Card>
  )
}

export function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

/** A term with a small icon and its explanation, for a `dl` (the term and
 *  description are the wrapper's direct children, as a definition list needs). */
export function GuideTerm({ icon: Icon, name, children }: { icon: LucideIcon; name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      <dt className="col-span-2 flex items-center gap-3 font-medium">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
          <Icon className="size-4" />
        </span>
        {name}
      </dt>
      <dd className="col-start-2 text-muted-foreground">{children}</dd>
    </div>
  )
}
