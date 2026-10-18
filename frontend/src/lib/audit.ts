import { dayLabel } from '@/lib/format'
import type { AuditEntry } from '@/lib/types'

/** Plain-language labels for audit-log actions. The raw action name stays
 *  available (as a tooltip) for anyone correlating with server logs. */
const LABELS: Record<string, string> = {
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in attempt',
  'login.blocked': 'Sign-in blocked (too many attempts)',
  logout: 'Signed out',
  'password.change': 'Changed their password',
  'user.bootstrap': 'First administrator created',
  'user.create': 'Created a user',
  'user.update': 'Changed a user',
  'user.delete': 'Deleted a user',
  'user.reset_password': 'Reset a user’s password',
  'api.play_sound': 'Played a test sound on the device',
  'api.save_config': 'Changed the device settings',
  'api.save_buttons': 'Changed what the buttons do',
  'api.restart_app': 'Restarted the app',
  'api.test_home_assistant': 'Tested a Home Assistant connection',
  'api.save_home_assistant_connection': 'Changed the Home Assistant connection',
}

export function describeAction(action: string): string {
  return LABELS[action] ?? action
}

/** The log's entries, in the order given, under a heading per day. */
export function groupByDay(entries: AuditEntry[], now = new Date()): { day: string; entries: AuditEntry[] }[] {
  const groups: { day: string; entries: AuditEntry[] }[] = []
  for (const entry of entries) {
    const day = dayLabel(entry.ts, now)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}
