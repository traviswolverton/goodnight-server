/** Thin fetch wrapper for the JSON API: same-origin cookies, JSON in/out, the
 *  session's CSRF token on every state-changing request, and one error type. */

export class ApiError extends Error {
  status: number
  /** Seconds, from a 429's Retry-After. */
  retryAfter?: number

  constructor(status: number, detail: string, retryAfter?: number) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

let csrfToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setCsrfToken(token: string | null) {
  csrfToken = token
}

/** Called when any request (other than the login/me probes) comes back 401 —
 *  i.e. the session expired or was revoked while the app was open. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** 401 is an expected answer here (login form, "am I signed in?" probe). */
  expectUnauthorized?: boolean
}

function detailOf(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return 'The request was not valid.' // FastAPI validation errors
  }
  return fallback
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, expectUnauthorized = false } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Could not reach the server.')
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const retryAfter = Number(response.headers.get('Retry-After')) || undefined
    if (response.status === 401 && !expectUnauthorized) onUnauthorized?.()
    throw new ApiError(response.status, detailOf(payload, response.statusText || 'Request failed'), retryAfter)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
