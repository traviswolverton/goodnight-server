import { queryOptions } from '@tanstack/react-query'
import { api, ApiError, setCsrfToken } from '@/lib/api'

export type Role = 'admin' | 'viewer'

export interface User {
  id: number
  username: string
  email: string | null
  role: Role
  is_active: boolean
  has_password: boolean
  created_at: string
  last_login_at: string | null
}

export interface Session {
  user: User
  csrf_token: string
}

/** The signed-in session, or null when nobody is signed in. A null answer is
 *  data (show the login screen), not an error; anything else (server down,
 *  auth database unavailable) does throw. */
export async function fetchSession(): Promise<Session | null> {
  try {
    const session = await api<Session>('/api/auth/me', { expectUnauthorized: true })
    setCsrfToken(session.csrf_token)
    return session
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null)
      return null
    }
    throw error
  }
}

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: fetchSession,
  staleTime: 5 * 60_000,
  retry: false,
})

export async function login(username: string, password: string): Promise<Session> {
  const session = await api<Session>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    expectUnauthorized: true,
  })
  setCsrfToken(session.csrf_token)
  return session
}

export async function logout(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST' })
  } finally {
    setCsrfToken(null)
  }
}

/** Paths served by the backend itself (not this SPA): a full page load is
 *  needed to reach them. */
const SERVER_PREFIXES = ['/api', '/snapshot', '/schema', '/healthz']

/** A same-site absolute path, or undefined. Refuses `//host` and backslash tricks
 *  so `?next=` can never become an open redirect. */
export function safeNext(next: string | undefined | null): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return undefined
  return next
}

export function isServerPath(path: string): boolean {
  return SERVER_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))
}
