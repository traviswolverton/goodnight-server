# Bedside Dashboard Server

The bedside sibling of [desk-dashboard-server](https://github.com/traviswolverton/desk-dashboard-server),
forked with full history (`upstream` remote). Same job — poll homelab services,
turn them into what a small display should show, publish it over MQTT — for a
nightstand ESP32 ([bedside-dashboard-esp32](https://github.com/traviswolverton/bedside-dashboard-esp32))
with a 128×32 OLED, 8 buttons, a joystick, and light/temperature/humidity
sensors. On top of the desk server it adds the **Device** page: live sensor
readings, the screen's light-following dimmer, and what each button does.

- **Web UI** — React (`frontend/`), served by the same container.
- **API + poller** — FastAPI (`app/`): adapters → cards/pixels (Jinja2 templates)
  → MQTT (`bedside/status`); the device link (`app/device.py`) sends the device
  its settings and reads its sensors and button presses.
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

Live configuration (adapters, cards, pixels, encrypted secrets) lives outside
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

Every route requires a login except `/healthz`, the JSON Schema files, and the
static UI shell (a test fails if a new route is left open). Passwords are
Argon2id; sessions are server-side; every write needs a CSRF token; logins and
password changes are rate-limited; all changes are audited; adapter credentials
are encrypted at rest and never sent to a browser. The ESP32 needs no
credentials — the snapshot links in camera alerts are signed and expire. Details
in `DESIGN.md` ("Security / network exposure").
