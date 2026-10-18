/** Shapes of the JSON API responses (see app/api/). */

export type Status = 'ok' | 'warn' | 'down'
export type Context = Record<string, unknown>

/** How Home Assistant is doing, as the Home page shows it. */
export type HomeAssistantStatus = 'connected' | 'unreachable' | 'not_set_up'

export interface Overview {
  version: string
  uptime_seconds: number
  home_assistant: HomeAssistantStatus
  mqtt_connected: boolean
  database_available: boolean
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

/** What Home Assistant offers the Actions editor's pickers: its entities and services. */
export interface CatalogEntity {
  id: string
  name: string
  state: string
}
export interface HomeAssistantCatalog {
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
  home_assistant: {
    set_up: boolean
    /** Why states are blank right now (not set up, or unreachable), else null. */
    problem: string | null
  }
  /** What the variables panel offers: the device's own readings. */
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
  problem: string | null
}

/** The bedside device (app/device.py). */
export interface DimmerConfig {
  bright_lux: number
  dark_lux: number
  dim_contrast: number
  wake_seconds: number
  /** Minutes with no touch or movement before the screen turns off; 0 = never. */
  idle_off_minutes: number
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
  /** The PIR's output right now; null from firmware that predates it. */
  motion: boolean | null
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
/** What the device found at boot. false = a wiring problem; null = not reported. */
export interface DiagnosticsHardware {
  oled: boolean | null
  light: boolean | null
  expander: boolean | null
  joystick: boolean | null
  climate: boolean | null
}
/** One `bedside/diagnostics` report (app/device.py DiagnosticsMessage). */
export interface DiagnosticsReport {
  firmware: string | null
  uptime_s: number | null
  heap_free: number | null
  setup_mode: boolean
  wifi: { rssi: number | null; ip: string | null } | null
  hardware: DiagnosticsHardware | null
  /** The PIR's output right now. It has no boot check: a quiet room and a missing sensor look alike. */
  motion: boolean | null
  /** x and y are raw 12-bit readings, null when there's no joystick. */
  stick: { x: number | null; y: number | null; direction: string; pressed: boolean } | null
  buttons_down: number[]
}
export interface StickEvent {
  stick: 'up' | 'down' | 'left' | 'right' | 'press'
  /** Unix seconds, on the server's clock. */
  at: number
}
/** GET /api/device/diagnostics. */
export interface DiagnosticsResponse {
  /** The server's clock, unix seconds: ages of `presses` and `stick_events` are `now - at`. */
  now: number
  online: boolean | null
  link_connected: boolean
  diagnostics: DiagnosticsReport | null
  /** null with a report = only the retained copy from before the server connected. */
  diagnostics_age_seconds: number | null
  sensors: SensorReading | null
  sensors_age_seconds: number | null
  presses: ButtonPress[]
  stick_events: StickEvent[]
  sounds: SoundName[]
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
  /** The Home Assistant that Actions run through. The token is never sent. */
  home_assistant: {
    url: string | null
    verify_ssl: boolean
    token_set: boolean
    status: HomeAssistantStatus
  }
  /** False until SECRETS_MASTER_KEY is set: there'd be nowhere to keep a password. */
  can_save: boolean
}
export interface MqttTestResult {
  ok: boolean
  error: string | null
}
/** POST /api/connections/home-assistant/test. */
export interface HomeAssistantTestResult {
  ok: boolean
  error: string | null
  version?: string | null
  location_name?: string | null
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
