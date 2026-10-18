import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import type { DeviceResponse } from '@/lib/types'
import { BindingDialog, ButtonList } from '@/routes/buttons'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const data: DeviceResponse = {
  online: true,
  link_connected: true,
  sensors: null,
  sensors_age_seconds: null,
  presses: [{ button: 6, press: 'long', at: Date.now() / 1000 - 2, action: null, ok: null, text: null }],
  config: {
    dimmer: { bright_lux: 20, dark_lux: 2, dim_contrast: 1, wake_seconds: 15, idle_off_minutes: 15 },
    sounds: { enabled: true, volume: 80, dark_volume: 10 },
    buttons: { '1': { short: 'lamp', long: 'garage' }, '8': { short: 'lamp' } },
  },
  actions: [
    { id: 'lamp', label: 'Lamp', confirm: false, verify: false },
    { id: 'garage', label: 'Close garage', confirm: true, verify: true },
  ],
  num_buttons: 8,
  confirm_seconds: 5,
  sounds: ['armed', 'running', 'success', 'failure', 'cancel'],
  ha_discovery: true,
}

const fetchMock = vi.fn<typeof fetch>()

function withClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeAll(() => {
  // Radix Select uses these; jsdom doesn't have them.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ saved: true })))
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  Object.values(toast).forEach((f) => f.mockReset())
  setCsrfToken(null)
})

describe('ButtonList', () => {
  it('lists the eight buttons in device order with what each press runs', () => {
    withClient(<ButtonList data={data} canEdit onEdit={() => {}} />)
    const tiles = within(screen.getByRole('list', { name: 'Buttons' })).getAllByRole('button')
    expect(tiles).toHaveLength(8)
    expect(tiles[0]).toHaveAccessibleName('Button 1: short press Lamp, long press Close garage')
    expect(tiles[1]).toHaveAccessibleName('Button 2: short press nothing, long press nothing')
    expect(tiles[7]).toHaveAccessibleName('Button 8: short press Lamp, long press nothing')
  })

  it('flags actions that ask to confirm or are checked', () => {
    withClient(<ButtonList data={data} canEdit onEdit={() => {}} />)
    const first = screen.getByRole('button', { name: /^Button 1:/ })
    expect(within(first).getByText('Asks to confirm')).toBeInTheDocument()
    expect(within(first).getByText('Checked')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^Button 8:/ })).queryByText('Asks to confirm')).toBeNull()
  })

  it('lights up a button that was just pressed', () => {
    withClient(<ButtonList data={data} canEdit onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: /^Button 6:.*just pressed$/ })).toHaveTextContent('long press')
  })

  it('opens the editor for the tile clicked, and not for viewers', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const { unmount } = withClient(<ButtonList data={data} canEdit onEdit={onEdit} />)
    await user.click(screen.getByRole('button', { name: /^Button 3:/ }))
    expect(onEdit).toHaveBeenCalledWith(3)
    unmount()
    withClient(<ButtonList data={data} canEdit={false} onEdit={onEdit} />)
    expect(screen.getByRole('button', { name: /^Button 3:/ })).toBeDisabled()
  })
})

describe('BindingDialog', () => {
  it('saves only the bindings, keeping the other buttons', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    withClient(<BindingDialog data={data} button={4} onClose={onClose} />)
    await user.click(screen.getByRole('combobox', { name: 'Long press' }))
    await user.click(screen.getByRole('option', { name: 'Close garage' }))
    expect(screen.getByText('This one asks for a second press and checks that it happened.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/device/buttons')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      buttons: { '1': { short: 'lamp', long: 'garage' }, '4': { short: null, long: 'garage' }, '8': { short: 'lamp' } },
    })
    expect(toast.success).toHaveBeenCalledWith('Button 4 saved.')
  })

  it('drops a button left with nothing bound', async () => {
    const user = userEvent.setup()
    withClient(<BindingDialog data={data} button={8} onClose={() => {}} />)
    await user.click(screen.getByRole('combobox', { name: 'Short press' }))
    await user.click(screen.getByRole('option', { name: 'Nothing' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).buttons).toEqual({ '1': { short: 'lamp', long: 'garage' } })
  })
})
