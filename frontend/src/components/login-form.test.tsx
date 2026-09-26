import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '@/components/login-form'
import { setCsrfToken } from '@/lib/api'

const session = { user: { id: 1, username: 'alice', role: 'admin' }, csrf_token: 'csrf-1' }
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  setCsrfToken(null)
})

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('<LoginForm>', () => {
  it("won't submit until both fields are filled", () => {
    render(<LoginForm onSuccess={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('posts the credentials and reports the session on success', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(session), { status: 200 }))
    const onSuccess = vi.fn()
    const user = userEvent.setup()
    render(<LoginForm onSuccess={onSuccess} />)
    await fillAndSubmit(user)

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(session))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(JSON.parse(init!.body as string)).toEqual({ username: 'alice', password: 'correct horse battery' })
  })

  it.each([
    [401, { detail: 'invalid username or password' }, {}, 'invalid username or password'],
    [429, { detail: 'too many failed logins' }, { 'Retry-After': '600' }, 'Try again in about 10 minutes'],
    [503, { detail: 'authentication is temporarily unavailable' }, {}, 'temporarily unavailable'],
  ])('shows a clear message for a %i', async (status, body, headers, expected) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status, headers }))
    const onSuccess = vi.fn()
    const user = userEvent.setup()
    render(<LoginForm onSuccess={onSuccess} />)
    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()   // can retry
  })

  it('tells the user when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    render(<LoginForm onSuccess={() => {}} />)
    await fillAndSubmit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  })
})
