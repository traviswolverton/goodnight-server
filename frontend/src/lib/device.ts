import type { DeviceResponse, DimmerConfig } from '@/lib/types'

/** What the screen would do at `lux` with these settings — the page's own
 *  sanity check, not a promise: the device adds hysteresis and a woken state. */
export function screenAt(lux: number | null | undefined, d: DimmerConfig): string | null {
  if (lux === null || lux === undefined) return null
  if (lux >= d.bright_lux) return 'full brightness'
  if (lux >= d.dark_lux) return 'dimmed'
  return 'off until a button is pressed'
}

/** Whether the device is there, and the words for it. */
export function deviceStatus(data: DeviceResponse): { status: 'ok' | 'down' | 'unknown'; label: string } {
  if (!data.link_connected) return { status: 'unknown', label: 'Server not connected to the broker' }
  if (data.online === null) return { status: 'unknown', label: 'Not heard from yet' }
  return data.online ? { status: 'ok', label: 'Online' } : { status: 'down', label: 'Offline' }
}
