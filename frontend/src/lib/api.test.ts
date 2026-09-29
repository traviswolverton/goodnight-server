import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from '@/lib/api'

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
}

/** Runs a request that is expected to fail and returns its ApiError. */
async function failure(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request
  } catch (error) {
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('api()', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    setCsrfToken('tok-123')
    setUnauthorizedHandler(null)
  })
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  function lastHeaders() {
    return fetchMock.mock.calls.at(-1)![1]!.headers as Record<string, string>
  }

  it('sends the CSRF token on writes but not on reads', async () => {
    fetchMock.mockImplementation(async () => respond(200, {}))
    await api('/api/things')
    expect(lastHeaders()['X-CSRF-Token']).toBeUndefined()
    await api('/api/things', { method: 'POST', body: { a: 1 } })
    expect(lastHeaders()['X-CSRF-Token']).toBe('tok-123')
    expect(lastHeaders()['Content-Type']).toBe('application/json')
    expect(fetchMock.mock.calls.at(-1)![1]!.body).toBe('{"a":1}')
  })

  it('uses same-origin credentials so the session cookie is sent', async () => {
    fetchMock.mockImplementation(async () => respond(200, {}))
    await api('/api/things')
    expect(fetchMock.mock.calls[0][1]!.credentials).toBe('same-origin')
  })

  it('turns an error response into an ApiError carrying the server detail and Retry-After', async () => {
    fetchMock.mockImplementation(async () => respond(429, { detail: 'too many failed logins' }, { 'Retry-After': '120' }))
    const error = await failure(api('/api/auth/login', { method: 'POST' }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 429, message: 'too many failed logins', retryAfter: 120 })
  })

  it("doesn't leak FastAPI's validation error structure", async () => {
    fetchMock.mockImplementation(async () => respond(422, { detail: [{ loc: ['body', 'x'], msg: 'bad' }] }))
    const error = await failure(api('/api/things', { method: 'POST' }))
    expect(error.message).toBe('The request was not valid.')
  })

  it('reports an unreachable server as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await failure(api('/api/things'))
    expect(error).toMatchObject({ status: 0, message: 'Could not reach the server.' })
  })

  it('calls the unauthorized handler on a 401, except where a 401 is expected', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockImplementation(async () => respond(401, { detail: 'not authenticated' }))
    await api('/api/actions').catch(() => {})
    expect(handler).toHaveBeenCalledTimes(1)
    await api('/api/auth/login', { method: 'POST', expectUnauthorized: true }).catch(() => {})
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handles empty 204 responses', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    await expect(api('/api/things', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
