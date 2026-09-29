import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { HomeAssistantCatalog } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The most rows drawn at once; a filter narrows a big install down. */
const MAX_SHOWN = 200

/** Choose entities from Home Assistant's entity list.
 *  `multiple`: toggle any number, applied with Done. Otherwise one click picks. */
export function EntityPicker({
  open,
  onOpenChange,
  title,
  description,
  queryKey,
  load,
  multiple = false,
  selected = [],
  initialFilter = '',
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Identifies what `load` fetches, for caching while the dialog reopens. */
  queryKey: readonly unknown[]
  load: () => Promise<HomeAssistantCatalog>
  multiple?: boolean
  selected?: string[]
  /** Starting filter text, e.g. "light." for a light service. */
  initialFilter?: string
  onPick: (ids: string[]) => void
}) {
  const [filter, setFilter] = useState(initialFilter)
  const [picked, setPicked] = useState<string[]>(selected)
  const catalog = useQuery({ queryKey: ['catalog', ...queryKey], queryFn: load, enabled: open, staleTime: 60_000, retry: false })

  const needle = filter.trim().toLowerCase()
  const matches = (catalog.data?.entities ?? []).filter(
    (e) => !needle || e.id.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle),
  )
  const shown = matches.slice(0, MAX_SHOWN)

  function close() {
    setFilter('')
    onOpenChange(false)
  }

  function choose(id: string) {
    if (!multiple) {
      onPick([id])
      close()
      return
    }
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPicked(selected)
        else setFilter('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input aria-label="Filter entities" placeholder="Filter — e.g. light., office, temperature" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {catalog.isPending ? (
          <LoadingBlocks rows={2} />
        ) : catalog.error ? (
          <LoadError error={catalog.error} retry={() => void catalog.refetch()} />
        ) : (
          <>
            <ul className="grid max-h-[50svh] gap-0.5 overflow-y-auto" aria-label="Entities" aria-multiselectable={multiple || undefined}>
              {shown.map((entity) => {
                const on = picked.includes(entity.id)
                return (
                  <li key={entity.id}>
                    <button
                      type="button"
                      aria-pressed={multiple ? on : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        on && 'bg-accent',
                      )}
                      onClick={() => choose(entity.id)}
                    >
                      {multiple && (
                        <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on && 'border-primary bg-primary text-primary-foreground')}>
                          {on && <Check className="size-3" aria-hidden="true" />}
                        </span>
                      )}
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate">{entity.name}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{entity.id}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{entity.state}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {matches.length === 0 && <p className="text-sm text-muted-foreground">No entity matches “{filter}”.</p>}
            {matches.length > MAX_SHOWN && (
              <p className="text-xs text-muted-foreground">
                Showing {MAX_SHOWN} of {matches.length} — filter to narrow it down.
              </p>
            )}
          </>
        )}
        {multiple && (
          <DialogFooter>
            <span className="mr-auto self-center text-sm text-muted-foreground">{picked.length} selected</span>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onPick(picked)
                close()
              }}
            >
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
