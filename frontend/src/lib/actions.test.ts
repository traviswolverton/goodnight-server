import { describe, expect, it } from 'vitest'
import { describeAction, explainAction, slugify } from '@/lib/actions'

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
    expect(describeAction({ id: 'bed', kind: 'event', service: null, target: null })).toBe('event bedside_dashboard_action (bed)')
  })
})

describe('explainAction', () => {
  const lamp = { id: 'lamp', kind: 'service', service: 'light.toggle', target: 'light.desk', confirm: false, verify: null } as const

  it('explains a plain action in two steps: send it, then the sounds', () => {
    const steps = explainAction(lamp)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toContain('calls the service light.toggle on light.desk')
    expect(steps[1]).toContain('only means the request was accepted')
  })

  it('walks through confirm and a check for a garage script', () => {
    const steps = explainAction({
      id: 'goodnight',
      kind: 'script',
      service: null,
      target: 'script.goodnight',
      confirm: true,
      verify: { entities: ['cover.left', 'cover.right'], state: 'closed', timeout: 45 },
    })
    expect(steps).toHaveLength(5)
    expect(steps[0]).toMatch(/armed.*within 5 seconds/)
    expect(steps[1]).toContain('cover.left and cover.right')
    expect(steps[1]).toContain('they’re all already closed')
    expect(steps[2]).toContain('runs the script script.goodnight')
    expect(steps[3]).toContain('up to 45 seconds')
  })

  it('ignores a check that isn’t filled in yet', () => {
    expect(explainAction({ ...lamp, verify: { entities: [], state: '', timeout: 30 } })).toHaveLength(2)
  })
})
