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
    sounds: { enabled: true, volume: 80, dark_volume: 10 },
    buttons: { '3': { short: 'lamp' } },
  },
  actions: [{ id: 'lamp', label: 'Lamp', confirm: false, verify: false }],
  num_buttons: 8,
  confirm_seconds: 5,
  sounds: ['armed', 'running', 'success', 'failure', 'cancel'],
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
  it('saves the dimmer and buzzer, leaving the bindings to the server', async () => {
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
      sounds: { enabled: true, volume: 80, dark_volume: 10 },
    })
  })

  it('saves the buzzer volumes', async () => {
    const user = userEvent.setup()
    renderForm()
    const dark = screen.getByLabelText('Volume in the dark (0–100)')
    await user.clear(dark)
    await user.type(dark, '0')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).sounds).toEqual({ enabled: true, volume: 80, dark_volume: 0 })
  })

  it('refuses a volume outside 0-100 without calling the server', async () => {
    const user = userEvent.setup()
    renderForm()
    const volume = screen.getByLabelText('Volume (0–100)')
    await user.clear(volume)
    await user.type(volume, '150')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Volume (0–100): enter a whole number from 0 to 100.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('plays a test sound on the device', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Play the failed sound' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/device/sound')
    expect(JSON.parse(init?.body as string)).toEqual({ sound: 'failure' })
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

  it('keeps Save off until something changes, and Discard puts it back', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    const volume = screen.getByLabelText('Volume (0–100)')
    await user.clear(volume)
    await user.type(volume, '50')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(volume).toHaveValue(80)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('marks where the room is now among the screen levels, as typed', async () => {
    const user = userEvent.setup()
    renderForm()
    expect(screen.getByText('the room is here now').closest('li')).toHaveTextContent('Dimmed')
    const dark = screen.getByLabelText('Screen off below (lux)')
    await user.clear(dark)
    await user.type(dark, '9')
    expect(screen.getByText('the room is here now').closest('li')).toHaveTextContent('Off')
  })

  it('keeps each setting’s explanation behind its (i)', async () => {
    const user = userEvent.setup()
    renderForm()
    const info = screen.getByRole('button', { name: 'About Volume (0–100)' })
    expect(info).toHaveAttribute('aria-expanded', 'false')
    await user.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Volume (0–100)')).toHaveAccessibleDescription('Normally, and for failures at any time.')
  })

  it('is read-only for viewers', () => {
    renderForm(false)
    expect(screen.getByLabelText('Full brightness at (lux)')).toBeDisabled()
    expect(screen.getByLabelText('Volume (0–100)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Play the/ })).toBeNull()
  })
})
