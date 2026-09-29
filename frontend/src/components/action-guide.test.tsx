import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ActionGuide } from '@/components/action-guide'

describe('ActionGuide', () => {
  it('starts open for a first visit and closed once there are actions', () => {
    const { unmount } = render(<ActionGuide defaultOpen />)
    expect(screen.getByRole('button', { name: 'Details: How actions work' })).toHaveAttribute('aria-expanded', 'true')
    unmount()
    render(<ActionGuide defaultOpen={false} />)
    expect(screen.getByRole('button', { name: 'Details: How actions work' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens and closes, and hides the sounds until asked', async () => {
    const user = userEvent.setup()
    render(<ActionGuide defaultOpen={false} />)
    const toggle = screen.getByRole('button', { name: 'Details: How actions work' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const sounds = screen.getByRole('button', { name: /The sounds you’ll hear/ })
    expect(sounds).toHaveAttribute('aria-expanded', 'false')
    await user.click(sounds)
    expect(sounds).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/A low falling buzz/)).toBeInTheDocument()
  })
})
