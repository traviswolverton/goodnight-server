import { describe, expect, it } from 'vitest'
import { isServerPath, safeNext } from '@/lib/auth'
import { navFor } from '@/lib/nav'

describe('safeNext', () => {
  it('keeps same-site absolute paths', () => {
    expect(safeNext('/cards')).toBe('/cards')
    expect(safeNext('/cards?card=Card%201')).toBe('/cards?card=Card%201')
  })
  it.each(['//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '', undefined, null])(
    'refuses %s (no open redirects)',
    (value) => expect(safeNext(value as string | undefined)).toBeUndefined(),
  )
})

describe('isServerPath', () => {
  it('flags paths the backend serves, not this app', () => {
    expect(isServerPath('/schema/status_payload.schema.json')).toBe(true)
    expect(isServerPath('/snapshot/front_door')).toBe(true)
    expect(isServerPath('/cards')).toBe(false)
    expect(isServerPath('/apiary')).toBe(false)
  })
})

describe('navFor', () => {
  it('hides admin-only sections from viewers', () => {
    expect(navFor('viewer').map((i) => i.label)).toEqual(['Home', 'Device', 'Cards', 'Pixels', 'Actions', 'MQTT reference'])
    expect(navFor('admin').map((i) => i.label)).toEqual(['Home', 'Device', 'Cards', 'Pixels', 'Actions', 'Adapters', 'Users', 'MQTT reference'])
  })
})
