import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Braces, Check, CheckCheck, ListChecks, Loader2, Pencil, Play, Plus, Radio, ScrollText, ShieldCheck, Trash2, TriangleAlert, Zap, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { AboutLink } from '@/components/about-link'
import { EXAMPLE_SCRIPT } from '@/components/action-guide'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Diag } from '@/components/diag'
import { Reveal } from '@/components/disclosure'
import { EntityPicker } from '@/components/entity-picker'
import { PageHeader } from '@/components/page-header'
import { EmptyState, LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { VariablesPanel } from '@/components/variables-panel'
import { useCanEdit } from '@/hooks/use-can-edit'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { errorMessage, toastError } from '@/lib/mutations'
import { describeAction, explainAction, slugify } from '@/lib/actions'
import { actionsQuery } from '@/lib/queries'
import { insertText } from '@/lib/vars'
import { cn } from '@/lib/utils'
import type { ActionConfig, ActionInfo, ActionKind, ActionOutcome, ActionsResponse, HomeAssistantCatalog, PreviewActionStateResponse } from '@/lib/types'

const KIND_INFO: Record<ActionKind, { label: string; icon: LucideIcon; blurb: string }> = {
  service: {
    label: 'Call a service',
    icon: Zap,
    blurb: 'One Home Assistant service, like light.toggle. The simplest choice when a button does one thing.',
  },
  script: {
    label: 'Run a script',
    icon: ScrollText,
    blurb: 'A script you’ve written in Home Assistant. The way to do several things at once, like closing the garage and turning off the lights.',
  },
  event: {
    label: 'Fire an event',
    icon: Radio,
    blurb: 'Sends an event for a Home Assistant automation to react to. The only kind that needs an automation.',
  },
}
const KINDS = Object.keys(KIND_INFO) as ActionKind[]

/** Home Assistant's entities and services, for the editor's pickers. */
const loadCatalog = () => api<HomeAssistantCatalog>('/api/home-assistant/catalog')

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
      toast.success('Removed.')
      refresh()
    },
    onError: (e) => toastError(e, 'Remove failed'),
  })

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Actions"
        description="Things a button on the device can make happen. This server does the work — the device only says which button was pressed."
        actions={<AboutLink section="actions" />}
      />
      {!canEdit && <ReadOnlyNote />}
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          {!data.home_assistant.set_up ? (
            <EmptyState title="Home Assistant isn’t set up yet">
              Actions run through Home Assistant.{' '}
              {canEdit ? (
                <Link to="/settings" className="underline">
                  Connect it on the Settings page
                </Link>
              ) : (
                'An administrator can connect it on the Settings page'
              )}
              .
            </EmptyState>
          ) : (
            data.home_assistant.problem && (
              <Alert>
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{data.home_assistant.problem}</AlertDescription>
              </Alert>
            )
          )}

          <Card>
            <CardHeader>
              <CardTitle>Your actions</CardTitle>
              <CardDescription>
                Bind them to buttons on the <Link to="/buttons" className="underline">Buttons page</Link>. The state beside each
                label is live.
              </CardDescription>
              {canEdit && data.home_assistant.set_up && (
                <CardAction>
                  <Button size="sm" onClick={() => setEditing('new')}>
                    <Plus aria-hidden="true" /> Add action
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {data.actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No actions yet.{' '}
                  {canEdit && data.home_assistant.set_up
                    ? 'Add one to start: a good first try is “Call a service” with light.toggle on a lamp.'
                    : ''}
                </p>
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
        description="A button still bound to it will fail (and beep) until you rebind it on the Buttons page."
        onConfirm={() => {
          if (removing) remove.mutate(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

export function ActionRow({
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
  const { icon: KindIcon, label: kindLabel } = KIND_INFO[action.kind]

  return (
    <li className="grid gap-3 py-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-medium">{action.label}</span>
          {action.resolved_state && <span className="font-mono text-sm text-muted-foreground">{action.resolved_state}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            <KindIcon aria-hidden="true" /> {kindLabel}
          </Badge>
          {action.confirm && (
            <Badge variant="secondary">
              <ShieldCheck aria-hidden="true" /> Asks to confirm
            </Badge>
          )}
          {action.verify && (
            <Badge variant="secondary">
              <CheckCheck aria-hidden="true" /> Checks for {action.verify.state}
            </Badge>
          )}
        </div>
        <span className="font-mono text-xs break-all text-muted-foreground">{describeAction(action)}</span>
        {action.state_error && <span className="text-xs text-destructive">State template error: {action.state_error}</span>}
      </div>
      <Reveal label="What happens when it’s pressed">
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground marker:font-medium">
          {explainAction(action).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Reveal>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending} aria-label={`Run ${action.label} now`}>
            {run.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />} Run
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${action.label}`}>
            <Pencil aria-hidden="true" /> Edit
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRemove} aria-label={`Remove ${action.label}`}>
            <Trash2 aria-hidden="true" /> Remove
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
  const [pickingState, setPickingState] = useState(false)
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

  const catalog = useQuery({ queryKey: ['catalog', 'home-assistant'], queryFn: loadCatalog, staleTime: 60_000, retry: false })
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
      toast.success('Saved.')
      onDone()
    },
    onError: (e) => toastError(e, 'Save failed'),
  })

  const preview = useMutation({
    mutationFn: () => api<PreviewActionStateResponse>('/api/preview-action-state', { method: 'POST', body: { state_template: stateTemplate } }),
    onSuccess: setStatePreview,
    onError: (e) => setStatePreview({ rendered: null, state: null, error: errorMessage(e), problem: null }),
  })

  function fillTargetState() {
    const first = splitEntities(target)[0]
    if (first) setStateTemplate(`{{ states['${first}'].state }}`)
  }

  // What a press would do with the form as it stands right now.
  const draft = {
    id: id.trim(),
    kind,
    service: service.trim() || null,
    target: target.trim() || null,
    confirm,
    verify: verifyOn ? { entities: splitEntities(verifyEntities), state: verifyState.trim(), timeout: Number(verifyTimeout) || 30 } : null,
  }

  const card = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // It opens below the list: bring it into view (not in every environment, e.g. tests).
    card.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <Card ref={card} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{original ? `Edit “${original.label}”` : 'New action'}</CardTitle>
        <CardDescription>Saved to config/actions.yaml. Takes effect straight away, no restart.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Step n={1} title="Name it" description="What the display shows, and the id it sends when the button is pressed.">
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
              <p className="text-xs text-muted-foreground">
                Filled in from the label. Lowercase letters, digits and underscores; it’s what the display sends, so you rarely need to
                change it.
              </p>
            </div>
          </Step>

          <Step n={2} title="What it does" description="Every action makes one call to Home Assistant. For several things at once, run a script.">
            <div role="radiogroup" aria-label="What it does" className="grid gap-2">
              {KINDS.map((k) => {
                const { icon: Icon, label: kindLabel, blurb } = KIND_INFO[k]
                return (
                  <label
                    key={k}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm transition-colors',
                      'hover:bg-accent/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      kind === k && 'border-primary bg-accent/40 ring-2 ring-primary/30',
                    )}
                  >
                    <input type="radio" className="sr-only" name={`${prefix}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="font-medium">{kindLabel}</span>
                      <span className="text-muted-foreground">{blurb}</span>
                    </span>
                    {kind === k && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden="true" />}
                  </label>
                )
              })}
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
                <p className="text-xs text-muted-foreground">
                  In the form <code>domain.service</code>. Start typing and Home Assistant’s own services are suggested. Prefer a
                  one-way service like <code>cover.close_cover</code> to a toggle if you’ll add a check.
                </p>
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
                    className="min-w-0 font-mono"
                    value={target}
                    placeholder={kind === 'script' ? 'script.goodnight' : 'light.desk'}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => setPicking(true)}>
                    <ListChecks aria-hidden="true" /> Choose…
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {kind === 'script'
                    ? 'A script.* entity from Home Assistant.'
                    : 'The thing the service acts on: a light, a lock, a cover. Several can be listed, separated by commas.'}
                </p>
                {picking && (
                  <EntityPicker
                    open
                    onOpenChange={(open) => !open && setPicking(false)}
                    title={kind === 'script' ? 'Choose a script' : 'Choose the target entity'}
                    description={targetDomain ? `Filtered to ${targetDomain}.* to start with — clear the filter to see everything.` : 'Every entity Home Assistant has.'}
                    queryKey={['home-assistant']}
                    load={loadCatalog}
                    onPick={([picked]) => setTarget(picked)}
                    initialFilter={targetDomain ? `${targetDomain}.` : ''}
                  />
                )}
              </div>
            )}

            {kind === 'script' && (
              <Reveal label="Doing several things? Here’s an example script">
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <p>
                    Write it in Home Assistant (Settings, Automations &amp; scenes, Scripts), then choose it above:
                  </p>
                  <Diag kind="blank">{EXAMPLE_SCRIPT}</Diag>
                  <p>
                    To check the garage really closed, turn on the check below and list the two garage covers. A check watches one
                    state for all its entities, so leave the lights out of it.
                  </p>
                </div>
              </Reveal>
            )}

            {kind === 'event' && (
              <Diag kind="blank">
                {`Fires bedside_dashboard_action. Trigger a Home Assistant automation with:\n\ntriggers:\n  - trigger: event\n    event_type: bedside_dashboard_action\n    event_data:\n      action: ${id || '<id>'}`}
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
              <p className="text-xs text-muted-foreground">
                {kind === 'service'
                  ? 'Anything else the service takes, as a JSON object.'
                  : kind === 'script'
                    ? 'Passed to the script as variables.'
                    : 'Sent along with the event, for the automation to read.'}
              </p>
            </div>
          </Step>

          <Step n={3} title="Ask before it runs" description="For locks, doors, anything you don’t want to trigger in the dark.">
            <div className="flex items-center gap-3">
              <Switch id={`${prefix}-confirm`} checked={confirm} onCheckedChange={setConfirm} />
              <Label htmlFor={`${prefix}-confirm`}>Ask for a second press first — for locks, doors, anything you don&rsquo;t want to trigger by accident</Label>
            </div>
            <Reveal label="How the second press works">
              <p className="text-sm text-muted-foreground">
                The first press arms it (one beep). Press the same button, the same way, again within 5 seconds and it runs. A different
                button, the other press length, or waiting too long cancels it. So a quick tap meant for a lamp can never confirm the
                garage.
              </p>
            </Reveal>
          </Step>

          <Step n={4} title="Check that it worked" description="Without a check, “done” only means Home Assistant accepted the request.">
            <div className="flex items-center gap-3">
              <Switch id={`${prefix}-verify`} checked={verifyOn} onCheckedChange={setVerifyOn} aria-describedby={`${prefix}-verify-help`} />
              <Label htmlFor={`${prefix}-verify`} id={`${prefix}-verify-heading`}>
                Check that it really happened
              </Label>
            </div>
            <p id={`${prefix}-verify-help`} className="text-sm text-muted-foreground">
              With a check, it waits for the entities to reach the state, and fails (the loud buzz on the device) if they don&rsquo;t in
              time. If they&rsquo;re already there, nothing is sent.
            </p>
            {verifyOn && (
              <>
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
                    <Button type="button" variant="outline" onClick={() => setPickingVerify(true)} aria-label="Choose entities to check">
                      <ListChecks aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Every one must reach the state. Separate them with commas.</p>
                  {target && kind !== 'event' && verifyEntities.trim() === '' && (
                    <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setVerifyEntities(target)}>
                      Use the target
                    </Button>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-verify-state`}>Must become</Label>
                  <Input
                    id={`${prefix}-verify-state`}
                    required
                    className="max-w-xs font-mono text-sm"
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
                  <p className="text-xs text-muted-foreground">
                    Home Assistant’s own word for the state, in lowercase: <code>closed</code>, <code>locked</code>, <code>off</code>.
                    You can see it on the entity’s page in Home Assistant.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-verify-timeout`}>Within (seconds)</Label>
                  <Input
                    id={`${prefix}-verify-timeout`}
                    required
                    type="number"
                    inputMode="numeric"
                    className="max-w-xs"
                    min={1}
                    max={300}
                    value={verifyTimeout}
                    onChange={(e) => setVerifyTimeout(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">How long to wait. A garage door might need 45; a light, 5.</p>
                </div>
              </>
            )}
            {pickingVerify && (
              <EntityPicker
                open
                multiple
                selected={splitEntities(verifyEntities)}
                onOpenChange={(open) => !open && setPickingVerify(false)}
                title="Choose the entities to check"
                description="Every one must reach the state for the action to count as done."
                queryKey={['home-assistant']}
                load={loadCatalog}
                onPick={(ids) => setVerifyEntities(ids.join(', '))}
                initialFilter={targetDomain ? `${targetDomain}.` : ''}
              />
            )}
          </Step>

          <Step n={5} title="Show a status (optional)" description="A live value beside the label on this page, such as whether the lamp is on.">
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                Jinja2, cut to {data.limits.state_max} characters. <code>{"states['light.desk'].state"}</code> is an entity&rsquo;s
                state; <code>device.temperature_c</code> is the device&rsquo;s own reading.
              </p>
              <div className="flex flex-wrap gap-2">
                <Label htmlFor={`${prefix}-state`} className="sr-only">
                  State template
                </Label>
                <Input
                  ref={stateInput}
                  id={`${prefix}-state`}
                  className="min-w-0 flex-1 font-mono text-sm"
                  value={stateTemplate}
                  placeholder="{{ states['light.desk'].state }}"
                  onChange={(e) => setStateTemplate(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {target && kind !== 'event' && (
                  <Button type="button" variant="ghost" size="sm" onClick={fillTargetState}>
                    Use the target&rsquo;s state
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" aria-label="Insert an entity’s state" onClick={() => setPickingState(true)}>
                  <ListChecks aria-hidden="true" /> Entity…
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Insert a device reading in the state" onClick={() => setVarsOpen(true)}>
                  <Braces aria-hidden="true" /> Device
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => preview.mutate()} disabled={!stateTemplate.trim() || preview.isPending}>
                  Preview
                </Button>
              </div>
              {pickingState && (
                <EntityPicker
                  open
                  onOpenChange={(open) => !open && setPickingState(false)}
                  title="Insert an entity’s state"
                  description="Inserts {{ states['…'].state }} where your cursor was."
                  queryKey={['home-assistant']}
                  load={loadCatalog}
                  onPick={([picked]) => insertVariable(`states['${picked}'].state`)}
                />
              )}
              <div aria-live="polite">
                {statePreview?.problem && <p className="mb-1 text-xs text-muted-foreground">{statePreview.problem}</p>}
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
            </div>
          </Step>

          <section aria-labelledby={`${prefix}-summary`} className="grid gap-2 rounded-lg bg-muted/50 p-4">
            <h3 id={`${prefix}-summary`} className="text-sm font-semibold">
              What a press will do
            </h3>
            <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-muted-foreground marker:font-medium">
              {explainAction(draft).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
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

/** One numbered stage of the editor: what it's for, then its fields. */
function Step({ n, title, description, children }: { n: number; title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border p-4 sm:p-5">
      <header className="flex items-start gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground" aria-hidden="true">
          {n}
        </span>
        <div className="grid gap-0.5">
          <h3 className="leading-6 font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}
