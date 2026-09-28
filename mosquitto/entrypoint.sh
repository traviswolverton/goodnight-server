#!/bin/sh
# Regenerates the password file from env vars on every container start, so
# no password (hashed or not) ever needs to be committed to git — same
# "gospel configs in git, secrets in env store" convention as
# config/adapters.yaml. See DESIGN.md.
set -eu

CONF_DIR=/mosquitto/config
PASSWD_FILE="$CONF_DIR/passwd"

: "${MQTT_USERNAME:?MQTT_USERNAME must be set (aggregator account)}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD must be set (aggregator account)}"
: "${MQTT_CLIENT_USERNAME:?MQTT_CLIENT_USERNAME must be set (ESP32 account)}"
: "${MQTT_CLIENT_PASSWORD:?MQTT_CLIENT_PASSWORD must be set (ESP32 account)}"

# -c truncates/creates, but errors instead if the file already exists from
# a previous start (bind-mounted, so it survives container restarts) —
# remove it first so this is idempotent across restarts.
rm -f "$PASSWD_FILE"
mosquitto_passwd -b -c "$PASSWD_FILE" "$MQTT_USERNAME" "$MQTT_PASSWORD"
mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_CLIENT_USERNAME" "$MQTT_CLIENT_PASSWORD"
# This entrypoint runs as root so mosquitto itself can bind and then drop
# privileges to the "mosquitto" user — chown so *that* user can still read
# the file after dropping, or it dies with EACCES right after startup.
chown mosquitto:mosquitto "$PASSWD_FILE"
chmod 0600 "$PASSWD_FILE"

# Defensive: named volumes normally inherit the image's baked-in
# ownership for /mosquitto/data and /mosquitto/log already, but this is a
# no-op if so and cheap insurance if that ever isn't true (e.g. someone
# switches these to host bind mounts later, which do NOT inherit image
# ownership and hit the exact EACCES-after-startup bug the passwd file fix
# above works around).
chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/log

exec mosquitto -c "$CONF_DIR/mosquitto.conf"
