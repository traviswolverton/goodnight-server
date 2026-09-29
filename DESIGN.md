# Bedside Dashboard — Server (aggregator microservice)

## Role in the system
This is the "server" in a server/client relationship with an ESP32 bedside
device. It owns all the logic — what a button press does, whether it needs
confirming, whether it really happened, which sound to play, the device's
settings. The ESP32 is intentionally dumb: it reports its sensors and
presses, and plays and applies whatever this service sends it.

## This fork: the bedside device
Forked from desk-dashboard-server on 2026-09-27 with full history. The desk
unit is a status display (320×240 color LCD, rotary encoder, 5 LEDs, camera
snapshots): homelab services rendered as cards. The bedside unit isn't — see
"What the bedside dropped" below. What differs:

- **Separate app, shared infrastructure.** Its own database
  (`bedside_dashboard`, on the central Postgres by default) and config dir
  (`/opt/bedside-dashboard-data/config`), web UI on host port 8001 so it
  runs beside the desk stack. Both use the central MQTT broker
  (192.0.2.25) with separate accounts — `bedside-aggregator` /
  `bedside-esp32` here — whose ACLs keep each to its own topics
  (`docs/mqtt-broker.md`). Every topic is `bedside/*` instead of
  `homelab/*`. Bundled Postgres/Mosquitto remain as the `local-db` /
  `local-mqtt` compose profiles.
- **The device's hardware is a first-class thing** (`app/device.py`), not
  just a renderer: it reports sensors and presses, and takes settings.

| Topic | Direction | Retained | |
|---|---|---|---|
| `bedside/config` | server → device | yes | dimmer thresholds and buzzer volumes, from `config/device.yaml` |
| `bedside/sensors` | device → server | yes | `{"temperature_c", "humidity", "lux", "screen"}` every 30s |
| `bedside/button` | device → server | no | `{"button": 1-8, "press": "short"\|"long"}` |
| `bedside/availability` | device → server | yes | `online` / `offline` (last will) |
| `bedside/sound` | server → device | no | `{"sound": "armed"\|"running"\|"success"\|"failure"\|"cancel", "urgent": bool}` — see "Button feedback" |

- **Buttons are bound here, not on the device.** `config/device.yaml` maps
  each button's short/long press to an Action id; `MqttDeviceLink` runs it
  through the same `ActionRunner` (and debounce) as the web UI's Run button.
  Bindings are edited on the web UI's **Buttons** page: a 2×4 grid laid
  out like the device (1–4 on the top row), where a tile lights up when
  its button is pressed, so it's easy to tell which is which. An unbound
  press is still recorded on the Device page.
- **Home Assistant via MQTT discovery.** On connect the server publishes,
  retained under `homeassistant/`, three sensors (temperature, humidity,
  illuminance) and a device trigger per button and press length. The
  sensors read the device's own topic, so they don't depend on the server
  staying up. HA already reads the central broker, so nothing else is
  needed; the server's account may only write this device's discovery
  topics, never another HA entity's. Device-trigger payloads must match the firmware's
  `publishButton()` byte for byte (tests/test_device.py checks).
- **Sensors in templates.** The `bedside_device` adapter reads the latest
  report: `{{ adapters.<name>.temperature_c }}`, `temperature_f`,
  `humidity`, `lux`, `screen`, `online`, `last_report_seconds`.
- **The screen is the device's own business.** A resting readout (clock,
  light, temperature, humidity — all local to the device) plus brief
  confirmations of what a button press did, alongside its sounds. No
  menus: actions are reached through buttons only, bound server-side.

### What the bedside dropped (2026-09-29)
Everything the desk unit needs to *show homelab status* was removed, since
this screen won't: **Cards** (`cards.yaml`, the Cards page, card templates
and their AI helper endpoints), the **`bedside/status`** message and its
heartbeat, the Home page's display previews, **camera alerts** (the Frigate
adapter, `bedside/alert/camera`, the signed `/snapshot` proxy), the desk's
**icon font** and its line-width tables, the on-screen **Actions menu** (its
action list and `bedside/action` request/reply topics), and earlier the
**Pixels** (LEDs). The desk repo still has all of it; `git log` here has
the removal commits if any of it is wanted back. What stayed: adapters
(polled, for Actions to run and check and for templates), Actions,
buttons, sounds, the device's settings, and the AI plumbing
(`app/ai_assist.py`, pointed at Action state text for now).

## Architecture: adapter pattern
Each integration is a small class (`app/adapters/`) with one required
method, `fetch()`, returning an `AdapterResult` — name, status
(`ok`/`warn`/`down`), value, unit, detail, and a `context` of named values
for templates. Adapters are config-driven (`config/adapters.yaml`, edited on
the Adapters page): no code change to enable, add or remove one.

The aggregator (`app/aggregator.py`) polls every enabled adapter on an
interval and keeps each one's latest result — publishing nothing. Readers:
an Action's adapter (to run it, and to check it happened), an Action's
`state_template`, the Home and Adapters pages' health, and AI assist's
tools. Templates render in a Jinja2 sandbox against
`{{ adapters.<name>.<field> }}`, every adapter namespaced under its own name.

Adapters built: **Home Assistant** (entities; runs and checks Actions) and
**bedside_device** (the device's own sensors) are the ones this unit uses.
Inherited from the desk unit and still available: Uptime Kuma, AdGuard Home,
Proxmox, TrueNAS, UniFi, Tracearr.

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
Added 2026-09-26 with the Home Assistant adapter, from the desk unit,
whose on-screen menu sent the chosen action's `id` on `bedside/action`
(answered on `bedside/action/result`). The bedside has no menu: actions
are run by **buttons** bound on the Buttons page (see "Button feedback"),
so the device only ever says which button was pressed. The menu's action
list and request/reply topics were removed 2026-09-29.

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
`label`, the `adapter` that performs it, and a `kind`:
- `service` — call `domain.service` (e.g. `light.toggle`) on an optional
  `target` entity, with optional extra `data`;
- `script` — run a `script.*` entity, `data` as its variables;
- `event` — fire `desk_dashboard_action` with `{action: <id>, label}`,
  for a Home Assistant automation to handle (the logic then lives in HA,
  where HA users expect it).

Plus `confirm` (ask for a second press first — locks, garage doors), an
optional `verify` check (see "Button feedback"), and an optional
`state_template` (usually `{{ adapters.home_assistant.entities['light.desk'].state }}`)
shown beside the label on the Actions page. `actions.yaml` is re-read on
every run: saves apply without a restart.

**Which adapters run actions:** any whose `action_kinds` is non-empty
(`Adapter.run_action()` in `app/adapters/base.py`) — today only
`home_assistant`. The web UI's Run button goes through the same
`ActionRunner` as a button press, so the debounce covers both.

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
those entities (`GET /api/states/<id>`, once a second — the adapter's
normal poll is far too slow) until they all pass → `success`, or the
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

## AI-assisted template generation (app/ai_assist.py)
Added 2026-09-19 on the desk unit: an "AI prompt" box beside each card
template in the web UI, backed by a local Ollama instance. **On the
bedside the cards are gone (2026-09-29), and nothing in the UI calls it
yet**: the plumbing below is kept — the agent loop, its tools and its
answer checks — pointed at the one template left, an Action's short
`state_template` (`TemplateKind = "state"`), for a future screen-text or
Actions-page helper. The history below is from the card era, and is why
the checks exist.

**Design choice made explicitly, not the obvious default**: rather than
stuffing a static dump of live variable values into one big prompt, the
model gets real read-only **tools** and runs an actual tool-calling loop
(`run_agent()`) — `list_adapters`, `describe_adapter` (an adapter's own
`description` — what the underlying service actually does, e.g. "AdGuard
Home: a network-wide DNS-level ad and tracker blocker..." — plus its
current live field values), `get_live_context`, and
`list_existing_templates` (real templates already configured, as style
examples). The model decides what it needs and looks it up, the same way
an agent working in this repo reads a file instead of guessing its
contents, rather than receiving one fixed context blob that goes stale
as adapters are added. Every shipped `Adapter` subclass sets a real
`description` class attribute specifically so this has something
meaningful to hand over.

**Safety property, unconditional**: the model's final answer only ever
fills the relevant textarea/input in the editor — it is never
auto-saved. It goes through the exact same Preview step (real Jinja2
sandboxed render, real validation — a state must fit in 11 plain-ASCII
characters) as anything typed by hand, so a bad or creative-but-wrong
generation just shows a render error rather than breaking anything.

**A second, more surprising failure mode found live**: giving a model
tools doesn't guarantee it actually uses what they returned. One real
generation called `describe_adapter` correctly three times, then still
fabricated different adapter names in its actual answer (`adapters.
requests.total`, `adapters.up.time_kuma.avg_uptime_pct` instead of the
real `adguard_main`/`uptime_kuma`) — consulting a tool and heeding its
result turned out to be two separate things. `run_agent()` now checks
every candidate final answer against the real adapter list
(`_invalid_adapter_references()`) before accepting it, and gives the
model one corrective turn naming exactly which reference was wrong and
what the real names are, rather than handing a hallucinated answer back
to the user and relying solely on the Preview-time render error to
catch it. The system prompt also states the exact real adapter name
list up front now, rather than only trusting the model to look it up.

**A third failure mode, same day**: a generation used a real adapter
name correctly, then invented a `| comma` filter for thousands
separators that simply doesn't exist in this project's Jinja2
environment — the adapter-name check has no way to catch a wrong
*filter*. `run_agent()` now also actually trial-renders every candidate
answer (`_render_error()`, reusing `app.aggregator.
render_single_expression()` — the exact same call the real Preview
endpoint makes) before accepting it, catching any render failure, not
just wrong adapter names. Left alone, the model kept guessing different
nonexistent filters across corrective turns (`intcomma`,
`format_thousands`, `format_markdown`) without ever landing on a working
approach, since it had no idea what filters this sandboxed environment
actually has — the "No filter named" case now gets an extra hint
pointing at `{{ '{:,}'.format(value) }}`-style Python string formatting
(which the sandbox does allow), which resolved it in one retry.
`_MAX_AGENT_TURNS` raised 6 → 8 the same day, since both correction
checks now share that budget with tool calls.

Ollama runs on the **host**, not in this compose stack —
`docker-compose.yml`'s `extra_hosts: host.docker.internal:host-gateway`
is required for the container to reach it on plain Linux Docker (it
resolves for free on Docker Desktop, but not here). `OLLAMA_BASE_URL`
unset disables the feature entirely (`run_agent()` raises a clear
`AIAssistError`) rather than every request hanging against an
unreachable default.

**Model choice matters more than you'd expect**: verified live
2026-09-18 that `llama3.1:8b` and `qwen2.5:7b` both correctly populate
Ollama's structured `message.tool_calls` field, while `qwen2.5-coder:14b`
— despite being tagged with `"tools"` capability in `ollama list` —
instead emitted a tool-call-shaped JSON object as plain text `content`
on this Ollama version. `app.ai_assist._extract_tool_calls()` handles
both shapes defensively.

Round-tripping tool calls isn't enough, though. On 2026-09-23 a real
request ("keep line 1 and 2, add a new line 3 showing proxmox total memory
used, a "/", then total memory, plus a percentage") went 0 for 3 on
`llama3.1:8b`: after its tool calls it lost the request and answered with
prose or a template about some other adapter. `qwen2.5:14b` went 3 for 3,
so `OLLAMA_MODEL` now defaults to it. It's ~9GB, which still fits a
1080 Ti (11GB VRAM). The same session tightened what `run_agent()`
accepts: the editor's current text is part of the prompt, generated
answers are trial-rendered with StrictUndefined (a guessed field name is
an error, not a blank), and a correction for a guessed field lists that
adapter's real field names.

## Security / network exposure
Both the HTTP API and MQTT broker are bound to all interfaces (Docker's
default when a compose port mapping doesn't specify a host IP) — reachable
by anything on the LAN, not just `localhost`. Confirmed 2026-09-16 by
curling the host's actual LAN IP successfully. Deliberate, not accidental:
the ESP32 client needs to reach both from elsewhere on the network.

- **MQTT is protected** — password auth plus per-account topic ACLs:
  `aggregator` write-only, `esp32-client` read-only (each with one Actions
  topic the other way). Since 2026-09-28 the broker is normally the central
  one, where those accounts and ACLs are set up by hand
  (`docs/mqtt-broker.md`); the bundled broker (`local-mqtt` profile) applies
  the same rules from `mosquitto/config/`. Verified end-to-end on the
  bundled broker.
- **The HTTP API and web UI require a login** (since 2026-09-21; see
  `docs/plan-ui-and-auth.md` and `app/auth/`). Everything is default-deny —
  `tests/test_auth_coverage.py` fails if a route is neither protected nor on
  its explicit public allowlist. The only open routes are `/healthz`, the
  login endpoint, `/device/config` (the device token instead), and the React
  app's static shell/bundle (the login screen is part of that app; all data comes from the
  authenticated `/api`).
  - Users live in Postgres (`users`, `sessions`, `audit_log`); passwords are
    Argon2id; sessions are server-side with an opaque HttpOnly cookie (only its
    SHA-256 is stored) and a per-session CSRF token required on every write.
  - Roles: `viewer` (read) and `admin` (everything, incl. adapters and
    their credentials, restart, user management). Failed logins are throttled
    per account and per IP; logins and every state-changing call are recorded
    in `audit_log` (request bodies are never logged, only a few safe keys).
  - Postgres being down never stops polling/MQTT publishing — only login.
    Likewise the MQTT broker being down never stops the app, even at
    startup (since 2026-09-28; before that, an unreachable broker made
    startup fail). The app starts, the UI stays up, publishing retries at
    most every 5 s, and each outage is logged once. That matters because
    the broker can be changed from the UI: an app that crash-looped
    without its broker would take down the page you'd fix it from.
  - **Admins can re-point the broker and the database from the UI**
    (Connections page, since 2026-09-28; `app/connections.py`). `.env` is
    only the first-start bootstrap. A saved section in
    `config/connections.yaml` overrides it. Because signing in needs the
    database, a database change is gated on proof that someone can still
    sign in afterwards. The target must be either this app's own database
    with an active admin, or empty, in which case users, sessions and the
    audit log are copied over with their ids, so the current session
    survives. The server re-runs that check on save, not just on "Test". If
    a saved database later dies, the recovery path is to delete its section
    from the file (see `docs/database.md`), since the UI is unreachable. A
    blank password field in these forms reuses the running password,
    matching the adapter forms: an admin could point it at a host they
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
- ~~Flask or FastAPI~~ — FastAPI, containerized (see `Dockerfile`)
- ~~Deploy via Portainer from a git stack file~~ — tried this (a Portainer stack);
  Portainer CE can't reliably run `docker compose build` on a remote host
  through the agent (BuildKit worker-listing breaks over the tunnel), and
  even fixed, a git-stack's relative bind mounts resolve against
  Portainer's own checkout, not the remote host's filesystem — the
  container would start with no config. Neither is a compose-file problem;
  they're Portainer-CE-plus-remote-agent limitations.
- Actual pattern (matches `/opt/another-stack`, the existing convention
  for this host — most other Portainer stacks avoid this entirely by only
  ever referencing pre-built third-party images, never building custom
  code): `git clone`/`pull` this repo directly onto the target host
  (`docker-host`), `cp .env.example .env` and fill in real secrets, then
  `docker compose up -d --build` run locally there. Building happens on
  the host's own Docker daemon — no agent tunnel involved — and relative
  bind mounts resolve correctly since the checkout actually lives where
  Docker is running. `restart: unless-stopped` on both services handles
  surviving a reboot; no separate systemd unit needed for the compose part
  (unlike another-stack's older Streamlit component, which predates it
  moving to compose and still runs via systemd + a venv).
- **Config is not in git (changed 2026-09-19).** The live
  `adapters.yaml`/`actions.yaml`/`device.yaml`/`secrets.enc.yaml` live in
  `/opt/desk-dashboard-data/config` on the host, mounted at `/app/config`
  — edited through the running app, so live edits never show up as git
  diffs. `config.example/` in the repo is the template for a fresh
  deploy. This replaces the earlier "gospel configs in git, secrets out
  of git" convention. Per-adapter credentials are Fernet-encrypted in
  `secrets.enc.yaml` (`app/secret_store.py`, referenced from
  `adapters.yaml` as `password: {secret: <name>}`); the one value held in
  the clear is `SECRETS_MASTER_KEY` in the gitignored `.env`, alongside
  the non-adapter secrets (MQTT, Ollama) which stay as `${VAR}`.
  Adapters are managed from the editor's **Adapters** tab (forms
  rendered from each adapter class's `required_fields`): add, edit
  (blank secret = keep), remove (with a warning for actions that
  use it, and its now-unused secrets deleted), and a **Test
  connection** that runs one fetch() with the values as typed without
  saving anything. Changes take effect after a restart, which the tab's
  *Restart app* button does by SIGTERM-ing the process so Docker's
  `restart: unless-stopped` brings it back — no docker socket mounted.
  **Since 2026-09-21, adapter management (like everything else) requires an
  admin login** — see the "Security / network exposure" section above and
  `docs/plan-ui-and-auth.md`. This note previously said it was
  unauthenticated; that's no longer true and was stale.
- Good Docker Swarm candidate — stateless, no GPU/hardware coupling
- Homelab repo: github.com/traviswolverton/homelab (for reference/context on
  existing conventions, not necessarily where this new repo lives)

## Open items for Claude Code to help resolve
- ~~Pick Flask vs FastAPI~~ — FastAPI, scaffolded (see `app/`)
- ~~Design the exact `/status` payload schema~~ — done for the desk unit;
  the bedside dropped the status payload entirely (2026-09-29, see "What the
  bedside dropped").
- ~~Decide Mosquitto container config (auth, persistence, topic ACLs)~~ —
  done: password auth (`mosquitto/config/mosquitto.conf`), two accounts
  provisioned from env vars at container start (`mosquitto/entrypoint.sh`),
  and topic ACLs (`mosquitto/config/acl.conf`) restricting `aggregator` to
  write-only and `esp32-client` to read-only on both topics. Verified
  end-to-end: anonymous/bad-password connections refused, and a write from
  `esp32-client` is silently dropped by the ACL rather than reaching the
  topic. TLS was deliberately skipped — LAN-only broker; revisit
  if it's ever exposed beyond the LAN. (2026-09-26 added the Actions
  menu's `bedside/action` topics; removed 2026-09-29 with the menu. The
  current accounts and topics are in `docs/mqtt-broker.md`.)
- ~~Build adapters incrementally~~ — 7 adapters built in `app/adapters/`.
  Verified 2026-09-23 by polling each once against the real homelab
  service: AdGuard Home, Uptime Kuma, Frigate (since removed), UniFi, Tracearr and Proxmox
  VE 9.2 all returned `ok` with every `context` field populated (the only
  empty ones were lists with nothing to report, e.g. no monitors down).
  **Still open: TrueNAS** — built from the documented API only, not yet
  configured against the real box (and iX has deprecated the REST API it
  uses, so it may need porting to JSON-RPC).
- Scheduled ntfy digest (push a summary of live data at a configured time,
  e.g. daily 7am) — see `docs/plan-ntfy-digest.md`. Proposed 2026-09-22, not
  yet implemented; three open questions in that doc (ntfy.sh vs. self-hosted,
  one digest or several, global vs. per-user) need answers before it starts.
  Status-change alerts (notify the moment something changes, not on a
  schedule) were discussed too and sketched as a later Phase 2 in the same
  doc, once the digest's ntfy-sending machinery exists to build on.
