import { describe, expect, it } from 'vitest'
import { splitList } from '@/lib/adapter-fields'
import { describeAction, slugify } from '@/lib/actions'

describe('slugify', () => {
  it('makes a valid action id from a label', () => {
    expect(slugify('Desk lamp')).toBe('desk_lamp')
    expect(slugify('  2nd floor — Fan!  ')).toBe('nd_floor_fan')
    expect(slugify('x'.repeat(40))).toHaveLength(23)
  })
})

describe('describeAction', () => {
  it('summarises each kind in one line', () => {
    expect(describeAction({ id: 'a', kind: 'service', service: 'light.toggle', target: 'light.desk' })).toBe('light.toggle → light.desk')
    expect(describeAction({ id: 'a', kind: 'script', service: null, target: 'script.movie' })).toBe('script.movie')
    expect(describeAction({ id: 'bed', kind: 'event', service: null, target: null })).toBe('event desk_dashboard_action (bed)')
  })
})

describe('splitList', () => {
  it('splits and trims a comma-separated field, dropping blanks', () => {
    expect(splitList(' light.desk,, sensor.* ,')).toEqual(['light.desk', 'sensor.*'])
  })
})
