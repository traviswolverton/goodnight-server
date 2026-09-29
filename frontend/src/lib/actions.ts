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

/** How long a button's row stays lit on the Buttons page after it's pressed. */
export const BUTTON_LIT_SECONDS = 10

/** How long an armed action waits for its second press (app/device.py). */
export const CONFIRM_SECONDS = 5

type Explainable = Pick<ActionConfig, 'id' | 'kind' | 'service' | 'target' | 'confirm'> & {
  verify?: { entities: string[]; state: string; timeout: number } | null
}

function listOf(items: string[]): string {
  if (items.length < 2) return items[0] ?? '…'
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** What a press of the button does, step by step, in plain words: the
 *  confirm press, the pre-check, the call, the wait, the sound. Mirrors
 *  app/device.py and app/actions.py; shown per action and live in the editor. */
export function explainAction(a: Explainable): string[] {
  const check = a.verify && a.verify.entities.length > 0 && a.verify.state ? a.verify : null
  const sends =
    a.kind === 'service'
      ? `calls the service ${a.service || '…'}${a.target ? ` on ${a.target}` : ''}`
      : a.kind === 'script'
        ? `runs the script ${a.target || '…'}`
        : `fires the desk_dashboard_action event (action: ${a.id || '…'}) for an automation to handle`
  const steps: string[] = []
  if (a.confirm) {
    steps.push(
      `First press: one beep, and it’s armed. Press the same button the same way again within ${CONFIRM_SECONDS} seconds to go ahead. Anything else cancels it, with a soft blip.`,
    )
  }
  if (check) {
    const one = check.entities.length === 1
    steps.push(
      `Looks at ${listOf(check.entities)} first. If ${one ? 'it’s' : 'they’re all'} already ${check.state}, nothing is sent and it counts as done.`,
    )
  }
  steps.push(`Two quick beeps while it goes to Home Assistant, which ${sends}.`)
  if (check) {
    steps.push(
      `Then it watches ${listOf(check.entities)} for up to ${check.timeout} seconds, waiting for ${check.entities.length === 1 ? 'it' : 'all of them'} to be ${check.state}.`,
    )
    steps.push('Three rising notes when that happens. A low buzz if time runs out or something becomes unavailable.')
  } else {
    steps.push(
      'Three rising notes once Home Assistant accepts it, or a low buzz if it refuses. With no check, that only means the request was accepted, not that anything moved.',
    )
  }
  return steps
}
