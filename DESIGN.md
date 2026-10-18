# Bedside Dashboard — Server (aggregator microservice)

## Role in the system
This is the "server" in a server/client relationship with an ESP32 bedside
device. It owns all the logic — what a button press does, whether it needs
confirming, whether it really happened, which sound to play, the device's
settings. The ESP32 is intentionally dumb: it reports its sensors and
presses, and plays and applies whatever this service sends it.

## The bedside device
Forked from desk-dashboard-server on 2026-09-27 (full history on the
`upstream` remote). The desk unit is a status display; the bedside unit is a
remote control. Everything that existed to show homelab status was removed
("What was removed from the fork" below).

- **Separate app, shared infrastructure.** Its own database
  (`bedside_dashboard`, on the central Postgres by default) and config dir
  (`/opt/bedside-dashboard-data/config`), web UI on host port 8001 so it
  runs beside the desk stack. Both use the central MQTT broker
  (192.0.2.25) with separate accounts — `bedside-aggregator` /
  `bedside-esp32` here — whose ACLs keep each to its own topics
  (`docs/mqtt-broker.md`); every topic here is `bedside/*`. Bundled
  Postgres/Mosquitto are the `local-db` / `local-mqtt` compose profiles.
- **The device's hardware is a first-class thing** (`app/device.py`), not
  just a renderer: it reports sensors and presses, and takes settings.

| Topic | Direction | Retained | |
|---|---|---|---|
| `bedside/config` | server → device | yes | dimmer thresholds (including `idle_off_minutes`: screen off after that long with no touch or PIR movement, 0 = never) and buzzer volumes, from `config/device.yaml` |
| `bedside/sensors` | device → server | yes | `{"temperature_c", "humidity", "lux", "screen", "motion"}` every 30s and when motion starts or stops |
| `bedside/button` | device → server | no | `{"button": 1-8, "press": "short"\|"long"}` |
| `bedside/availability` | device → server | yes | `online` / `offline` (last will) |
| `bedside/diagnostics` | device → server | yes | the device's own checks: hardware found at boot, joystick, buttons held, Wi-Fi, heap, uptime, firmware build. Every 30 s, once a second in fast mode — see "Diagnostics" |
| `bedside/diagnostics/request` | server → device | no | `{"fast_seconds": N}` (max 600, 0 stops) — fast mode |
| `bedside/stick` | device → server | no | `{"stick": "up"\|"down"\|"left"\|"right"\|"press"}`, repeating while held |
| `bedside/sound` | server → device | no | `{"sound": "armed"\|"running"\|"success"\|"failure"\|"cancel", "urgent": bool}` — see "Button feedback" |

- **Buttons are bound here, not on the device.** `config/device.yaml` maps
  each button's short/long press to an Action id; `MqttDeviceLink` runs it
  through the same `ActionRunner` (and debounce) as the web UI's Run button.
  Bindings are edited on the web UI's **Buttons** page: a list with one
  row per button, showing what its short and long press do. A row lights
  up when its button is pressed, so it's easy to tell which is which. An
  unbound press is still recorded on the Device page.
- **Home Assistant via MQTT discovery.** On connect the server publishes,
  retained under `homeassistant/`, three sensors (temperature, humidity,
  illuminance), a motion binary sensor (the PIR; unknown, not clear, when
  the firmware sends no `motion`) and a device trigger per bindable button (1–7) and press length. The
  sensors read the device's own topic, so they don't depend on the server
  staying up. HA already reads the central broker, so nothing else is
  needed; the server's account may only write this device's discovery
  topics, never another HA entity's. Device-trigger payloads must match the firmware's
  `publishButton()` byte for byte (tests/test_device.py checks).
- **Sensors in templates.** An Action's state text can use the latest
  report: `{{ device.temperature_c }}`, `temperature_f`, `humidity`, `lux`,
  `screen`, `motion` (true, false, or none for firmware that doesn't report
  it), `online`, `last_report_seconds` (`app/state_templates.py`).
- **The screen is the device's own business.** A resting readout (clock,
  light, temperature, humidity — all local to the device) plus brief
  confirmations of what a button press did, alongside its sounds. No
  menus: actions are reached through buttons only, bound server-side.

### Diagnostics (2026-10-03)
The **Diagnostics** page (`/diagnostics`, any signed-in user) shows the
device's own view of its hardware, so a loose wire or a dead sensor is
visible without a serial cable: the five boot checks (display, light
sensor, button expander, joystick axes, DHT11) as answering / not
answering, the raw joystick, buttons 1–8 lit while held or just pressed,
Wi-Fi signal, address, uptime, firmware build and free heap, and (for
admins) the buzzer's sound test. The firmware's contract is in the
bedside-dashboard-esp32 repo (`docs/diagnostics-server-brief.md`).

- **Fast mode is kept alive by polling.** The page polls
  `GET /api/device/diagnostics` once a second, and the server turns that
  into `{"fast_seconds": 60}` on the request topic, at most every 30 s
  (`keep_diagnostics_fast`). A GET rather than a POST on purpose: viewers
  can't POST, and "nobody is looking" then needs no extra bookkeeping — the
  polling stops, the 60 s runs out, and the device is back to every 30 s.
  A hidden tab doesn't poll either.
- **A retained report is not a current one.** `bedside/diagnostics` is
  retained, so on every (re)connect the broker replays the last one,
  possibly days old. The link records the broker's retain flag: a replayed
  report is shown with *no age* ("waiting for a new report"), and any
  report older than 90 s, or any report while the device is offline, is
  shown greyed out as "not reporting". Only a live publish counts as current.
  (`bedside/sensors` is retained too and is not treated this way yet: the
  Device page's "last report" resets on a server restart.)
- **Events are not retained**, so a press from before the page opened is
  never seen. The server keeps the last few button and joystick events,
  stamped with its own clock; the page ages them against the `now` the
  endpoint sends, not the viewer's clock.
- **Lenient parsing.** A report with a missing or unknown field still
  shows what it has; only the wrong *type* of a field (a button 9, a hardware
  flag that isn't a boolean) drops the message.
- **ACL.** The device needs write on `bedside/diagnostics` and
  `bedside/stick` and read on `bedside/diagnostics/request`; the server the
  reverse. Mosquitto doesn't wildcard these (`bedside/diagnostics` does not
  cover `…/request`), and a denied publish is silent, so a missing ACL line
  looks like a device that never reports.

### What was removed from the fork (2026-09-29)
Everything the desk unit needs to *show homelab status* is gone, since this
screen doesn't: the cards, the `bedside/status` message, camera alerts, the
on-screen Actions menu, the LEDs, and the adapters (the plug-in data sources
and their pages). The unit is a remote control for Home Assistant, which
was the only adapter doing any work, so Home Assistant became a plain
connection (below). The desk repo still has all of it, and `git log` here
has the removal commits. What stayed: Actions, buttons, sounds, the device's
settings. (The AI template helper, an Ollama agent that was never wired into
the UI, was removed on 2026-10-18.)

## Architecture: one Home Assistant, read on demand
Home Assistant is a connection like the broker and the database: a URL, a
long-lived access token and a TLS-check switch, saved in the Connections section of the Settings
page into `config/connections.yaml` (the token encrypted in
`secrets.enc.yaml`). A save swaps the client in place, no restart
(`HomeAssistantLink` in `app/home_assistant.py`).

Nothing polls it. What reads it asks when it needs to: a button press runs
an Action through its REST API (and an Action's `verify` check reads the
entities it watches), and the Actions page renders each Action's
`state_template` from one `GET /api/states` per page load (cached for two
seconds so the Preview right after reuses it). The Home and Settings
pages ask whether it answers (`GET /api/config`, cached 30 s).

Templates render in a Jinja2 sandbox against `states['<entity_id>']`
(`.state`, `.name`, `.unit`, `.domain`, `.attributes`, `.last_changed`)
and `device.<field>` (the device's own readings). Attributes that carry
secrets or whereabouts (a camera's `access_token`, a person's GPS
position) are dropped before a template can see them. The page only ever
receives the rendered text: the full entity list stays server-side, since
viewer accounts can read the Actions page.

## Transport: MQTT (push, not polling)
One connection, `app/device.py`'s `MqttDeviceLink`: it publishes the
device's settings (`bedside/config`, retained), sounds (`bedside/sound`)
and Home Assistant discovery, and reads the device's sensors, presses and
availability. The topics are in the table at the top.

**Broker: the central one (since 2026-09-28).** This project originally
ran its own dedicated Mosquitto and kept off Home Assistant's. It now uses
the homelab's central broker (192.0.2.25), shared with Home Assistant
and other projects — one broker to run, and HA can see these topics
directly. What the dedicated broker gave us is kept with ACLs instead:
each account can touch only its own `bedside/*` topics, so nothing else on
the broker can change what the device does, and the device's login can do
nothing else there (`docs/mqtt-broker.md`). The bundled broker remains as
the `local-mqtt` compose profile.

## Actions (a button asks, the server acts)
Actions are run by **buttons** bound on the Buttons page (see "Button
feedback"), so the device only ever says which button was pressed.

**Architecture, and why:** device → broker → this server → Home
Assistant's REST API. The more HA-native options were considered and
rejected: ESPHome's native API needs ESPHome firmware (this is custom
PlatformIO code), and MQTT discovery would (at the time) have meant a
second set of credentials on the device for HA's own broker. The broker is
now the shared central one (see "Transport"), but the reasoning still
holds: the display talks only to this server's topics. It never holds a
Home Assistant credential, and a press is a button number, never an
instruction — a stolen `bedside-esp32` login can press the same buttons
the device can, nothing more.

**An action** (`app/actions.py`, one entry in `actions.yaml`, edited on
the web UI's Actions page) has an `id` (what the device sends), a
`label`, and a `kind`:
- `service` — call `domain.service` (e.g. `light.toggle`) on an optional
  `target` entity, with optional extra `data`;
- `script` — run a `script.*` entity, `data` as its variables;
- `event` — fire `bedside_dashboard_action` with `{action: <id>, label}`,
  for a Home Assistant automation to handle (the logic then lives in HA,
  where HA users expect it).

Plus `confirm` (ask for a second press first — locks, garage doors), an
optional `verify` check (see "Button feedback"), and an optional
`state_template` (usually `{{ states['light.desk'].state }}`)
shown beside the label on the Actions page. `actions.yaml` is re-read on
every run: saves apply without a restart.

**Who runs them:** Home Assistant, always (`HomeAssistant.run_action()`
in `app/home_assistant.py`); an action pressed before it's set up fails
with "No HA". Actions saved before 2026-09-29 also named an `adapter`;
that field is ignored and dropped on the next save. The web UI's Run
button goes through the same `ActionRunner` as a button press, so the
debounce covers both.

**Limits:** any number of actions. 23-byte id and label, and an 11-byte
state (cut at a character boundary), sized for on-screen confirmations.

### Button feedback: confirm, verify, sounds
Added 2026-09-28. A physical button bound to an Action gets audible
feedback from a passive piezo on the device, a second press for anything
marked `confirm`, and a check that the action really happened — not just
that Home Assistant accepted the call. The motivating case: one button
that makes sure the garage doors are closed, with no way to trigger it by
brushing the button in the dark and a clear "it didn't work" if a door
jams.

**Who decides what: the server.** The device only plays a named sound when
told to (`bedside/sound`), the same dumb-client split as everything else.
The one exception is the long-press tick below, which is feedback on the
button itself, not on an action.

**The sounds** (patterns live in the firmware; the names are the contract):

| Sound | When | Pattern |
|---|---|---|
| `tick` | a hold passes 0.6 s and becomes a long press (device-local) | one very short click |
| `armed` (beep 1) | first press of a `confirm` action: press again to run it | one mid beep |
| `running` (beep 2) | the action is being sent to Home Assistant | two quick rising beeps |
| `success` (beep 3) | it's done — verified, if the action has a check | three rising notes |
| `failure` (beep 4) | it failed, timed out, or the check never passed | low falling buzz |
| `cancel` | an armed action timed out or was cancelled | one soft blip |

**Confirm (server-side, `app/device.py`):** press a button bound to a
`confirm: true` action and it's *armed* for 5 seconds (`armed`). The
confirming press must be the **same button and the same press length** —
arm with a long press, confirm with a long press — so a quick tap meant
for a lamp on the same button can never confirm the garage. Anything else
while armed (another button, the other press length) cancels it
(`cancel`) and is otherwise ignored; so does the window running out. Only
one action is armed at a time. A press bound to an action *without*
`confirm` runs straight away: `running`, then `success`/`failure`.

**Verify (`ActionConfig.verify`):** an optional check —
```yaml
verify:
  entities: [cover.garage_left, cover.garage_right]
  state: closed      # every entity must reach this state
  timeout: 45        # seconds after the call
```
Before calling Home Assistant, the runner reads those entities: if they
already pass, it skips the call and reports success ("make sure it's
closed", not "close it"). Otherwise it makes the call, then polls just
those entities (`GET /api/states/<id>`, once a second) until they all pass → `success`, or the
timeout / an entity going `unavailable` → `failure`. Without `verify`,
success means Home Assistant accepted the call, as before. The web UI's
Run button goes through the same runner, so it waits for the check too.

**Quiet in the dark, except failures.** `config/device.yaml` has
`sounds: {enabled, volume, dark_volume}` (Device page), sent on
`bedside/config`. When the room is below the dimmer's `dark_lux`, the
device plays at `dark_volume` — except a message marked `urgent`, which
always plays at `volume`. The server marks `failure` urgent: a garage
that didn't close has to be heard even at 3 a.m. (A piezo's loudness is
set by PWM duty, so "volume" is coarse — fine for this.)

**Hardware:** passive piezo on GPIO 25, driven by the ESP32's LEDC PWM
(see the device repo's DESIGN.md).

## Security / network exposure
The HTTP API is bound to all interfaces (Docker's default when a compose
port mapping doesn't specify a host IP, overridable with `APP_BIND`) —
reachable by anything on the LAN, not just `localhost`. Deliberate, not
accidental: the ESP32 has to reach it for `GET /device/config`. The MQTT
broker is normally the central one (192.0.2.25), which the device and
this app both reach over the LAN; the bundled broker (`local-mqtt`
profile) is likewise published on all interfaces, on host port 1884.

- **MQTT is protected** — password auth plus per-account topic ACLs:
  `bedside-aggregator` (this app) and `bedside-esp32` (the device) may each
  write only their own `bedside/*` topics and read only the other's, so the
  device's login can't change its own settings or make itself play a sound.
  Since 2026-09-28 the broker is normally the central
  one, where those accounts and ACLs are set up by hand
  (`docs/mqtt-broker.md`); the bundled broker (`local-mqtt` profile) applies
  the same rules from `mosquitto/config/`. Verified end-to-end on the
  bundled broker.
- **The HTTP API and web UI require a login** (since 2026-09-21; see
  `app/auth/`). Everything is default-deny —
  `tests/test_auth_coverage.py` fails if a route is neither protected nor on
  its explicit public allowlist. The only open routes are `/healthz`, the
  login endpoint, `/device/config` (the device token instead), and the React
  app's static shell/bundle (the login screen is part of that app; all data comes from the
  authenticated `/api`).
  - Users live in Postgres (`users`, `sessions`, `audit_log`); passwords are
    Argon2id; sessions are server-side with an opaque HttpOnly cookie (only its
    SHA-256 is stored) and a per-session CSRF token required on every write.
  - Roles: `viewer` (read) and `admin` (everything, incl. connections and
    their credentials, restart, user management). Failed logins are throttled
    per account and per IP; logins and every state-changing call are recorded
    in `audit_log` (request bodies are never logged, only a few safe keys).
  - Postgres being down never stops button presses or MQTT — only login.
    Likewise the MQTT broker being down never stops the app, even at
    startup (since 2026-09-28; before that, an unreachable broker made
    startup fail). The app starts, the UI stays up, publishing retries at
    most every 5 s, and each outage is logged once. That matters because
    the broker can be changed from the UI: an app that crash-looped
    without its broker would take down the page you'd fix it from.
  - **Admins can re-point the broker and the database from the UI**
    (Settings page, since 2026-09-28; `app/connections.py`). `.env` is
    only the first-start bootstrap. A saved section in
    `config/connections.yaml` overrides it. Because signing in needs the
    database, a database change is gated on proof that someone can still
    sign in afterwards. The target must be either this app's own database
    with an active admin, or empty, in which case users, sessions and the
    audit log are copied over with their ids, so the current session
    survives. The server re-runs that check on save, not just on "Test". If
    a saved database later dies, the recovery path is to delete its section
    from the file (see `docs/database.md`), since the UI is unreachable. A
    blank password field in these forms reuses the running password
    (the Home Assistant form does the same with its token): an admin could point it at a host they
    control and capture it. That's accepted, because admins already hold
    every other credential in the app.
  - **The Settings page** (`app/app_settings.py`, since 2026-09-28) covers
    the rest of `.env` that's safe to change live. Every one of those
    values is read where it's used, not copied at startup, so a save
    applies at once with no restart. Two guards stop it from locking
    anyone out:
    - `HTTPS_ONLY` can only be turned on from a request that arrived over
      HTTPS, directly or through a trusted proxy's `X-Forwarded-Proto`.
      Turning it on over plain HTTP would make the session cookie
      `Secure`, and the browser would never send it back over HTTP.
    - Flipping `HTTPS_ONLY` renames the session cookie, so the save
      re-issues the current session under the new name.

    The module docstring lists what's deliberately left out.
  - **The bedside device gets its broker from the server** (`GET /device/config`,
    since 2026-09-28), so it can move brokers without a reflash. It
    authenticates with a device token: a 256-bit random value, stored
    only as a SHA-256, sent as a Bearer header so it never appears in an
    access log. The endpoint hands out the `bedside-esp32` password over
    plain HTTP. That's accepted because the device's MQTT connection
    already sends the same password in the clear on the same LAN. The
    firmware (bedside-dashboard-esp32 `device_config.cpp`) keeps a fetched
    change only once it has connected with it, and rolls back otherwise.
  - Also: one strict CSP on every response (`script-src 'self'`, no inline
    scripts), `no-store` on `/api`, password changes share the login
    throttle (a hijacked session can't guess the current password), and audit
    rows are pruned after `AUDIT_RETENTION_DAYS` (default 365).
  - **Exposing it beyond the LAN** is a deliberate step, not a default: see
    `docs/reverse-proxy.md`. The one non-obvious constraint is that the
    ESP32 can't do TLS, so the app port must stay reachable over plain HTTP on
    the LAN for `/device/config` (token-protected).

## Deployment
- FastAPI, containerized (see `Dockerfile`).
- Run from a checkout on the target host: `git clone`/`pull` this repo
  there, `cp .env.example .env` and fill in the secrets, then
  `docker compose up -d --build` run locally. Building on the host's own
  Docker daemon keeps relative bind mounts resolving where Docker runs
  (a Portainer git-stack on a remote agent can't do either reliably), and
  `restart: unless-stopped` on every service survives a reboot with no
  separate systemd unit.
- **Config is not in git.** The live
  `connections.yaml`/`actions.yaml`/`device.yaml`/`secrets.enc.yaml` live in
  `/opt/bedside-dashboard-data/config` on the host, mounted at `/app/config`
  — edited through the running app, so live edits never show up as git
  diffs. `config.example/` in the repo is the template for a fresh
  deploy. Passwords and tokens are Fernet-encrypted in
  `secrets.enc.yaml` (`app/secret_store.py`, referenced from
  `connections.yaml` as `password: {secret: <name>}`); the one value held
  in the clear is `SECRETS_MASTER_KEY` in the gitignored `.env`. Saving a
  broker or database change on the Settings page restarts the app (there's
  also a plain Restart, `app/api/system.py`): it SIGTERMs the process so
  Docker's `restart: unless-stopped` brings it back — no docker socket
  mounted.

## Open items
- Live mirror of the device's 128×32 OLED in the web UI: the device
  publishes its real framebuffer on `bedside/screen` and the Device page
  draws it, so icons and layouts added later just appear — see
  `docs/plan-screen-rendering.md`. Decided 2026-09-29, not yet implemented;
  the plan was brought up to date on 2026-10-18 for the current one-line
  clock screen.
