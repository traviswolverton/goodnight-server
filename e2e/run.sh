#!/bin/bash
# Browser tests against the REAL Docker image, on a throwaway stack (Postgres 18
# + Mosquitto + the app) that is created and destroyed by this script. Nothing
# here touches your running deployment or its config.
#
#   e2e/run.sh              # everything
#   e2e/run.sh a11y         # one test file (e2e/tests/a11y.mjs)
#   KEEP=1 e2e/run.sh shell # leave the stack running afterwards, for debugging
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
ID="e2e$$"
NET="dd-$ID"
WORK="$(mktemp -d)"
ONLY="${1:-}"

cleanup() {
  if [ -n "${KEEP:-}" ]; then
    echo "KEEP set: stack left running (network $NET, containers $ID-*). Admin password: ${ADMIN_PW:-?}"
    return
  fi
  docker rm -fv "$ID-app" "$ID-pg" "$ID-mqtt" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker rmi "dd-$ID-app" >/dev/null 2>&1 || true   # the per-run app image (the runner image is reused)
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> building the app image (this runs the frontend build and type-check)"
docker build -q -t "dd-$ID-app" "$ROOT" >/dev/null
docker build -q -t dd-e2e-runner "$HERE" >/dev/null

mkdir -p "$WORK/cfg" "$HERE/shots"
cp "$HERE"/seed/*.yaml "$WORK/cfg/"
chmod -R a+rwX "$WORK/cfg" "$HERE/shots"

PG_PW="$(openssl rand -hex 12)"; APP_PW="$(openssl rand -hex 12)"; ADMIN_PW="e2e-$(openssl rand -hex 8)"
SECRETS_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"   # a Fernet key

echo "==> starting Postgres, Mosquitto and the app"
# The seed's Home Assistant token lives in the encrypted secret store, like a real one.
docker run --rm --user "$(id -u):$(id -g)" -v "$WORK/cfg:/app/config" -e SECRETS_MASTER_KEY="$SECRETS_KEY" "dd-$ID-app" \
  python -c "from app.secret_store import set_secret; set_secret('/app/config/secrets.enc.yaml', 'connection_home_assistant_token', 'literal-test-token')"
docker network create "$NET" >/dev/null
docker run -d --name "$ID-mqtt" --network "$NET" --network-alias mqtt eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf >/dev/null
docker run -d --name "$ID-pg" --network "$NET" --network-alias pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$PG_PW" -e APP_DB_PASSWORD="$APP_PW" \
  -v "$ROOT/postgres/initdb.sh:/docker-entrypoint-initdb.d/01-app-role.sh:ro" postgres:18-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$ID-pg" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 3
docker run -d --name "$ID-app" --network "$NET" --network-alias dashapp --user "$(id -u):$(id -g)" \
  -v "$WORK/cfg:/app/config" -e MQTT_HOST=mqtt \
  -e DATABASE_URL="postgresql+asyncpg://bedside_dashboard:$APP_PW@pg:5432/bedside_dashboard" \
  -e ADMIN_USERNAME=smokeadmin -e ADMIN_PASSWORD="$ADMIN_PW" -e SECRETS_MASTER_KEY="$SECRETS_KEY" \
  -e APP_VERSION=e2e "dd-$ID-app" >/dev/null
for _ in $(seq 1 60); do
  docker run --rm --network "$NET" curlimages/curl -fs http://dashapp:8000/healthz >/dev/null 2>&1 && break; sleep 1
done
sleep 3   # the database's migrations and first admin

run() {
  docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
    -e ADMIN_PW="$ADMIN_PW" -e BASE_URL=http://dashapp:8000 -v "$HERE:/work" -w /work dd-e2e-runner "$@"
}
run npm install --no-audit --no-fund --silent >/dev/null

# NB: the app's network alias must not end in a preloaded-HSTS TLD like ".app",
# or Chromium refuses plain HTTP to it.
if [ -n "$ONLY" ]; then FILES=("$HERE/tests/$ONLY.mjs"); else FILES=("$HERE"/tests/*.mjs); fi

STATUS=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "no such test: $f"; exit 2; }
  echo; echo "==> $(basename "$f")"
  run node "tests/$(basename "$f")" || STATUS=1
done
echo; [ $STATUS -eq 0 ] && echo "ALL BROWSER TESTS PASSED" || echo "SOME BROWSER TESTS FAILED"
exit $STATUS
