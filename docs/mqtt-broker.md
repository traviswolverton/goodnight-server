# MQTT broker

The app publishes the display's status and the device's settings to an MQTT
broker, and reads the device's sensors, button presses and Action requests
there (`app/mqtt.py`, `app/device.py`); the ESP32 connects to the same
broker. By default that's your **central broker** — shared with Home
Assistant, which is how the device's sensors and button triggers reach HA
(MQTT discovery) with no bridge. The bundled Mosquitto container is opt-in,
for a host without one.

## Central broker (default)

Two accounts, each limited to exactly the topics it needs:

| Account | Who | Reads | Writes |
|---|---|---|---|
| `bedside-aggregator` | this service | `bedside/sensors`, `bedside/button`, `bedside/availability` | `bedside/status`, `bedside/alert/camera`, `bedside/config`, `bedside/sound`, and this device's discovery topics under `homeassistant/` |
| `bedside-esp32` | the nightstand device | `bedside/status`, `bedside/config`, `bedside/sound` | `bedside/sensors`, `bedside/button`, `bedside/availability` |

On a shared broker these limits matter more, not less. Nothing else on it
(Home Assistant, other devices, the desk dashboard) can write what the
bedside display shows. The device's login — stored on a device on your
nightstand — can touch nothing but its own topics. And this service can
only write discovery messages for its own device, never another HA
entity's.

For a Mosquitto central broker, create the accounts (use URL-safe
passwords, e.g. `openssl rand -hex 24`):

```sh
mosquitto_passwd -b /path/to/passwd bedside-aggregator '<password>'
mosquitto_passwd -b /path/to/passwd bedside-esp32 '<password>'
```

and add to the broker's ACL file (the same rules as the bundled broker's
`mosquitto/config/acl.conf`):

```
user bedside-aggregator
topic write bedside/status
topic write bedside/alert/camera
topic write bedside/config
topic write bedside/sound
topic read bedside/sensors
topic read bedside/button
topic read bedside/availability
topic write homeassistant/sensor/bedside_dashboard/#
topic write homeassistant/device_automation/bedside_dashboard/#

user bedside-esp32
topic read bedside/status
topic read bedside/config
topic read bedside/sound
topic write bedside/sensors
topic write bedside/button
topic write bedside/availability
```

Then reload the broker (`kill -HUP` its process, or restart it). Home
Assistant's own account needs read access to `bedside/sensors`,
`bedside/button`, `bedside/availability` and `homeassistant/#` — normally
it already has everything. If `HA_DISCOVERY_PREFIX` isn't `homeassistant`,
change the two discovery lines to match.

The account names differ from the desk dashboard's (`aggregator`,
`esp32-client`) on purpose: account names are global on a shared broker.

In `.env`:

```
MQTT_HOST=192.0.2.25
MQTT_PORT=1883
MQTT_USERNAME=bedside-aggregator
MQTT_PASSWORD=<password>
```

After the first start, an administrator can change the app's broker on the
web UI's **Connections** page instead. It tests the connection and login
before it saves anything, then restarts the app. The broker's topic ACLs
can't be tested: Mosquitto silently drops a publish the account isn't
allowed. The setting is kept in `config/connections.yaml` and overrides the
`MQTT_*` values in `.env`, with the password stored in the encrypted
`secrets.enc.yaml`. Delete that section and restart to go back to `.env`.

## The device's broker

The bedside device (ESP32) asks this app which broker to use and how to
sign in, with `GET /device/config`. It asks at boot, every 15 minutes, and
after repeated failed connects, and it keeps the answer in flash. So moving
it to another broker is a change on the **Connections** page (Bedside
device → Change), which tests the `bedside-esp32` login before saving. It
needs no reflash and no app restart.

Set up once:

1. On the Connections page, set the device's broker and account. Until
   one is saved there, the device is handed this app's broker with
   `MQTT_CLIENT_USERNAME`/`MQTT_CLIENT_PASSWORD` from `.env`.
2. Under **Device token**, make a token, then put the two lines it shows
   (`SERVER_URL`, `DEVICE_TOKEN`) in bedside-dashboard-esp32's
   `include/secrets.h` and flash it once. From the shell instead:
   `docker compose exec app python -m app.connections new-device-token`.

The request is plain HTTP on the LAN, with the token in an `Authorization`
header, so it stays out of access logs. That's the same exposure as MQTT
itself, which sends this password in the clear. Only the token's hash is
stored. Making a new token cuts off the old one at once.

The firmware only keeps a fetched change once it has connected with it.
A change that can't connect is rolled back after 5 tries, so a mistake on
the server can't strand the device. Firmware without `SERVER_URL`/
`DEVICE_TOKEN` keeps using its compiled-in `MQTT_*` values, as before.

## Bundled broker

For a host without a central broker, in `.env`:

```
COMPOSE_PROFILES=local-mqtt
MQTT_HOST=mosquitto
MQTT_CLIENT_USERNAME=bedside-esp32
MQTT_CLIENT_PASSWORD=<password>
```

The container provisions both accounts from `.env` on every start
(`mosquitto/entrypoint.sh`) and applies `mosquitto/config/acl.conf`,
listening on host port 1884 (`MQTT_PUBLISH_PORT`). Home Assistant won't see
the device's discovery messages there unless it reads this broker too.
