/** Shapes of the JSON API responses (see app/api/). */

export type Status = 'ok' | 'warn' | 'down'
export type Context = Record<string, unknown>

export interface AdapterField {
  name: string
  label: string
  secret?: boolean
  required?: boolean
  type?: 'checkbox' | 'text'
  default?: boolean
  placeholder?: string
  /** Offer a picker filled from the adapter's catalog (a comma-separated list). */
  suggest?: 'entities'
}
export interface AdapterType {
  type: string
  description: string
  required_fields: AdapterField[]
}
/** A stored field value: text, a checkbox, or (for secrets) only whether one is set. */
export type AdapterFieldValue = string | boolean | { secret: true; set: boolean }
export interface AdapterEntry {
  name: string
  type: string
  enabled: boolean
  known_type: boolean
  state: 'running' | 'pending' | 'disabled'
  fields: Record<string, AdapterFieldValue>
  /** Live health from the last poll; null unless it's running. */
  health: { status: Status | 'unknown'; detail: string | null; reason: string | null } | null
}
export interface AdaptersResponse {
  adapters: AdapterEntry[]
  restart_pending: boolean
}
export interface TestAdapterResult {
  ok: boolean
  error?: string
  status?: string
  detail?: string | null
  value?: number | string | null
  unit?: string | null
  summary?: Record<string, string | number | boolean | null>
}

export interface OverviewAdapter {
  name: string
  type: string
  status: Status | 'unknown'
  detail: string | null
  /** Why it's warn/down, in a sentence, when the adapter says (hover the pill). */
  reason?: string | null
}
export interface Overview {
  last_poll_ts: number | null
  poll_interval_seconds: number
  version: string
  uptime_seconds: number
  mqtt_connected: boolean
  database_available: boolean
  adapters: OverviewAdapter[]
}

export interface AuditEntry {
  id: number
  ts: string
  user_id: number | null
  username: string | null
  action: string
  target: string | null
  ip: string | null
  detail: Record<string, unknown> | null
}

/** One topic between the server and the device (GET /api/mqtt-reference). */
export interface MqttTopic {
  topic: string
  direction: string
  retained: boolean
  about: string
  example: unknown
}
export interface MqttReference {
  topics: MqttTopic[]
}

/** What an adapter offers the pickers (Home Assistant: its entities and services). */
export interface CatalogEntity {
  id: string
  name: string
  state: string
}
export interface AdapterCatalog {
  entities?: CatalogEntity[]
  services?: string[]
}

export type ActionKind = 'service' | 'script' | 'event'
/** An action's check that it really happened (app/actions.py VerifyConfig). */
export interface VerifyConfig {
  entities: string[]
  state: string
  /** Seconds after the call. */
  timeout: number
}
export interface ActionConfig {
  id: string
  label: string
  adapter: string
  kind: ActionKind
  service: string | null
  target: string | null
  data: Record<string, unknown>
  confirm: boolean
  state_template: string | null
  verify?: VerifyConfig | null
}
export interface ActionInfo extends ActionConfig {
  resolved_state: string | null
  state_error: string | null
}
export interface ActionsResponse {
  actions: ActionInfo[]
  /** Running adapters that can perform actions. */
  adapters: { name: string; type: string; kinds: ActionKind[] }[]
  context: Context
  limits: { label_max: number; state_max: number }
}
export interface ActionOutcome {
  ok: boolean
  text: string
}
export interface PreviewActionStateResponse {
  rendered: string | null
  state: string | null
  error: string | null
}

/** The bedside device (app/device.py). */
export interface DimmerConfig {
  bright_lux: number
  dark_lux: number
  dim_contrast: number
  wake_seconds: number
}
export interface SoundConfig {
  enabled: boolean
  /** 0-100. */
  volume: number
  /** 0-100, while the room is dark. Failures always use `volume`. */
  dark_volume: number
}
export type SoundName = 'armed' | 'running' | 'success' | 'failure' | 'cancel'
export type PressKind = 'short' | 'long'
export interface ButtonBinding {
  short?: string | null
  long?: string | null
}
export interface DeviceConfig {
  dimmer: DimmerConfig
  sounds: SoundConfig
  /** Keyed by button number, "1"-"8". Unbound buttons are absent. */
  buttons: Record<string, ButtonBinding>
}
export interface SensorReading {
  temperature_c: number | null
  humidity: number | null
  lux: number | null
  screen: 'off' | 'dim' | 'full' | null
}
export interface ButtonPress {
  button: number
  press: PressKind
  /** Unix seconds. */
  at: number
  action: string | null
  ok: boolean | null
  text: string | null
}
/** An action as the Buttons page lists it. */
export interface DeviceAction {
  id: string
  label: string
  confirm: boolean
  /** Has a check that it really happened. */
  verify: boolean
}
export interface DeviceResponse {
  /** null until the broker has said either way. */
  online: boolean | null
  link_connected: boolean
  sensors: SensorReading | null
  sensors_age_seconds: number | null
  presses: ButtonPress[]
  config: DeviceConfig
  actions: DeviceAction[]
  num_buttons: number
  /** How long an armed confirm action waits for its second press. */
  confirm_seconds: number
  sounds: SoundName[]
  ha_discovery: boolean
}

/** GET /api/connections. Passwords are never sent, only whether one is set. */
export interface ConnectionsResponse {
  mqtt: {
    source: 'app' | 'env'
    host: string
    port: number
    username: string | null
    password_set: boolean
    connected: boolean
  }
  database: {
    source: 'app' | 'env'
    configured: boolean
    host: string | null
    port: number | null
    database: string | null
    username: string | null
    password_set: boolean
    available: boolean
  }
  /** The broker the bedside device is handed by GET /device/config. */
  display: {
    /** none = no account for the device anywhere yet. */
    source: 'app' | 'env' | 'none'
    host: string | null
    port: number | null
    username: string | null
    password_set: boolean
    token_set: boolean
    /** Its last GET /device/config since the app started (unix seconds). */
    last_seen: { ts: number; ip: string | null } | null
  }
  /** False until SECRETS_MASTER_KEY is set: there'd be nowhere to keep a password. */
  can_save: boolean
}
export interface MqttTestResult {
  ok: boolean
  error: string | null
}
export type DatabaseSaveMode = 'use' | 'copy' | 'fresh'
/** POST /api/connections/database/test (app.connections.DatabaseReport). */
export interface DatabaseReport {
  connected: boolean
  error: string | null
  server_version: string | null
  schema: 'none' | 'current' | 'upgrade' | 'unknown' | 'foreign' | null
  can_create_tables: boolean
  user_count: number
  admins: string[]
  same_as_current: boolean
  /** What a save may do; empty = it can't be saved (see problems). */
  modes: DatabaseSaveMode[]
  problems: string[]
}

/** One row of GET /api/settings (app/app_settings.py). */
export interface SettingField {
  key: string
  label: string
  group: string
  help: string
  kind: 'number' | 'integer' | 'boolean' | 'text' | 'select'
  minimum: number | null
  maximum: number | null
  unit: string | null
  options: string[]
  placeholder: string | null
  value: string | number | boolean | null
  /** What a reset goes back to (.env or the built-in default). */
  baseline: string | number | boolean | null
  source: 'app' | 'env' | 'default'
}
export interface SettingsResponse {
  fields: SettingField[]
  /** HTTPS only can be turned on only from an HTTPS page. */
  request_is_https: boolean
}
export interface OllamaTestResult {
  ok: boolean
  error: string | null
  models: string[]
}
