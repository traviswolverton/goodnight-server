import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import type { User } from '@/lib/auth'
import type { AuditEntry } from '@/lib/types'
import { groupByDay } from '@/lib/audit'
import { UsersPage } from '@/routes/users'

// The page's "How it works" link is a router <Link>; a plain anchor stands in for it here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, hash, children }: { to: string; hash?: string; children: React.ReactNode }) => <a href={hash ? `${to}#${hash}` : to}>{children}</a>,
}))

const user = (over: Partial<User>): User => ({
  id: 1, username: 'alex', email: null, role: 'admin', is_active: true, has_password: true, created_at: '', last_login_at: null, ...over,
})
const users: User[] = [
  user({ id: 1, username: 'alex', email: 'alex@example.com' }),
  user({ id: 2, username: 'guest', role: 'viewer', is_active: false }),
]
const entry = (id: number, ts: string, action = 'login.success'): AuditEntry =>
  ({ id, ts, action, username: 'alex', target: null, detail: null, ip: '192.0.2.5' }) as AuditEntry

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown) => new Response(JSON.stringify(body))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  fetchMock.mockImplementation(async (url) => {
    const path = String(url)
    if (path === '/api/auth/me') return json({ user: users[0], csrf_token: 'csrf-1' })
    if (path.startsWith('/api/audit-log')) return json({ entries: [entry(2, new Date().toISOString()), entry(1, new Date(2020, 0, 5, 9, 0).toISOString(), 'user.create')] })
    return json({ users })
  })
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

describe('UsersPage', () => {
  it('lists each account with its role, marking you and disabled ones', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: 'Accounts' })
    const [me, guest] = within(list).getAllByRole('listitem')
    expect(me).toHaveTextContent('alex')
    expect(me).toHaveTextContent('(you)')
    expect(me).toHaveTextContent('admin')
    expect(guest).toHaveTextContent('viewer')
    expect(guest).toHaveTextContent('Disabled')
    expect(screen.getByRole('button', { name: 'Delete alex' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete guest' })).toBeEnabled()
    expect(screen.getByText('2 accounts, 1 active administrator.')).toBeInTheDocument()
  })

  it('links to its part of the About page', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /How it works/ })).toHaveAttribute('href', '/about#users')
  })

  it('shows the activity log under a heading per day', async () => {
    const ux = userEvent.setup()
    renderPage()
    await ux.click(await screen.findByRole('tab', { name: 'Activity' }))
    expect(await screen.findByRole('region', { name: 'Today' })).toHaveTextContent('Signed in')
    expect(screen.getByText('Created a user')).toBeInTheDocument()
  })
})

describe('groupByDay', () => {
  it('groups neighbouring entries from the same day, keeping order', () => {
    const now = new Date(2026, 8, 29, 15, 0)
    const groups = groupByDay(
      [entry(1, new Date(2026, 8, 29, 14, 0).toISOString()), entry(2, new Date(2026, 8, 29, 9, 0).toISOString()), entry(3, new Date(2026, 8, 28, 20, 0).toISOString())],
      now,
    )
    expect(groups.map((g) => [g.day, g.entries.map((e) => e.id)])).toEqual([['Today', [1, 2]], ['Yesterday', [3]]])
  })
})
