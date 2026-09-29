import { useId, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Braces, ListChecks, Loader2, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Diag } from '@/components/diag'
import { EntityPicker } from '@/components/entity-picker'
import { PageHeader } from '@/components/page-header'
import { EmptyState, LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { VariablesPanel } from '@/components/variables-panel'
import { useCanEdit } from '@/hooks/use-can-edit'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { errorMessage, toastError } from '@/lib/mutations'
import { describeAction, slugify } from '@/lib/actions'
import { actionsQuery } from '@/lib/queries'
import { insertText } from '@/lib/vars'
import type { ActionConfig, ActionInfo, ActionKind, ActionOutcome, ActionsResponse, AdapterCatalog, PreviewActionStateResponse } from '@/lib/types'

const KIND_LABELS: Record<ActionKind, string> = {
  service: 'Call a service',
  script: 'Run a script',
  event: 'Fire an event',
}

export function ActionsPage() {
  usePageTitle('Actions')
  const canEdit = useCanEdit()
  const queryClient = useQueryClient()
  const { data, error, isPending, refetch } = useQuery(actionsQuery)
  const [editing, setEditing] = useState<ActionConfig | 'new' | null>(null)
  const [removing, setRemoving] = useState<ActionInfo | null>(null)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: actionsQuery.queryKey })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/actions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Removed — gone from the display on the next poll.')
      refresh()
    },
    onError: (e) => toastError(e, 'Remove failed'),
  })

  return (
    <>
      <PageHeader
        title="Actions"
        description="What the display's Actions menu can do: turn the knob to pick one, press to run it. This server does the work — the display only sends which one."
      />
      {!canEdit && <ReadOnlyNote />}
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          {data.adapters.length === 0 && (
            <EmptyState title="Nothing can run actions yet">
              Actions are run by a Home Assistant adapter. {canEdit ? <Link to="/adapters" className="underline">Add one on the Adapters page</Link> : 'An administrator can add one on the Adapters page'}, then restart.
            </EmptyState>
          )}
          <Card>
            <CardHeader>
              <CardTitle>On the display</CardTitle>
              <CardDescription>
                In menu order, {data.actions.length} of {data.limits.max_actions}. The state beside each label is live.
              </CardDescription>
              {canEdit && data.adapters.length > 0 && (
                <CardAction>
                  <Button size="sm" onClick={() => setEditing('new')} disabled={data.actions.length >= data.limits.max_actions}>
                    <Plus aria-hidden="true" /> Add action
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {data.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No actions yet — the display&rsquo;s Actions menu says so too.</p>
              ) : (
                <ul className="divide-y" aria-label="Actions">
                  {data.actions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      canEdit={canEdit}
                      onEdit={() => setEditing(action)}
                      onRemove={() => setRemoving(action)}
                      onRan={refresh}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {editing && (
            <ActionEditor
              key={editing === 'new' ? 'new' : editing.id}
              original={editing === 'new' ? null : editing}
              data={data}
              onDone={() => {
                setEditing(null)
                refresh()
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove “${removing?.label}”?`}
        destructive
        confirmLabel="Remove action"
        description="It disappears from the display's Actions menu on the next poll."
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
          setRemoving(null)
        }}
      />
    </>
  )
}

function ActionRow({
  action,
  canEdit,
  onEdit,
  onRemove,
  onRan,
}: {
  action: ActionInfo
  canEdit: boolean
  onEdit: () => void
  onRemove: () => void
  onRan: () => void
}) {
  const run = useMutation({
    mutationFn: () => api<ActionOutcome>(`/api/actions/${encodeURIComponent(action.id)}/run`, { method: 'POST' }),
    onSuccess: (outcome) => {
      if (outcome.ok) toast.success(`${action.label}: ${outcome.text}`)
      else toast.error(`${action.label}: ${outcome.text}`)
      // The server polls again a second after a run; catch the new state.
      window.setTimeout(onRan, 1500)
    },
    onError: (e) => toastError(e, 'Run failed'),
  })

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="font-medium">{action.label}</span>
          {action.resolved_state && <span className="font-mono text-sm text-muted-foreground">{action.resolved_state}</span>}
          {action.confirm && <span className="text-xs text-muted-foreground">asks to confirm</span>}
          {action.verify && <span className="text-xs text-muted-foreground">checks for {action.verify.state}</span>}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {action.adapter}: {describeAction(action)}
        </span>
        {action.state_error && <span className="text-xs text-destructive">State template error: {action.state_error}</span>}
      </div>
      {canEdit && (
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending} aria-label={`Run ${action.label} now`}>
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />} Run
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${action.label}`}>
            <Pencil aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRemove} aria-label={`Remove ${action.label}`}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      )}
    </li>
  )
}

/** Offered as suggestions for a check's state; any state is allowed. */
const COMMON_STATES = ['closed', 'open', 'on', 'off', 'locked', 'unlocked', 'home', 'not_home']

function splitEntities(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter(Boolean)
}

export function ActionEditor({
  original,
  data,
  onDone,
  onCancel,
}: {
  original: ActionConfig | null
  data: ActionsResponse
  onDone: () => void
  onCancel: () => void
}) {
  const prefix = useId()
  const [label, setLabel] = useState(original?.label ?? '')
  const [id, setId] = useState(original?.id ?? '')
  const [idTouched, setIdTouched] = useState(original !== null)
  const [adapter, setAdapter] = useState(original?.adapter ?? data.adapters[0]?.name ?? '')
  const [kind, setKind] = useState<ActionKind>(original?.kind ?? 'service')
  const [service, setService] = useState(original?.service ?? '')
  const [target, setTarget] = useState(original?.target ?? '')
  const [dataText, setDataText] = useState(original && Object.keys(original.data).length ? JSON.stringify(original.data, null, 2) : '')
  const [confirm, setConfirm] = useState(original?.confirm ?? false)
  const [stateTemplate, setStateTemplate] = useState(original?.state_template ?? '')
  const [verifyOn, setVerifyOn] = useState(!!original?.verify)
  const [verifyEntities, setVerifyEntities] = useState(original?.verify?.entities.join(', ') ?? '')
  const [verifyState, setVerifyState] = useState(original?.verify?.state ?? '')
  const [verifyTimeout, setVerifyTimeout] = useState(String(original?.verify?.timeout ?? 30))
  const [picking, setPicking] = useState(false)
  const [pickingVerify, setPickingVerify] = useState(false)
  const [statePreview, setStatePreview] = useState<PreviewActionStateResponse | null>(null)
  const [varsOpen, setVarsOpen] = useState(false)
  const stateInput = useRef<HTMLInputElement | null>(null)

  function insertVariable(path: string) {
    const input = stateInput.current
    const start = input?.selectionStart ?? stateTemplate.length
    const next = insertText(stateTemplate, start, input?.selectionEnd ?? start, `{{ ${path} }}`)
    setStateTemplate(next.value)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(next.caret, next.caret)
    })
  }

  const adapterInfo = data.adapters.find((a) => a.name === adapter)
  const kinds = adapterInfo?.kinds ?? ['service', 'script', 'event']
  const catalog = useQuery({
    queryKey: ['catalog', 'running', adapter],
    queryFn: () => api<AdapterCatalog>(`/api/adapters/${encodeURIComponent(adapter)}/catalog`),
    enabled: !!adapter,
    staleTime: 60_000,
    retry: false,
  })
  const targetDomain = kind === 'script' ? 'script' : service.split('.')[0]

  const save = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {}
      if (dataText.trim()) {
        try {
          parsed = JSON.parse(dataText)
        } catch {
          throw new Error('Extra data must be a JSON object, e.g. {"brightness_pct": 40}')
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Extra data must be a JSON object')
      }
      const body: ActionConfig = {
        id: id.trim(),
        label: label.trim(),
        adapter,
        kind,
        service: kind === 'service' ? service.trim() || null : null,
        target: kind === 'event' ? null : target.trim() || null,
        data: parsed,
        confirm,
        state_template: stateTemplate.trim() || null,
        verify: verifyOn
          ? { entities: splitEntities(verifyEntities), state: verifyState.trim(), timeout: Number(verifyTimeout) }
          : null,
      }
      return original
        ? api(`/api/actions/${encodeURIComponent(original.id)}`, { method: 'PUT', body })
        : api('/api/actions', { method: 'POST', body })
    },
    onSuccess: () => {
      toast.success('Saved — on the display from the next poll.')
      onDone()
    },
    onError: (e) => toastError(e, 'Save failed'),
  })

  const preview = useMutation({
    mutationFn: () => api<PreviewActionStateResponse>('/api/preview-action-state', { method: 'POST', body: { state_template: stateTemplate } }),
    onSuccess: setStatePreview,
    onError: (e) => setStatePreview({ rendered: null, state: null, error: errorMessage(e) }),
  })

  function fillTargetState() {
    if (!target || !adapter) return
    setStateTemplate(`{{ adapters.${adapter}.entities['${target}'].state }}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{original ? `Edit “${original.label}”` : 'New action'}</CardTitle>
        <CardDescription>Saved to config/actions.yaml. Takes effect on the next poll, no restart.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-label`}>Label</Label>
              <Input
                id={`${prefix}-label`}
                required
                maxLength={data.limits.label_max}
                value={label}
                placeholder="Desk lamp"
                onChange={(e) => {
                  setLabel(e.target.value)
                  if (!idTouched) setId(slugify(e.target.value))
                }}
              />
              <p className="text-xs text-muted-foreground">
                As the display shows it — {label.length} / {data.limits.label_max}.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-id`}>Id</Label>
              <Input
                id={`${prefix}-id`}
                required
                className="font-mono"
                maxLength={23}
                pattern="[a-z][a-z0-9_]*"
                value={id}
                onChange={(e) => {
                  setIdTouched(true)
                  setId(e.target.value)
                }}
              />
              <p className="text-xs text-muted-foreground">What the display sends. Lowercase letters, digits and underscores.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-adapter`}>Adapter</Label>
              <Select value={adapter} onValueChange={setAdapter}>
                <SelectTrigger id={`${prefix}-adapter`} className="w-full">
                  <SelectValue placeholder="Choose an adapter" />
                </SelectTrigger>
                <SelectContent>
                  {data.adapters.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      {a.name} <span className="text-xs text-muted-foreground">({a.type})</span>
                    </SelectItem>
                  ))}
                  {original && !adapterInfo && <SelectItem value={original.adapter}>{original.adapter} (not running)</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-kind`}>What it does</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ActionKind)}>
                <SelectTrigger id={`${prefix}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === 'service' && (
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-service`}>Service</Label>
              <Input
                id={`${prefix}-service`}
                required
                className="font-mono"
                list={`${prefix}-services`}
                value={service}
                placeholder="light.toggle"
                onChange={(e) => setService(e.target.value)}
              />
              <datalist id={`${prefix}-services`}>
                {(catalog.data?.services ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              {catalog.error && <p className="text-xs text-destructive">Couldn&rsquo;t load the service list: {errorMessage(catalog.error)}</p>}
            </div>
          )}

          {kind !== 'event' && (
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-target`}>{kind === 'script' ? 'Script' : 'Target entity (optional for some services)'}</Label>
              <div className="flex gap-2">
                <Input
                  id={`${prefix}-target`}
                  required={kind === 'script'}
                  className="font-mono"
                  value={target}
                  placeholder={kind === 'script' ? 'script.movie_mode' : 'light.desk'}
                  onChange={(e) => setTarget(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => setPicking(true)} disabled={!adapter}>
                  <ListChecks aria-hidden="true" /> Choose…
                </Button>
              </div>
              {picking && (
                <EntityPicker
                  open
                  onOpenChange={(open) => !open && setPicking(false)}
                  title={kind === 'script' ? 'Choose a script' : 'Choose the target entity'}
                  description={targetDomain ? `Filtered to ${targetDomain}.* to start with — clear the filter to see everything.` : 'Every entity Home Assistant has.'}
                  queryKey={['running', adapter]}
                  load={() => api<AdapterCatalog>(`/api/adapters/${encodeURIComponent(adapter)}/catalog`)}
                  onPick={([picked]) => setTarget(picked)}
                  initialFilter={targetDomain ? `${targetDomain}.` : ''}
                />
              )}
            </div>
          )}

          {kind === 'event' && (
            <Diag kind="blank">
              {`Fires desk_dashboard_action. Trigger a Home Assistant automation with:\n\ntriggers:\n  - trigger: event\n    event_type: desk_dashboard_action\n    event_data:\n      action: ${id || '<id>'}`}
            </Diag>
          )}

          <div className="grid gap-2">
            <Label htmlFor={`${prefix}-data`}>
              {kind === 'script' ? 'Script variables' : kind === 'event' ? 'Extra event data' : 'Extra service data'} (optional, JSON)
            </Label>
            <Textarea
              id={`${prefix}-data`}
              className="font-mono text-sm"
              rows={3}
              value={dataText}
              placeholder={kind === 'service' ? '{"brightness_pct": 40}' : '{}'}
              onChange={(e) => setDataText(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch id={`${prefix}-confirm`} checked={confirm} onCheckedChange={setConfirm} />
            <Label htmlFor={`${prefix}-confirm`}>Ask for a second press first — for locks, doors, anything you don&rsquo;t want to trigger by accident</Label>
          </div>

          <section className="grid gap-3" aria-labelledby={`${prefix}-verify-heading`}>
            <div className="flex items-center gap-3">
              <Switch id={`${prefix}-verify`} checked={verifyOn} onCheckedChange={setVerifyOn} aria-describedby={`${prefix}-verify-help`} />
              <Label htmlFor={`${prefix}-verify`} id={`${prefix}-verify-heading`}>
                Check that it really happened
              </Label>
            </div>
            <p id={`${prefix}-verify-help`} className="text-sm text-muted-foreground">
              Otherwise &ldquo;done&rdquo; only means Home Assistant accepted the request. With a check, it waits for the entities to
              reach the state, and fails (the loud beep on the device) if they don&rsquo;t in time. If they&rsquo;re already there,
              nothing is sent.
            </p>
            {verifyOn && (
              <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-verify-entities`}>Entities</Label>
                  <div className="flex gap-2">
                    <Input
                      id={`${prefix}-verify-entities`}
                      required
                      className="min-w-0 font-mono text-sm"
                      value={verifyEntities}
                      placeholder="cover.garage_left, cover.garage_right"
                      onChange={(e) => setVerifyEntities(e.target.value)}
                    />
                    <Button type="button" variant="outline" onClick={() => setPickingVerify(true)} disabled={!adapter} aria-label="Choose entities to check">
                      <ListChecks aria-hidden="true" />
                    </Button>
                  </div>
                  {target && kind !== 'event' && verifyEntities.trim() === '' && (
                    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setVerifyEntities(target)}>
                      Use the target
                    </Button>
                  )}
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${prefix}-verify-state`}>Must become</Label>
                  <Input
                    id={`${prefix}-verify-state`}
                    required
                    className="font-mono text-sm"
                    list={`${prefix}-verify-states`}
                    value={verifyState}
                    placeholder="closed"
                    onChange={(e) => setVerifyState(e.target.value)}
                  />
                  <datalist id={`${prefix}-verify-states`}>
                    {COMMON_STATES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${prefix}-verify-timeout`}>Within (seconds)</Label>
                  <Input
                    id={`${prefix}-verify-timeout`}
                    required
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={300}
                    value={verifyTimeout}
                    onChange={(e) => setVerifyTimeout(e.target.value)}
                  />
                </div>
              </div>
            )}
            {pickingVerify && (
              <EntityPicker
                open
                multiple
                selected={splitEntities(verifyEntities)}
                onOpenChange={(open) => !open && setPickingVerify(false)}
                title="Choose the entities to check"
                description="Every one must reach the state for the action to count as done."
                queryKey={['running', adapter]}
                load={() => api<AdapterCatalog>(`/api/adapters/${encodeURIComponent(adapter)}/catalog`)}
                onPick={(ids) => setVerifyEntities(ids.join(', '))}
                initialFilter={targetDomain ? `${targetDomain}.` : ''}
              />
            )}
          </section>

          <section className="grid gap-2" aria-labelledby={`${prefix}-state-heading`}>
            <div>
              <h3 id={`${prefix}-state-heading`} className="text-sm font-medium">
                State beside the label (optional)
              </h3>
              <p className="text-sm text-muted-foreground">
                Jinja2, like a card line, cut to {data.limits.state_max} characters. E.g. whether the light is on right now.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Label htmlFor={`${prefix}-state`} className="sr-only">
                State template
              </Label>
              <Input
                ref={stateInput}
                id={`${prefix}-state`}
                className="min-w-0 flex-1 font-mono text-sm"
                value={stateTemplate}
                placeholder="{{ adapters.home_assistant.entities['light.desk'].state }}"
                onChange={(e) => setStateTemplate(e.target.value)}
              />
              {target && kind !== 'event' && (
                <Button type="button" variant="ghost" size="sm" onClick={fillTargetState}>
                  Use the target&rsquo;s state
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" aria-label="Insert a variable in the state" onClick={() => setVarsOpen(true)}>
                <Braces aria-hidden="true" /> Variables
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => preview.mutate()} disabled={!stateTemplate.trim() || preview.isPending}>
                Preview
              </Button>
            </div>
            <div aria-live="polite">
              {statePreview &&
                (statePreview.error ? (
                  <Diag kind="error">{statePreview.error}</Diag>
                ) : statePreview.state ? (
                  <Diag kind="ok" aside={`${new TextEncoder().encode(statePreview.state).length} / ${data.limits.state_max}`}>
                    {statePreview.state}
                  </Diag>
                ) : (
                  <Diag kind="blank">Renders empty — no state shown.</Diag>
                ))}
            </div>
            <VariablesPanel open={varsOpen} onOpenChange={setVarsOpen} context={data.context} target="the state" onInsert={insertVariable} />
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending || !adapter}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
