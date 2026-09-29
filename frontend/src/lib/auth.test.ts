import { describe, expect, it } from 'vitest'
import { isServerPath, safeNext } from '@/lib/auth'
import { navFor } from '@/lib/nav'

describe('safeNext', () => {
  it('keeps same-site absolute paths', () => {
    expect(safeNext('/buttons')).toBe('/buttons')
    expect(safeNext('/actions?x=Card%201')).toBe('/actions?x=Card%201')
  })
  it.each(['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '', undefined, null])(
    'refuses %s (no open redirects)',
    (value) => expect(safeNext(value as string | undefined)).toBeUndefined(),
  )
})

describe('isServerPath', () => {
  it('flags paths the backend serves, not this app', () => {
    expect(isServerPath('/api/actions')).toBe(true)
    expect(isServerPath('/healthz')).toBe(true)
    expect(isServerPath('/buttons')).toBe(false)
    expect(isServerPath('/apiary')).toBe(false)
  })
})

describe('navFor', () => {
  it('hides admin-only sections from viewers', () => {
    expect(navFor('viewer').map((i) => i.label)).toEqual(['Home', 'Device', 'Actions', 'Buttons', 'MQTT reference'])
    expect(navFor('admin').map((i) => i.label)).toEqual(['Home', 'Device', 'Actions', 'Buttons', 'Settings', 'Users', 'MQTT reference'])
  })
})
