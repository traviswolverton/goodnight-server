import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@/components/theme-provider'
import { AppearancePage } from '@/routes/appearance'

const html = document.documentElement

function renderPage() {
  render(
    <ThemeProvider>
      <AppearancePage />
    </ThemeProvider>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  html.removeAttribute('data-accent')
  html.removeAttribute('data-radius')
  html.classList.remove('dark')
})

describe('AppearancePage', () => {
  it('starts on light blue and default corners', () => {
    renderPage()
    expect(html.dataset.accent).toBe('sky')
    expect(html.dataset.radius).toBe('default')
    expect(screen.getByRole('radio', { name: 'Sky' })).toBeChecked()
  })

  it('applies and remembers an accent, a corner style and a mode', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'Rose' }))
    await user.click(screen.getByRole('radio', { name: 'Round' }))
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(html.dataset.accent).toBe('rose')
    expect(html.dataset.radius).toBe('round')
    expect(html).toHaveClass('dark')
    expect(localStorage.getItem('dd-accent')).toBe('rose')
    expect(localStorage.getItem('dd-radius')).toBe('round')
    expect(localStorage.getItem('dd-theme')).toBe('dark')
  })

  it('restores what was saved, ignoring anything it no longer offers', () => {
    localStorage.setItem('dd-accent', 'teal')
    localStorage.setItem('dd-radius', 'triangular')
    renderPage()
    expect(html.dataset.accent).toBe('teal')
    expect(html.dataset.radius).toBe('default')
  })

  it('resets everything to the defaults', async () => {
    const user = userEvent.setup()
    localStorage.setItem('dd-accent', 'violet')
    renderPage()
    await user.click(screen.getByRole('radio', { name: 'Sharp' }))
    await user.click(screen.getByRole('button', { name: /Reset to defaults/ }))
    expect(html.dataset.accent).toBe('sky')
    expect(html.dataset.radius).toBe('default')
    expect(localStorage.getItem('dd-accent')).toBeNull()
  })
})
