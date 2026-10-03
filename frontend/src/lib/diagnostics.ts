import type { DiagnosticsHardware, DiagnosticsResponse } from '@/lib/types'
import { formatUptime, timeAgo } from '@/lib/format'

/** A report older than this is "not reporting": the device sends every 30 s,
 *  and every second while this page is open, so three missed ones is a lot. */
export const STALE_AFTER_SECONDS = 90

/** How long a button press or stick event stays lit after it arrives. */
export const FLASH_SECONDS = 2

/** The five things the device checks at boot, and where to look when one fails. */
export const HARDWARE: { key: keyof DiagnosticsHardware; name: string; part: string; fault: string }[] = [
  { key: 'oled', name: 'Display', part: 'OLED screen', fault: 'Didn’t answer. Check its SDA and SCL wires, power and ground.' },
  { key: 'light', name: 'Light sensor', part: 'BH1750', fault: 'Didn’t answer. Check its SDA and SCL wires, power and ground.' },
  { key: 'expander', name: 'Button reader', part: 'MCP23017', fault: 'Didn’t answer, so the 8 buttons and the stick press can’t be read. Check its SDA and SCL wires, power and ground.' },
  { key: 'joystick', name: 'Joystick axes', part: 'Analog X and Y', fault: 'Not reading. Check the stick’s two analog wires, power and ground.' },
  { key: 'climate', name: 'Temperature and humidity', part: 'DHT11', fault: 'Has no reading. Check its data wire, power and ground.' },
]

export type ReportStatus = 'ok' | 'down' | 'unknown'

/** Whether the latest report describes the device right now, and the words for it.
 *  `live` is false for anything that could be old: the diagnostics topic is retained,
 *  so a message can outlive the device that sent it. */
export function reportStatus(data: DiagnosticsResponse): { status: ReportStatus; label: string; live: boolean } {
  if (!data.link_connected) return { status: 'unknown', label: 'Server not connected to the broker', live: false }
  if (!data.diagnostics) return { status: 'unknown', label: 'No report yet', live: false }
  if (data.diagnostics_age_seconds === null) return { status: 'unknown', label: 'Waiting for a new report', live: false }
  if (data.online === false) return { status: 'down', label: 'Offline', live: false }
  if (data.diagnostics_age_seconds > STALE_AFTER_SECONDS) return { status: 'down', label: 'Not reporting', live: false }
  return { status: 'ok', label: 'Reporting', live: true }
}

/** One sentence on why the readings may not be current, or null when they are. */
export function staleNote(data: DiagnosticsResponse, now: number): string | null {
  const { live } = reportStatus(data)
  if (live) return null
  if (!data.link_connected) return 'The server can’t reach the broker, so nothing here is current.'
  if (!data.diagnostics) return 'The device hasn’t sent a report since the server started. It sends one every 30 seconds when it’s on.'
  if (data.diagnostics_age_seconds === null)
    return 'This is the last report the broker kept, from before the server connected. It may be old; a fresh one should arrive in a moment.'
  const reportedAt = now - data.diagnostics_age_seconds
  return `The device isn’t reporting. What’s below is its last report, ${timeAgo(reportedAt, now)}.`
}

export function signalWord(rssi: number | null | undefined): string | null {
  if (rssi === null || rssi === undefined) return null
  if (rssi >= -55) return 'strong'
  if (rssi >= -67) return 'good'
  if (rssi >= -75) return 'fair'
  return 'weak'
}

export function heapLabel(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? '—' : `${Math.round(bytes / 1024)} KB free`
}

export function uptimeLabel(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? '—' : formatUptime(seconds)
}

/** Seconds since an event, on the server's clock (it stamped the event). */
export function eventAge(data: DiagnosticsResponse, at: number): number {
  return Math.max(0, data.now - at)
}

/** Where a raw 12-bit axis reading sits along its track, 0 to 100. */
export function axisPercent(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  return Math.min(100, Math.max(0, (raw / 4095) * 100))
}
