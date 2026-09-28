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
created on first connect (tested against Postgres 17 and 18).

## Changing it from the web UI

After the first start, an administrator can switch databases on the
**Connections** page instead of editing `.env`. **Test** checks the new
database before anything is saved:

- it connects, and the role can create tables there (the migrations need to)
- it's either empty or this app's own. A database with migrations the app
  doesn't know about, or a `users` table the app didn't create, is refused.
- afterwards, someone can still sign in:
  - **It already has users.** It needs at least one active administrator.
    You'll be signed out and must sign back in with an account from that
    database.
  - **It's empty.** Saving copies the users, sessions and audit log over
    from the current database, so everyone stays signed in. If `.env` still
    has `ADMIN_USERNAME`/`ADMIN_PASSWORD`, you can start empty instead.

The save runs the same checks again on the server, then restarts the app.
The connection is saved in `config/connections.yaml`, and the password goes
in the encrypted `secrets.enc.yaml`, so saving needs `SECRETS_MASTER_KEY`.
From then on it overrides `DATABASE_URL`.

**Recovery:** if a database saved there stops answering, nobody can sign in
to change it back. To fall back to `DATABASE_URL`, delete the `database:`
section from `/opt/desk-dashboard-data/config/connections.yaml`, then
`docker compose restart app`.

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
