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

/** "14:05" — the time of day of an ISO timestamp, in the viewer's locale. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** "Today", "Yesterday", or "Monday, Sep 28": the day an ISO timestamp falls on, for grouping a log. */
export function dayLabel(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return 'Unknown date'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}
