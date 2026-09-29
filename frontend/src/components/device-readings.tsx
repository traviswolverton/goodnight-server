import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Droplets, Sun, Thermometer, type LucideIcon } from 'lucide-react'
import { StatusGlyph } from '@/components/status-pill'
import { deviceStatus } from '@/lib/device'
import { deviceQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'

const dash = '—'

/** The device's latest readings, always in the top bar, as a link to the
 *  Device page. Shows nothing until the first answer (or if there's never
 *  one), rather than a broken bar; dims the numbers when the device isn't
 *  reporting, since they're then the last ones it sent. */
export function DeviceReadings() {
  const { data } = useQuery(deviceQuery)
  if (!data) return null
  const { status, label } = deviceStatus(data)
  const s = data.sensors
  const c = s?.temperature_c
  const temp = c == null ? null : { c: c.toFixed(1), f: ((c * 9) / 5 + 32).toFixed(1) }
  const humidity = s?.humidity == null ? null : `${Math.round(s.humidity)}%`
  const lux = s?.lux == null ? null : `${s.lux.toFixed(1)}`
  const spoken = [
    `Device: ${label}`,
    temp ? `temperature ${temp.c} °C` : null,
    humidity ? `humidity ${humidity}` : null,
    lux ? `light ${lux} lx` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Link
      to="/device"
      aria-label={spoken}
      title={status === 'ok' ? label : `${label}: these are the last readings it sent`}
      className="flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-1 py-1 text-xs whitespace-nowrap hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:gap-4 sm:px-2 sm:text-sm"
    >
      <StatusGlyph status={status} />
      <span className={cn('flex min-w-0 items-center gap-2 sm:gap-4', status !== 'ok' && 'opacity-60')} aria-hidden="true">
        <Item icon={Thermometer}>
          {temp ? (
            <>
              {temp.c}
              <span className="sm:hidden">°</span>
              <span className="max-sm:hidden"> °C</span>
              <span className="text-muted-foreground max-md:hidden"> · {temp.f} °F</span>
            </>
          ) : (
            dash
          )}
        </Item>
        <Item icon={Droplets}>{humidity ?? dash}</Item>
        <Item icon={Sun}>
          {lux ?? dash}
          {lux && <span className="max-sm:hidden"> lx</span>}
        </Item>
      </span>
    </Link>
  )
}

function Item({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 font-medium tabular-nums">
      <Icon className="size-3.5 shrink-0 text-muted-foreground sm:size-4" />
      <span>{children}</span>
    </span>
  )
}
