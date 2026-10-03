import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cpu,
  Droplets,
  Gamepad2,
  Grid2x2,
  MousePointerClick,
  Sun,
  Thermometer,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { LoadError, LoadingBlocks } from '@/components/query-state'
import { ReadOnlyNote } from '@/components/read-only-note'
import { SectionCard } from '@/components/section-card'
import { StatusPill } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CardContent } from '@/components/ui/card'
import { useCanEdit } from '@/hooks/use-can-edit'
import { useNow } from '@/hooks/use-now'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  FLASH_SECONDS,
  HARDWARE,
  axisPercent,
  eventAge,
  heapLabel,
  reportStatus,
  signalWord,
  staleNote,
  uptimeLabel,
} from '@/lib/diagnostics'
import { diagnosticsQuery } from '@/lib/queries'
import type { DiagnosticsReport, DiagnosticsResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SoundTester } from '@/routes/device'

export function DiagnosticsPage() {
  usePageTitle('Diagnostics')
  const canEdit = useCanEdit()
  const { data, error, isPending, refetch } = useQuery(diagnosticsQuery)

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Diagnostics"
        description="What the device found at power-up and reads right now, for tracking down a loose wire or a dead sensor without a cable. While this page is open the device reports once a second."
      />
      {isPending ? (
        <LoadingBlocks />
      ) : error ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : (
        <DiagnosticsView data={data} canEdit={canEdit} />
      )}
    </div>
  )
}

export function DiagnosticsView({ data, canEdit }: { data: DiagnosticsResponse; canEdit: boolean }) {
  const now = useNow(1000)
  const { live } = reportStatus(data)
  const note = staleNote(data, now)
  const d = data.diagnostics
  return (
    <div className="grid gap-4">
      <StatusCard data={data} />
      {note && (
        <Alert role="status">
          <CircleHelp aria-hidden="true" />
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      )}
      {d && (
        // Greyed (not faded, which would cost text contrast) when it isn't current, so a green
        // tick from last week doesn't read as "fine". The note above says why in words.
        <div className={cn('grid gap-4', !live && 'grayscale')}>
          <HardwareCard report={d} />
          <SensorsCard data={data} />
          <ButtonsCard data={data} report={d} />
          <StickCard data={data} report={d} />
        </div>
      )}
      {canEdit ? (
        <SectionCard icon={Volume2} title="Sound test" description="Play a sound on the device’s buzzer to check it works.">
          <SoundTester sounds={data.sounds} />
        </SectionCard>
      ) : (
        <ReadOnlyNote />
      )}
    </div>
  )
}

function StatusCard({ data }: { data: DiagnosticsResponse }) {
  const { status, label } = reportStatus(data)
  const d = data.diagnostics
  const rssi = d?.wifi?.rssi
  const word = signalWord(rssi)
  return (
    <SectionCard icon={Cpu} title="Device" aside={<StatusPill status={status} label={label} />}>
      <CardContent className="px-4 py-4 sm:px-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="Running for" value={uptimeLabel(d?.uptime_s)} hint="A small number means it just restarted." />
          <Fact label="Wi-Fi signal" value={rssi == null ? '—' : `${rssi} dBm`} hint={word ?? undefined} />
          <Fact label="Address" value={d?.wifi?.ip ?? '—'} />
          <Fact label="Firmware built" value={d?.firmware ? d.firmware.replace(/\s+/g, ' ') : '—'} hint="Tells you whether it’s running old firmware." />
          <Fact label="Memory" value={heapLabel(d?.heap_free)} hint="Watch for it shrinking over time." />
          <Fact
            label="Last report"
            value={data.diagnostics_age_seconds === null ? (d ? 'unknown' : 'never') : `${Math.round(data.diagnostics_age_seconds)} s ago`}
          />
        </dl>
        {d?.setup_mode && (
          <Alert className="mt-4">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>In Wi-Fi setup mode</AlertTitle>
            <AlertDescription>The device is waiting to be given a network from a phone.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </SectionCard>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/50 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold break-words tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

function HardwareCard({ report }: { report: DiagnosticsReport }) {
  const hw = report.hardware
  const failed = hw ? HARDWARE.filter((h) => hw[h.key] === false) : []
  return (
    <SectionCard
      icon={CircleCheck}
      title="Hardware"
      description="What answered when the device started. A red one is almost always a wire."
      aside={
        hw && <StatusPill status={failed.length ? 'down' : 'ok'} label={failed.length ? `${failed.length} not answering` : 'All answering'} />
      }
    >
      {failed.length > 0 && (
        <CardContent className="px-4 pt-4 sm:px-6">
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>{failed.map((f) => f.name).join(', ')}: not answering</AlertTitle>
          </Alert>
        </CardContent>
      )}
      <ul className="divide-y text-sm" aria-label="Hardware checks">
        {HARDWARE.map(({ key, name, part, fault }) => {
          const ok = hw?.[key] ?? null
          return (
            <li key={key} className={cn('flex items-start gap-3 px-4 py-3 sm:px-6', ok === false && 'bg-destructive/10')}>
              <span aria-hidden="true" className="mt-0.5">
                {ok === true ? (
                  <CircleCheck className="size-5 text-success" />
                ) : ok === false ? (
                  <CircleAlert className="size-5 text-destructive" />
                ) : (
                  <CircleHelp className="size-5 text-muted-foreground" />
                )}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">
                  {name} <span className="font-normal text-muted-foreground">({part})</span>
                </span>
                {ok === false && <span className="text-destructive">{fault}</span>}
              </div>
              <span className={cn('shrink-0 text-xs font-semibold', ok === false ? 'text-destructive' : 'text-muted-foreground')}>
                {ok === true ? 'Answering' : ok === false ? 'Not answering' : 'Not reported'}
              </span>
            </li>
          )
        })}
      </ul>
    </SectionCard>
  )
}

function SensorsCard({ data }: { data: DiagnosticsResponse }) {
  const s = data.sensors
  const f = s?.temperature_c == null ? null : (s.temperature_c * 9) / 5 + 32
  return (
    <SectionCard icon={Thermometer} title="Sensors" description="The same readings the Device page shows.">
      <CardContent className="px-4 py-4 sm:px-6">
        <dl className="grid grid-cols-3 gap-3">
          <Sensor icon={Thermometer} label="Temperature" value={s?.temperature_c == null ? null : `${s.temperature_c.toFixed(1)} °C`} extra={f === null ? null : `${f.toFixed(1)} °F`} />
          <Sensor icon={Droplets} label="Humidity" value={s?.humidity == null ? null : `${Math.round(s.humidity)}%`} />
          <Sensor icon={Sun} label="Light" value={s?.lux == null ? null : `${s.lux.toFixed(1)} lx`} />
        </dl>
      </CardContent>
    </SectionCard>
  )
}

function Sensor({ icon: Icon, label, value, extra }: { icon: LucideIcon; label: string; value: string | null; extra?: string | null }) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/50 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" /> {label}
      </dt>
      {value === null ? (
        <dd className="text-sm font-semibold text-muted-foreground">No reading</dd>
      ) : (
        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      )}
      {extra && <dd className="text-xs text-muted-foreground tabular-nums">{extra}</dd>}
    </div>
  )
}

function ButtonsCard({ data, report }: { data: DiagnosticsResponse; report: DiagnosticsReport }) {
  const last = data.presses[0]
  return (
    <SectionCard
      icon={Grid2x2}
      title="Buttons"
      description="Press each one. A button lights while it’s held, and shows its last press for a moment."
    >
      <CardContent className="grid gap-3 px-4 py-4 sm:px-6">
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8" aria-label="Buttons 1 to 8">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => {
            const held = report.buttons_down.includes(n)
            const recent = data.presses.find((p) => p.button === n && eventAge(data, p.at) < FLASH_SECONDS)
            const state = held ? 'held' : recent ? `${recent.press} press` : 'idle'
            return (
              <li
                key={n}
                aria-label={`Button ${n}: ${state}`}
                className={cn(
                  'grid justify-items-center gap-0.5 rounded-lg border px-2 py-3 text-center transition-colors',
                  held ? 'border-primary bg-primary text-primary-foreground' : recent ? 'border-primary/60 bg-accent text-accent-foreground' : 'bg-muted/40 text-muted-foreground',
                )}
              >
                <span className="text-lg font-semibold tabular-nums">{n}</span>
                <span className="text-[11px]" aria-hidden="true">
                  {state}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MousePointerClick className="size-3.5" aria-hidden="true" />
          {last ? `Last press: button ${last.button}, ${last.press}, ${Math.round(eventAge(data, last.at))} s ago.` : 'No presses since the server started.'}
        </p>
      </CardContent>
    </SectionCard>
  )
}

const PAD: { key: 'up' | 'down' | 'left' | 'right'; icon: LucideIcon; cell: string }[] = [
  { key: 'up', icon: ArrowUp, cell: 'col-start-2 row-start-1' },
  { key: 'left', icon: ArrowLeft, cell: 'col-start-1 row-start-2' },
  { key: 'right', icon: ArrowRight, cell: 'col-start-3 row-start-2' },
  { key: 'down', icon: ArrowDown, cell: 'col-start-2 row-start-3' },
]

function StickCard({ data, report }: { data: DiagnosticsResponse; report: DiagnosticsReport }) {
  const stick = report.stick
  const recent = data.stick_events.filter((e) => eventAge(data, e.at) < FLASH_SECONDS).map((e) => e.stick)
  const direction = stick?.direction && stick.direction !== 'none' ? stick.direction : null
  const lit = (key: string) => direction === key || recent.includes(key as never)
  const pressed = stick?.pressed === true || recent.includes('press')
  const x = axisPercent(stick?.x)
  const y = axisPercent(stick?.y)
  const missing = report.hardware?.joystick === false
  return (
    <SectionCard
      icon={Gamepad2}
      title="Joystick"
      description="Push it each way and press it in. The dot is where the raw readings put it."
    >
      <CardContent className="flex flex-wrap items-center gap-6 px-4 py-4 sm:px-6">
        <div className="grid grid-cols-3 grid-rows-3 gap-1.5" role="group" aria-label="Joystick directions">
          {PAD.map(({ key, icon: Icon, cell }) => (
            <span
              key={key}
              aria-label={`${key}: ${lit(key) ? 'on' : 'off'}`}
              className={cn('grid size-12 place-items-center rounded-lg border', cell, lit(key) ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground')}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
          ))}
          <span
            aria-label={`press: ${pressed ? 'on' : 'off'}`}
            className={cn('col-start-2 row-start-2 grid size-12 place-items-center rounded-full border text-[11px] font-semibold', pressed ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground')}
          >
            press
          </span>
        </div>

        <div className="grid min-w-0 flex-1 basis-48 gap-3">
          {missing || x === null || y === null ? (
            <p className="text-sm text-muted-foreground">No joystick readings. {missing ? 'The device says the axes aren’t answering.' : ''}</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative size-24 shrink-0 rounded-md border bg-muted/40" aria-hidden="true">
                <span className="absolute top-1/2 left-0 h-px w-full bg-border" />
                <span className="absolute top-0 left-1/2 h-full w-px bg-border" />
                <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" style={{ left: `${x}%`, top: `${y}%` }} />
              </div>
              <dl className="grid gap-1 text-sm tabular-nums">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">x</dt>
                  <dd className="font-medium">{stick?.x}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">y</dt>
                  <dd className="font-medium">{stick?.y}</dd>
                </div>
                <p className="text-xs text-muted-foreground">0 to 4095, resting near 1900.</p>
              </dl>
            </div>
          )}
        </div>
      </CardContent>
    </SectionCard>
  )
}
