import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckCheck, Loader2, Lock, Pencil, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AboutLink } from '@/components/about-link'
import { PageHeader } from '@/components/page-header'
import { EmptyState, LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCanEdit } from '@/hooks/use-can-edit'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { BUTTON_LIT_SECONDS } from '@/lib/actions'
import { DEVICE_OWN_BUTTON } from '@/lib/device'
import { toastError } from '@/lib/mutations'
import { deviceQuery } from '@/lib/queries'
import type { ButtonBinding, DeviceAction, DeviceResponse, PressKind } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Radix Select can't hold an empty value, so "nothing bound" is this. */
const UNBOUND = '__none__'

const PRESS_LABEL: Record<PressKind, string> = { short: 'Short press', long: 'Long press' }
const PRESS_HINT: Record<PressKind, string> = { short: 'Tap and let go.', long: 'Hold until the device clicks, about 0.6 seconds.' }

export function ButtonsPage() {
  usePageTitle('Buttons')
  const canEdit = useCanEdit()
  // Faster than the Device page, so pressing a button to find its tile
  // shows up quickly.
  const { data, error, isPending, refetch } = useQuery({ ...deviceQuery, refetchInterval: 2_000 })
  const [editing, setEditing] = useState<number | null>(null)

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Buttons"
        description="What each of the device's buttons does, for a short press and for a long press."
        actions={<AboutLink section="buttons" />}
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
          <ButtonList data={data} canEdit={canEdit} onEdit={setEditing} />
          {editing !== null && <BindingDialog data={data} button={editing} onClose={() => setEditing(null)} />}
        </div>
      )}
    </div>
  )
}

export function ButtonList({ data, canEdit, onEdit }: { data: DeviceResponse; canEdit: boolean; onEdit: (button: number) => void }) {
  const now = useNow(1000)
  const labels = Object.fromEntries(data.actions.map((a) => [a.id, a]))
  const numbers = Array.from({ length: data.num_buttons }, (_, i) => i + 1)
  return (
    <ul className="grid gap-3" aria-label="Buttons">
      {numbers.map((n) => {
        if (n === DEVICE_OWN_BUTTON) return <ReservedButton key={n} number={n} />
        const binding = data.config.buttons[String(n)] ?? {}
        const lastPress = data.presses.find((p) => p.button === n)
        const pressed = lastPress !== undefined && now - lastPress.at < BUTTON_LIT_SECONDS
        const describe = (press: PressKind) => labels[binding[press] ?? '']?.label ?? 'nothing'
        return (
          <li key={n}>
            <button
              type="button"
              onClick={() => onEdit(n)}
              disabled={!canEdit}
              aria-label={`Button ${n}: short press ${describe('short')}, long press ${describe('long')}${pressed ? ', just pressed' : ''}`}
              className={cn(
                'flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors',
                canEdit && 'hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                pressed && 'border-primary bg-accent/40 ring-2 ring-primary',
              )}
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-accent text-xl font-semibold text-accent-foreground tabular-nums">
                {n}
              </span>
              <span className="grid min-w-0 flex-1 gap-2">
                <PressLine press="short" action={labels[binding.short ?? '']} />
                <PressLine press="long" action={labels[binding.long ?? '']} />
              </span>
              {pressed && (
                <Badge className="shrink-0 self-start">{lastPress.press} press</Badge>
              )}
              {canEdit && !pressed && <Pencil className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Button 8 belongs to the device itself: the firmware never publishes it, so
 *  a binding here could never run. Shown, but not editable. */
function ReservedButton({ number }: { number: number }) {
  return (
    <li className="flex items-center gap-4 rounded-xl border border-dashed bg-muted/30 p-4 text-muted-foreground">
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-xl font-semibold tabular-nums" aria-hidden="true">
        {number}
      </span>
      <span className="grid gap-0.5 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <Lock className="size-3.5" aria-hidden="true" /> Button {number} is reserved for the device
        </span>
        <span>It never reaches the server, so it can’t be bound to an action.</span>
      </span>
    </li>
  )
}

function PressLine({ press, action }: { press: PressKind; action: DeviceAction | undefined }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="w-12 shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{press === 'short' ? 'Short' : 'Long'}</span>
      <span className={cn('min-w-0 font-medium', !action && 'font-normal text-muted-foreground italic')}>{action ? action.label : 'nothing'}</span>
      {action?.confirm && (
        <Badge variant="secondary">
          <ShieldCheck aria-hidden="true" /> Asks to confirm
        </Badge>
      )}
      {action?.verify && (
        <Badge variant="secondary">
          <CheckCheck aria-hidden="true" /> Checked
        </Badge>
      )}
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
                <p className="text-xs text-muted-foreground">{PRESS_HINT[press]}</p>
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
                {current && byId[current]?.confirm && (
                  <p className="text-xs text-muted-foreground">
                    Press the same button the same way again within {data.confirm_seconds} seconds to run it.
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
