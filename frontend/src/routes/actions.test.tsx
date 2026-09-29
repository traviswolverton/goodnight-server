import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '@/lib/api'
import type { ActionsResponse } from '@/lib/types'
import { ActionEditor } from '@/routes/actions'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const data: ActionsResponse = {
  actions: [],
  home_assistant: { set_up: true, problem: null },
  context: { device: { temperature_c: 21.5 } },
  limits: { label_max: 23, state_max: 11 },
}

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function renderEditor(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ActionEditor original={null} data={data} onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  )
  return onDone
}

const lastBody = (path: string) => {
  const [, init] = fetchMock.mock.calls.findLast(([u]) => u === path)!
  return JSON.parse(init?.body as string)
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  setCsrfToken('csrf-1')
  fetchMock.mockImplementation(async (url) =>
    json(String(url).endsWith('/catalog') ? { entities: [], services: ['light.toggle'] } : { saved: true }),
  )
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  Object.values(toast).forEach((f) => f.mockReset())
  setCsrfToken(null)
})

describe('ActionEditor', () => {
  it('fills the id from the label and saves a service action', async () => {
    const user = userEvent.setup()
    const onDone = renderEditor()
    await user.type(screen.getByLabelText('Label'), 'Desk lamp')
    expect(screen.getByLabelText('Id')).toHaveValue('desk_lamp')
    await user.type(screen.getByLabelText('Service'), 'light.toggle')
    await user.type(screen.getByLabelText(/Target entity/), 'light.desk')
    await user.click(screen.getByRole('button', { name: 'Use the target’s state' }))
    await user.type(screen.getByLabelText(/Extra service data/), '{{"brightness_pct": 40}')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(lastBody('/api/actions')).toEqual({
      id: 'desk_lamp',
      label: 'Desk lamp',
      kind: 'service',
      service: 'light.toggle',
      target: 'light.desk',
      data: { brightness_pct: 40 },
      confirm: false,
      state_template: "{{ states['light.desk'].state }}",
      verify: null,
    })
  })

  it('saves a check that the action really happened', async () => {
    const user = userEvent.setup()
    const onDone = renderEditor()
    await user.type(screen.getByLabelText('Label'), 'Close garage')
    await user.type(screen.getByLabelText('Service'), 'cover.close_cover')
    await user.type(screen.getByLabelText(/Target entity/), 'cover.left, cover.right')
    await user.click(screen.getByRole('switch', { name: 'Check that it really happened' }))
    await user.click(screen.getByRole('button', { name: 'Use the target' }))
    await user.type(screen.getByLabelText('Must become'), 'closed')
    const within = screen.getByLabelText('Within (seconds)')
    await user.clear(within)
    await user.type(within, '45')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(lastBody('/api/actions').verify).toEqual({ entities: ['cover.left', 'cover.right'], state: 'closed', timeout: 45 })
  })

  it('refuses extra data that is not a JSON object', async () => {
    const user = userEvent.setup()
    const onDone = renderEditor()
    await user.type(screen.getByLabelText('Label'), 'Lamp')
    await user.type(screen.getByLabelText('Service'), 'light.toggle')
    await user.type(screen.getByLabelText(/Extra service data/), '[[1]')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Extra data must be a JSON object'))
    expect(onDone).not.toHaveBeenCalled()
  })
})
