import { describe, expect, it } from 'vitest'
import { flattenSegments, insertText, matchesFilter, templatePath } from '@/lib/vars'

describe('matchesFilter', () => {
  const key = 'adapters.adguard_main.percent_blocked'
  it('matches everything when there is no term', () => {
    expect(matchesFilter(key, '')).toBe(true)
    expect(matchesFilter(key, '   ')).toBe(true)
  })
  it('prefix-matches any dotted segment, not just the whole key', () => {
    expect(matchesFilter(key, 'adg')).toBe(true)
    expect(matchesFilter(key, 'percent')).toBe(true)
    expect(matchesFilter(key, 'main')).toBe(false) // in the middle of a segment: not a prefix
  })
  it('*term* means contains', () => {
    expect(matchesFilter(key, '*main*')).toBe(true)
    expect(matchesFilter(key, '*volume*')).toBe(false)
  })
  it('is case-insensitive', () => {
    expect(matchesFilter(key, 'ADG')).toBe(true)
  })
})

describe('templatePath', () => {
  it('uses dots for identifiers and brackets for keys that are not', () => {
    expect(templatePath(['adapters', 'proxmox', 'status'])).toBe('adapters.proxmox.status')
    expect(templatePath(['adapters', 'home_assistant', 'entities', 'light.desk', 'state'])).toBe("adapters.home_assistant.entities['light.desk'].state")
    expect(templatePath(['a', "it's"])).toBe("a['it\\'s']")
  })
})

describe('flattenSegments', () => {
  it('keeps a dotted key as one key', () => {
    expect(flattenSegments({ entities: { 'light.desk': { state: 'on' } } })).toEqual([[['entities', 'light.desk', 'state'], 'on']])
  })
})

describe('insertText', () => {
  it('replaces the selection and puts the caret after the insert', () => {
    expect(insertText('ab cd', 3, 5, '{{ x }}')).toEqual({ value: 'ab {{ x }}', caret: 10 })
  })
})
