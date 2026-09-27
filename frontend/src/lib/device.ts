import type { DimmerConfig } from '@/lib/types'

/** What the screen would do at `lux` with these settings — the page's own
 *  sanity check, not a promise: the device adds hysteresis and a woken state. */
export function screenAt(lux: number | null | undefined, d: DimmerConfig): string | null {
  if (lux === null || lux === undefined) return null
  if (lux >= d.bright_lux) return 'full brightness'
  if (lux >= d.dark_lux) return 'dimmed'
  return 'off until a button is pressed'
}
