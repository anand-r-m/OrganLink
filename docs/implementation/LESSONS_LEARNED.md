# Lessons Learned

## OL-003

### Throwaway Postgres refused to start
- **Symptom:** `pg_ctl start` failed; `db:reset` got "connection refused" on 5433.
- **Root cause:** the log said `postmaster became multithreaded during startup` / `Set the LC_ALL environment variable to a valid locale`. The agent shell had no valid locale.
- **Fix:** export `LC_ALL=en_US.UTF-8` before `initdb`/`pg_ctl start`.
- **Prevent/detect:** when `pg_ctl` reports a failed start, read `<datadir>/log` first. Set `LC_ALL` in any scripted Postgres launch.

### No Postgres on the configured port
- **Symptom:** `.env` points at `localhost:5432`, but nothing was listening.
- **Root cause:** the earlier throwaway cluster (OL-002, port 5433) was gone; no persistent server is configured on this machine.
- **Fix:** new throwaway cluster in the session scratchpad on 5433, passed through the `DATABASE_URL` env var only (`.env` untouched), loaded with `npm run db:reset -- --yes`.
- **Prevent/detect:** document a "start local test DB" snippet in the README (OL-033).

## OL-004

### Throwaway Postgres failed again: socket path too long
- **Symptom:** `pg_ctl start` failed with "could not create any Unix-domain sockets" even with `LC_ALL` set.
- **Root cause:** the session scratchpad path exceeds macOS's 103-byte Unix socket path limit when passed as `-k`.
- **Fix:** put the socket dir at a short path (`-k /tmp/ol4sock`); keep the data directory in the scratchpad.
- **Prevent/detect:** read `<datadir>/log` on failed start. Always use a short `-k` dir. Add this to the README "start local test DB" snippet (OL-033).

### Dependencies used at runtime were missing or misfiled
- **Symptom:** `express-session` was not installed; `bcryptjs` sat in `devDependencies`.
- **Root cause:** OL-001 only used bcryptjs for the seed hash.
- **Fix:** installed `express-session`, moved `bcryptjs` to `dependencies`.
- **Prevent/detect:** when a task adds a runtime import, check `package.json` and `node_modules` before writing code.

### Auth guard hides 404s
- **Symptom (design note):** a global `app.use('/api', requireAuth)` makes unknown `/api/*` paths return 401 without a session, not 404.
- **Fix:** accepted; matches the contract ("every endpoint except login and health needs a session"). Tests use an unmatched path to exercise the guard.
- **Prevent/detect:** later route tasks must mount routers after the guard in `server/index.js`.

## OL-005

### No Postgres running at task start
- **Symptom:** `pg_isready` reported `/tmp:5432 - no response`; no `.env` exists.
- **Root cause:** the throwaway cluster from OL-004 had been stopped; no persistent server is configured.
- **Fix:** new throwaway cluster in the session scratchpad on :5433 with `LC_ALL=en_US.UTF-8` and a short socket dir (`-k /tmp/ol4sock`), `DATABASE_URL` passed via the environment only. Applied the two earlier lessons up front, so it started first time.
- **Prevent/detect:** the "start local test DB" README snippet planned for OL-033 would remove this repeated setup.

### Reference-only seed has no hospitals
- **Symptom (design note):** `GET /api/hospitals` returns `[]` after `db:reset` because the demo seed is OL-006.
- **Fix:** the server test inserts its own hospital and deletes it afterwards; the end-to-end check inserts one via psql.
- **Prevent/detect:** tests for read endpoints should create the rows they assert on, not depend on a later seed task.

### Live mode silently changed a neighbouring tab
- **Symptom (caught in review, not by a test):** the Regions tab counts hospitals by mock region names ("North"); sharing the live hospital state would have made every count 0.
- **Fix:** the Regions tab keeps `mockHospitals` in live mode until OL-024.
- **Prevent/detect:** when lifting a mock state to live data, grep for other consumers of that state.

## OL-006

### No Postgres running at task start (again)
- **Symptom:** `pg_isready` showed nothing on 5432 or 5433.
- **Root cause:** the previous throwaway cluster was stopped; no persistent server is configured.
- **Fix:** new throwaway cluster in the session scratchpad on :5433 with `LC_ALL=en_US.UTF-8` and `-k /tmp/ol6sock`; `DATABASE_URL` passed via the environment only (`.env` untouched). Started first time.
- **Prevent/detect:** the "start local test DB" README snippet (OL-033) would remove this repeated setup.

### `WITH ORDINALITY` does not work on a VALUES list
- **Symptom:** `db:reset` failed in `03_seed_demo.sql` with `syntax error at or near "WITH"`. Without ordering, hospital IDs (and organ IDs) came out in join order, not list order (Heart was organ 3, AIIMS was not hospital 1).
- **Root cause:** `WITH ORDINALITY` is only valid after a function call in FROM. I then fixed it with a regex rewrite whose non-greedy match spanned several statements and wrapped the wrong `VALUES` blocks, which gave a second syntax error.
- **Fix:** `FROM (SELECT x.*, row_number() OVER () AS n FROM (VALUES …) AS x(cols)) AS v … ORDER BY v.n`, applied to the four inserts that need stable IDs; repaired the mis-wrapped blocks by hand.
- **Prevent/detect:** run `db:reset` after every edit to the seed. Edit SQL blocks one at a time rather than with a multi-statement regex. Note that BSD `sed -i` needs `-i ''` on macOS.

### Seed-dependent assumptions in later tasks
- **Symptom (design note):** IDs are now deterministic after reset (Heart = organ 1, Liver = 2, Kidney = 3; AIIMS = hospital 1), but only because of `row_number()` ordering in the seed.
- **Prevent/detect:** tests for later tasks should look rows up by name or type, not hard-code IDs.

## OL-010

No failures or debugging cycles.

### Design note: keep badge logic out of the .jsx file
- **Note:** `node --test` cannot import `.jsx`, so the status→colour map and label formatter live in `src/utils/status.js` (pure, unit-tested). `StatusBadge.jsx` re-exports them.
- **Prevent/detect:** put testable logic in plain `.js` modules; the client test runner has no JSX transform. For a render check, use Vite's `ssrLoadModule` with `renderToStaticMarkup`.

## OL-011

### No Postgres running at task start (third time)
- **Symptom:** `pg_isready` showed nothing on 5432 or 5433.
- **Root cause:** the earlier throwaway clusters were stopped; no persistent server.
- **Fix:** new throwaway cluster in the session scratchpad on :5433 (`-k /tmp/ol11sock`), `DATABASE_URL` via the environment only, then `db:reset --yes`.
- **Prevent/detect:** the README "start local test DB" snippet (OL-033) would remove this repeated setup.

### Guessed a column name instead of reading the schema
- **Symptom:** every donor query returned 500; the server log said `column bg.name does not exist`.
- **Root cause:** `blood_group` has `group_name`, not `name`. I wrote the SQL from memory.
- **Fix:** `bg.group_name`.
- **Prevent/detect:** grep `CREATE TABLE <t>` in `db/01_schema.sql` before writing a join. The 500 surfaced on the first test run; tests that hit the real DB catch this immediately.

### Shell chain skipped an `export`
- **Symptom:** the next test run failed with `ECONNREFUSED` after a BSD `sed -i` (no `''`) error.
- **Root cause:** `sed … && … ; export DATABASE_URL=…` — the failed `sed` short-circuited the `&&` chain, and the `export` was part of it, so `DATABASE_URL` was unset.
- **Fix:** rerun with `sed -i ''` and the export in its own statement.
- **Prevent/detect:** use `sed -i ''` on macOS and keep `export` on its own line, not inside an `&&` chain.

### SSR smoke check: "MantineProvider was not found"
- **Symptom:** rendering the page through Vite `ssrLoadModule` failed even though it was wrapped in `MantineProvider`.
- **Root cause:** Vite externalised `@mantine/*`, so the page and the test script loaded two copies of Mantine with separate contexts.
- **Fix:** `ssr: { noExternal: [/mantine/, /tabler/] }` in the throwaway script.
- **Prevent/detect:** use `noExternal` for context-based UI libraries in SSR smoke checks.

### Design note: register/edit/deactivate disabled in live mode
- **Note:** the donor create/edit/deactivate handlers only change local state (OL-020 makes them live). In live mode the buttons are disabled so the UI cannot show a save that never reached the database.

## OL-012

### Throwaway Postgres failed to start twice
- **Symptom:** `pg_ctl start` reported "could not start server"; `db:reset` then got ECONNREFUSED.
- **Root cause:** (1) the scratchpad socket directory path exceeds the 103-byte Unix-socket limit; (2) with no `LC_ALL` set, Postgres 18 aborted with "postmaster became multithreaded during startup".
- **Fix:** socket dir `-k /tmp/ol12sock`, and `LC_ALL=en_US.UTF-8` exported before `pg_ctl`.
- **Prevent/detect:** read `pg.log` right after a failed start. The README "start local test DB" snippet (OL-033) should include both settings.

### New test file broke existing exact-count tests
- **Symptom:** `donors-read` tests failed intermittently (`10 !== 11` donors; donor 1 organ count changed) once `donors-procure.test.js` existed.
- **Root cause:** `node --test` runs files in parallel against one DB; my file inserted a donor/organs that other files count exactly.
- **Fix:** `test:server` now runs with `--test-concurrency=1`. My tests also use their own donor and count rows per donor, not globally.
- **Prevent/detect:** server tests share one DB, so never assert global counts in parallel-run files; keep concurrency at 1 for DB suites.

### SSR smoke script: two module graphs again
- **Symptom:** "MantineProvider was not found" / `ERR_AMBIGUOUS_MODULE_SYNTAX` from a throwaway `.mjs` that imported react and mantine natively.
- **Root cause:** same as OL-011: the page loaded through Vite and the script's own imports used different module copies; sed-patching the script made it worse.
- **Fix:** put the render in a temporary `.jsx` loaded via `ssrLoadModule`, so every import goes through Vite; delete both files afterwards.
- **Prevent/detect:** keep one tiny `.jsx` entry for SSR smoke checks instead of building elements in the `.mjs`.

## OL-013

### No test or validation failures
- Server (63), client (31) tests and the build passed on the first run.
- Environment note: no Postgres was running. I started a throwaway PG 18 on port 5433 (`-k /tmp/ol13sock`, `LC_ALL=en_US.UTF-8` exported first), per the OL-012 lessons, and ran `db:reset --yes` against it. This worked first time.
- Design note: the organ SQL moved from `donors.js` to `server/util/organSql.js` so `organs.js` and the donor drawer share one definition (OL-014 and OL-023 will add to `organs.js`).
- Limit of the UI check: SSR does not run effects, so it proves the page and nav render but not table rows. Row rendering is covered by the adapter tests only; a browser check of `/organs` with the dev servers is still worth doing.
