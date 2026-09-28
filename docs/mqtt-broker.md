# MQTT broker

The app publishes the display's status to an MQTT broker and listens there
for the display's Action requests (see `app/mqtt.py`); the ESP32 connects to
the same broker. By default that's your **central broker** — the bundled
Mosquitto container is opt-in, for a host without one.

## Central broker (default)

Two accounts, each limited to exactly the topics it needs:

| Account | Who | Reads | Writes |
|---|---|---|---|
| `aggregator` | this service | `homelab/action` | `homelab/status`, `homelab/alert/camera`, `homelab/action/result` |
| `esp32-client` | the desk display | `homelab/status`, `homelab/alert/camera`, `homelab/action/result` | `homelab/action` |

On a shared broker these limits matter more, not less: other things on it
(Home Assistant, other devices) shouldn't be able to write what the display
shows, and the display's login — stored on a device on your desk —
shouldn't be able to touch anything but its own topics.

For a Mosquitto central broker, create the accounts (use URL-safe
passwords, e.g. `openssl rand -hex 24`):

```sh
mosquitto_passwd -b /path/to/passwd aggregator '<password>'
mosquitto_passwd -b /path/to/passwd esp32-client '<password>'
```

and add to the broker's ACL file:

```
user aggregator
topic write homelab/status
topic write homelab/alert/camera
topic read homelab/action
topic write homelab/action/result

user esp32-client
topic read homelab/status
topic read homelab/alert/camera
topic write homelab/action
topic read homelab/action/result
```

Then reload the broker (`kill -HUP` its process, or restart it). If the
broker is Home Assistant's Mosquitto add-on, create the two users as Home
Assistant users (or in the add-on's `logins`) and put the ACL lines in a
file the add-on reads through its `customize` option.

Account names are global on a shared broker. If `aggregator` is already
taken, pick another name: it's `MQTT_USERNAME` here, and just a new
`user` line in the ACL.

In `.env`:

```
MQTT_HOST=192.0.2.25
MQTT_PORT=1883
MQTT_USERNAME=aggregator
MQTT_PASSWORD=<password>
```

The ESP32 gets the same host and port, and the `esp32-client` login, in its
`include/secrets.h` (desk-dashboard-esp32) — a reflash, since the broker
address is compiled in.

## Bundled broker

For a host without a central broker, in `.env`:

```
COMPOSE_PROFILES=local-mqtt
MQTT_HOST=mosquitto
MQTT_CLIENT_USERNAME=esp32-client
MQTT_CLIENT_PASSWORD=<password>
```

The container provisions both accounts from `.env` on every start
(`mosquitto/entrypoint.sh`) and applies the same ACL
(`mosquitto/config/acl.conf`), listening on host port 1883.

## Moving from the bundled broker to a central one

Nothing on the broker needs to be copied: every retained message is
re-published by the app within one poll interval of connecting. Set up the
accounts above, change `.env`, `docker compose up -d`, then remove the old
broker container — dropping the profile only stops Compose from starting it,
not an already-running one:

```sh
docker compose --profile local-mqtt stop mosquitto
docker compose --profile local-mqtt rm -f mosquitto
```

and reflash the ESP32 with the new broker address. Until the display is reflashed it stays connected to the
old broker and shows the last status it received there.
