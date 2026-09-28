"""App-wide settings, loaded from environment variables (see .env.example)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # extra="ignore": .env legitimately carries vars this class doesn't
    # declare — MQTT_CLIENT_USERNAME/PASSWORD and
    # APP_PORT (consumed by docker-compose.yml's own substitution, never
    # read by the Python process at all). Without this, pydantic-settings
    # defaults to extra="forbid" and raises a ValidationError that embeds
    # the actual offending values in its message — which is exactly how a
    # real .env's secrets ended up printed in plaintext during a pytest run
    # on 2026-09-16. Never remove this.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # MQTT
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    # Must match a user in mosquitto/config/acl.conf — see .env.example.
    mqtt_username: str = "aggregator"
    mqtt_password: str | None = None
    mqtt_status_topic: str = "homelab/status"
    mqtt_camera_alert_topic: str = "homelab/alert/camera"
    # Actions (app/actions.py): the display publishes to the first, this
    # service replies on the second.
    mqtt_action_topic: str = "homelab/action"
    mqtt_action_result_topic: str = "homelab/action/result"

    # Aggregator loop timing
    poll_interval_seconds: float = 15.0
    heartbeat_interval_seconds: float = 45.0

    # Postgres (users / sessions / audit log — docs/plan-ui-and-auth.md).
    # SQLAlchemy async URL, e.g. postgresql+asyncpg://user:pass@postgres:5432/db
    # (percent-encode any special characters in the password). None disables
    # everything that needs the database; the aggregator and MQTT publishing
    # never depend on it — see app/db.py.
    database_url: str | None = None

    # --- Authentication (docs/plan-ui-and-auth.md) -----------------------
    # First admin, created once at startup when the users table is empty
    # (then ignored — remove these from .env afterwards).
    admin_username: str | None = None
    admin_password: str | None = None
    # True when the UI is served over HTTPS (e.g. behind a reverse proxy):
    # marks the session cookie Secure (and __Host- prefixed) and sends HSTS.
    # Leave False for plain-HTTP LAN access, or login cookies won't stick.
    https_only: bool = False
    # Comma-separated proxy IPs whose X-Forwarded-For is believed (used for
    # the audit log and login rate limiting). Empty = never trust it.
    trusted_proxies: str = ""
    # Audit-log rows older than this are deleted (at startup / when the database
    # comes back). 0 keeps everything.
    audit_retention_days: int = 365
    session_idle_hours: float = 24.0
    session_max_days: float = 14.0

    # Signs the /snapshot links embedded in camera alerts so the ESP32 (no
    # auth, plain HTTP) can fetch them without a login. Unset = a random key
    # per process, which is fine: links are short-lived and only need to
    # survive until the display fetches them (a restart just invalidates any
    # in-flight ones).
    snapshot_signing_key: str | None = None
    snapshot_url_ttl_seconds: int = 600

    # Built React app (frontend/dist). Blank = <repo>/frontend/dist, which is
    # where the Docker image puts it. See app/spa.py.
    frontend_dist_path: str | None = None

    # Config file locations
    adapters_config_path: str = "config/adapters.yaml"
    cards_config_path: str = "config/cards.yaml"
    pixels_config_path: str = "config/pixels.yaml"
    actions_config_path: str = "config/actions.yaml"
    # Encrypted per-adapter credentials (app/secret_store.py). The master
    # key is the one secret still held unencrypted; see .env.example.
    secrets_config_path: str = "config/secrets.enc.yaml"
    secrets_master_key: str | None = None
    # MQTT broker / database set from the web UI's Connections page; they
    # replace the MQTT_* / DATABASE_URL values above (app/connections.py).
    connections_config_path: str = "config/connections.yaml"

    # Frigate snapshot proxy (see DESIGN.md "Camera / Frigate integration").
    # Landscape (320x240) to match the ESP32 client's CAMERA screen, which
    # runs the same landscape orientation as HOME/MENU (TFT_eSPI rotation) —
    # a portrait snapshot here would letterbox down to a thin strip on a
    # screen that doesn't share its aspect ratio. Confirmed 2026-09-20 with
    # the desk-dashboard-esp32 side, which built CAMERA screen decode
    # straight to a 320x240 framebuffer.
    snapshot_width: int = 320
    snapshot_height: int = 240

    # AI-assisted template generation (app/ai_assist.py) — Ollama runs on
    # the host, not in this compose stack; see docker-compose.yml's
    # extra_hosts entry for how the container reaches it. None entirely
    # disables the feature (the generate endpoints 503) rather than
    # failing every request against an unreachable default host.
    ollama_base_url: str | None = "http://host.docker.internal:11434"
    ollama_model: str = "qwen2.5:14b"
    """Was llama3.1:8b until 2026-09-23. Asked to keep a card's two lines
    and add a Proxmox memory line, qwen2.5:14b got it right 3 times out of
    3 (after a corrective turn for guessed field names), while llama3.1:8b
    managed 0 of 3: after its tool calls it lost the request and answered
    with prose or a template about some other adapter. qwen2.5:14b (9 GB)
    fits the host's 11 GB GPU.

    Also verified live 2026-09-18 that llama3.1:8b and qwen2.5:7b populate
    Ollama's structured `message.tool_calls` field, unlike
    qwen2.5-coder:14b on the same Ollama version — that one emitted a
    tool-call-shaped JSON blob as plain text `content` instead, despite
    being tagged with "tools" capability. app.ai_assist parses both
    shapes defensively, but pick a model you've confirmed actually
    round-trips tool calls correctly if you change this."""

    # Shown in the web UI footer. The Docker build sets it (see Dockerfile).
    app_version: str = "dev"

    log_level: str = "INFO"


settings = Settings()
