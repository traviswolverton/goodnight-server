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
| `bedside-aggregator` | this service | `bedside/action`, `bedside/sensors`, `bedside/button`, `bedside/availability` | `bedside/status`, `bedside/alert/camera`, `bedside/action/result`, `bedside/config`, and this device's discovery topics under `homeassistant/` |
| `bedside-esp32` | the nightstand device | `bedside/status`, `bedside/config`, `bedside/action/result` | `bedside/sensors`, `bedside/button`, `bedside/availability`, `bedside/action` |

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
topic read bedside/action
topic write bedside/action/result
topic write bedside/config
topic read bedside/sensors
topic read bedside/button
topic read bedside/availability
topic write homeassistant/sensor/bedside_dashboard/#
topic write homeassistant/device_automation/bedside_dashboard/#

user bedside-esp32
topic read bedside/status
topic read bedside/config
topic write bedside/sensors
topic write bedside/button
topic write bedside/availability
topic write bedside/action
topic read bedside/action/result
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

The device gets the same host and port and the `bedside-esp32` login in
bedside-dashboard-esp32's `include/secrets.h`.

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
