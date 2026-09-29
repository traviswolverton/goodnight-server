# Desk Dashboard web UI

React + TypeScript single-page app. Vite builds it into `frontend/dist`, which
the FastAPI service serves (`app/spa.py`); there is no separate frontend server
in production. Architecture and plan: `docs/plan-ui-and-auth.md`.

**Stack:** Vite · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) ·
TanStack Router + Query · Sonner · Vitest + Testing Library.

## Develop

Needs Node 22+ (the Docker build uses `node:22-alpine`). With the backend
running on `:8000` (`docker compose up`, or `uvicorn app.main:app`):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, hot reload; /api etc. proxy to the backend
```

Point at a backend elsewhere with `BACKEND_URL=http://host:8000 npm run dev`.
Sign in with any account (see `ADMIN_USERNAME` in `.env.example` for the first
one). Cookies are same-origin through the dev proxy, so the session works.

## Check

```bash
npm run build      # type-check (tsc -b) + production bundle
npm run lint       # oxlint
npx vitest run     # unit/component tests
```

The Docker image runs `npm run build` in a first stage, so a type error fails
`docker compose build`.

## Layout

- `src/lib/api.ts` — fetch wrapper: same-origin cookies, JSON, the session's
  CSRF token on writes, one `ApiError` type, a hook for "session expired".
- `src/lib/auth.ts` — session query, login/logout, `?next=` sanitising.
- `src/lib/queries.ts` / `types.ts` — query definitions and the API's shapes.
- `src/router.tsx` — code-based routes; everything except `/login` sits under
  an auth guard, admin-only pages under a role guard; old bookmarks redirect.
- `src/routes/` — one file per page (home, cards, adapters, users,
  profile, mqtt, login).
- `src/components/` — shared pieces (app shell, device preview, variables
  table, AI-assist box, adapter form, confirm dialog, query states).
- `src/components/ui/` — shadcn components (generated; add more with
  `npx shadcn@latest add <name>`).

Server-side auth is the real boundary: hiding a nav item or a Save button for
a viewer is UX only — every `/api` route enforces roles itself.
