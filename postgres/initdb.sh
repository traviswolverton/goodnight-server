#!/bin/sh
# Runs once, on first initialisation of an empty data volume (the postgres
# image's /docker-entrypoint-initdb.d hook), as the bootstrap superuser.
# Creates the application's own NON-superuser role and database, so the app
# (and anyone who compromises it) can never do more than own its one
# database. Changing DB_PASSWORD in .env later does NOT re-run this — use
# `ALTER ROLE desk_dashboard PASSWORD '...'` on the running instance.
set -eu

psql -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE ROLE desk_dashboard LOGIN PASSWORD :'app_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE desk_dashboard OWNER desk_dashboard;
REVOKE ALL ON DATABASE desk_dashboard FROM PUBLIC;
SQL
