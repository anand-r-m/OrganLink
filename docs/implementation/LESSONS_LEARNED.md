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
