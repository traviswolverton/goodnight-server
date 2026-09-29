import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import type { ConnectionsResponse, DatabaseReport } from '@/lib/types'
import { ConnectionsSection } from '@/components/connections-section'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/restart', () => ({ waitForRestart: vi.fn(async () => true) }))

const connections: ConnectionsResponse = {
  mqtt: { source: 'env', host: '192.0.2.25', port: 1883, username: 'aggregator', password_set: true, connected: true },
  database: {
    source: 'env', configured: true, host: 'old.lan', port: 5432, database: 'bedside_dashboard',
    username: 'bedside_dashboard', password_set: true, available: true,
  },
  display: {
    source: 'env', host: '192.0.2.25', port: 1883, username: 'bedside-esp32', password_set: true,
    token_set: false, last_seen: null,
  },
  home_assistant: { url: 'http://ha.lan:8123', verify_ssl: true, token_set: true, status: 'connected' },
  can_save: true,
}

const report = (over: Partial<DatabaseReport>): DatabaseReport => ({
  connected: true, error: null, server_version: '17.2', schema: 'none', can_create_tables: true,
  user_count: 0, admins: [], same_as_current: false, modes: [], problems: [], ...over,
})

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let routes: Record<string, unknown> = {}

const bodyOf = (path: string, method: string) => {
  const [, init] = fetchMock.mock.calls.findLast(([u, i]) => u === path && i?.method === method)!
  return JSON.parse(init?.body as string)
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ConnectionsSection />
    </QueryClientProvider>,
  )
}

async function openDatabaseFlow(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole('button', { name: /Change/ }))[2]) // Home Assistant, MQTT, Database, Display
  await user.clear(screen.getByLabelText('Host'))
  await user.type(screen.getByLabelText('Host'), 'new.lan')
  await user.click(screen.getByRole('button', { name: 'Test' }))
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  routes = { '/api/connections': connections }
  fetchMock.mockImplementation(async (url) => json(routes[String(url)] ?? { saved: true, restarting: true }))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  Object.values(toast).forEach((f) => f.mockReset())
  setCsrfToken(null)
})

describe('ConnectionsSection', () => {
  it('keeps each explanation closed until asked, or all at once', async () => {
    const user = userEvent.setup()
    renderPage()
    const details = await screen.findByRole('button', { name: 'Details: Home Assistant' })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Details: MQTT broker' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByRole('button', { name: 'Details: MQTT broker' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(details).toHaveAttribute('aria-expanded', 'false')
  })

  it('won’t save a database the test says nobody could sign in to', async () => {
    const user = userEvent.setup()
    routes['/api/connections/database/test'] = report({
      schema: 'current', user_count: 3, problems: ['It has users but no active administrator.'],
    })
    renderPage()
    await openDatabaseFlow(user)
    expect(await screen.findByText('This database can’t be used')).toBeInTheDocument()
    expect(screen.getByText('It has users but no active administrator.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeDisabled()
  })

  it('offers copy or fresh for an empty database, and saves the choice', async () => {
    const user = userEvent.setup()
    routes['/api/connections/database/test'] = report({ modes: ['copy', 'fresh'] })
    renderPage()
    await openDatabaseFlow(user)
    expect(await screen.findByRole('radio', { name: /Copy everything/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Start empty/ }))
    await user.click(screen.getByRole('button', { name: 'Save and restart' }))
    const body = bodyOf('/api/connections/database', 'PUT')
    expect(body.mode).toBe('fresh')
    expect(body.fields.host).toBe('new.lan')
    expect(body.fields.password).toBe('') // blank = keep the current password
    expect(toast.success).toHaveBeenCalledWith('Now using bedside_dashboard on new.lan.')
  })

  it('warns about being signed out when switching to another database that has users', async () => {
    const user = userEvent.setup()
    routes['/api/connections/database/test'] = report({ schema: 'current', user_count: 2, admins: ['travis'], modes: ['use'] })
    renderPage()
    await openDatabaseFlow(user)
    expect(await screen.findByText('You’ll be signed out')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and restart' })).toBeEnabled()
  })

  it('keeps a failed broker test on the form', async () => {
    const user = userEvent.setup()
    routes['/api/connections/mqtt/test'] = { ok: false, error: '[code:135] Not authorized' }
    renderPage()
    await user.click((await screen.findAllByRole('button', { name: /Change/ }))[1])
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Couldn’t connect: [code:135] Not authorized')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and restart' })).not.toBeInTheDocument()
  })

  it('saves the device’s broker without restarting the app', async () => {
    const user = userEvent.setup()
    const { waitForRestart } = await import('@/lib/restart')
    routes['/api/connections/display/test'] = { ok: true, error: null }
    renderPage()
    await user.click((await screen.findAllByRole('button', { name: /Change/ }))[3])
    await user.clear(screen.getByLabelText('Host'))
    await user.type(screen.getByLabelText('Host'), 'new-broker.lan')
    await user.click(screen.getByRole('button', { name: 'Test' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(bodyOf('/api/connections/display', 'PUT').fields.host).toBe('new-broker.lan')
    expect(waitForRestart).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Saved. The device moves to new-broker.lan:1883 at its next check-in.')
  })

  it('tests Home Assistant, then saves it without restarting the app', async () => {
    const user = userEvent.setup()
    const { waitForRestart } = await import('@/lib/restart')
    routes['/api/connections/home-assistant/test'] = { ok: true, error: null, version: '2026.9.1', location_name: 'Home' }
    renderPage()
    await user.click((await screen.findAllByRole('button', { name: /Change/ }))[0])
    await user.clear(screen.getByLabelText('URL'))
    await user.type(screen.getByLabelText('URL'), 'http://ha2.lan:8123')
    await user.click(screen.getByRole('switch', { name: /TLS certificate/ }))
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/Home Assistant 2026\.9\.1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // A blank token keeps the saved one; it's never sent back to the page.
    expect(bodyOf('/api/connections/home-assistant', 'PUT').fields).toEqual({ url: 'http://ha2.lan:8123', token: '', verify_ssl: 'false' })
    expect(waitForRestart).not.toHaveBeenCalled()
  })

  it('keeps a failed Home Assistant test on the form', async () => {
    const user = userEvent.setup()
    routes['/api/connections/home-assistant/test'] = { ok: false, error: 'Home Assistant refused the token (401)' }
    renderPage()
    await user.click((await screen.findAllByRole('button', { name: /Change/ }))[0])
    await user.click(screen.getByRole('button', { name: 'Test' }))
    expect(await screen.findByText('Couldn’t connect: Home Assistant refused the token (401)')).toBeInTheDocument()
  })

  it('shows a new device token once, as the lines for secrets.h', async () => {
    const user = userEvent.setup()
    routes['/api/connections/display/token'] = { token: 'tok-123' }
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Device token/ }))
    await user.click(screen.getByRole('button', { name: 'Make a token' }))
    const snippet = (await screen.findByLabelText('secrets.h lines')) as HTMLTextAreaElement
    expect(snippet.value).toContain('#define DEVICE_TOKEN "tok-123"')
    expect(snippet.value).toContain(`#define SERVER_URL   "${window.location.origin}"`)
  })
})
