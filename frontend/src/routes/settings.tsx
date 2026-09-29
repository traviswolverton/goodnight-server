import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, PlugZap, RotateCcw, ScrollText, Settings2, ShieldCheck, Sparkles, XCircle, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConnectionsSection } from '@/components/connections-section'
import { Collapse, InfoToggle } from '@/components/disclosure'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/mutations'
import { settingsQuery } from '@/lib/queries'
import type { OllamaTestResult, SettingField, SettingsResponse } from '@/lib/types'
import { cn } from '@/lib/utils'

type Value = string | boolean
/** What the form holds per field: its value as edited, or RESET (go back
 *  to the .env / built-in value on save). */
const RESET = Symbol('reset')
type Draft = Record<string, Value | typeof RESET>

/** Form representation: inputs edit strings, switches booleans. */
function toForm(value: SettingField['value']): Value {
  return typeof value === 'boolean' ? value : value === null ? '' : String(value)
}

function display(value: SettingField['value']): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return value === null || value === '' ? '(empty)' : String(value)
}

export function SettingsPage() {
  usePageTitle('Settings')
  return (
    <>
      <PageHeader title="Settings" description="Where this app connects, and how it behaves." />
      <div className="grid gap-10">
        <ConnectionsSection />
        <PreferencesSection />
      </div>
    </>
  )
}

/** The "Preferences" half: how the app behaves. */
export function PreferencesSection() {
  const settings = useQuery(settingsQuery)

  return (
    <section aria-labelledby="preferences-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="preferences-heading" className="text-lg font-semibold tracking-tight">
          Preferences
        </h2>
        <p className="text-sm text-muted-foreground">How the app behaves. A save takes effect straight away; nothing restarts.</p>
      </div>
      {settings.isPending ? (
        <LoadingBlocks />
      ) : settings.error ? (
        <LoadError error={settings.error} retry={() => void settings.refetch()} />
      ) : (
        // Keyed on the loaded values, so a save (new values) starts a clean form.
        <SettingsForm key={JSON.stringify(settings.data.fields.map((f) => [f.value, f.source]))} data={settings.data} />
      )}
    </section>
  )
}

/** An icon and a line of context per group; unknown groups get a plain one. */
const GROUP_META: Record<string, { icon: LucideIcon; blurb: string }> = {
  'Sign-in and security': { icon: ShieldCheck, blurb: 'Sessions, HTTPS, trusted proxies and how long the audit log is kept.' },
  'AI assist': { icon: Sparkles, blurb: 'A local Ollama model that helps write templates.' },
  Diagnostics: { icon: ScrollText, blurb: 'What the app writes to its log.' },
}

function SettingsForm({ data }: { data: SettingsResponse }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(data.fields.map((f) => [f.key, toForm(f.value)])))
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [models, setModels] = useState<string[] | null>(null)

  const groups = useMemo(() => {
    const byGroup = new Map<string, SettingField[]>()
    for (const field of data.fields) byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field])
    return [...byGroup.entries()]
  }, [data.fields])

  const changes = useMemo(() => {
    const out: Record<string, Value | null> = {}
    for (const field of data.fields) {
      const edited = draft[field.key]
      if (edited === RESET) out[field.key] = null
      else if (edited !== toForm(field.value)) out[field.key] = edited
    }
    return out
  }, [draft, data.fields])
  const changeCount = Object.keys(changes).length

  const set = (key: string, value: Value | typeof RESET) => setDraft((d) => ({ ...d, [key]: value }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setProblem(null)
    try {
      const fresh = await api<SettingsResponse>('/api/settings', { method: 'PUT', body: { values: changes } })
      queryClient.setQueryData(settingsQuery.queryKey, fresh)
      toast.success('Saved. The new settings are in effect.')
    } catch (error) {
      setProblem(errorMessage(error, 'Saving failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save} autoComplete="off">
      {groups.map(([group, fields]) => {
        const { icon: Icon, blurb } = GROUP_META[group] ?? { icon: Settings2, blurb: '' }
        return (
          <Card key={group} className="gap-0 overflow-hidden py-0">
            <CardHeader className="flex items-center gap-3 border-b bg-muted/30 px-4 py-4 sm:px-6">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-4.5" aria-hidden="true" />
              </span>
              <div className="grid min-w-0 gap-1">
                <CardTitle>{group}</CardTitle>
                {blurb && <CardDescription>{blurb}</CardDescription>}
              </div>
            </CardHeader>
            <CardContent className="divide-y px-0">
              {group === 'AI assist' && (
                <div className="px-4 py-4 sm:px-6">
                  <OllamaTest url={draft.ollama_base_url === RESET ? '' : String(draft.ollama_base_url)} onModels={setModels} />
                </div>
              )}
              {fields.map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  onChange={(value) => set(field.key, value)}
                  lockedOff={field.key === 'https_only' && !data.request_is_https && field.value === false}
                  choices={field.key === 'ollama_model' ? models : null}
                />
              ))}
            </CardContent>
          </Card>
        )
      })}

      {/* Sticks to the bottom of the viewport while the form scrolls under it. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-6 border-t bg-background/95 backdrop-blur sm:-mx-6">
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6">
          <div aria-live="polite" className="mr-auto min-w-0 text-sm">
            {problem ? (
              <span className="text-destructive">{problem}</span>
            ) : (
              <span className="text-muted-foreground">
                {changeCount === 0 ? 'No unsaved changes' : `${changeCount} unsaved change${changeCount === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={changeCount === 0 || saving}
            onClick={() => {
              setDraft(Object.fromEntries(data.fields.map((f) => [f.key, toForm(f.value)])))
              setProblem(null)
            }}
          >
            Discard
          </Button>
          <Button type="submit" disabled={changeCount === 0 || saving}>
            {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}

const SOURCE_LABEL: Record<SettingField['source'], string> = { app: 'Set here', env: 'From .env', default: 'Default' }

function SettingRow({
  field,
  value,
  onChange,
  lockedOff,
  choices,
}: {
  field: SettingField
  value: Value | typeof RESET
  onChange: (value: Value | typeof RESET) => void
  lockedOff: boolean
  choices: string[] | null
}) {
  const id = `setting-${field.key}`
  const resetting = value === RESET
  const current = resetting ? toForm(field.baseline) : value
  const help = `${id}-help`
  const note = `${id}-note`
  const [showHelp, setShowHelp] = useState(false)
  const hasNote = resetting || lockedOff
  const described = [field.help ? help : null, hasNote ? note : null].filter(Boolean).join(' ') || undefined

  let input
  if (field.kind === 'boolean') {
    input = (
      <Switch
        id={id}
        checked={current === true}
        disabled={resetting || lockedOff}
        aria-describedby={described}
        onCheckedChange={(checked) => onChange(checked)}
      />
    )
  } else if (field.kind === 'select' || (choices && choices.length > 0)) {
    const options = field.kind === 'select' ? field.options : [...new Set([...(choices ?? []), String(current)])].filter(Boolean)
    input = (
      <Select value={String(current)} onValueChange={onChange} disabled={resetting}>
        <SelectTrigger id={id} className="w-full" aria-describedby={described}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else {
    const numeric = field.kind === 'number' || field.kind === 'integer'
    input = (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type={numeric ? 'number' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          min={field.minimum ?? undefined}
          max={field.maximum ?? undefined}
          step={field.kind === 'integer' ? 1 : 'any'}
          value={String(current)}
          placeholder={field.placeholder ?? undefined}
          disabled={resetting}
          aria-describedby={described}
          className={cn(numeric ? 'w-28 sm:ml-auto' : 'w-full')}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && <span className="w-12 shrink-0 text-sm text-muted-foreground">{field.unit}</span>}
      </div>
    )
  }

  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Label htmlFor={id}>{field.label}</Label>
          {field.help && (
            <InfoToggle open={showHelp} onToggle={() => setShowHelp((v) => !v)} controls={help} label={`About ${field.label}`} />
          )}
          <Badge variant={field.source === 'app' ? 'secondary' : 'outline'} className="text-[11px]">
            {SOURCE_LABEL[field.source]}
          </Badge>
          {field.source === 'app' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(resetting ? toForm(field.value) : RESET)}
            >
              <RotateCcw aria-hidden="true" /> {resetting ? 'Keep' : 'Reset'}
            </Button>
          )}
        </div>
        <div className={cn(field.kind === 'boolean' && 'sm:justify-self-end')}>{input}</div>
      </div>
      {hasNote && (
        <p id={note} className="mt-2 text-xs text-muted-foreground">
          {resetting ? `On save, goes back to ${display(field.baseline)} (from .env or the built-in default). ` : ''}
          {lockedOff && 'Open this page through its HTTPS address to turn it on.'}
        </p>
      )}
      {field.help && (
        <Collapse open={showHelp} id={help}>
          <p className="max-w-prose pt-3 text-sm text-muted-foreground">{field.help}</p>
        </Collapse>
      )}
    </div>
  )
}

/** Checks the Ollama URL as typed and fills the model picker. */
function OllamaTest({ url, onModels }: { url: string; onModels: (models: string[] | null) => void }) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<OllamaTestResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setResult(null)
    setFailure(null)
    try {
      const found = await api<OllamaTestResult>('/api/settings/ollama/test', { method: 'POST', body: { url } })
      setResult(found)
      onModels(found.ok ? found.models : null)
    } catch (error) {
      setFailure(errorMessage(error, 'The test failed'))
      onModels(null)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void run()} disabled={pending || !url.trim()}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
        {pending ? 'Testing…' : 'Test Ollama'}
      </Button>
      <div aria-live="polite" className="text-sm">
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {result &&
          (result.ok ? (
            <span className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
              Reached it: {result.models.length} model{result.models.length === 1 ? '' : 's'}. Pick one below.
            </span>
          ) : (
            <span className="flex items-center gap-2 text-destructive">
              <XCircle className="size-4" aria-hidden="true" />
              Couldn’t reach it: {result.error}
            </span>
          ))}
      </div>
    </div>
  )
}
