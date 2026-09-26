import { useMemo, useState } from 'react'
import { ChevronRight, Copy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { StatusGlyph, type AnyStatus } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Context } from '@/lib/types'
import { cn } from '@/lib/utils'
import { flattenSegments, matchesFilter, templatePath } from '@/lib/vars'

type Node = Record<string, unknown>
const isBranch = (value: unknown): value is Node => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A value as a short line of text; React escapes it (some values, like
 *  client hostnames, are chosen by any device on the LAN). */
function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** Every value templates can use, live, grouped by adapter. With `onInsert`,
 *  each value's + puts `{{ path }}` into the field that opened the panel and
 *  the panel stays open for more; without it (read-only), + copies instead.
 *  Not modal: the field stays visible and usable beside it. */
export function VariablesPanel({
  open,
  onOpenChange,
  context,
  target,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: Context
  /** What an insert goes into, e.g. "line 2" — for the heading. */
  target?: string
  onInsert?: (path: string) => void
}) {
  const [term, setTerm] = useState('')
  const adapters = useMemo(() => (isBranch(context.adapters) ? context.adapters : {}) as Node, [context])
  const matches = useMemo(
    () => (term.trim() ? flattenSegments({ adapters }).filter(([segments]) => matchesFilter(templatePath(segments), term)) : []),
    [adapters, term],
  )

  function use(segments: string[]) {
    const path = templatePath(segments)
    if (onInsert) {
      onInsert(path)
      return
    }
    void navigator.clipboard?.writeText(`{{ ${path} }}`).then(
      () => toast.success(`Copied {{ ${path} }}`),
      () => toast.error('Couldn’t copy — select the path instead.'),
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        // Clicking back into the field must not close it: that's the point.
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b">
          <SheetTitle>Variables{target ? ` for ${target}` : ''}</SheetTitle>
          <SheetDescription>
            {onInsert ? 'Live values. + inserts one where your cursor was.' : 'Live values. + copies one as {{ … }}.'}
          </SheetDescription>
          <Input
            type="search"
            aria-label="Filter variables"
            placeholder="Filter — e.g. adg (prefix) or *volume* (contains)"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {Object.keys(adapters).length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No adapters have completed a poll yet.</p>
          ) : term.trim() ? (
            matches.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">No variables match “{term}”.</p>
            ) : (
              <ul aria-label="Matching variables">
                {matches.map(([segments, value]) => (
                  <Leaf
                    key={segments.join('\u0000')}
                    label={templatePath(segments.slice(1))}
                    name={templatePath(segments)}
                    value={value}
                    onUse={() => use(segments)}
                    copy={!onInsert}
                  />
                ))}
              </ul>
            )
          ) : (
            <ul aria-label="Adapters">
              {Object.entries(adapters).map(([name, fields]) => (
                <Branch
                  key={name}
                  label={name}
                  node={isBranch(fields) ? fields : {}}
                  path={['adapters', name]}
                  depth={0}
                  status={isBranch(fields) ? (fields.status as AnyStatus | undefined) : undefined}
                  onUse={use}
                  copy={!onInsert}
                />
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Branch({
  label,
  node,
  path,
  depth,
  status,
  onUse,
  copy,
}: {
  label: string
  node: Node
  path: string[]
  depth: number
  status?: AnyStatus
  onUse: (segments: string[]) => void
  copy: boolean
}) {
  const [open, setOpen] = useState(false)
  const count = Object.keys(node).length
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          depth === 0 ? 'text-sm font-medium' : 'font-mono text-xs',
        )}
      >
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
        {status && <StatusGlyph status={status} />}
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{count}</span>
      </button>
      {open && (
        <ul className="ml-3 border-l pl-1">
          {Object.entries(node).map(([key, value]) =>
            isBranch(value) ? (
              <Branch key={key} label={key} node={value} path={[...path, key]} depth={depth + 1} onUse={onUse} copy={copy} />
            ) : (
              <Leaf key={key} label={key} name={templatePath([...path, key])} value={value} onUse={() => onUse([...path, key])} copy={copy} />
            ),
          )}
        </ul>
      )}
    </li>
  )
}

function Leaf({ label, name, value, onUse, copy }: { label: string; name: string; value: unknown; onUse: () => void; copy: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-md py-0.5 pr-1 pl-7 hover:bg-muted/60">
      <code className="min-w-0 shrink-0 truncate text-xs" title={label}>
        {label}
      </code>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground" title={JSON.stringify(value)}>
        {preview(value)}
      </span>
      <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`${copy ? 'Copy' : 'Insert'} ${name}`} onClick={onUse}>
        {copy ? <Copy aria-hidden="true" /> : <Plus aria-hidden="true" />}
      </Button>
    </li>
  )
}
