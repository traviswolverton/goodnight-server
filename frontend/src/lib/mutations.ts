import { toast } from 'sonner'
import { ApiError } from '@/lib/api'

/** A message fit for a toast from anything a mutation can throw. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) return error.status === 403 ? 'You need administrator access for that.' : error.message
  return error instanceof Error ? error.message : fallback
}

export function toastError(error: unknown, fallback?: string) {
  toast.error(errorMessage(error, fallback))
}
