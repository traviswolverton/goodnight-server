# Bedside Dashboard Server

The bedside sibling of [desk-dashboard-server](https://github.com/traviswolverton/desk-dashboard-server),
forked with full history (`upstream` remote), for a nightstand ESP32
([bedside-dashboard-esp32](https://github.com/traviswolverton/bedside-dashboard-esp32))
with a 128×32 OLED, 8 buttons, a joystick, a piezo buzzer, and
light/temperature/humidity sensors. Where the desk server shows homelab status
cards, this one turns button presses into Home Assistant actions — with a
confirm press, a check that it really happened, and a sound for each step —
and looks after the device itself: its **Device** page (readings, the
light-following dimmer, the buzzer) and **Buttons** page.

- **Web UI** — React (`frontend/`), served by the same container.
- **API + poller** — FastAPI (`app/`): polls adapters (Home Assistant, the
  device's own sensors) for Actions to run and check; the device link
  (`app/device.py`) sends the device its settings and sounds, and turns its
  button presses into Actions.
- **Accounts** — Postgres; admin/viewer roles, sessions, audit log.
- **MQTT broker** — your central broker (accounts and ACLs in
  [`docs/mqtt-broker.md`](docs/mqtt-broker.md)), or a bundled Mosquitto via the
  `local-mqtt` compose profile.

Design and history: [`DESIGN.md`](DESIGN.md) · data flow: [`docs/pipeline.md`](docs/pipeline.md) ·
UI/auth plan and what was built: [`docs/plan-ui-and-auth.md`](docs/plan-ui-and-auth.md) ·
exposing it beyond your LAN: [`docs/reverse-proxy.md`](docs/reverse-proxy.md).

## Run it

```bash
cp .env.example .env        # then fill in the passwords (see the comments inside)
docker compose up -d --build
```

Set at least `MQTT_HOST`, `MQTT_PASSWORD`, `DATABASE_URL`, and
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (12+ characters). `DATABASE_URL` points at
a Postgres you provide (one-time role/database setup in
[`docs/database.md`](docs/database.md)), or at the bundled container via the
`local-db` compose profile. `MQTT_HOST` is likewise a broker you provide
([`docs/mqtt-broker.md`](docs/mqtt-broker.md)) or the bundled one via
`local-mqtt`. The first start creates that administrator; sign in at `http://<host>:8001`. After
that the two `ADMIN_*` values are ignored and can be removed.

After the first start, the broker and database can be changed on the web UI's
**Connections** page. Each change is tested before it's saved, and the saved
values override `.env` (`config/connections.yaml`). The rest of the tunable
values are on the **Settings** page. These are polling, sessions,
HTTPS and proxies, audit retention, Ollama, and log level. They take effect
immediately on save, with no restart (`config/settings.yaml`).

Live configuration (adapters, actions, device, connections, settings, encrypted secrets) lives outside
the repo in `/opt/bedside-dashboard-data/config` and is edited through the web UI;
`config.example/` shows the file formats.

The container runs a **single worker on purpose** — the poll loop and MQTT
connection are in-process state.

## Develop

```bash
# Backend (Python 3.12)
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # unit + API tests (no services needed)

# Frontend (Node 22+)
cd frontend && npm install
npm run dev                              # hot reload on :5173, proxying to the backend on :8000
npm run build && npx vitest run && npm run lint
```

More in [`frontend/README.md`](frontend/README.md).

### Browser tests

```bash
e2e/run.sh            # builds the real image, starts a throwaway Postgres + MQTT + app,
                      # drives Chromium through every page, tears it all down
e2e/run.sh a11y       # just the axe accessibility audit (WCAG 2.1 A/AA, both themes)
```

Needs only Docker. It never touches your running deployment. See
[`e2e/README.md`](e2e/README.md).

## Layout

```
app/            FastAPI service: adapters/, api/, auth/, aggregator, mqtt, spa, ...
app/migrations/ Alembic (applied automatically at startup)
frontend/       React app (Vite, TypeScript, Tailwind, shadcn/ui)
e2e/            Browser tests (Puppeteer + axe-core, run in Docker)
tests/          pytest suite
schema/         JSON Schema for the MQTT payloads (regenerate: scripts/export_schema.py)
mosquitto/      Bundled broker config (local-mqtt only);  postgres/  role creation (local-db only)
docs/           Longer-form docs and plans
```

## Security in one paragraph

Every route requires a login except `/healthz`, `/device/config` (the device's
own token), and the static UI shell (a test fails if a new route is left open). Passwords are
Argon2id; sessions are server-side; every write needs a CSRF token; logins and
password changes are rate-limited; all changes are audited; adapter credentials
are encrypted at rest and never sent to a browser. The ESP32 holds
only its own MQTT login and device token; a button press is a number, never an
instruction. Details
in `DESIGN.md` ("Security / network exposure").
