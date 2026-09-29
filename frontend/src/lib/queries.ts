import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  ActionsResponse,
  AdaptersResponse,
  AdapterType,
  AuditEntry,
  ConnectionsResponse,
  DeviceResponse,
  MqttReference,
  Overview,
  SettingsResponse,
} from '@/lib/types'
import type { User } from '@/lib/auth'

export const actionsQuery = queryOptions({
  queryKey: ['actions'],
  queryFn: () => api<ActionsResponse>('/api/actions'),
  refetchInterval: 15_000, // live states
})

export const deviceQuery = queryOptions({
  queryKey: ['device'],
  queryFn: () => api<DeviceResponse>('/api/device'),
  refetchInterval: 5_000, // live readings and presses
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

export const connectionsQuery = queryOptions({
  queryKey: ['connections'],
  queryFn: () => api<ConnectionsResponse>('/api/connections'),
  refetchInterval: 15_000, // live connected / available
})

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: () => api<SettingsResponse>('/api/settings'),
})
