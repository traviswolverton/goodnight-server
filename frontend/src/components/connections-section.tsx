import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BedDouble,
  CheckCircle2,
  Database,
  House,
  KeyRound,
  Loader2,
  Pencil,
  Radio,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { ChevronToggle, Collapse } from '@/components/disclosure'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { StatusPill, type AnyStatus } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useNow } from '@/hooks/use-now'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { errorMessage } from '@/lib/mutations'
import { connectionsQuery } from '@/lib/queries'
import { waitForRestart } from '@/lib/restart'
import type { ConnectionsResponse, DatabaseReport, DatabaseSaveMode, HomeAssistantTestResult, MqttTestResult } from '@/lib/types'
import { cn } from '@/lib/utils'

type Editing = 'home_assistant' | 'mqtt' | 'database' | 'display' | 'token' | null
type RowKey = 'home_assistant' | 'mqtt' | 'database' | 'display'
const ROW_KEYS: RowKey[] = ['home_assistant', 'mqtt', 'database', 'display']

/** The "Connections" half of the Settings page: what this app and the
 *  bedside device talk to. Each is a row that opens to its explanation. */
export function ConnectionsSection() {
  const connections = useQuery(connectionsQuery)
  const [editing, setEditing] = useState<Editing>(null)
  const [open, setOpen] = useState<Set<RowKey>>(new Set())
  const allOpen = open.size === ROW_KEYS.length
  const toggle = (key: RowKey) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <section aria-labelledby="connections-heading" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="grid gap-1">
          <h2 id="connections-heading" className="text-lg font-semibold tracking-tight">
            Connections
          </h2>
          <p className="text-sm text-muted-foreground">
            What this app and the bedside device talk to. Every change is tested before it’s saved.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(ROW_KEYS))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      </div>

      {connections.isPending ? (
        <LoadingBlocks />
      ) : connections.error ? (
        <LoadError error={connections.error} retry={() => void connections.refetch()} />
      ) : (
        <>
          {!connections.data.can_save && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>Changes can’t be saved yet</AlertTitle>
              <AlertDescription>
                Set <code>SECRETS_MASTER_KEY</code> in <code>.env</code> first: it encrypts the passwords saved here.
              </AlertDescription>
            </Alert>
          )}
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y">
              <HomeAssistantRow data={connections.data} open={open.has('home_assistant')} onToggle={() => toggle('home_assistant')} onEdit={() => setEditing('home_assistant')} />
              <MqttRow data={connections.data} open={open.has('mqtt')} onToggle={() => toggle('mqtt')} onEdit={() => setEditing('mqtt')} />
              <DatabaseRow data={connections.data} open={open.has('database')} onToggle={() => toggle('database')} onEdit={() => setEditing('database')} />
              <DisplayRow
                data={connections.data}
                open={open.has('display')}
                onToggle={() => toggle('display')}
                onEdit={() => setEditing('display')}
                onToken={() => setEditing('token')}
              />
            </ul>
          </Card>
        </>
      )}

      {connections.data && editing === 'home_assistant' && (
        <HomeAssistantFlow current={connections.data.home_assistant} onClose={() => setEditing(null)} />
      )}
      {connections.data && editing === 'mqtt' && <MqttFlow target="app" current={connections.data.mqtt} onClose={() => setEditing(null)} />}
      {connections.data && editing === 'display' && (
        <MqttFlow target="display" current={connections.data.display} onClose={() => setEditing(null)} />
      )}
      {connections.data && editing === 'token' && <TokenFlow replacing={connections.data.display.token_set} onClose={() => setEditing(null)} />}
      {connections.data && editing === 'database' && (
        <DatabaseFlow current={connections.data.database} onClose={() => setEditing(null)} />
      )}
    </section>
  )
}

// --- Rows -----------------------------------------------------------------------

const SOURCE_TEXT = { app: 'Set on this page', env: 'From .env', none: 'Not set' } as const

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One connection: icon, name, live status and a one-line summary, with its
 *  buttons; the explanation and facts open underneath. */
function ConnectionRow({
  id,
  icon: Icon,
  name,
  status,
  statusLabel,
  summary,
  actions,
  open,
  onToggle,
  children,
}: {
  id: RowKey
  icon: LucideIcon
  name: string
  status: AnyStatus
  statusLabel: string
  summary: string
  actions: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const panel = `connection-${id}`
  return (
    <li className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 flex-1 basis-56 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{name}</h3>
            <StatusPill status={status} label={statusLabel} />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <ChevronToggle open={open} onToggle={onToggle} controls={panel} label={`Details: ${name}`} />
        </div>
      </div>
      <Collapse open={open} id={panel}>
        <div className="grid gap-4 pt-4 sm:pl-14">{children}</div>
      </Collapse>
    </li>
  )
}

function Explain({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-sm text-muted-foreground">{children}</p>
}

interface RowProps {
  data: ConnectionsResponse
  open: boolean
  onToggle: () => void
  onEdit: () => void
}

function ChangeButton({ onClick, disabled, children = 'Change' }: { onClick: () => void; disabled: boolean; children?: ReactNode }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      <Pencil aria-hidden="true" /> {children}
    </Button>
  )
}

const HA_STATUS = {
  connected: { status: 'ok', text: 'Connected' },
  unreachable: { status: 'down', text: 'Can’t be reached' },
  not_set_up: { status: 'unknown', text: 'Not set up' },
} as const

function HomeAssistantRow({ data, open, onToggle, onEdit }: RowProps) {
  const ha = data.home_assistant
  const status = HA_STATUS[ha.status]
  return (
    <ConnectionRow
      id="home_assistant"
      icon={House}
      name="Home Assistant"
      status={status.status}
      statusLabel={status.text}
      summary={ha.url ?? 'Not set up'}
      actions={<ChangeButton onClick={onEdit} disabled={!data.can_save}>{ha.url ? 'Change' : 'Set up'}</ChangeButton>}
      open={open}
      onToggle={onToggle}
    >
      <Explain>
        What the buttons control: every Action calls one of its services, scripts or events, and an action’s state reads its entities. A
        change takes effect straight away.
      </Explain>
      {ha.url ? (
        <Facts
          rows={[
            ['URL', ha.url],
            ['Access token', ha.token_set ? 'Set' : 'None'],
            ['TLS certificate', ha.verify_ssl ? 'Checked' : 'Not checked'],
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Not connected yet, so no action can run.</p>
      )}
    </ConnectionRow>
  )
}

function MqttRow({ data, open, onToggle, onEdit }: RowProps) {
  const mqtt = data.mqtt
  return (
    <ConnectionRow
      id="mqtt"
      icon={Radio}
      name="MQTT broker"
      status={mqtt.connected ? 'ok' : 'down'}
      statusLabel={mqtt.connected ? 'Connected' : 'Not connected'}
      summary={`${mqtt.host}:${mqtt.port}`}
      actions={<ChangeButton onClick={onEdit} disabled={!data.can_save} />}
      open={open}
      onToggle={onToggle}
    >
      <Explain>
        Where the device’s settings and sounds are published, and its sensors and buttons are read. The bedside device has its own broker
        setting, below.
      </Explain>
      <Facts
        rows={[
          ['Broker', `${mqtt.host}:${mqtt.port}`],
          ['Username', mqtt.username ?? '(none)'],
          ['Password', mqtt.password_set ? 'Set' : 'None'],
          ['Source', SOURCE_TEXT[mqtt.source]],
        ]}
      />
    </ConnectionRow>
  )
}

function DatabaseRow({ data, open, onToggle, onEdit }: RowProps) {
  const db = data.database
  return (
    <ConnectionRow
      id="database"
      icon={Database}
      name="Database"
      status={db.available ? 'ok' : 'down'}
      statusLabel={db.available ? 'Available' : 'Unavailable'}
      summary={db.configured ? `${db.database} on ${db.host}:${db.port}` : 'No database is set up'}
      actions={<ChangeButton onClick={onEdit} disabled={!data.can_save} />}
      open={open}
      onToggle={onToggle}
    >
      <Explain>
        PostgreSQL, for users, sign-ins and the audit log. If a database saved here ever stops answering, nobody can sign in to change it
        back: remove <code>database:</code> from <code>config/connections.yaml</code> and restart to fall back to <code>DATABASE_URL</code>{' '}
        in <code>.env</code>.
      </Explain>
      {db.configured ? (
        <Facts
          rows={[
            ['Server', `${db.host}:${db.port}`],
            ['Database', db.database],
            ['Username', db.username],
            ['Source', SOURCE_TEXT[db.source]],
          ]}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No database is set up.</p>
      )}
    </ConnectionRow>
  )
}

function DisplayRow({ data, open, onToggle, onEdit, onToken }: RowProps & { onToken: () => void }) {
  const display = data.display
  const now = useNow(15_000)
  const seen = display.last_seen
  return (
    <ConnectionRow
      id="display"
      icon={BedDouble}
      name="Bedside device"
      status={seen ? 'ok' : 'unknown'}
      statusLabel={seen ? `Checked in ${timeAgo(seen.ts, now)}` : 'Not seen since the app started'}
      summary={display.host ? `${display.host}:${display.port}` : 'Broker not set'}
      actions={
        <>
          <ChangeButton onClick={onEdit} disabled={!data.can_save} />
          <Button variant="outline" size="sm" onClick={onToken}>
            <KeyRound aria-hidden="true" /> Device token
          </Button>
        </>
      }
      open={open}
      onToggle={onToggle}
    >
      <Explain>
        The broker the device connects to. It asks this app at start-up, every 15 minutes, and whenever it can’t connect, so a change
        here reaches it without a reflash. It needs this app’s address and a device token in its <code>secrets.h</code> (one flash).
      </Explain>
      <Facts
        rows={[
          ['Broker', display.host ? `${display.host}:${display.port}` : 'Not set'],
          ['Username', display.username ?? '(none)'],
          ['Device token', display.token_set ? 'Set' : 'Not made yet'],
          ['Source', SOURCE_TEXT[display.source]],
          ...(seen?.ip ? ([['Last seen from', seen.ip]] as [string, string][]) : []),
        ]}
      />
    </ConnectionRow>
  )
}

// --- Shared flow pieces -------------------------------------------------------------

type Step = 'form' | 'review' | 'saving'

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = true,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'number'
  placeholder?: string
  required?: boolean
  hint?: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Check({ ok, children }: { ok: boolean | 'warn'; children: ReactNode }) {
  const Icon = ok === 'warn' ? TriangleAlert : ok ? CheckCircle2 : XCircle
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', ok === 'warn' ? 'text-amber-600' : ok ? 'text-emerald-600' : 'text-destructive')}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  )
}

/** Save (the server re-tests first and restarts itself), then wait for the
 *  app to come back and refresh everything. */
function useSaveAndRestart(onClose: () => void) {
  const queryClient = useQueryClient()
  return async (save: () => Promise<unknown>, success: string, setStep: (s: Step) => void, setProblem: (p: string) => void) => {
    setStep('saving')
    try {
      await save()
    } catch (error) {
      setProblem(errorMessage(error, 'Saving failed'))
      setStep('review')
      return
    }
    const back = await waitForRestart()
    await queryClient.invalidateQueries()
    if (back) toast.success(success)
    else toast.error('The app hasn’t come back after a minute. Check its logs.')
    onClose()
  }
}

// --- MQTT flow -------------------------------------------------------------------

type BrokerSummary = Pick<ConnectionsResponse['display'], 'host' | 'port' | 'username' | 'password_set'>

/** Topic permissions each account needs (docs/mqtt-broker.md). */
const ACL_TEXT = {
  app: (
    <>
      write <code>bedside/config</code>, <code>bedside/sound</code> and its Home Assistant discovery topics, and
      read <code>bedside/sensors</code>, <code>bedside/button</code> and <code>bedside/availability</code>
    </>
  ),
  display: (
    <>
      read <code>bedside/config</code> and <code>bedside/sound</code>, and write{' '}
      <code>bedside/sensors</code>, <code>bedside/button</code> and <code>bedside/availability</code>
    </>
  ),
}

/** The app's own broker (save restarts the app) or the device's (save
 *  just updates what GET /device/config hands out). */
function MqttFlow({ target, current, onClose }: { target: 'app' | 'display'; current: BrokerSummary; onClose: () => void }) {
  const queryClient = useQueryClient()
  const forDisplay = target === 'display'
  const path = forDisplay ? '/api/connections/display' : '/api/connections/mqtt'
  const [step, setStep] = useState<Step>('form')
  const [host, setHost] = useState(current.host ?? '')
  const [port, setPort] = useState(String(current.port ?? 1883))
  const [username, setUsername] = useState(current.username ?? '')
  const [password, setPassword] = useState('')
  const [testing, setTesting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const saveAndRestart = useSaveAndRestart(onClose)
  const fields = { host, port, username, password }

  async function saveDisplay() {
    setStep('saving')
    try {
      await api(path, { method: 'PUT', body: { fields } })
    } catch (error) {
      setProblem(errorMessage(error, 'Saving failed'))
      setStep('review')
      return
    }
    await queryClient.invalidateQueries({ queryKey: connectionsQuery.queryKey })
    toast.success(`Saved. The device moves to ${host}:${port} at its next check-in.`)
    onClose()
  }

  async function test(e: FormEvent) {
    e.preventDefault()
    setTesting(true)
    setProblem(null)
    try {
      const result = await api<MqttTestResult>(`${path}/test`, { method: 'POST', body: { fields } })
      if (result.ok) setStep('review')
      else setProblem(`Couldn’t connect: ${result.error}`)
    } catch (error) {
      setProblem(errorMessage(error, 'The test failed'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && step !== 'saving' && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{forDisplay ? 'Change the device’s broker' : 'Change the MQTT broker'}</DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? `Step 1 of 2: enter the broker${forDisplay ? ' and the display’s own account' : ''}, then test it.`
              : forDisplay
                ? 'Step 2 of 2: save. The device picks it up the next time it checks in; nothing restarts.'
                : 'Step 2 of 2: save, and the app restarts to use it.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <form className="grid gap-4" autoComplete="off" onSubmit={test}>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field id={`${target}-host`} label="Host" value={host} onChange={setHost} placeholder="192.0.2.25" />
              <Field id={`${target}-port`} label="Port" type="number" value={port} onChange={setPort} />
            </div>
            <Field
              id={`${target}-username`}
              label="Username"
              value={username}
              onChange={setUsername}
              required={forDisplay}
              placeholder={forDisplay ? 'bedside-esp32' : undefined}
            />
            <Field
              id={`${target}-password`}
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              required={forDisplay && !current.password_set}
              placeholder={current.password_set ? 'Leave blank to keep the current one' : undefined}
            />
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={testing || !host.trim()}>
                {testing && <Loader2 className="animate-spin" aria-hidden="true" />}
                {testing ? 'Testing…' : 'Test'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <ul className="grid gap-2 text-sm">
              <Check ok>
                Connected to <strong>{host}:{port}</strong>
                {username ? (
                  <>
                    {' '}and signed in as <strong>{username}</strong>
                  </>
                ) : null}
                .
              </Check>
              <Check ok="warn">
                Topic permissions can’t be tested from here. This account needs to {ACL_TEXT[target]} (docs/mqtt-broker.md).
              </Check>
            </ul>
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep('form')} disabled={step === 'saving'}>
                Back
              </Button>
              <Button
                disabled={step === 'saving'}
                onClick={() =>
                  forDisplay
                    ? void saveDisplay()
                    : void saveAndRestart(
                        () => api(path, { method: 'PUT', body: { fields } }),
                        `Now using the broker at ${host}:${port}.`,
                        setStep,
                        setProblem,
                      )
                }
              >
                {step === 'saving' && <Loader2 className="animate-spin" aria-hidden="true" />}
                {step === 'saving' ? (forDisplay ? 'Saving…' : 'Restarting…') : forDisplay ? 'Save' : 'Save and restart'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Home Assistant flow ----------------------------------------------------------------

function HomeAssistantFlow({ current, onClose }: { current: ConnectionsResponse['home_assistant']; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('form')
  const [url, setUrl] = useState(current.url ?? '')
  const [token, setToken] = useState('')
  const [verifySsl, setVerifySsl] = useState(current.verify_ssl)
  const [testing, setTesting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [found, setFound] = useState<HomeAssistantTestResult | null>(null)
  const fields = { url, token, verify_ssl: String(verifySsl) }

  async function test(e: FormEvent) {
    e.preventDefault()
    setTesting(true)
    setProblem(null)
    try {
      const result = await api<HomeAssistantTestResult>('/api/connections/home-assistant/test', { method: 'POST', body: { fields } })
      if (result.ok) {
        setFound(result)
        setStep('review')
      } else setProblem(`Couldn’t connect: ${result.error}`)
    } catch (error) {
      setProblem(errorMessage(error, 'The test failed'))
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    setStep('saving')
    try {
      await api('/api/connections/home-assistant', { method: 'PUT', body: { fields } })
    } catch (error) {
      setProblem(errorMessage(error, 'Saving failed'))
      setStep('review')
      return
    }
    await queryClient.invalidateQueries()
    toast.success('Saved. Actions now run through this Home Assistant.')
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && step !== 'saving' && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{current.url ? 'Change Home Assistant' : 'Connect Home Assistant'}</DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? 'Step 1 of 2: enter its address and an access token, then test it.'
              : 'Step 2 of 2: save. It takes effect straight away; nothing restarts.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <form className="grid gap-4" autoComplete="off" onSubmit={test}>
            <Field id="ha-url" label="URL" value={url} onChange={setUrl} placeholder="http://homeassistant.local:8123" />
            <Field
              id="ha-token"
              label="Long-lived access token"
              type="password"
              value={token}
              onChange={setToken}
              required={!current.token_set}
              placeholder={current.token_set ? 'Leave blank to keep the current one' : undefined}
              hint="Make one in Home Assistant on your profile’s Security tab, as a user that isn’t an administrator: the token can do anything that user can."
            />
            <div className="flex items-center gap-3">
              <Switch id="ha-verify" checked={verifySsl} onCheckedChange={setVerifySsl} />
              <Label htmlFor="ha-verify">Check its TLS certificate (turn off only for a self-signed https:// address)</Label>
            </div>
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={testing || !url.trim()}>
                {testing && <Loader2 className="animate-spin" aria-hidden="true" />}
                {testing ? 'Testing…' : 'Test'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <ul className="grid gap-2 text-sm">
              <Check ok>
                Connected to <strong>{found?.location_name ?? 'Home Assistant'}</strong>
                {found?.version ? ` (Home Assistant ${found.version})` : ''} and signed in with the token.
              </Check>
            </ul>
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep('form')} disabled={step === 'saving'}>
                Back
              </Button>
              <Button disabled={step === 'saving'} onClick={() => void save()}>
                {step === 'saving' && <Loader2 className="animate-spin" aria-hidden="true" />}
                {step === 'saving' ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FlowProblem({ problem }: { problem: string | null }) {
  return (
    <div aria-live="polite">
      {problem && (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// --- Database flow -------------------------------------------------------------------

const SCHEMA_TEXT: Record<string, string> = {
  none: 'It’s empty. This app will create its tables there.',
  current: 'It has this app’s tables, up to date.',
  upgrade: 'It has this app’s tables, from an older version. They’ll be upgraded when the app restarts.',
}

const MODE_TEXT: Record<DatabaseSaveMode, { label: string; detail: string }> = {
  copy: {
    label: 'Copy everything from the current database',
    detail: 'Users, sign-ins and the audit log. Everyone stays signed in, you included.',
  },
  fresh: {
    label: 'Start empty',
    detail: 'ADMIN_USERNAME / ADMIN_PASSWORD in .env create the first administrator. Everyone else’s accounts stay behind.',
  },
  use: { label: 'Use it as it is', detail: '' },
}

function DatabaseFlow({ current, onClose }: { current: ConnectionsResponse['database']; onClose: () => void }) {
  const [step, setStep] = useState<Step>('form')
  const [host, setHost] = useState(current.host ?? '')
  const [port, setPort] = useState(String(current.port ?? 5432))
  const [database, setDatabase] = useState(current.database ?? '')
  const [username, setUsername] = useState(current.username ?? '')
  const [password, setPassword] = useState('')
  const [testing, setTesting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [report, setReport] = useState<DatabaseReport | null>(null)
  const [mode, setMode] = useState<DatabaseSaveMode | null>(null)
  const saveAndRestart = useSaveAndRestart(onClose)
  const fields = { host, port, database, username, password }

  async function test(e: FormEvent) {
    e.preventDefault()
    setTesting(true)
    setProblem(null)
    try {
      const result = await api<DatabaseReport>('/api/connections/database/test', { method: 'POST', body: { fields } })
      if (!result.connected) {
        setProblem(`Couldn’t connect: ${result.error}`)
        return
      }
      setReport(result)
      setMode(result.modes[0] ?? null)
      setStep('review')
    } catch (error) {
      setProblem(errorMessage(error, 'The test failed'))
    } finally {
      setTesting(false)
    }
  }

  const choosing = report !== null && report.modes.length > 1
  const signsOut = mode === 'use' && report !== null && !report.same_as_current

  return (
    <Dialog open onOpenChange={(open) => !open && step !== 'saving' && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change the database</DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? 'Step 1 of 2: enter the database, then test it. Nothing changes until you save.'
              : 'Step 2 of 2: check what was found, then save. The app restarts to use it.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'form' || report === null ? (
          <form className="grid gap-4" autoComplete="off" onSubmit={test}>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field id="db-host" label="Host" value={host} onChange={setHost} placeholder="192.0.2.42" />
              <Field id="db-port" label="Port" type="number" value={port} onChange={setPort} />
            </div>
            <Field id="db-name" label="Database" value={database} onChange={setDatabase} placeholder="bedside_dashboard" />
            <Field
              id="db-username"
              label="Username"
              value={username}
              onChange={setUsername}
              hint="A role that owns the database, not a superuser (docs/database.md)."
            />
            <Field
              id="db-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              required={!current.password_set}
              placeholder={current.password_set ? 'Leave blank to keep the current one' : undefined}
            />
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={testing || !host.trim() || !database.trim() || !username.trim()}>
                {testing && <Loader2 className="animate-spin" aria-hidden="true" />}
                {testing ? 'Testing…' : 'Test'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-4">
            <ul className="grid gap-2 text-sm">
              <Check ok>
                Connected to <strong>{database}</strong> on {host}:{port} (PostgreSQL {report.server_version}).
              </Check>
              {report.same_as_current && <Check ok>This is the database in use now.</Check>}
              {report.schema && SCHEMA_TEXT[report.schema] && <Check ok>{SCHEMA_TEXT[report.schema]}</Check>}
              {(report.schema === 'none' || report.schema === 'upgrade') && (
                <Check ok={report.can_create_tables}>
                  {report.can_create_tables ? `${username} can create tables there.` : `${username} can’t create tables there.`}
                </Check>
              )}
              {report.user_count > 0 && (
                <Check ok={report.admins.length > 0}>
                  {report.user_count} user{report.user_count === 1 ? '' : 's'}
                  {report.admins.length > 0 ? `; administrators: ${report.admins.join(', ')}` : ', none of them an active administrator'}.
                </Check>
              )}
            </ul>

            {report.problems.length > 0 && (
              <Alert variant="destructive">
                <XCircle aria-hidden="true" />
                <AlertTitle>This database can’t be used</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {report.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {choosing && (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">It has no users yet. What should it start with?</legend>
                {report.modes.map((m) => (
                  <label
                    key={m}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                      mode === m && 'border-primary bg-muted/50',
                    )}
                  >
                    <input type="radio" name="db-mode" className="mt-1" checked={mode === m} onChange={() => setMode(m)} />
                    <span className="grid gap-0.5">
                      <strong>{MODE_TEXT[m].label}</strong>
                      <span className="text-muted-foreground">{MODE_TEXT[m].detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {!choosing && mode === 'copy' && (
              <Check ok>
                It has no users yet: saving copies them over from the current database (users, sign-ins and the audit log), so everyone
                stays signed in.
              </Check>
            )}
            {signsOut && (
              <Alert>
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>You’ll be signed out</AlertTitle>
                <AlertDescription>
                  Sign-ins don’t carry over to a different database. Sign back in with an account from that one
                  {report.admins.length > 0 && <> (administrators: {report.admins.join(', ')})</>}.
                </AlertDescription>
              </Alert>
            )}

            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep('form')} disabled={step === 'saving'}>
                Back
              </Button>
              <Button
                disabled={step === 'saving' || mode === null}
                onClick={() =>
                  mode &&
                  void saveAndRestart(
                    () => api('/api/connections/database', { method: 'PUT', body: { fields, mode } }),
                    `Now using ${database} on ${host}.`,
                    setStep,
                    setProblem,
                  )
                }
              >
                {step === 'saving' && <Loader2 className="animate-spin" aria-hidden="true" />}
                {step === 'saving' ? (mode === 'copy' ? 'Copying and restarting…' : 'Restarting…') : 'Save and restart'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Device token ----------------------------------------------------------------------

/** Makes a new device token and shows it once, as the two secrets.h lines
 *  the firmware needs. */
function TokenFlow({ replacing, onClose }: { replacing: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const secure = window.location.protocol === 'https:'
  const snippet = token
    ? `#define SERVER_URL   "${secure ? 'http://<this app’s LAN address>:<port>' : window.location.origin}"\n#define DEVICE_TOKEN "${token}"`
    : ''

  async function make() {
    setPending(true)
    setProblem(null)
    try {
      setToken((await api<{ token: string }>('/api/connections/display/token', { method: 'POST' })).token)
      await queryClient.invalidateQueries({ queryKey: connectionsQuery.queryKey })
    } catch (error) {
      setProblem(errorMessage(error, 'Couldn’t make a token'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Device token</DialogTitle>
          <DialogDescription>
            {token
              ? 'Put these two lines in the device’s include/secrets.h and flash it. The token is shown only this once.'
              : 'The device sends this with every request for its broker settings.'}
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="grid gap-3">
            <Label htmlFor="token-snippet" className="sr-only">
              secrets.h lines
            </Label>
            <Textarea
              id="token-snippet"
              readOnly
              rows={3}
              value={snippet}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            {secure && (
              <Check ok="warn">
                The device can only use plain http: give it this app’s LAN address, not the HTTPS one you’re using now.
              </Check>
            )}
            <DialogFooter>
              {navigator.clipboard && (
                <Button
                  variant="outline"
                  onClick={() => void navigator.clipboard.writeText(snippet).then(() => toast.success('Copied.'))}
                >
                  Copy
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            {replacing && (
              <Alert>
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>This replaces the current token</AlertTitle>
                <AlertDescription>
                  The old one stops working right away. The device keeps using the broker settings it already has until it’s flashed
                  with the new token.
                </AlertDescription>
              </Alert>
            )}
            <FlowProblem problem={problem} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void make()} disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {replacing ? 'Make a new token' : 'Make a token'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
