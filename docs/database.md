# Database

The app keeps users, sessions and the audit log in Postgres (see
`app/db.py`). Everything else — adapters, cards, pixels, secrets — stays in
`/opt/desk-dashboard-data/config`. The app works without the database
(the poll loop and MQTT keep running); only login and the web UI need it.

## Central Postgres (default)

Run once on the central server, as a superuser, with a URL-safe password
(`openssl rand -hex 24`):

```sql
CREATE ROLE desk_dashboard LOGIN PASSWORD '...'
    NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE desk_dashboard OWNER desk_dashboard;
REVOKE ALL ON DATABASE desk_dashboard FROM PUBLIC;
```

This is the same thing `postgres/initdb.sh` does for the bundled container:
the app gets its own non-superuser role that owns exactly one database.
Allow the role in the server's `pg_hba.conf` from the Docker host, then set
in `.env`:

```
DATABASE_URL=postgresql+asyncpg://desk_dashboard:<password>@<host>:5432/desk_dashboard
```

On startup the app applies its Alembic migrations, so the tables are
created on first connect (tested against Postgres 18).

## Bundled container

For a host without a central server, set `COMPOSE_PROFILES=local-db`,
`POSTGRES_PASSWORD` and `DB_PASSWORD`, and point `DATABASE_URL` at
`@postgres:5432` — the commented block in `.env.example` has all four.

## Moving from the bundled container to a central server

After creating the role and database above:

```bash
docker compose exec -T postgres pg_dump -U postgres --no-owner --no-acl desk_dashboard \
  | psql "postgresql://desk_dashboard:<password>@<host>:5432/desk_dashboard"
```

Then set `DATABASE_URL`, remove `COMPOSE_PROFILES=local-db` (and the two
password variables) from `.env`, and `docker compose up -d --remove-orphans`.
The old `postgres_data` volume stays until you `docker volume rm` it.
