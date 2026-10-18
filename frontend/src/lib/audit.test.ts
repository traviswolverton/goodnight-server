import { describe, expect, it } from 'vitest'
import { describeAction } from '@/lib/audit'

describe('describeAction', () => {
  it('translates known actions and falls back to the raw name for unknown ones', () => {
    expect(describeAction('api.save_buttons')).toBe('Changed what the buttons do')
    expect(describeAction('login.failed')).toBe('Failed sign-in attempt')
    expect(describeAction('api.something_new')).toBe('api.something_new')
  })
})
