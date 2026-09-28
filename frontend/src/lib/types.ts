/** Shapes of the JSON API responses (see app/api/). */

export type Status = 'ok' | 'warn' | 'down'
export type Context = Record<string, unknown>

export interface CardInfo {
  name: string
  title: string
  title_override: string | null
  lines_template: string[] | null
  status_template: string | null
  render: boolean
  resolved_lines: string[]
  resolved_status: Status
}
export interface CardsResponse {
  context: Context
  cards: CardInfo[]
  /** The display's limit for each line, by position (line 1 first). */
  line_max_chars: number[]
}

export interface PixelInfo {
  index: number
  color_template: string | null
  resolved_color: string | null
}
export interface PixelsResponse {
  context: Context
  pixels: PixelInfo[]
}

export interface Diagnostic {
  template: string
  rendered: string | null
  error: string | null
  /** Rendered empty: a blank row on the display. */
  blank: boolean
  length: number
  /** This line's limit on the display; null past the last line it has. */
  max_chars: number | null
  too_long: boolean
  /** Too wide to sit still on the display, so it scrolls sideways. */
  scrolls: boolean
  /** Characters the display's font can't draw (it has plain ASCII only). */
  undrawable?: string[]
}
export interface PreviewLinesResponse {
  diagnostics: Diagnostic[]
  final_lines: string[]
  used_default_fallback: boolean
  default_lines: string[]
}
export interface PreviewStatusResponse {
  rendered: string | null
  resolved_status: Status
  used_fallback: boolean
}
export interface PreviewColorResponse {
  rendered: string | null
  resolved_color: string | null
  used_fallback: boolean
}
export interface LineTooLong {
  /** 1-based. */
  line: number
  length: number
  max_chars: number
}
export interface SaveLinesResponse {
  too_long: LineTooLong[]
}
export interface SaveTitleResponse {
  title: string
  too_long: boolean
  client_max_chars: number
}
/** The Cards page's one Save & apply (title, lines and status together). */
export interface SaveCardResponse {
  title: string
  title_too_long: boolean
  client_max_chars: number
  too_long: LineTooLong[]
}
export interface GenerateResponse {
  tools_consulted: string[]
  raw: string
}

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

export interface ServiceReading {
  name: string
  title: string
  status: Status
  lines: string[]
}
export interface StatusPayload {
  ts: number
  overall: { level: Status; text: string }
  services: ServiceReading[]
  pixels: Record<string, string | null>
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
  overall: { level: Status; text: string } | null
  last_poll_ts: number | null
  last_published_ts: number | null
  poll_interval_seconds: number
  heartbeat_interval_seconds: number
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

export interface MqttReference {
  status_topic: string
  camera_topic: string
  heartbeat_interval_seconds: number
  status_schema_url: string
  camera_schema_url: string
  status_schema: unknown
  camera_schema: unknown
  status_example: unknown | null
  camera_example: unknown
  action_topic: string
  action_result_topic: string
  action_schema_url: string
  action_result_schema_url: string
  action_example: unknown
  action_result_example: unknown
  limits: {
    title_max_chars: number
    line_max_chars: number[]
    overall_text_max_chars: number
    max_services: number
    max_actions: number
    action_label_max_chars: number
    action_state_max_chars: number
  }
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
  limits: { max_actions: number; label_max: number; state_max: number }
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
  /** The broker the desk display is handed by GET /device/config. */
  display: {
    /** none = no account for the display anywhere yet. */
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
