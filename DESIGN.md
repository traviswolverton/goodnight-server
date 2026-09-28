# Desk Dashboard — Server (aggregator microservice)

## Role in the system
This is the "server" in a server/client relationship with an ESP32 desk
dashboard. It owns all business logic — polling homelab services, normalizing
their status, deciding severity, and pushing updates. The ESP32 client is
intentionally dumb: it just renders whatever this service sends it.

## Architecture: adapter pattern
Each integration is a small class implementing one method:

```python
class Adapter:
    def fetch(self) -> dict:
        # returns: {name, status: "ok"|"warn"|"down", value, unit, detail}
        ...
```

An aggregator loops over enabled adapters (config-driven — a YAML/JSON list,
git-trackable, no code change needed to enable/disable one) and merges their
results into one status payload.

Alert/severity logic (what counts as red vs amber) lives in the aggregator,
not in individual adapters — keeps adapters dumb and swappable.

For the exact code path from a raw adapter reading to bytes on the MQTT
wire (which function fills in `title`/`lines`, where the change-vs-heartbeat
publish decision happens, etc.), see
[`docs/pipeline.md`](docs/pipeline.md).

### Cards: named slots in `services[]`, with NO relationship to Adapters
Went through the same progression as Pixels (below), for the same
underlying reason, culminating 2026-09-19 in the current design:

1. **First**: a Card was created automatically, one per Adapter, named
   after it — `services[]` was really just "adapters, dressed up."
2. **Second**: `lines_template` let a Card reword an adapter's output via
   config, then combine several adapters via an explicit `sources:` list
   — a real improvement (see the retained rationale below on why
   combining adapters matters), but a Card still had to declare which
   adapters it was "for," and its `status` was still mechanically
   `_worst_status()` of just those sources.
3. **Current**: a Card (`config/cards.yaml`, `CardConfig`) has **no
   `sources:` at all** — just a `name`, optional `title`,
   `lines_template`, `status_template`, and a `render` toggle. Both
   templates render against the exact same global adapter context Pixels
   get (`build_multi_source_context()`, fed every currently loaded
   adapter) — a Card can reference any combination of adapters, or none
   at all, with zero declared link. **A Card only exists if it's listed
   in `cards.yaml` at all** — no automatic default any more; an adapter
   with no card referencing it publishes nowhere.
   ```yaml
   # config/cards.yaml
   cards:
     - name: "Card 1"
       title: "AdGuard"
       lines_template:
         - "{{ adapters.adguard_main.percent_blocked }}% blocked"
       status_template: "{{ adapters.adguard_main.status }}"
       render: true   # false skips this card entirely — not even a
                       # placeholder — while keeping it defined/editable
   ```
   With no `lines_template`, a card just shows its own title as one
   static line; with no `status_template`, it's always `"ok"` — there's
   no adapter-derived fold or worst-of-sources computation left to fall
   back to, since there's no declared relationship to any adapter any
   more. `status_template` must render to exactly `"ok"`/`"warn"`/`"down"`
   (same strict validation as a Pixel's `color_template` validates hex)
   or it falls back to `"ok"`.

**Why combining several adapters into one card still matters** (unchanged
from the original design): with 10 candidate adapter types below and only
10 display slots, combining related ones (e.g. Sonarr+Radarr+Prowlarr+
Bazarr's data into one "Arr Stack" card's `lines_template`) is a real
lever once there are more adapter instances than slots — now achieved by
just referencing multiple adapters in one card's template, no `sources:`
bookkeeping required. See [`docs/pipeline.md`](docs/pipeline.md) for the
full pipeline this produces.

**Consequence worth knowing**: since there's no automatic default any
more, a freshly added adapter with no matching card publishes nowhere —
same "nothing lights up for free" rule Pixels already follow.

### Candidate adapters (build incrementally, start with 2-3)
> ~~⚠ This is 10 adapters, client hard-caps `services[]` at 8~~ — first
> resolved by the client repo (`desk-dashboard-esp32@20a9472`, 2026-09-17,
> unprompted): `kMaxServices` raised 8 → 10 to match this list before it
> became a real problem. 5 of these 10 are built (Uptime Kuma, AdGuard,
> Proxmox, TrueNAS, Frigate), plus UniFi and Tracearr from outside the
> list — 7 adapters, still under the ceiling — but the ceiling itself is doubly no longer the constraint now
> that related adapters can be combined into one Card (above), for the
> case where there end up being MORE than 10 *adapters* (e.g. several
> `*arr` instances) even with only 10 display slots.

1. Uptime Kuma — services up/down count
2. AdGuard Home — query/block stats (native API, HTTP Basic Auth)
3. Proxmox — cluster CPU/RAM/node health (native REST API, read-only token)
4. arr stack — queue depth, download activity (exportarr)
5. Home Assistant — REST API, any entity; also runs Actions (built
   2026-09-26, see "Actions")
6. PBS — backup job status / last-run success
7. TrueNAS / Baby NAS — pool capacity / health
8. Portainer — stack/container health count
9. ntfy — recent alert count
10. Frigate — camera/detection status (see camera section below)

## Transport: MQTT (push, not polling)
The aggregator is mainly an MQTT **publisher** — its one subscription is
`homelab/action`, the display asking for an Action (see "Actions"). It
publishes to:
- `homelab/status` — full merged status payload, published on any adapter
  state change, PLUS a periodic heartbeat (~30-60s) even with no change, so a
  missed message or client reconnect doesn't leave the display stale.
- `homelab/alert/camera` — published when Frigate (or another adapter) flags
  an alert-worthy event; carries a reference/URL to the triggering snapshot.
  The ESP32 client jumps straight to a camera pop-up view on receipt.

**Broker: the central one (since 2026-09-28).** This project originally
ran its own dedicated Mosquitto and kept off Home Assistant's. It now
publishes to the homelab's central broker (192.0.2.25), shared with Home
Assistant and other projects — one broker to run, and HA can see these
topics directly. What the dedicated broker gave us is kept with ACLs
instead: each account can touch only its own `homelab/*` topics, so nothing
else on the broker can change what the display shows, and the display's
login can do nothing else there (`docs/mqtt-broker.md`). The bundled
broker remains as the `local-mqtt` compose profile.

## Pixels: the 5 physical LEDs, with NO relationship to Cards
This went through two earlier designs before landing here (2026-09-19,
same day, in fairly quick succession) — worth knowing the history because
each rejected version is a plausible-looking trap:

1. **First**: `pixel_map.yaml` mapped a pixel index straight to a card
   *name*, and the pixel's color was just `STATUS_COLORS[that card's
   status]`. Simple, but coupled a pixel's color 1:1 to a card's health.
2. **Second**: kept the name-based `pixel_map.yaml`, but let a `CardConfig`
   set its own `color_template` (Jinja2 -> `#RRGGBB`) so a card's pixel
   could mean something other than plain status — e.g. a calendar card
   rendering red for "event today". Better, but a pixel was still only
   ever *one card's* color — combining several adapters into one pixel
   still meant combining them into a visible Card first, and a Card's own
   text/severity had no reason to be entangled with what its pixel showed.
3. **Current**: a Pixel is its own independent concept
   (`app/pixels.py`, `PixelConfig`) — an index (0-4) and an optional
   `color_template`, with **no `sources:`, no card name, no link to
   `services[]`/Cards of any kind**. Its template renders against every
   currently loaded adapter directly, namespaced `adapters.<name>.<field>`
   (`build_multi_source_context()` fed the *entire* adapter set, not one
   card's subset):
   ```yaml
   # config/pixels.yaml
   pixels:
     - index: 0
       color_template: "{{ '#C0392B' if adapters.adguard_main.status == 'down' else '#1D9E75' }}"
     - index: 4
       color_template: "{{ '#8E44AD' }}"   # a hardcoded/constant color is just as valid — no adapter required
   ```
   An index with no entry (or, as shipped, an empty `pixels.yaml`) is
   simply off. A template that fails to render, renders empty, or
   doesn't produce a real 6-digit hex is also just off — no status-based
   fallback exists any more, since a pixel has no card/status to fall
   back to. `config/pixels.yaml` is hot-reloadable — `app.config.
   load_pixels()` re-reads it fresh every poll, the same property the
   old `pixel_map.yaml` had, and unlike a card's `lines_template` there's
   no live object to hot-patch: a save just needs to land on disk.
   Editable live on the web UI's Pixels page (its own
   pixel selector, its own live variable list — every loaded adapter, not
   scoped to any card — preview + Save & Apply, no restart), with a small
   set of example swatches as starting points; the field itself accepts
   any raw hex, not a fixed palette.

**Why this, and not tying color to status**: `overall.level`/
`overall.text` (the banner) are driven by the worst `status` across all
cards, and that has a real, pre-existing quirk worth knowing about —
AdGuard's `status` flips to `"warn"` purely from `percent_blocked < 5.0`
(`app/adapters/adguard.py`), a business-metric threshold, not an actual
failure (the fetch succeeded, AdGuard is up). That's enough to flip the
whole banner to "adguard_main degraded" even when every other card is
perfectly healthy. A pixel deriving its color from any card's `status` —
however indirectly — would inherit that same quirk. Pixels bypass it
entirely by not referencing `status` (or Cards) at all; a template is
free to read whatever raw adapter fields actually matter (e.g.
`adapters.adguard_main.percent_blocked` directly) instead of the
already-lossy `status` enum.

**Consequence worth knowing**: since no automatic status-based color
exists any more, a freshly deployed or freshly cleared `pixels.yaml`
means every LED is off until someone explicitly writes a `color_template`
for it — nothing lights up "for free" the way it used to.

## Actions (two-way: the display asks, the server acts)
Added 2026-09-26 with the Home Assistant adapter. The display's MENU gets
an **Actions** item listing `actions[]` from the status payload; turning
the encoder picks one and pressing sends its `id` on `homelab/action`.
This server looks the id up in `config/actions.yaml`, performs it, and
replies on `homelab/action/result`.

**Architecture, and why:** device → broker → this server → Home
Assistant's REST API. The more HA-native options were considered and
rejected: ESPHome's native API needs ESPHome firmware (this is custom
PlatformIO code), and MQTT discovery would (at the time) have meant a
second set of credentials on the device for HA's own broker. The broker is
now the shared central one (see "Transport"), but the reasoning below still
holds: the display talks only to this server's topics. As built, the display never holds a Home
Assistant credential and can only trigger actions already listed on the
server — a stolen `esp32-client` login can press the same buttons the
desk can, nothing more. (Mosquitto's ACL gives `esp32-client` write
access to `homelab/action` only.)

**An action** (`app/actions.py`, one entry in `actions.yaml`, edited on
the web UI's Actions page) has an `id` (what the device sends), a
`label`, the `adapter` that performs it, and a `kind`:
- `service` — call `domain.service` (e.g. `light.toggle`) on an optional
  `target` entity, with optional extra `data`;
- `script` — run a `script.*` entity, `data` as its variables;
- `event` — fire `desk_dashboard_action` with `{action: <id>, label}`,
  for a Home Assistant automation to handle (the logic then lives in HA,
  where HA users expect it).

Plus `confirm` (ask for a second press first — locks, garage doors) and
an optional `state_template`, rendered each poll against the same context
as cards (usually `{{ adapters.home_assistant.entities['light.desk'].state }}`)
and shown beside the label. `actions.yaml` is re-read every poll and every
run, like `pixels.yaml`: saves apply without a restart.

**Which adapters run actions:** any whose `action_kinds` is non-empty
(`Adapter.run_action()` in `app/adapters/base.py`) — today only
`home_assistant`. The web UI's Run button goes through the same
`ActionRunner` as the display, so the debounce covers both.

**Limits (the display's buffers):** 12 actions, 23-byte id and label,
11-byte state (cut server-side at a character boundary).

## AI-assisted template generation (app/ai_assist.py)
Added 2026-09-19: an "AI prompt" box next to each of the three template
kinds (Card `lines_template`/`status_template`, Pixel `color_template`)
in the web UI, backed by a local Ollama instance.

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
sandboxed render, real validation — a `color_template` still has to
match `#RRGGBB`, a `status_template` still has to be exactly
`ok`/`warn`/`down`) as anything typed by hand, so a bad or creative-but-
wrong generation just shows a render error or falls back safely (a pixel
goes off, a status falls back to `ok`) — confirmed live: a real
generation once produced a malformed `'%02x%02x%00'|format(...)` color
expression that simply failed validation and left that pixel off,
rather than breaking anything.

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
unset disables the feature entirely (the generate endpoints return 503
with a clear message) rather than every request hanging against an
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

## MQTT JSON payload schema

> **Coordination note** (added after a 2026-09-15 incident where a session
> working in the `desk-dashboard-esp32` repo edited this file directly
> instead of its own): changes here should be made by a session working in
> *this* repo. If you're an agent working in `desk-dashboard-esp32` and
> need something here to change, message this session (or the user)
> instead of editing across repos — two agents with plain filesystem
> access to each other's working directory is what caused the incident.
> `tests/test_design_doc_schema_sync.py` catches drift automatically
> (doc-vs-code, doc-vs-sibling-doc, and schema-file-vs-code) — run it
> before assuming this section, `app/models.py`, and `schema/*.schema.json`
> still agree.

Locked against the client repo (`desk-dashboard-esp32/DESIGN.md`) — the
JSON examples below (not the surrounding prose, which is repo-local) must
be valid instances of the same schema as theirs; exact example *values*
are expected to differ once `lines` content is adapter-specific (see
`tests/test_design_doc_schema_sync.py`, which checks this by validating
both docs' examples against the real Pydantic models rather than diffing
them against each other). Implemented in `app/models.py`
(`StatusPayload`/`Overall`/`ServiceReading`) and resolved by
`app/aggregator.py`. Also exported as JSON Schema to
`schema/status_payload.schema.json` / `schema/camera_alert.schema.json`
(regenerate via `python3 scripts/export_schema.py` after any model
change) for the client repo to validate firmware-side fixtures against.

### `homelab/status`
Published on any adapter state change and as a ~30-60s heartbeat regardless.
```json
{
  "version": 1,
  "ts": 1737000000,
  "overall": {
    "level": "ok",
    "text": "All systems normal"
  },
  "services": [
    {
      "name": "plex",
      "status": "ok",
      "value": 4,
      "unit": "streams",
      "detail": "4 active streams",
      "title": "plex",
      "lines": ["4 streams", "4 active streams"]
    },
    {
      "name": "uptime_kuma",
      "status": "warn",
      "value": 68,
      "unit": "/71 up",
      "detail": "3 down",
      "title": "Uptime Kuma",
      "lines": [
        "68 / 71 monitors up",
        "Down: bazarr, gluetun, +1 more",
        "24h uptime avg: 99.6%"
      ]
    }
  ],
  "pixels": {
    "0": "#1D9E75",
    "1": "#BA7517",
    "2": "#1D9E75",
    "3": "#1D9E75",
    "4": null
  },
  "actions": [
    {"id": "desk_lamp", "label": "Desk lamp", "state": "on", "confirm": false},
    {"id": "garage", "label": "Garage door", "state": "closed", "confirm": true}
  ]
}
```
- `overall.level` is `"ok"` | `"warn"` | `"down"` — the aggregator computes
  this from `services` (per "Alert/severity logic" above) and sends the
  client a final answer; the client does no severity logic of its own.
- `overall.text` is the short banner string, already worded here.
- `services` is an array, in the order the aggregator wants cards to
  rotate — each entry is one **Card**'s rendered output (`app/cards.py`),
  NOT an adapter's `fetch()` return value: a Card has no declared link to
  any adapter at all, so `value`/`unit`/`detail` below are vestigial
  fields a Card simply doesn't populate (always `null` on anything
  actually published today) — this example predates that redesign but
  remains schema-valid, since those fields were always optional.
- `title` (string; added 2026-09-19): display text for the card's title
  row — the Card's own `title:` override, or its `name` if it didn't
  bother (`app.aggregator.resolve_card_title`). Always present, same
  enforcement pattern as `lines`: `app.models.ServiceReading.title` is
  required. **`name` itself is never repurposed for this** — it stays
  the stable identifier `cards.yaml` uses, unrelated to Pixels (see that
  section — a service has no link to any pixel). (The status glyph next
  to the title — a colored circle/triangle/square — is drawn entirely
  client-side from `status`, confirmed live 2026-09-19; no field carries
  it, `title` is unrelated to that decision. **Updated 2026-09-24**: the
  glyph itself changed from a plain shape to a real check-circle / alert
  / close-circle icon — see "Card icons" below — but the mechanism is
  identical: still driven entirely by `status`, still no field carries
  it.)
- `lines` (1-4 strings; added 2026-09-17, made always-present 2026-09-18):
  pre-formatted display lines for the client's generalized card renderer
  (title row + up to 4 detail rows) — each string shown verbatim, zero
  client-side formatting beyond drawing `:name:` icon codes (see "Card
  icons"), same principle as `overall.text`. **Always present on every
  service, never null** — enforced server-side
  (`app.models.ServiceReading.lines` is a required field). A Card
  renders these from its own `lines_template` if it has one, referencing
  any adapter directly (`{{ adapters.adguard_main.percent_blocked }}`),
  or just falls back to `[title]` — a single static line — if it
  doesn't; there's no adapter-derived fold any more (see
  docs/pipeline.md). **Position matters:** `lines[i]` always lands in row
  `i`, each row has its own length limit, and an empty line is sent as
  `""` rather than dropped (see "Client display limits"). Over-long lines
  aren't rejected — the editor flags them and the client cuts them off.
- `pixels` keys are strings `"0"`-`"4"` (JSON object keys can't be bare
  ints); `null` means off. Built entirely from each pixel's own
  `color_template` (`config/pixels.yaml`) — completely independent of
  `services[]`/Cards, see the Pixels section above.
- `actions` (added 2026-09-26): the display's Actions menu, in order —
  see "Actions" below. `state` is short live text shown beside the label
  (`null` for none), cut server-side to fit; `confirm` means ask for a
  second press before sending. Nothing about what an action *does* is
  here. Always present (`[]` when none are configured); a client that
  predates it just ignores the key.
- `ts` is unix seconds.

### `homelab/alert/camera`
```json
{
  "camera": "front_door",
  "ts": 1737000000,
  "snapshot_url": "http://<host>/snapshot/front_door?event=<id>",
  "label": "person",
  "text": "Front Door: person detected"
}
```
- `snapshot_url` points at the resized-JPEG endpoint described below; the
  ESP32 fetches it directly over HTTP rather than the JPEG bytes going
  through MQTT.
- `label` is the detected object class, optional.
- `text` is pre-worded for display, not derived client-side.

### `homelab/action` (published by the display)
```json
{"id": "desk_lamp", "req": 17}
```
- `id` is one of the `actions[].id` values from the latest status payload.
- `req` is the display's own counter, echoed back in the result so a
  reply can be matched to the press that caused it.
- QoS 0 from the device, not retained. The server runs only actions
  listed in `config/actions.yaml`; any other `id` gets an "Unknown
  action" reply and does nothing.

### `homelab/action/result` (published by the server)
```json
{"id": "desk_lamp", "req": 17, "ok": true, "text": "Done"}
```
- One reply per request, not retained. `text` is short and pre-worded
  for the display: `Done`, `Failed`, `Too soon` (the same action pressed
  again within a second — debounced), `No adapter`, `Unknown action`.
- A successful action also triggers a poll a second later, so the new
  state (`actions[].state`, and any card showing the same entity) reaches
  the display without waiting out the poll interval.

## Card icons (inside line text)
The ESP32 has a 146-icon set (Material Design Icons 7.4.47, 24px — sized
for Font 4's ~26px line height, which every card row renders in, title and
detail alike) built by `desk-dashboard-esp32`'s
`tools/icons/build_icons.py` into `data/icons.vlw` — a TFT_eSPI smooth
font on the device's SPIFFS partition, uploaded with `pio run -t
uploadfs` (never by OTA). See that repo's DESIGN.md "Status icon font"
for how it's built, including the real bugs found getting it working (a
`loadFont()` overload that silently draws nothing on this display, VLW
glyph headers needing to be one block ahead of all bitmap data, and the
first icon size — 16px — looking small once actually next to Font 4's
numerals on real hardware).

**Icons go anywhere in the detail rows (`lines[0..3]`)**, any number per
line, as a named code in the line's own text — no schema change, `lines`
stays an array of strings:

```json
"lines": ["7 hosts", ":wifi: 71 up  :lock: 3 locked", ":harddisk: 42%  :thermometer: 38"]
```

- **The wire rule** (server `app/icons.py`, editor `frontend/src/lib/icons.ts`
  and the client must all follow it exactly): scanning left to right, a `:`
  followed by a catalog name and another `:` is an icon, and scanning
  continues after its closing `:`. Any other `:` is ordinary text and
  scanning continues from the very next character. So `12:30:05` stays
  text, `:wifi::lock:` is two icons, and `a:b:wifi:` is `a:b` then wifi.
- **Names, never codepoints**, go on the wire. The client's codepoints
  (from U+E000, in `icon_list.txt` order) are its own business and get
  renumbered whenever that list changes.
- **Templates write icons with `{{ icon('wifi') }}`**, which renders to
  `:wifi:` and fails at Preview on a name that doesn't exist ("did you mean
  'wifi'?") rather than drawing nothing. The editor has an icon picker per
  line and draws the icons (via `@mdi/js`, same version) in its results and
  display preview; AI assist is told the helper and every name.
- **Limits:** an icon counts as **3 bytes** against its row's limit
  (`CLIENT_LINE_MAX_CHARS`) however long its name is — the client swaps the
  code for its 3-byte glyph as it copies the line in (below) — and as its
  glyph's advance width (24px for every icon today) toward whether the row
  scrolls.
- **The status glyph** on the title row is also one of these icons now
  (check-circle / alert / close-circle), still chosen by the client from
  `status` — no field carries it. The title row itself does not take icon
  codes.
- **Keeping the two repos in step:** `scripts/sync_icons.py` reads the
  client's `icon_list.txt` (names) and `data/icons.vlw` (each glyph's
  advance) into `app/icon_catalog.json`, and writes
  `frontend/src/lib/icon-paths.ts`. `tests/test_icons.py` fails when either
  is out of date with the client repo checked out alongside. Rerun the
  script whenever the client's icon set changes.

**Client-side rendering (desk-dashboard-esp32), implemented 2026-09-24:**

1. **Codes are swapped for their glyph while copying each line into its
   buffer** (`populateDetailLines` → `copyTruncatedWithIcons`, a sibling
   of the plain `copyTruncated` every other field still uses), not after:
   `:name:` → the icon's 3-byte UTF-8 glyph, by the rule above. Every code
   is at least 3 bytes, so the result never grows, and doing it during the
   copy is what makes an icon cost 3 bytes against the limit — converting
   after a plain copy would count the whole name and could cut a code in
   half at the end of a full line. The name → codepoint table
   (`Icon::lookupByName`) is generated into `icons.h` by `build_icons.py`,
   alongside `Icon::advanceForCodepoint` for the reverse direction the
   renderer needs (below).
2. **A row draws in runs** (`splitLineRuns` in `drawCardLine`): text in
   font 4, each glyph from `icons.vlw`, advancing by `textWidth()` / the
   glyph's advance — the same sum this server predicts
   (`app.aggregator.client_text_width_px`), so the scroll decision agrees
   on both sides.
3. **The icon font isn't reloaded per glyph.** A row's text draws first
   (smooth font unloaded, since TFT_eSPI routes ALL text through it the
   moment it's loaded, not just icon codepoints — confirmed the hard way),
   then, if the row has any icons, the font loads once, every icon glyph
   in the row draws, and it unloads once — one load/unload pair per
   row-draw regardless of icon count, not per icon, since a scrolling row
   redraws every 120ms.
4. **Without `icons.vlw`** (e.g. firmware updated by OTA but never
   `uploadfs`'d), icon codes draw as nothing (the reserved space stays,
   so layout doesn't jitter if the font becomes available later), and the
   status glyph falls back to the old circle/triangle/square rather than
   showing no status indicator at all.

### Full icon catalog
The names usable in `:name:` / `icon('name')`, grouped by category in
`icon_list.txt`'s own order (`app/icon_catalog.json` is the checked copy;
this list is for reading):

**Tech / network**
`chip`, `memory`, `server`, `server-network`, `database`, `lan`,
`ethernet`, `wifi`, `wifi-off`, `bluetooth`, `bluetooth-off`, `usb`,
`harddisk`, `monitor`, `laptop`, `desktop-tower`, `keyboard`, `printer`,
`power-plug`, `power-plug-off`, `power`, `restart`, `update`, `download`,
`upload`, `sync`, `sync-alert`, `cloud`, `cloud-off`, `cloud-check`,
`cloud-alert`, `shield-check`, `shield-alert`, `lock`, `lock-open`,
`key-variant`, `cctv`, `camera`, `camera-off`, `video`, `motion-sensor`,
`doorbell`, `router-wireless`, `access-point`, `access-point-network`,
`signal`, `signal-off`

**Battery / charging**
`battery`, `battery-outline`, `battery-charging`,
`battery-charging-outline`, `battery-alert`,
`battery-alert-variant-outline`, `battery-20`, `battery-50`,
`battery-unknown`

**Weather**
`weather-sunny`, `weather-partly-cloudy`, `weather-cloudy`,
`weather-rainy`, `weather-pouring`, `weather-lightning`,
`weather-lightning-rainy`, `weather-snowy`, `weather-fog`,
`weather-windy`, `weather-night`, `weather-hail`, `thermometer`,
`thermometer-low`, `thermometer-high`, `water-percent`

**Generic status / UI**
`check-circle`, `alert-circle`, `alert`, `close-circle`, `close`,
`information`, `help-circle`, `pause-circle`, `play-circle`,
`clock-alert`, `minus-circle`, `plus-circle`, `circle`

**Containers / homelab brands** (added 2026-09-24)
`docker`, `kubernetes`, `package-variant`, `home-assistant`, `plex`,
`github`, `gitlab`, `git`

**More networking / notifications** (added 2026-09-24)
`nas`, `backup-restore`, `bell`, `bell-alert`, `dns`, `router`,
`router-network`, `vpn`, `console-network`, `domain`, `web`, `earth`,
`ip-network`, `folder-network`, `swap-horizontal`, `movie-open`, `magnet`

**Home Assistant domains** (added 2026-09-26 — people/presence, lighting,
switches, climate, covers, safety sensors, media, appliances, rooms)
`account`, `account-multiple`, `account-group`, `walk`, `home`,
`lightbulb`, `lightbulb-outline`, `ceiling-light`, `toggle-switch`,
`power-socket`, `thermostat`, `fan`, `air-conditioner`, `garage`,
`garage-open`, `window-shutter`, `door`, `door-open`, `window-closed`,
`window-open`, `water`, `water-alert`, `smoke-detector`, `molecule-co`,
`speaker`, `television`, `cast`, `washing-machine`, `fridge`,
`dishwasher`, `sofa`, `bed`, `gauge`, `timer`, `timer-outline`, `flash`

## Client display limits
Reported by the client repo 2026-09-19 — every field below is a fixed-size
buffer on the ESP32 (desk-dashboard-esp32's header file is the actual
source of truth; this is a mirror for awareness on this side). Exceeding
one does **not** error or crash the client — it silently truncates
(clipped to fit, null-terminated) or, for the services cap, silently drops
the whole entry. Either way, there's no signal back to this service that
it happened; `app.aggregator` logs a warning of its own when a payload
about to be published would exceed one of these, specifically because the
client can't tell us.

None of these are hard walls — the client session said they're one-line
constant changes on their side if a real need comes up (they already
bumped the per-line limit from 47 to 99, then split it per row
2026-09-23). Ask before assuming a
number below is still current; these are a snapshot, not a contract like
the JSON schema above is.

`homelab/status`, per service:
- `name`: 23 usable chars (24-byte buffer)
- `status`: 7 chars (the three literal values all fit easily — not a
  practical concern)
- `lines[]`: max 4 entries (already enforced by the schema's `max_length`
  above). Each entry's limit depends on its **position** — the client
  (`kDetailLineLens`) copies `lines[i]` into row `i` strictly by index:
  - `lines[0]`: 24 usable chars (25-byte buffer)
  - `lines[1]`, `lines[2]`: 74 usable chars each (75-byte buffers)
  - `lines[3]`: 224 usable chars (225-byte buffer)

  Separately from those caps, any row **scrolls** sideways once its text
  is wider than 308px (the 320px screen less 6px margins) in TFT_eSPI
  font 4, which every row uses — about 22 characters, fewer for wide
  letters. `app.aggregator.client_text_width_px` reproduces the client's
  `textWidth()` from the font's width table so the editor can say which
  lines will scroll.

  So an empty line in the middle is published as `""` at its own index
  (the client draws a blank row), never removed. Removing it would move
  later lines into smaller rows. Trailing blanks are trimmed. The card
  editor has one input per row (each with its own "Ask AI", which
  writes just that line), shows each line's rendered length against its
  row's limit and whether it scrolls, and warns on save. Mirrored in `app.aggregator.CLIENT_LINE_MAX_CHARS`.

`homelab/status`, top level:
- `overall.text`: 47 chars
- `services[]`: **max 10 entries** (raised from 8 by
  `desk-dashboard-esp32@20a9472`, 2026-09-17, to match the candidate-adapter
  list above before it became a real problem) **— anything past the cap is
  dropped entirely, not truncated.**
- `pixels`: fixed at exactly 5 indices, tied to the physical LED count —
  not really a content limit, just noted for completeness

`homelab/alert/camera`:
- `camera`: 31 chars, `snapshot_url`: 159 chars, `text`: 63 chars

## Camera / Frigate integration
No live video — ESP32 can't decode RTSP/H.264. Instead:
- **One `frigate` adapter** (`app/adapters/frigate.py`, added from the
  Adapters tab) does both jobs over Frigate's HTTP API: `fetch()` reads
  `/api/stats` for camera/detector health (a normal status reading for
  cards/pixels), and the optional `Adapter.poll_alerts()` hook reads
  `/api/events` and returns new `CameraAlert`s, which the aggregator
  publishes to `homelab/alert/camera` every poll. Any adapter can
  override `poll_alerts()`; the default returns nothing.
- Alerts are edge-triggered, so the adapter keeps its own state: the ids
  of events already seen (the first poll only baselines, so a restart
  never replays history) and a per-camera cooldown. Which cameras and
  labels alert, the cooldown, and the URL the display uses to reach this
  server (`snapshot_base_url`) are all adapter options — no code or env
  change to retune.
- `GET /snapshot/<camera>[?event=<id>]` proxies Frigate's JPEG (the
  event's own snapshot with its bounding box, or the camera's latest
  frame), scaled to fit the display (`SNAPSHOT_WIDTH`/`HEIGHT`, aspect
  kept, letterboxed) so the ESP32 only decodes. It uses the Frigate
  adapter's URL.

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
  login endpoint, the static `/schema/*` files, and the React app's static
  shell/bundle (the login screen is part of that app; all data comes from the
  authenticated `/api`).
  - Users live in Postgres (`users`, `sessions`, `audit_log`); passwords are
    Argon2id; sessions are server-side with an opaque HttpOnly cookie (only its
    SHA-256 is stored) and a per-session CSRF token required on every write.
  - Roles: `viewer` (read, preview) and `admin` (everything, incl. adapters and
    their credentials, restart, user management). Failed logins are throttled
    per account and per IP; logins and every state-changing call are recorded
    in `audit_log` (request bodies are never logged, only a few safe keys).
  - Postgres being down never stops polling/MQTT publishing — only login.
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
  - **The display gets its broker from the server** (`GET /device/config`,
    since 2026-09-28), so it can move brokers without a reflash. It
    authenticates with a device token: a 256-bit random value, stored
    only as a SHA-256, sent as a Bearer header so it never appears in an
    access log. The endpoint hands out the `esp32-client` password over
    plain HTTP. That's accepted because the display's MQTT connection
    already sends the same password in the clear on the same LAN. The
    firmware (desk-dashboard-esp32 `device_config.cpp`) keeps a fetched
    change only once it has connected with it, and rolls back otherwise.
  - **The ESP32 needs no credentials**: camera-alert `snapshot_url`s carry an
    HMAC signature and expiry (`app/signing.py`), which `/snapshot/*` accepts
    in place of a session. Links must fit the firmware's 160-char URL buffer
    (tested).
  - Also: one strict CSP on every response (`script-src 'self'`, no inline
    scripts), `no-store` on `/api`, password changes share the login
    throttle (a hijacked session can't guess the current password), and audit
    rows are pruned after `AUDIT_RETENTION_DAYS` (default 365).
  - **Exposing it beyond the LAN** is a deliberate step, not a default: see
    `docs/reverse-proxy.md`. The one non-obvious constraint is that the
    ESP32 can't do TLS, so the app port must stay reachable over plain HTTP on
    the LAN for `/snapshot` (its links are signed, so that's safe).

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
  `adapters.yaml`/`cards.yaml`/`pixels.yaml`/`secrets.enc.yaml` live in
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
  (blank secret = keep), remove (with a warning for cards/pixels that
  reference it, and its now-unused secrets deleted), and a **Test
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
- ~~Design the exact `/status` payload schema~~ — done, locked with the
  ESP32 client repo (see "MQTT JSON payload schema" above) and implemented
  in `app/models.py`/`app/aggregator.py`. (A conflicting draft briefly
  existed in `app/models.py` from before the two repos were reconciled —
  resolved in favor of the client repo's version, since it keeps the
  client's severity/color logic at zero, per this doc's own "intentionally
  dumb" principle.)
- ~~Decide Mosquitto container config (auth, persistence, topic ACLs)~~ —
  done: password auth (`mosquitto/config/mosquitto.conf`), two accounts
  provisioned from env vars at container start (`mosquitto/entrypoint.sh`),
  and topic ACLs (`mosquitto/config/acl.conf`) restricting `aggregator` to
  write-only and `esp32-client` to read-only on both topics. Verified
  end-to-end: anonymous/bad-password connections refused, and a write from
  `esp32-client` is silently dropped by the ACL rather than reaching the
  topic. TLS was deliberately skipped — LAN-only broker; revisit
  if it's ever exposed beyond the LAN. **Changed 2026-09-26 for Actions:**
  each account now has exactly one topic in the other direction —
  `esp32-client` writes `homelab/action` and reads
  `homelab/action/result`, `aggregator` the reverse; everything else is
  as before.
- ~~Build adapters incrementally~~ — 7 adapters built in `app/adapters/`.
  Verified 2026-09-23 by polling each once against the real homelab
  service: AdGuard Home, Uptime Kuma, Frigate, UniFi, Tracearr and Proxmox
  VE 9.2 all returned `ok` with every `context` field populated (the only
  empty ones were lists with nothing to report, e.g. no monitors down).
  **Still open: TrueNAS** — built from the documented API only, not yet
  configured against the real box (and iX has deprecated the REST API it
  uses, so it may need porting to JSON-RPC).
- Scheduled ntfy digest (push a summary of live data at a configured time,
  e.g. daily 7am) — see `docs/plan-ntfy-digest.md`. Proposed 2026-09-22, not
  yet implemented; three open questions in that doc (ntfy.sh vs. self-hosted,
  one digest or several, global vs. per-user) need answers before it starts.
  Card-triggered alerts (notify the moment a card's status changes, not on a
  schedule) were discussed too and sketched as a later Phase 2 in the same
  doc, once the digest's ntfy-sending machinery exists to build on.
