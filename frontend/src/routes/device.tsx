import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, BedDouble, Loader2, MousePointerClick, Sun, Volume2, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { Collapse, InfoToggle } from '@/components/disclosure'
import { GuideCard, GuideSection, GuideTerm } from '@/components/guide-card'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { SectionCard } from '@/components/section-card'
import { StatusPill, type AnyStatus } from '@/components/status-pill'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCanEdit } from '@/hooks/use-can-edit'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { errorMessage, toastError } from '@/lib/mutations'
import { screenAt } from '@/lib/device'
import { deviceQuery } from '@/lib/queries'
import { SOUND_INFO } from '@/lib/sounds'
import type { DeviceConfig, DeviceResponse, DimmerConfig, SoundConfig, SoundName } from '@/lib/types'
import { cn } from '@/lib/utils'

export function DevicePage() {
  usePageTitle('Device')
  const canEdit = useCanEdit()
  const { data, error, isPending, refetch } = useQuery(deviceQuery)

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Device"
        description="The bedside unit itself: what its sensors read, how its screen follows the room's light, and its buzzer. What the buttons do is on the Buttons page."
      />
      {!canEdit && <ReadOnlyNote />}
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <div className="grid gap-4">
          {/* Open until the device has been heard from once: that's when you're setting it up. */}
          <DeviceGuide defaultOpen={data.online === null} />
          <ReadingsCard data={data} />
          <PressesCard data={data} />
          {/* Remount (and so reset the draft) only when the saved config itself changes. */}
          <SettingsForm key={JSON.stringify(data.config)} data={data} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}

function DeviceGuide({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <GuideCard
      title="About the device"
      description="A small screen, buttons and a buzzer by the bed, and sensors for the room."
      icon={BedDouble}
      defaultOpen={defaultOpen}
    >
      <GuideSection title="How it works">
        <ol className="grid list-decimal gap-2 pl-5 text-sm marker:font-medium marker:text-muted-foreground">
          <li>
            <strong>It reports.</strong> Temperature, humidity and light, every so often, and every button press, over MQTT through your
            broker.
          </li>
          <li>
            <strong>This server decides.</strong> It works out what a press does and sends the device its settings and sounds. The
            device doesn’t know what any button does; that’s the Buttons page.
          </li>
          <li>
            <strong>Saving here reaches it straight away.</strong> If it’s switched off, it picks the settings up when it reconnects.
          </li>
        </ol>
      </GuideSection>
      <GuideSection title="What the status means">
        <dl className="grid gap-3 text-sm">
          <GuideTerm icon={Wifi} name="Online">
            It’s connected to the broker and reporting.
          </GuideTerm>
          <GuideTerm icon={Wifi} name="Offline">
            It was there and has dropped off. Check its power and Wi-Fi.
          </GuideTerm>
          <GuideTerm icon={Wifi} name="Not heard from yet">
            Nothing has arrived since this server started. A device that’s still being set up looks like this.
          </GuideTerm>
          <GuideTerm icon={Wifi} name="Server not connected to the broker">
            This server can’t reach the broker, so it can’t hear the device either. Fix the broker on the Settings page first.
          </GuideTerm>
        </dl>
      </GuideSection>
    </GuideCard>
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
    <SectionCard
      icon={Activity}
      title="Right now"
      description={`Last report: ${reportedAt === null ? 'never' : timeAgo(reportedAt, now)}`}
      aside={<StatusPill status={status} label={label} />}
    >
      <CardContent className="px-4 py-4 sm:px-6">
        <dl className="grid grid-cols-2 gap-3">
          <Reading label="Temperature" value={fmt(s?.temperature_c, ' °C', 1)} extra={tempF !== null ? fmt(tempF, ' °F', 1) : null} />
          <Reading label="Humidity" value={fmt(s?.humidity, '%')} />
          <Reading label="Light" value={fmt(s?.lux, ' lx', 1)} />
          <Reading label="Screen" value={s?.screen ? SCREEN_LABEL[s.screen] : '—'} />
        </dl>
      </CardContent>
    </SectionCard>
  )
}

function Reading({ label, value, extra }: { label: string; value: string; extra?: string | null }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/50 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {extra && <dd className="text-xs text-muted-foreground tabular-nums">{extra}</dd>}
    </div>
  )
}

function PressesCard({ data }: { data: DeviceResponse }) {
  const now = useNow()
  const labels = Object.fromEntries(data.actions.map((a) => [a.id, a.label]))
  return (
    <SectionCard
      icon={MousePointerClick}
      title="Recent button presses"
      description={
        <>
          Newest first, since the server started.
          {data.ha_discovery && ' Every press also reaches Home Assistant as a device trigger, bound here or not.'}
        </>
      }
    >
      {data.presses.length === 0 ? (
        <CardContent className="px-4 py-4 sm:px-6">
          <p className="text-sm text-muted-foreground">No presses yet. Press a button on the device and it shows up here.</p>
        </CardContent>
      ) : (
        <ul className="divide-y text-sm" aria-label="Recent button presses">
          {data.presses.map((p) => (
            <li key={`${p.at}-${p.button}-${p.press}`} className="flex items-start gap-3 px-4 py-3 sm:px-6">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-sm font-semibold text-accent-foreground tabular-nums" aria-hidden="true">
                {p.button}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">
                  Button {p.button} <span className="font-normal text-muted-foreground">({p.press})</span>
                </span>
                <span className="text-muted-foreground">
                  {p.action ? (
                    <>
                      {labels[p.action] ?? p.action}
                      {p.text && <> — {p.ok ? p.text : <span className="text-destructive">{p.text}</span>}</>}
                    </>
                  ) : (
                    'nothing bound'
                  )}
                </span>
              </div>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{timeAgo(p.at, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
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

/** One setting: its label, an (i) that opens the explanation, and the input at the right. */
function FieldRow({ id, label, help, children }: { id: string; label: string; help: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-4 py-4 sm:px-6">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          <InfoToggle open={open} onToggle={() => setOpen((v) => !v)} controls={`${id}-help`} label={`About ${label}`} />
        </div>
        {children}
      </div>
      <Collapse open={open} id={`${id}-help`}>
        <p className="max-w-prose pt-3 text-sm text-muted-foreground">{help}</p>
      </Collapse>
    </div>
  )
}

export function SettingsForm({ data, canEdit }: { data: DeviceResponse; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const id = useId()
  const initialDimmer = {
    bright_lux: String(data.config.dimmer.bright_lux),
    dark_lux: String(data.config.dimmer.dark_lux),
    dim_contrast: String(data.config.dimmer.dim_contrast),
    wake_seconds: String(data.config.dimmer.wake_seconds),
  }
  const initialVolumes = { volume: String(data.config.sounds.volume), dark_volume: String(data.config.sounds.dark_volume) }
  const [dimmer, setDimmer] = useState<Record<keyof DimmerConfig, string>>(initialDimmer)
  const [soundsOn, setSoundsOn] = useState(data.config.sounds.enabled)
  const [volumes, setVolumes] = useState<Record<'volume' | 'dark_volume', string>>(initialVolumes)
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
  const dirty =
    DIMMER_FIELDS.some((f) => dimmer[f.key] !== initialDimmer[f.key]) ||
    soundsOn !== data.config.sounds.enabled ||
    SOUND_FIELDS.some((f) => volumes[f.key] !== initialVolumes[f.key])

  const save = useMutation({
    // Bindings are left out: the server keeps them (they're the Buttons page's).
    mutationFn: (config: Omit<DeviceConfig, 'buttons'>) =>
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
    save.mutate({ dimmer: parsed, sounds })
  }

  function discard() {
    setDimmer(initialDimmer)
    setSoundsOn(data.config.sounds.enabled)
    setVolumes(initialVolumes)
    setProblem(null)
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <SectionCard
        icon={Sun}
        title="Screen brightness"
        description="The device follows the room’s light. The press that wakes a dark screen does nothing else, so reaching over to check the time can’t switch anything."
      >
        <div className="divide-y">
          {DIMMER_FIELDS.map((f) => (
            <FieldRow key={f.key} id={`${id}-${f.key}`} label={f.label} help={f.help}>
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
            </FieldRow>
          ))}
          <ScreenLevels dimmer={parsed} valid={!invalid} current={preview} lux={data.sensors?.lux} />
        </div>
      </SectionCard>

      <SectionCard
        icon={Volume2}
        title="Buzzer"
        description="Beeps for button presses: armed, sending, done or failed. A failure always plays at full volume, even in the dark, so a door that didn’t close gets heard."
      >
        <div className="divide-y">
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <Label htmlFor={`${id}-sounds`}>Play sounds</Label>
            <Switch id={`${id}-sounds`} checked={soundsOn} onCheckedChange={setSoundsOn} disabled={!canEdit} />
          </div>
          {SOUND_FIELDS.map((f) => (
            <FieldRow key={f.key} id={`${id}-${f.key}`} label={f.label} help={f.help}>
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
            </FieldRow>
          ))}
          {canEdit && <SoundTester sounds={data.sounds} />}
        </div>
      </SectionCard>

      {problem && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}
      {canEdit && (
        // Sticks to the bottom of the viewport while the form scrolls under it, like Settings.
        <div className="sticky bottom-0 z-10 -mx-4 -mb-6 border-t bg-background/95 backdrop-blur sm:-mx-6">
          <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 sm:px-6">
            <span aria-live="polite" className="mr-auto text-sm text-muted-foreground">
              {dirty ? 'Unsaved changes' : 'No unsaved changes'}
            </span>
            <Button type="button" variant="ghost" disabled={!dirty || save.isPending} onClick={discard}>
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />} Save
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

/** The three screen levels, from the numbers as typed, with the room's current one marked. */
function ScreenLevels({ dimmer, valid, current, lux }: { dimmer: DimmerConfig; valid: boolean; current: string | null; lux: number | null | undefined }) {
  const levels = [
    { key: 'full brightness', name: 'Full brightness', when: valid ? `${dimmer.bright_lux} lx and above` : 'Bright room' },
    {
      key: 'dimmed',
      name: 'Dimmed',
      when: valid ? `${dimmer.dark_lux} to ${dimmer.bright_lux} lx, at brightness ${dimmer.dim_contrast}` : 'In between',
    },
    {
      key: 'off until a button is pressed',
      name: 'Off',
      when: valid ? `below ${dimmer.dark_lux} lx. A press wakes it dimmed for ${dimmer.wake_seconds} s` : 'Dark room',
    },
  ]
  return (
    <div className="grid gap-3 px-4 py-4 sm:px-6">
      <h3 className="text-sm font-semibold">How the screen decides</h3>
      <ul className="grid gap-2 text-sm">
        {levels.map((level) => {
          const here = valid && current === level.key
          return (
            <li key={level.key} className={cn('flex flex-wrap items-baseline gap-x-3 rounded-lg px-3 py-2', here ? 'bg-accent text-accent-foreground' : 'bg-muted/40')}>
              <span className="w-32 shrink-0 font-medium">{level.name}</span>
              <span className={here ? '' : 'text-muted-foreground'}>{level.when}</span>
              {here && <span className="ml-auto text-xs font-medium">the room is here now</span>}
            </li>
          )
        })}
      </ul>
      {current && valid && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          At the room&rsquo;s current {lux?.toFixed(1)} lx, the screen would be <strong>{current}</strong>.
        </p>
      )}
    </div>
  )
}

/** Play each sound on the device now, at its saved settings. */
function SoundTester({ sounds }: { sounds: SoundName[] }) {
  const play = useMutation({
    mutationFn: (sound: SoundName) => api('/api/device/sound', { method: 'POST', body: { sound } }),
    onError: (e) => toastError(e, 'The device didn’t get it'),
  })
  return (
    <div className="grid gap-3 px-4 py-4 sm:px-6">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Try the sounds</h3>
        <p className="text-sm text-muted-foreground">Plays on the device at the saved settings. Save first to hear a change.</p>
      </div>
      <ul className="grid gap-2">
        {sounds.map((sound) => (
          <li key={sound} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2">
            <div className="grid min-w-0 flex-1 basis-56 gap-0.5 text-sm">
              <span className="font-medium">{SOUND_INFO[sound].name}</span>
              <span className="text-xs text-muted-foreground">{SOUND_INFO[sound].when}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => play.mutate(sound)}
              disabled={play.isPending}
              aria-label={`Play the ${SOUND_INFO[sound].play.toLowerCase()} sound`}
            >
              <Volume2 aria-hidden="true" /> Play
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
