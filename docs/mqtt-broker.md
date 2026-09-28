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

After the first start, an administrator can change the app's broker on the
web UI's **Connections** page instead. It tests the connection and login
before it saves anything, then restarts the app. The broker's topic ACLs
can't be tested: Mosquitto silently drops a publish the account isn't
allowed. The setting is kept in `config/connections.yaml` and overrides the
`MQTT_*` values in `.env`, with the password stored in the encrypted
`secrets.enc.yaml`. Delete that section and restart to go back to `.env`.

## The display's broker

The desk display (ESP32) asks this app which broker to use and how to sign
in, with `GET /device/config`. It asks at boot, every 15 minutes, and after
repeated failed connects, and it keeps the answer in flash. So moving it to
another broker is a change on the **Connections** page (Desk display →
Change), which tests the `esp32-client` login before saving. It needs no
reflash and no app restart.

Set up once:

1. On the Connections page, set the display's broker and account. Until
   one is saved there, the display is handed this app's broker with
   `MQTT_CLIENT_USERNAME`/`MQTT_CLIENT_PASSWORD` from `.env`.
2. Under **Device token**, make a token, then put the two lines it shows
   (`SERVER_URL`, `DEVICE_TOKEN`) in the firmware's `include/secrets.h`
   and flash it once. From the shell instead:
   `docker compose exec app python -m app.connections new-device-token`.

The request is plain HTTP on the LAN, with the token in an `Authorization`
header, so it stays out of access logs. That's the same exposure as MQTT
itself, which sends this password in the clear. Only the token's hash is
stored. Making a new token cuts off the old one at once.

The firmware only keeps a fetched change once it has connected with it.
A change that can't connect is rolled back after 5 tries, so a mistake on
the server can't strand the display. Firmware without `SERVER_URL`/
`DEVICE_TOKEN` keeps using its compiled-in `MQTT_*` values, as before.

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

and move the display over on the Connections page (Desk display → Change).
Firmware that predates `SERVER_URL`/`DEVICE_TOKEN` needs a reflash with the
new broker address instead; until then it stays on the old broker, showing
the last status it received there.
