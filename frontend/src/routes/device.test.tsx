import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import { screenAt } from '@/lib/device'
import type { DeviceResponse } from '@/lib/types'
import { SettingsForm } from '@/routes/device'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const data: DeviceResponse = {
  online: true,
  link_connected: true,
  sensors: { temperature_c: 21, humidity: 40, lux: 5, screen: 'dim' },
  sensors_age_seconds: 3,
  presses: [],
  config: {
    dimmer: { bright_lux: 20, dark_lux: 2, dim_contrast: 1, wake_seconds: 15 },
    buttons: { '3': { short: 'lamp' } },
  },
  actions: [{ id: 'lamp', label: 'Lamp' }],
  num_buttons: 8,
  ha_discovery: true,
}

const fetchMock = vi.fn<typeof fetch>()

function renderForm(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SettingsForm data={data} canEdit={canEdit} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ saved: true, sent_to_device: true })))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  Object.values(toast).forEach((f) => f.mockReset())
  setCsrfToken(null)
})

describe('screenAt', () => {
  const d = data.config.dimmer
  it('matches the device thresholds', () => {
    expect(screenAt(20, d)).toBe('full brightness')
    expect(screenAt(2, d)).toBe('dimmed')
    expect(screenAt(1.5, d)).toBe('off until a button is pressed')
    expect(screenAt(null, d)).toBeNull()
  })
})

describe('SettingsForm', () => {
  it('saves the dimmer and keeps existing button bindings', async () => {
    const user = userEvent.setup()
    renderForm()
    const bright = screen.getByLabelText('Full brightness at (lux)')
    await user.clear(bright)
    await user.type(bright, '40')
    expect(screen.getByText(/the screen would be/)).toHaveTextContent('dimmed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved and sent to the device.'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/device/config')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      dimmer: { bright_lux: 40, dark_lux: 2, dim_contrast: 1, wake_seconds: 15 },
      buttons: { '3': { short: 'lamp' } },
    })
  })

  it('refuses a dark level above the bright one without calling the server', async () => {
    const user = userEvent.setup()
    renderForm()
    const dark = screen.getByLabelText('Screen off below (lux)')
    await user.clear(dark)
    await user.type(dark, '50')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('must not be above the full-brightness level')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is read-only for viewers', () => {
    renderForm(false)
    expect(screen.getByLabelText('Full brightness at (lux)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
