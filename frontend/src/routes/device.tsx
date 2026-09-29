import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { StatusPill, type AnyStatus } from '@/components/status-pill'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCanEdit } from '@/hooks/use-can-edit'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { errorMessage, toastError } from '@/lib/mutations'
import { screenAt } from '@/lib/device'
import { deviceQuery } from '@/lib/queries'
import type { DeviceConfig, DeviceResponse, DimmerConfig, PressKind, SoundConfig, SoundName } from '@/lib/types'

/** Radix Select can't hold an empty value, so "nothing bound" is this. */
const UNBOUND = '__none__'

export function DevicePage() {
  usePageTitle('Device')
  const canEdit = useCanEdit()
  const { data, error, isPending, refetch } = useQuery(deviceQuery)

  return (
    <>
      <PageHeader
        title="Device"
        description="The bedside unit itself: what its sensors read, how its screen follows the room's light, and what its buttons do."
      />
      {!canEdit && <ReadOnlyNote />}
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <ReadingsCard data={data} />
            <PressesCard data={data} />
          </div>
          {/* Remount (and so reset the draft) only when the saved config itself changes. */}
          <SettingsForm key={JSON.stringify(data.config)} data={data} canEdit={canEdit} />
        </div>
      )}
    </>
  )
}

function deviceStatus(data: DeviceResponse): { status: AnyStatus; label: string } {
  if (!data.link_connected) return { status: 'unknown', label: 'Server not connected to the broker' }
  if (data.online === null) return { status: 'unknown', label: 'Not heard from yet' }
  return data.online ? { status: 'ok', label: 'Online' } : { status: 'down', label: 'Offline' }
}

function fmt(value: number | null | undefined, unit: string, digits = 0): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)}${unit}`
}

const SCREEN_LABEL = { off: 'Off (dark room)', dim: 'Dimmed', full: 'Full brightness' }

function ReadingsCard({ data }: { data: DeviceResponse }) {
  const now = useNow()
  const { status, label } = deviceStatus(data)
  const s = data.sensors
  const reportedAt = data.sensors_age_seconds === null ? null : now - data.sensors_age_seconds
  const tempF = s?.temperature_c == null ? null : (s.temperature_c * 9) / 5 + 32
  return (
    <Card>
      <CardHeader>
        <CardTitle>Right now</CardTitle>
        <CardDescription>
          <StatusPill status={status} label={label} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Temperature</dt>
          <dd className="font-medium tabular-nums">
            {fmt(s?.temperature_c, ' °C', 1)}
            {tempF !== null && <span className="text-muted-foreground"> · {fmt(tempF, ' °F', 1)}</span>}
          </dd>
          <dt className="text-muted-foreground">Humidity</dt>
          <dd className="font-medium tabular-nums">{fmt(s?.humidity, '%')}</dd>
          <dt className="text-muted-foreground">Light</dt>
          <dd className="font-medium tabular-nums">{fmt(s?.lux, ' lx', 1)}</dd>
          <dt className="text-muted-foreground">Screen</dt>
          <dd className="font-medium">{s?.screen ? SCREEN_LABEL[s.screen] : '—'}</dd>
          <dt className="text-muted-foreground">Last report</dt>
          <dd>{reportedAt === null ? 'never' : timeAgo(reportedAt, now)}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function PressesCard({ data }: { data: DeviceResponse }) {
  const now = useNow()
  const labels = Object.fromEntries(data.actions.map((a) => [a.id, a.label]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent button presses</CardTitle>
        <CardDescription>
          Newest first, since the server started.
          {data.ha_discovery && ' Every press also reaches Home Assistant as a device trigger, bound here or not.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.presses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No presses yet.</p>
        ) : (
          <ul className="divide-y text-sm" aria-label="Recent button presses">
            {data.presses.map((p) => (
              <li key={`${p.at}-${p.button}-${p.press}`} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  Button {p.button} <span className="text-muted-foreground">({p.press})</span>
                </span>
                <span className="text-right text-muted-foreground">
                  {p.action ? (
                    <>
                      {labels[p.action] ?? p.action}
                      {p.text && <> — {p.ok ? p.text : <span className="text-destructive">{p.text}</span>}</>}
                    </>
                  ) : (
                    'nothing bound'
                  )}
                  {' · '}
                  {timeAgo(p.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const DIMMER_FIELDS: { key: keyof DimmerConfig; label: string; help: string; step: string; min: number; max: number }[] = [
  { key: 'bright_lux', label: 'Full brightness at (lux)', help: 'At or above this much room light.', step: '0.5', min: 0, max: 65000 },
  { key: 'dark_lux', label: 'Screen off below (lux)', help: 'Below this, a press wakes it. Must not be above the full-brightness level.', step: '0.5', min: 0, max: 65000 },
  { key: 'dim_contrast', label: 'Dimmed brightness (0–255)', help: 'Used between the two levels, and when woken in the dark.', step: '1', min: 0, max: 255 },
  { key: 'wake_seconds', label: 'Stay on after a press (seconds)', help: 'In the dark, before it turns off again.', step: '1', min: 3, max: 600 },
]

const SOUND_FIELDS: { key: 'volume' | 'dark_volume'; label: string; help: string }[] = [
  { key: 'volume', label: 'Volume (0–100)', help: 'Normally, and for failures at any time.' },
  { key: 'dark_volume', label: 'Volume in the dark (0–100)', help: 'Below the screen-off light level. 0 is silent — except failures.' },
]

const SOUND_LABELS: Record<SoundName, string> = {
  armed: 'Armed — press again',
  running: 'Sending',
  success: 'Done',
  failure: 'Failed',
  cancel: 'Cancelled',
}

export function SettingsForm({ data, canEdit }: { data: DeviceResponse; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const id = useId()
  const [dimmer, setDimmer] = useState<Record<keyof DimmerConfig, string>>(() => ({
    bright_lux: String(data.config.dimmer.bright_lux),
    dark_lux: String(data.config.dimmer.dark_lux),
    dim_contrast: String(data.config.dimmer.dim_contrast),
    wake_seconds: String(data.config.dimmer.wake_seconds),
  }))
  const [soundsOn, setSoundsOn] = useState(data.config.sounds.enabled)
  const [volumes, setVolumes] = useState<Record<'volume' | 'dark_volume', string>>(() => ({
    volume: String(data.config.sounds.volume),
    dark_volume: String(data.config.sounds.dark_volume),
  }))
  const [buttons, setButtons] = useState(data.config.buttons)
  const [problem, setProblem] = useState<string | null>(null)

  const parsed: DimmerConfig = {
    bright_lux: Number(dimmer.bright_lux),
    dark_lux: Number(dimmer.dark_lux),
    dim_contrast: Number(dimmer.dim_contrast),
    wake_seconds: Number(dimmer.wake_seconds),
  }
  const invalid = DIMMER_FIELDS.find(
    (f) => dimmer[f.key].trim() === '' || !Number.isFinite(parsed[f.key]) || parsed[f.key] < f.min || parsed[f.key] > f.max,
  )
  const preview = screenAt(data.sensors?.lux, parsed)
  const sounds: SoundConfig = { enabled: soundsOn, volume: Number(volumes.volume), dark_volume: Number(volumes.dark_volume) }
  const invalidSound = SOUND_FIELDS.find((f) => {
    const n = sounds[f.key]
    return volumes[f.key].trim() === '' || !Number.isInteger(n) || n < 0 || n > 100
  })

  const save = useMutation({
    mutationFn: (config: DeviceConfig) =>
      api<{ sent_to_device: boolean }>('/api/device/config', { method: 'PUT', body: config }),
    onSuccess: (result) => {
      setProblem(null)
      toast.success(
        result.sent_to_device ? 'Saved and sent to the device.' : 'Saved. The device gets it when the server reconnects to the broker.',
      )
      void queryClient.invalidateQueries({ queryKey: deviceQuery.queryKey })
    },
    onError: (e) => setProblem(errorMessage(e)),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (invalid) return setProblem(`${invalid.label}: enter a number from ${invalid.min} to ${invalid.max}.`)
    if (parsed.dark_lux > parsed.bright_lux) return setProblem('The screen-off level must not be above the full-brightness level.')
    if (invalidSound) return setProblem(`${invalidSound.label}: enter a whole number from 0 to 100.`)
    setProblem(null)
    save.mutate({ dimmer: parsed, sounds, buttons })
  }

  function bind(button: number, press: PressKind, value: string) {
    setButtons((current) => {
      const entry = { ...current[String(button)], [press]: value === UNBOUND ? null : value }
      const next = { ...current, [String(button)]: entry }
      if (!entry.short && !entry.long) delete next[String(button)]
      return next
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Screen brightness</CardTitle>
          <CardDescription>
            The device follows the room&rsquo;s light. The press that wakes a dark screen does nothing else, so reaching
            over to check the time can&rsquo;t switch anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {DIMMER_FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`${id}-${f.key}`}>{f.label}</Label>
                <Input
                  id={`${id}-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={dimmer[f.key]}
                  disabled={!canEdit}
                  onChange={(e) => setDimmer((d) => ({ ...d, [f.key]: e.target.value }))}
                  aria-describedby={`${id}-${f.key}-help`}
                />
                <p id={`${id}-${f.key}-help`} className="text-xs text-muted-foreground">
                  {f.help}
                </p>
              </div>
            ))}
          </div>
          {preview && !invalid && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              At the room&rsquo;s current {data.sensors?.lux?.toFixed(1)} lx, the screen would be <strong>{preview}</strong>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buzzer</CardTitle>
          <CardDescription>
            Beeps for button presses: armed, sending, done or failed. A failure always plays at full volume, even in the dark, so
            a door that didn&rsquo;t close gets heard.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-3">
            <Switch id={`${id}-sounds`} checked={soundsOn} onCheckedChange={setSoundsOn} disabled={!canEdit} />
            <Label htmlFor={`${id}-sounds`}>Play sounds</Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SOUND_FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`${id}-${f.key}`}>{f.label}</Label>
                <Input
                  id={`${id}-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={0}
                  max={100}
                  value={volumes[f.key]}
                  disabled={!canEdit || !soundsOn}
                  onChange={(e) => setVolumes((v) => ({ ...v, [f.key]: e.target.value }))}
                  aria-describedby={`${id}-${f.key}-help`}
                />
                <p id={`${id}-${f.key}-help`} className="text-xs text-muted-foreground">
                  {f.help}
                </p>
              </div>
            ))}
          </div>
          {canEdit && <SoundTester sounds={data.sounds} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
          <CardDescription>
            Which action each button runs. A press is short if released within 0.6 s; holding it longer is a long press (the
            device clicks when you can let go). An action that asks to confirm needs the same press again within{' '}
            {data.confirm_seconds} s; anything else cancels it.{' '}
            {data.actions.length === 0 &&
              (canEdit ? (
                <>
                  There are no actions yet — <Link to="/actions" className="underline">add some on the Actions page</Link>.
                </>
              ) : (
                'There are no actions yet.'
              ))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="w-24 pb-2 font-medium">Button</th>
                <th scope="col" className="pb-2 font-medium">Short press</th>
                <th scope="col" className="pb-2 pl-2 font-medium">Long press</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: data.num_buttons }, (_, i) => i + 1).map((n) => (
                <tr key={n}>
                  <th scope="row" className="py-1 text-left font-medium">
                    {n}
                  </th>
                  {(['short', 'long'] as const).map((press) => (
                    <td key={press} className={press === 'long' ? 'py-1 pl-2' : 'py-1'}>
                      <Select
                        value={buttons[String(n)]?.[press] ?? UNBOUND}
                        onValueChange={(v) => bind(n, press, v)}
                        disabled={!canEdit}
                      >
                        <SelectTrigger className="w-full" aria-label={`Button ${n} ${press} press`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNBOUND}>Nothing</SelectItem>
                          {data.actions.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {problem && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {canEdit && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save
          </Button>
        </div>
      )}
    </form>
  )
}

/** Play each sound on the device now, at its saved settings. */
function SoundTester({ sounds }: { sounds: SoundName[] }) {
  const play = useMutation({
    mutationFn: (sound: SoundName) => api('/api/device/sound', { method: 'POST', body: { sound } }),
    onError: (e) => toastError(e, 'The device didn’t get it'),
  })
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">Try them on the device (at the saved settings — save first to hear a change):</p>
      <div className="flex flex-wrap gap-2">
        {sounds.map((sound) => (
          <Button
            key={sound}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => play.mutate(sound)}
            disabled={play.isPending}
            aria-label={`Play the ${SOUND_LABELS[sound].toLowerCase()} sound`}
          >
            <Volume2 aria-hidden="true" /> {SOUND_LABELS[sound]}
          </Button>
        ))}
      </div>
    </div>
  )
}
