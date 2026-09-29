import { describe, expect, it } from 'vitest'
import { flattenSegments, insertText, matchesFilter, templatePath } from '@/lib/vars'

describe('matchesFilter', () => {
  const key = 'device.temperature_c'
  it('matches everything when there is no term', () => {
    expect(matchesFilter(key, '')).toBe(true)
    expect(matchesFilter(key, '   ')).toBe(true)
  })
  it('prefix-matches any dotted segment, not just the whole key', () => {
    expect(matchesFilter(key, 'dev')).toBe(true)
    expect(matchesFilter(key, 'temp')).toBe(true)
    expect(matchesFilter(key, 'rature')).toBe(false) // in the middle of a segment: not a prefix
  })
  it('*term* means contains', () => {
    expect(matchesFilter(key, '*rature*')).toBe(true)
    expect(matchesFilter(key, '*volume*')).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(matchesFilter(key, 'TEMP')).toBe(true)
  })
})

describe('templatePath', () => {
  it('uses dots for identifiers and brackets for keys that are not', () => {
    expect(templatePath(['device', 'lux'])).toBe('device.lux')
    expect(templatePath(['states', 'light.desk', 'state'])).toBe("states['light.desk'].state")
    expect(templatePath(['a', "it's"])).toBe("a['it\\'s']")
  })
})

describe('flattenSegments', () => {
  it('keeps a dotted key as one key', () => {
    expect(flattenSegments({ states: { 'light.desk': { state: 'on' } } })).toEqual([[['states', 'light.desk', 'state'], 'on']])
  })
})

describe('insertText', () => {
  it('replaces the selection and puts the caret after the insert', () => {
    expect(insertText('ab cd', 3, 5, '{{ x }}')).toEqual({ value: 'ab {{ x }}', caret: 10 })
  })
})
