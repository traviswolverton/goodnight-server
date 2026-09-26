import type { ActionConfig } from '@/lib/types'

/** What an action does, in one line. */
export function describeAction(a: Pick<ActionConfig, 'kind' | 'service' | 'target' | 'id'>): string {
  if (a.kind === 'service') return `${a.service ?? '?'}${a.target ? ` → ${a.target}` : ''}`
  if (a.kind === 'script') return a.target ?? '?'
  return `event desk_dashboard_action (${a.id})`
}

/** An id from a label: "Desk lamp" → "desk_lamp". */
export function slugify(label: string, max = 23): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
  return slug.slice(0, max).replace(/_+$/, '')
}
