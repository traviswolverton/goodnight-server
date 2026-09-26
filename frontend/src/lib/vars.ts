/** Helpers for the variables panel: finding, filtering and writing template paths. */

/** `*text*` = contains. Otherwise the term must prefix any dot-separated
 *  segment: keys are always `adapters.<name>.<field>`, so a plain startsWith
 *  could never match "adg" against "adapters.adguard_main.percent_blocked". */
export function matchesFilter(key: string, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  const haystack = key.toLowerCase()
  if (needle.length > 1 && needle.startsWith('*') && needle.endsWith('*')) {
    return haystack.includes(needle.slice(1, -1))
  }
  return haystack.split('.').some((segment) => segment.startsWith(needle))
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A template path from its keys: `adapters.home_assistant.entities['light.desk'].state`.
 *  A key that isn't a plain identifier (entity ids have dots in them) needs
 *  bracket notation, or Jinja2 would read its dots as more lookups. */
export function templatePath(segments: string[]): string {
  return segments
    .map((segment, i) => (IDENTIFIER.test(segment) ? (i === 0 ? segment : `.${segment}`) : `['${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`))
    .join('')
}

/** Every leaf value (arrays count as one) with the keys leading to it, kept
 *  as key lists so a key with dots in it (an entity id) stays one key. */
export function flattenSegments(obj: Record<string, unknown>, prefix: string[] = []): [string[], unknown][] {
  const rows: [string[], unknown][] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      rows.push(...flattenSegments(value as Record<string, unknown>, path))
    } else {
      rows.push([path, value])
    }
  }
  return rows
}

/** `text` put into `value` in place of the selection [start, end), and where
 *  the caret goes afterwards (just after it). */
export function insertText(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length }
}
