import { ApiError } from '@/lib/api'

/** A human message for a failed sign-in attempt. */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const minutes = error.retryAfter ? Math.max(1, Math.ceil(error.retryAfter / 60)) : null
      return minutes
        ? `Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
        : 'Too many failed attempts. Try again in a few minutes.'
    }
    if (error.status === 503) return 'Sign-in is temporarily unavailable. Please try again shortly.'
    if (error.status === 0) return error.message
    return error.message || 'Sign-in failed.'
  }
  return 'Sign-in failed.'
}
