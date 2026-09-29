import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import type { SettingField, SettingsResponse } from '@/lib/types'
import { PreferencesSection } from '@/routes/settings'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const field = (over: Partial<SettingField> & Pick<SettingField, 'key' | 'label' | 'kind'>): SettingField => ({
  group: 'Sign-in and security', help: '', minimum: null, maximum: null, unit: null, options: [], placeholder: null,
  value: null, baseline: null, source: 'default', ...over,
})

const data: SettingsResponse = {
  fields: [
    field({ key: 'session_idle_hours', label: 'Sign out after idle', kind: 'number', value: 24, baseline: 24, unit: 'hours', source: 'env' }),
    field({ key: 'audit_retention_days', label: 'Keep audit log for', kind: 'integer', value: 90, baseline: 365, source: 'app' }),
    field({ key: 'https_only', label: 'HTTPS only', kind: 'boolean', group: 'Sign-in and security', value: false, baseline: false }),
    field({ key: 'ollama_base_url', label: 'Ollama URL', kind: 'text', group: 'AI assist', value: 'http://ollama:11434' }),
    field({ key: 'ollama_model', label: 'Model', kind: 'text', group: 'AI assist', value: 'qwen2.5:14b' }),
  ],
  request_is_https: false,
}

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let routes: Record<string, unknown> = {}
const putBody = () => {
  const [, init] = fetchMock.mock.calls.findLast(([, i]) => i?.method === 'PUT')!
  return JSON.parse(init?.body as string)
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PreferencesSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  routes = { '/api/settings': data }
  fetchMock.mockImplementation(async (url) => json(routes[String(url)] ?? data))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  Object.values(toast).forEach((f) => f.mockReset())
  setCsrfToken(null)
})

describe('PreferencesSection', () => {
  it('keeps a setting’s explanation behind its (i) until asked', async () => {
    const user = userEvent.setup()
    routes['/api/settings'] = { ...data, fields: data.fields.map((f) => (f.key === 'audit_retention_days' ? { ...f, help: 'Older entries are removed at start-up.' } : f)) }
    renderPage()
    const info = await screen.findByRole('button', { name: 'About Keep audit log for' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    await user.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Keep audit log for')).toHaveAccessibleDescription('Older entries are removed at start-up.')
  })

  it('sends only what changed, and resets as null', async () => {
    const user = userEvent.setup()
    renderPage()
    const idle = await screen.findByLabelText('Sign out after idle')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.clear(idle)
    await user.type(idle, '30')
    await user.click(screen.getByRole('button', { name: /Reset/ })) // only the audit log setting is "Set here"
    expect(screen.getByText('2 unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(putBody()).toEqual({ values: { session_idle_hours: '30', audit_retention_days: null } })
    expect(toast.success).toHaveBeenCalled()
  })

  it('shows a refused save’s reason', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'PUT' ? json({ detail: 'Sign out after idle: must be at most 720' }, 400) : json(data),
    )
    renderPage()
    const idle = await screen.findByLabelText('Sign out after idle')
    await user.clear(idle)
    await user.type(idle, '9999')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Sign out after idle: must be at most 720')).toBeInTheDocument()
  })

  it('won’t let HTTPS only be switched on from a plain-HTTP page', async () => {
    renderPage()
    expect(await screen.findByRole('switch', { name: 'HTTPS only' })).toBeDisabled()
    expect(screen.getByText(/through its HTTPS address/)).toBeInTheDocument()
  })

  it('turns the model into a picker once Ollama answers', async () => {
    const user = userEvent.setup()
    routes['/api/settings/ollama/test'] = { ok: true, error: null, models: ['llama3.1:8b', 'qwen2.5:14b'] }
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Test Ollama' }))
    expect(await screen.findByText(/Reached it: 2 models/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
  })
})
