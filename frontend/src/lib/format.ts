/** "12 s ago" / "3 min ago" / "2 h ago" for a unix timestamp (seconds). */
export function timeAgo(unixSeconds: number | null | undefined, now = Date.now() / 1000): string {
  if (!unixSeconds) return 'never'
  const seconds = Math.max(0, Math.round(now - unixSeconds))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}

/** "3 d 4 h" / "5 min" for a duration in seconds. */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
