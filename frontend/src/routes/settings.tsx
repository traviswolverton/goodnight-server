import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, PlugZap, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  const settings = useQuery(settingsQuery)

  return (
    <>
      <PageHeader title="Settings" description="How the app behaves. A save takes effect straight away; nothing restarts." />
      {settings.isPending ? (
        <LoadingBlocks />
      ) : settings.error ? (
        <LoadError error={settings.error} retry={() => void settings.refetch()} />
      ) : (
        // Keyed on the loaded values, so a save (new values) starts a clean form.
        <SettingsForm key={JSON.stringify(settings.data.fields.map((f) => [f.value, f.source]))} data={settings.data} />
      )}
    </>
  )
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
      {groups.map(([group, fields]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            {group === 'AI assist' && (
              <OllamaTest url={draft.ollama_base_url === RESET ? '' : String(draft.ollama_base_url)} onModels={setModels} />
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
      ))}

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

  let input
  if (field.kind === 'boolean') {
    input = (
      <Switch
        id={id}
        checked={current === true}
        disabled={resetting || lockedOff}
        aria-describedby={help}
        onCheckedChange={(checked) => onChange(checked)}
      />
    )
  } else if (field.kind === 'select' || (choices && choices.length > 0)) {
    const options = field.kind === 'select' ? field.options : [...new Set([...(choices ?? []), String(current)])].filter(Boolean)
    input = (
      <Select value={String(current)} onValueChange={onChange} disabled={resetting}>
        <SelectTrigger id={id} className="w-full sm:w-72" aria-describedby={help}>
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
          aria-describedby={help}
          className={cn(numeric ? 'w-32' : 'w-full sm:max-w-md')}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && <span className="text-sm text-muted-foreground">{field.unit}</span>}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{field.label}</Label>
        <Badge variant="secondary">{SOURCE_LABEL[field.source]}</Badge>
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
      {input}
      <p id={help} className="text-xs text-muted-foreground">
        {resetting ? `On save, goes back to ${display(field.baseline)} (from .env or the built-in default). ` : ''}
        {field.help}
        {lockedOff && ' Open this page through its HTTPS address to turn it on.'}
      </p>
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
