import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { EmptyState, LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCanEdit } from '@/hooks/use-can-edit'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { toastError } from '@/lib/mutations'
import { deviceQuery } from '@/lib/queries'
import type { ButtonBinding, DeviceAction, DeviceResponse, PressKind } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The buttons as they sit on the device: two rows of four, 1–4 on top. */
const COLUMNS = 4

/** A tile lights up for this long after its button is pressed. */
const PRESSED_SECONDS = 10

/** Radix Select can't hold an empty value, so "nothing bound" is this. */
const UNBOUND = '__none__'

const PRESS_LABEL: Record<PressKind, string> = { short: 'Short press', long: 'Long press' }

export function ButtonsPage() {
  usePageTitle('Buttons')
  const canEdit = useCanEdit()
  // Faster than the Device page, so pressing a button to find its tile
  // shows up quickly.
  const { data, error, isPending, refetch } = useQuery({ ...deviceQuery, refetchInterval: 2_000 })
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <>
      <PageHeader
        title="Buttons"
        description="What each of the device's buttons does, laid out as they are on the device. A press is short if released within 0.6 s; hold it longer for a long press (the device clicks when you can let go)."
      />
      {!canEdit && <ReadOnlyNote />}
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          {data.actions.length === 0 && (
            <EmptyState title="No actions to assign yet">
              A button runs an action.{' '}
              {canEdit ? (
                <Link to="/actions" className="underline">
                  Add some on the Actions page
                </Link>
              ) : (
                'An administrator can add some on the Actions page'
              )}
              .
            </EmptyState>
          )}
          <ButtonGrid data={data} canEdit={canEdit} onEdit={setEditing} />
          <p className="text-sm text-muted-foreground">
            Not sure which is which? Press a button on the device and its tile lights up here. Actions that ask to confirm need
            the same press again within {data.confirm_seconds} s.
          </p>
          {editing !== null && <BindingDialog data={data} button={editing} onClose={() => setEditing(null)} />}
        </div>
      )}
    </>
  )
}

export function ButtonGrid({ data, canEdit, onEdit }: { data: DeviceResponse; canEdit: boolean; onEdit: (button: number) => void }) {
  const now = useNow(1000)
  const labels = Object.fromEntries(data.actions.map((a) => [a.id, a]))
  const numbers = Array.from({ length: data.num_buttons }, (_, i) => i + 1)
  return (
    <ul className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }} aria-label="Buttons">
      {numbers.map((n) => {
        const binding = data.config.buttons[String(n)] ?? {}
        const lastPress = data.presses.find((p) => p.button === n)
        const pressed = lastPress !== undefined && now - lastPress.at < PRESSED_SECONDS
        const describe = (press: PressKind) => labels[binding[press] ?? '']?.label ?? 'nothing'
        return (
          <li key={n}>
            <button
              type="button"
              onClick={() => onEdit(n)}
              disabled={!canEdit}
              aria-label={`Button ${n}: short press ${describe('short')}, long press ${describe('long')}${pressed ? ', just pressed' : ''}`}
              className={cn(
                'grid h-full w-full min-w-0 gap-1.5 rounded-lg border bg-card p-2 text-left transition-colors sm:p-3',
                canEdit && 'hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                pressed && 'border-primary ring-2 ring-primary',
              )}
            >
              <span className="flex items-baseline justify-between gap-1">
                <span className="text-lg font-semibold tabular-nums sm:text-xl">{n}</span>
                {pressed && <span className="truncate text-xs text-primary">{lastPress.press} press</span>}
              </span>
              <PressLine press="short" action={labels[binding.short ?? '']} />
              <PressLine press="long" action={labels[binding.long ?? '']} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PressLine({ press, action }: { press: PressKind; action: DeviceAction | undefined }) {
  return (
    <span className="grid min-w-0 text-xs sm:text-sm">
      <span className="text-muted-foreground">{press === 'short' ? 'Short' : 'Long'}</span>
      <span className={cn('truncate', !action && 'text-muted-foreground italic')}>{action ? action.label : 'nothing'}</span>
    </span>
  )
}

function actionNotes(action: DeviceAction | undefined): string | null {
  if (!action) return null
  const notes = [action.confirm && 'asks for a second press', action.verify && 'checks that it happened'].filter(Boolean)
  return notes.length ? `This one ${notes.join(' and ')}.` : null
}

export function BindingDialog({ data, button, onClose }: { data: DeviceResponse; button: number; onClose: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const [binding, setBinding] = useState<ButtonBinding>(() => ({ ...data.config.buttons[String(button)] }))
  const byId = Object.fromEntries(data.actions.map((a) => [a.id, a]))

  const save = useMutation({
    mutationFn: () => {
      const buttons = { ...data.config.buttons }
      if (binding.short || binding.long) buttons[String(button)] = { short: binding.short ?? null, long: binding.long ?? null }
      else delete buttons[String(button)]
      return api('/api/device/buttons', { method: 'PUT', body: { buttons } })
    },
    onSuccess: () => {
      toast.success(`Button ${button} saved.`)
      void queryClient.invalidateQueries({ queryKey: deviceQuery.queryKey })
      onClose()
    },
    onError: (e) => toastError(e, 'Save failed'),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Button {button}</DialogTitle>
          <DialogDescription>Choose what a short press and a long press run. Takes effect straight away.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          {(['short', 'long'] as const).map((press) => {
            const current = binding[press] ?? null
            const notes = actionNotes(current ? byId[current] : undefined)
            return (
              <div key={press} className="grid gap-1.5">
                <Label htmlFor={`${id}-${press}`}>{PRESS_LABEL[press]}</Label>
                <Select
                  value={current ?? UNBOUND}
                  onValueChange={(v) => setBinding((b) => ({ ...b, [press]: v === UNBOUND ? null : v }))}
                >
                  <SelectTrigger id={`${id}-${press}`} className="w-full" aria-describedby={notes ? `${id}-${press}-notes` : undefined}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNBOUND}>Nothing</SelectItem>
                    {data.actions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                    {current && !byId[current] && <SelectItem value={current}>{current} (no longer exists)</SelectItem>}
                  </SelectContent>
                </Select>
                {notes && (
                  <p id={`${id}-${press}-notes`} className="text-xs text-muted-foreground">
                    {notes}
                  </p>
                )}
              </div>
            )
          })}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
