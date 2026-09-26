import { describe, expect, it } from 'vitest'
import { formatDateTime, formatUptime, templatesFromLines, timeAgo } from '@/lib/format'

describe('timeAgo', () => {
  const now = 1_000_000
  it.each([
    [null, 'never'],
    [now - 1, 'just now'],
    [now - 30, '30 s ago'],
    [now - 300, '5 min ago'],
    [now - 7200, '2 h ago'],
    [now - 172800, '2 d ago'],
  ])('%s -> %s', (ts, expected) => expect(timeAgo(ts, now)).toBe(expected))
  it('never goes negative for a timestamp slightly in the future', () => expect(timeAgo(now + 3, now)).toBe('just now'))
})

describe('templatesFromLines', () => {
  it('trims each line, keeps a blank middle line in place and drops blank trailing ones', () => {
    expect(templatesFromLines(['  {{ a }}  ', ' ', '{{ c }}', '', '  '])).toEqual(['{{ a }}', '', '{{ c }}'])
    expect(templatesFromLines(['', '', '', ''])).toEqual([])
  })
})

describe('formatDateTime', () => {
  it('shows a dash for missing or invalid values', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not a date')).toBe('—')
    expect(formatDateTime('2026-09-21T12:00:00+00:00')).not.toBe('—')
  })
})

describe('formatUptime', () => {
  it.each([
    [10, 'under a minute'],
    [300, '5 min'],
    [3 * 3600 + 120, '3 h 2 min'],
    [2 * 86400 + 5 * 3600, '2 d 5 h'],
  ])('%s s -> %s', (seconds, expected) => expect(formatUptime(seconds)).toBe(expected))
})
