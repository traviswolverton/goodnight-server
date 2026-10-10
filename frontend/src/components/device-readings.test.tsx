import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceReadings } from '@/components/device-readings'
import { setCsrfToken } from '@/lib/api'
import type { DeviceResponse } from '@/lib/types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const base: DeviceResponse = {
  online: true, link_connected: true, sensors: { temperature_c: 21.44, humidity: 40.6, lux: 6.5, screen: 'dim', motion: false }, sensors_age_seconds: 3,
  presses: [], config: { dimmer: { bright_lux: 20, dark_lux: 2, dim_contrast: 1, wake_seconds: 15 }, sounds: { enabled: true, volume: 80, dark_volume: 10 }, buttons: {} },
  actions: [], num_buttons: 8, confirm_seconds: 5, sounds: [], ha_discovery: true,
}
const fetchMock = vi.fn<typeof fetch>()
const respond = (body: DeviceResponse) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(body)))

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DeviceReadings />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

describe('DeviceReadings', () => {
  it('links to the Device page with the readings as its name', async () => {
    respond(base)
    renderBar()
    const link = await screen.findByRole('link', { name: 'Device: Online, temperature 21.4 °C, humidity 41%, light 6.5 lx, no motion' })
    expect(link).toHaveAttribute('href', '/device')
  })

  it('shows dashes for what the device hasn’t reported, and says when it’s offline', async () => {
    respond({ ...base, online: false, sensors: null })
    renderBar()
    const link = await screen.findByRole('link', { name: 'Device: Offline' })
    expect(link).toHaveAttribute('title', 'Offline: these are the last readings it sent')
    expect(link).toHaveTextContent('—')
  })

  it('says when motion is detected, and leaves it out for firmware that doesn’t report it', async () => {
    respond({ ...base, sensors: { ...base.sensors!, motion: true } })
    const first = renderBar()
    expect(await screen.findByRole('link', { name: /light 6\.5 lx, motion detected$/ })).toBeInTheDocument()
    first.unmount()
    respond({ ...base, sensors: { ...base.sensors!, motion: null } })
    renderBar()
    expect(await screen.findByRole('link', { name: 'Device: Online, temperature 21.4 °C, humidity 41%, light 6.5 lx' })).toBeInTheDocument()
  })

  it('shows nothing until there is an answer', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })
})
