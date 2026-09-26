# Browser tests

Drive a real Chromium through the real Docker image — the same one you deploy —
against a throwaway Postgres 18 and Mosquitto. They exist to catch what unit
tests can't: layout bugs, broken flows between pages, and accessibility
problems.

```bash
e2e/run.sh              # all tests
e2e/run.sh shell        # one file from e2e/tests/
KEEP=1 e2e/run.sh pages # leave the stack running afterwards, for debugging
```

Requires Docker and network access (image pulls, `npm install` in the runner).
`run.sh` builds the app image (which type-checks and builds the frontend), starts
everything on a private network, runs each file in `tests/`, and removes it all
again. Screenshots land in `e2e/shots/` (git-ignored).

| File | Covers |
|---|---|
| `tests/shell.mjs` | Sign-in and redirects, navigation, theme, mobile drawer, sign-out (session really ends), security headers, open-redirect refusal |
| `tests/pages.mjs` | Every page as admin and as a viewer: cards, pixels, actions, adapters, users + activity log, MQTT reference, password change, old bookmarks, phone-width layout; secrets never reach the browser |
| `tests/a11y.mjs` | axe-core WCAG 2.1 A/AA audit of every page and dialog, light and dark |

The seed config in `seed/` is copied fresh for every run (one adapter pointing
at a host that doesn't exist, three cards, no pixels) — the tests mutate it, so
never point these at real config. The suite creates its own admin from
throwaway credentials.

## Writing a test

`lib.mjs` gives you `start()` → `{ page, check, step, goto, login, click, api, ... }`.
Wrap sections in `t.step(name, fn)` so one failure doesn't hide the rest, record
outcomes with `check(name, ok)`, and end with `await t.finish()`. Look at the
screenshots too — assertions can't see an overlapping layout (two real layout
bugs were caught that way).

Gotchas learned the hard way: Chromium force-upgrades hosts ending in `.app` to
HTTPS (so the app's network alias is `dashapp`); `user.type` in Testing Library
treats `{` as key syntax (paste template text instead).
