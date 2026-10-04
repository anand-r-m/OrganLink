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

## OL-014

### SSR smoke check failed with ERR_AMBIGUOUS_MODULE_SYNTAX (first attempt)
- **Symptom:** the throwaway SSR script crashed; the first run's output was cut off by `tail`, so the cause was unclear, and I had already deleted the script.
- **Root cause:** I again built elements in the `.mjs` (the OL-012 lesson) and then, on the retry, added `/react/` to `ssr.noExternal`, which inlined CJS React.
- **Fix:** one `.jsx` entry that does the whole render through `ssrLoadModule`, with `noExternal: [/mantine/, /tabler/]` only.
- **Prevent/detect:** keep the working SSR recipe in the README (OL-033); do not delete the smoke files until the run has succeeded.

### Notes (no failures)
- Server (72) and client (38) tests, lint (no new warnings) and build passed on the first run.
- Environment: no Postgres was running. I started a throwaway PG 18 on port 5433 (`-k /tmp/ol14sock`, `LC_ALL=en_US.UTF-8`) and ran `db:reset --yes` against it.
- The live-server curl check ran against the seeded DB, so match runs accumulated in it. Tests only assert relative counts (before/after) for that reason.
- Design note: all-zero effective weights are rejected in the route before calling `match_candidates`. The effective weights include regional defaults, so `{hla:0}` alone is valid if the region has other non-zero weights.

## OL-015

### Test expected 400 REFERENCE_NOT_FOUND for a nonexistent recipient
- **Symptom:** `POST /api/offers` with `recipientId: 999999` returned 422, not 400.
- **Root cause:** the `BEFORE INSERT` recipient-status trigger ("Recipient % is not active") fires before the FK is checked, so the DB raises P0001 first. The contract already lists that 422 message.
- **Fix:** the test now expects 422 `RULE_VIOLATION` for a bad recipient, and keeps 400 `REFERENCE_NOT_FOUND` for a bad organ (the route's own lock finds no row).
- **Prevent/detect:** BEFORE triggers run ahead of FK checks. Expect `RULE_VIOLATION` for missing referenced rows on tables that have such triggers.

### Mock organ list started reporting open offers, which broke an exact-equality client test
- **Symptom:** `tests/client/organs.test.js` "mock mode uses mockOrgans" failed on `deepEqual(rows[0], adaptMockOrgan(...))`.
- **Root cause:** mock `listOrgans` now overlays `hasActiveOffer` from the shared mock offer store, and the seeded mock offers include an open one for organ 0.
- **Fix:** the assertion neutralises `hasActiveOffer` and says why. No product change.
- **Prevent/detect:** when a mock adapter gains a derived field, grep the tests for `deepEqual` against that adapter.

### Shell/tooling slips in validation (no product impact)
- **Symptom:** `sed -i "s/..."` failed with "unterminated substitute pattern", and a `curl $J ...` option string was treated as one argument.
- **Root cause:** BSD `sed -i` needs a backup-suffix argument, and zsh does not word-split unquoted variables.
- **Fix:** Python for file edits; a bash script file (`bash flow.sh`) for the curl flow.
- **Prevent/detect:** put multi-step curl flows in a script run with `bash`; avoid `sed -i` on macOS.

### Notes (no failures)
- Server (78), client (47) tests and the build passed after the fixes above. Lint shows no new warnings; I removed an unused import and un-exported two page constants to avoid fast-refresh warnings.
- Environment: no Postgres was running. I started a throwaway PG 18 on port 5433 (`-k /tmp/ol15sock`, `LC_ALL=en_US.UTF-8`) and ran `db:reset --yes` against it.
- The console effect that loads weights and the latest run was keyed on the selected organ object. Refreshing organs after creating an offer would have reset the sliders, so it is now keyed on `selectedKey`.

## OL-016

### Throwaway Postgres failed to start on the first attempt
- **Symptom:** `pg_ctl start` printed "Examine the log output" and `db:reset` got ECONNREFUSED on 5433.
- **Root cause:** I passed `-k /tmp/ol16sock` but the directory did not exist yet, so Postgres could not create its Unix socket (the OL-004/OL-012 lessons said to use a short socket dir, but not to create it first).
- **Fix:** `mkdir -p /tmp/ol16sock`, then start again. `db:reset --yes` ran fine.
- **Prevent/detect:** create the `-k` socket directory before `pg_ctl start`; the OL-033 README snippet should include `mkdir -p`.

### Notes (no other failures)
- The new server tests passed on the first run. They clone an AVAILABLE organ per scenario (INSERT ... SELECT) so accepting or expiring never leaves a seeded organ ALLOCATED or EXPIRED; EXPIRED organs cannot be reverted (only DISCARDED), so reusing a seeded organ for the expiry test would have damaged the demo data. Cleanup deletes the clones' transport, offers, runs and organs.
- Skipping a prior decliner in Advance needs a test-only direct INSERT of a DECLINED offer, because the API cannot create a second DECLINED offer for a rank without walking through Advance.
- New lint warning (`setRecipients` unused after the mock accept stopped marking recipients Transplanted) fixed in the same task.

## OL-017

### No Postgres running and no `.env` at the start
- **Symptom:** `pg_isready` reported "no response" on localhost:5432 and there was no `.env` (only `.env.example`), so `DATABASE_URL` was unset. There was no `organlink` database either.
- **Root cause:** the Homebrew `postgresql@18` service was stopped, and `.env` is gitignored so it is not in a fresh checkout.
- **Fix:** `brew services start postgresql@18`, `cp .env.example .env` (the example holds only local, non-secret values), then `npm run db:reset -- --yes`. The reset created the `organlink` DB on the local server; nothing else was touched.
- **Prevent/detect:** run `pg_isready` and `ls .env` before anything else. The OL-033 README should list "start Postgres, copy `.env.example` to `.env`, `npm run db:reset`".

### Notes (no other failures)
- The transport tests passed on the first run. Same-hospital accepts create a DELIVERED transport immediately, so the tests pick a candidate whose hospital differs from the organ's recovering hospital; otherwise there is no PENDING row to test.
- Transport `FAILED` and `ALLOCATED` organ expiry are not exercised: OL-DEC-02 (A) records them as a known limitation.

## OL-018

### Notes (no failures)
- Postgres and `.env` were already in place; server (97) and client (66) tests passed on the first run. No debugging cycles.
- A transplant cascade changes seeded data permanently: the recipient's waitlist entry becomes TRANSPLANTED and cannot be undone through the API. The server tests therefore record each touched entry first and restore it in `test.after` (and delete any extra entry they insert), along with the cloned organs, offers, transports and transplants. Cleanup must delete `transplant_event` before `organ_offer` (RESTRICT FK).
- My first draft of the "offer not accepted" test was convoluted and could silently return early. I rewrote it to build its own CREATED offer on a cloned organ. **Prevent:** a test that can `return` before asserting should be rewritten to create its own fixture.

## OL-019

### Notes (no failures)
- Postgres and `.env` were already in place; the script passed on the first run (about 1 s after reset, against a 30 s budget). No debugging cycles.
- The match order is data-dependent: a same-hospital accept makes the transport DELIVERED immediately, so `depart` would 409. The script therefore tries donor/organ-type pairs until the top two candidates are at hospitals other than the recovering one. **Prevent:** do not hard-code ids in a smoke script; select fixtures from the API and assert the preconditions.
- The script is re-runnable without a reset (each run procures a new organ), but the ticket requires `db:reset` first, and it consumes seeded waitlist entries, so reset before demos.
