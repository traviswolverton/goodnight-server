import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AboutContent } from '@/routes/about'

describe('AboutContent', () => {
  it('has a card for each part of the app, all open, each with an id to link to', () => {
    const { container } = render(<AboutContent />)
    for (const id of ['device', 'buttons', 'actions', 'users']) expect(container.querySelector(`#${id}`)).not.toBeNull()
    for (const title of ['About the device', 'How buttons work', 'How actions work', 'Accounts and roles']) {
      expect(screen.getByRole('button', { name: `Details: ${title}` })).toHaveAttribute('aria-expanded', 'true')
    }
  })

  it('lets a card be closed', async () => {
    const user = userEvent.setup()
    render(<AboutContent />)
    const toggle = screen.getByRole('button', { name: 'Details: How buttons work' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('scrolls to the card a page linked to', () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    render(<AboutContent scrollTo="actions" />)
    expect(scrolled).toEqual(['actions'])
  })
})
