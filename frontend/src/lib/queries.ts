import { queryOptions } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import type {
  ActionsResponse,
  AdaptersResponse,
  AdapterType,
  AuditEntry,
  CardsResponse,
  MqttReference,
  Overview,
  PixelsResponse,
  StatusPayload,
} from '@/lib/types'
import type { User } from '@/lib/auth'

export const cardsQuery = queryOptions({
  queryKey: ['cards'],
  queryFn: () => api<CardsResponse>('/api/cards'),
  refetchInterval: 15_000, // the variable table is live data
})

export const pixelsQuery = queryOptions({
  queryKey: ['pixels'],
  queryFn: () => api<PixelsResponse>('/api/pixels'),
  refetchInterval: 15_000,
})

export const actionsQuery = queryOptions({
  queryKey: ['actions'],
  queryFn: () => api<ActionsResponse>('/api/actions'),
  refetchInterval: 15_000, // live states
})

export const swatchesQuery = queryOptions({
  queryKey: ['color-swatches'],
  queryFn: () => api<Record<string, string>>('/api/color-swatches'),
  staleTime: Infinity,
})

export const adaptersQuery = queryOptions({
  queryKey: ['adapters'],
  queryFn: () => api<AdaptersResponse>('/api/adapters'),
  refetchInterval: 15_000, // live health
})

export const adapterTypesQuery = queryOptions({
  queryKey: ['adapter-types'],
  queryFn: () => api<{ types: AdapterType[] }>('/api/adapter-types').then((r) => r.types),
  staleTime: Infinity,
})

export const overviewQuery = queryOptions({
  queryKey: ['overview'],
  queryFn: () => api<Overview>('/api/overview'),
  refetchInterval: 10_000,
})

/** The last published payload. 503 just means "nothing polled yet": that's a state, not an error. */
export const statusQuery = queryOptions({
  queryKey: ['status'],
  queryFn: async () => {
    try {
      return await api<StatusPayload>('/api/status')
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) return null
      throw error
    }
  },
  refetchInterval: 10_000,
})

export const usersQuery = queryOptions({
  queryKey: ['users'],
  queryFn: () => api<{ users: User[] }>('/api/users').then((r) => r.users),
})

export const auditQuery = queryOptions({
  queryKey: ['audit-log'],
  queryFn: () => api<{ entries: AuditEntry[] }>('/api/audit-log?limit=200').then((r) => r.entries),
})

export const mqttReferenceQuery = queryOptions({
  queryKey: ['mqtt-reference'],
  queryFn: () => api<MqttReference>('/api/mqtt-reference'),
})
