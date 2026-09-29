import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** A card with an icon tile and a one-line purpose in its header, and
 *  optionally something (a status, a button) at its right. */
export function SectionCard({
  icon: Icon,
  title,
  description,
  aside,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-4 sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 flex-1 basis-48 gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {aside}
      </CardHeader>
      {children}
    </Card>
  )
}
