import { useQuery } from '@tanstack/react-query'
import { sessionQuery } from '@/lib/auth'

/** Admins may change things; viewers get a read-only UI (the API enforces the
 *  same rule — this only avoids offering buttons that would answer 403). */
export function useCanEdit(): boolean {
  const { data } = useQuery(sessionQuery)
  return data?.user.role === 'admin'
}
