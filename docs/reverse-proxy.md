# Putting Desk Dashboard behind a reverse proxy (HTTPS / outside your LAN)

Read this before exposing the web UI beyond your LAN. Everything else in the
app assumes it; this is the part that isn't automatic.

## The one constraint: the display can't do TLS

The ESP32 fetches camera snapshots with a bare **plain-HTTP** request to the
`snapshot_url` in the MQTT alert (its firmware deliberately has no TLS stack).
So the app's port must stay reachable **over plain HTTP on your LAN**, and the
Frigate adapter's *"This server's URL, as the display reaches it"* field must
be that LAN address (e.g. `http://192.0.2.45:8000`), **not** your public
HTTPS name.

That's safe: `/snapshot/*` only accepts a signed, short-lived link (or a
logged-in session), so a leaked link expires within minutes and works for one
camera + event only.

Two shapes that work:

1. **Recommended — two doors.** Leave the app published on the LAN as today
   (`APP_BIND` unset). Add a reverse proxy that serves the *public* HTTPS name
   and forwards to it. The display uses the LAN address; people use HTTPS.
   Firewall the app port from the internet (don't port-forward it) so only
   the proxy is exposed.
2. **Proxy-only.** Set `APP_BIND=127.0.0.1` so nothing but a proxy on the same
   host can reach the app, and have the proxy also serve a LAN-only plain-HTTP
   listener for `/snapshot/` (see the Caddy example). More moving parts; only
   worth it if you can't firewall the port.

## App settings (`.env`)

| Variable | Set it to | Why |
|---|---|---|
| `HTTPS_ONLY` | `true` | Session cookie becomes `Secure` and `__Host-`-prefixed; `Strict-Transport-Security` is sent. With this on, **plain-HTTP logins stop working** (browsers drop the cookie) — use the HTTPS name. |
| `TRUSTED_PROXIES` | your proxy's IP(s), comma-separated | Only then is `X-Forwarded-For` believed, so the audit log and login throttling see the real client instead of the proxy. Leave empty and every request looks like it came from the proxy — one attacker could lock everyone out. |
| `APP_BIND` | `127.0.0.1` (shape 2 only) | Publish the port on this host only. |
| `SNAPSHOT_SIGNING_KEY` | `openssl rand -hex 32` (optional) | Keeps snapshot links valid across restarts. |

The proxy must pass `X-Forwarded-For` (all mainstream proxies do by default)
and `Host`. It does **not** need to set `X-Forwarded-Proto`: the app decides
cookie security from `HTTPS_ONLY`, not from headers.

## Caddy (automatic certificates)

```caddyfile
dashboard.example.com {
    reverse_proxy 192.0.2.45:8000
}

# Shape 2 only: LAN plain-HTTP door for the display, snapshots only.
http://192.0.2.45:8080 {
    @snap path /snapshot/*
    reverse_proxy @snap 127.0.0.1:8000
    respond "not found" 404
}
```

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name dashboard.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://192.0.2.45:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 1m;
    }
}
```

## Checklist before you open it up

- [ ] `HTTPS_ONLY=true` and `TRUSTED_PROXIES` set; app restarted.
- [ ] The app port is **not** forwarded from your router / firewalled from WAN.
- [ ] `ADMIN_USERNAME` / `ADMIN_PASSWORD` were only for first boot — remove
      them from `.env` (they're ignored once a user exists, but shouldn't sit there).
- [ ] Every account has a long unique password (12+ characters enforced);
      remove accounts you don't use (Users → delete/disable).
- [ ] Sign in over HTTPS and confirm: the cookie is `Secure`
      (browser dev tools → Application → Cookies), and Users → Activity shows
      *your* IP, not the proxy's.
- [ ] Trigger a camera alert (or open a signed link) and confirm the display
      still gets its snapshot over the LAN address.
- [ ] Postgres and MQTT ports aren't published to the internet
      (Postgres isn't published at all; MQTT `1883` is LAN-only by design).

## What protects you, and what doesn't

Built in: default-deny auth on every route, Argon2id passwords, server-side
sessions, CSRF tokens on every write, per-account and per-IP login throttling
(also on password changes), a full audit log, a strict CSP (no inline
scripts), no-store caching on the API, and role checks enforced server-side.

Not built in — worth adding at the proxy if you're exposed long-term: request
rate limiting at the edge, IP allow-listing, and single sign-on / MFA in front
(e.g. an Authentik forward-auth or OIDC layer; the app's own OIDC login is
planned but not built — see `docs/plan-ui-and-auth.md`, Phase 4).
