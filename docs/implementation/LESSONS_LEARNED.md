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

## Phase 3 run: environment

### New machine with no toolchain
- **Symptom:** the Phase 3 run started on a Linux checkout with no Node, no Postgres, no `node_modules`, no `.env` and no sudo.
- **Root cause:** earlier tasks ran on macOS with Homebrew Postgres. Nothing about the toolchain is in the repo.
- **Fix:** user-local toolchain in the session scratchpad: the Node 24 LTS tarball, the Arch `postgresql`/`postgresql-libs` 18.6 packages extracted without installing (SHA-256 checked against the local pacman sync DB), and a static jq. Then a throwaway cluster that listens on TCP 5433 only (`unix_socket_directories = ''`, which avoids the socket-path-length problem), `.env` pointing at it, and `npm ci`. See `PHASE3_PROGRESS.md`.
- **Prevent/detect:** the OL-033 README should list Node 20+, Postgres 14+, `jq` and `curl` as prerequisites, with a "start local test DB" snippet.

## OL-020

### Lint baseline mis-recorded by the orchestrator
- **Symptom:** the implementer reported 9 lint warnings against a recorded baseline of 2.
- **Root cause:** the baseline was read with `npx oxlint | tail -2`, which shows only the last two warnings, not a count.
- **Fix:** re-counted. The baseline is 9, all in files OL-020 did not touch.
- **Prevent/detect:** record lint baselines as a list of `file:line` locations (or oxlint's summary count), never a truncated tail.

### Notes (no code failures)
- `donor_hla` has no audit trigger, so an HLA-only PATCH would leave no audit row. The PATCH always issues an UPDATE (`name = name` when there are no scalar fields), so the donor's AFTER UPDATE audit trigger records the edit. The row marks that an edit happened; it does not detail which alleles changed.
- The death-field rule is not pre-validated in the client or the API. The DB CHECK fires and its message is mapped onto the form field, which keeps a single source of truth (05 §3).

## OL-021

### Implementer interrupted by an API usage limit
- **Symptom:** the implementer stopped after writing the server route and part of its tests.
- **Root cause:** the account usage limit, not the code.
- **Fix:** resumed the same agent (context intact) after the reset. It re-read its files and finished.
- **Prevent/detect:** after any interrupted agent, diff from the task's base snapshot before resuming, so the state on disk is known.

### Reviewer catch: mock-mode filtering discarded session rows
- **Symptom (review):** after lifting the page to the API module, every filter change in mock mode re-read `mockRecipients`, so recipients added or edited in the session vanished.
- **Root cause:** live mode re-queries the server on each filter change (correct), and the same effect ran unchanged in mock mode. The old page filtered page state in memory.
- **Fix:** mock rows load once into state, and a pure `filterRecipients` filters them in memory. A client test covers it.
- **Prevent/detect:** when a page gains live server-side filtering, keep mock filtering client-side over session state, and test "add locally, filter, clear, row still there".

### Reviewer catch: unvalidated enum filter
- **Symptom (review):** `?urgency=9` returned `[]` while bad `status`/`organ` returned 400.
- **Fix:** validate every enum-valued query filter against its allowed codes.

## OL-022

### Notes (no failures)
- First implementation cycle passed review and check.
- Reviewer catch: the old mock priority tooltip showed a fabricated "Policy Bonus / Urgency Weight" split, which contradicts 08 §7 (urgency and waiting time only). It was replaced in both modes by one pure `priorityBreakdown()` helper.
- The view's `priority_score` is a region-weighted mean of the two components, so the total does not equal their sum. The tooltip now says so. **Prevent:** when a UI shows components next to a total, check they reconcile visibly or label the weighting.
- Checker gap: the checker killed its server before verifying the success path (POST 201). The orchestrator closed it with one curl. **Prevent:** checkers should run the happy path before the error paths.

## OL-023

### Notes (no failures)
- First cycle passed review and check.
- Reviewer catch: the mock `discardOrgan` checked the open offer before the status, so a terminal organ with an open offer gave different error codes in mock and live. **Prevent:** mock implementations of a guarded transition should check in the same order as the server route.
- A17 (no discard with an open offer) has no DB rule. It is enforced in the API under the organ's `FOR UPDATE` lock, the same lock the offer-create route takes, so the check cannot race an offer insert.

## OL-024

### Reviewer catch: numeric overflow becomes 500
- **Symptom (review):** `PATCH /api/regions/:id {"weights":{"hla":1000}}` returns 500 `INTERNAL`.
- **Root cause:** `NUMERIC(5,2)` overflow raises SQLSTATE 22003, which `translatePgError` does not map. The contract maps only 22P02 and 23502 to `VALIDATION_ERROR`.
- **Fix:** none in this task. Mapping 22003 changes the shared error table in `API_CONTRACT.md`, so it needs approval. It is recorded as a follow-up in PHASE3-REPORT. The UI cannot trigger it (sliders cap at 100).
- **Prevent/detect:** for every NUMERIC(p,s) or INTEGER input, test one value above the column's precision. Decide once, contract-wide, how 22003 maps.

### Notes
- Settings writes touch shared reference rows (SR weights, Kidney). The server tests snapshot them in `before` and restore them in `after`, and the reviewer confirmed the restore. A leaked SR change would silently shift every later match test.

## OL-025

### `ON DELETE RESTRICT` raises 23001, not 23503
- **Symptom:** deleting an HLA allele used by a donor returned 500 instead of the contract's 409 `REFERENCE_IN_USE`.
- **Root cause:** the contract maps `REFERENCE_IN_USE` from "23503 on DELETE". `donor_hla` and `recipient_hla` use `ON DELETE RESTRICT`, which Postgres reports as SQLSTATE 23001 (restrict_violation). Only `NO ACTION` FKs report 23503.
- **Fix:** `translatePgError` maps 23001 to 409 `REFERENCE_IN_USE`, with a unit case. The contract wording needs a team update (recorded in OL-025-REPORT and PHASE3-REPORT).
- **Prevent/detect:** when mapping SQLSTATEs, check the FK's ON DELETE action. Test every DELETE endpoint against a referenced row.

## OL-026

### Notes (no failures)
- First cycle passed review and check.
- Reviewer catch: a "row counts per view" test asserted `count >= 0`, which can never fail. The orchestrator replaced it with "endpoint length equals the view's count, and the waiting-time view is non-empty on the seed". **Prevent:** every assertion should be able to fail. Compare against an independent query, not a bound that always holds.
- The backlog said every report endpoint sweeps, but the contract index says only utilization and compliance do. The contract index was followed. **Prevent:** when the backlog and contract disagree on mechanics, follow the contract and note it in the report.
- The v1 seed leaves most report views sparse (no declines, null fairness medians). Checkers ran `npm run smoke` once to compare the endpoints with the views on non-empty data too.

## OL-027 / OL-028 (run in parallel)

### Implementer claimed "build passes" after a change that broke it
- **Symptom:** after a reviewer-requested fix, the OL-028 implementer reported "the build succeeds". The concurrent OL-027 implementer then found `npm run build` failing with `Identifier 'Tooltip' has already been declared` at `ReportsPage.jsx:2`. Lint also showed a new warning there.
- **Root cause:** the fix imported Mantine's `Tooltip` into a page that already imports Recharts' `Tooltip`. `node --test` never loads `.jsx`, so the client suite stayed green. The build result in the hand-back was not genuine.
- **Fix:** the orchestrator aliased the import (`Tooltip as MantineTooltip`). Build OK, lint back to 8, client 151/151.
- **Prevent/detect:** never accept a self-reported build result. The independent checker re-runs the build, and the orchestrator re-runs it after any follow-up fix. Pages that import both Mantine and Recharts must alias one of the two `Tooltip` names.

### Parallel implementers on a shared DB
- OL-027 (server + dashboard) and OL-028 (client-only) ran at the same time, with disjoint files. OL-028 was barred from server tests and DB commands. It worked, and the build break above was caught precisely because the other agent ran the build.
- OL-027 checker note: back-dating `sent_at` can violate `ck_offer_time_order`, because `sent_at` may not precede `created_at`. To test "offer close to expiry", rely on a short response window (Heart is 1 h) or back-date `created_at` too.

## OL-030

### Delegation was unavailable; the orchestrator implemented directly
- **Symptom:** `task(subagent_type: 'fixer', ...)` failed twice with `Model not found: openai/gpt-6-luna. Did you mean: gpt-6-luna, gpt-6-luna-pro, gpt-6-luna-fast?`.
- **Handling:** the retry with an identical prompt failed the same way, so the work was implemented in the orchestrator instead of retrying a third time. **Prevent:** treat a repeated `Model not found` as a hard infrastructure failure rather than a prompt problem, and re-plan the lane rather than re-issuing it.

### Seed data cannot satisfy a 10-recipient concurrency proof
- **Symptom:** before writing the harness, the obvious approach — pick a donor/organ-type pair and reuse seeded waitlist entries — looked sufficient but was not.
- **Root cause:** the maximum number of currently-eligible recipients for *any* donor/organ-type pair in the seed is **8** (Kidney has the most ACTIVE waitlist entries). OL-030 demands 10 distinct eligible recipients, so the seed can never satisfy it as-is.
- **Fix:** `scripts/concurrency.mjs` reuses the eligible seeded recipients and tops the set up through `POST /api/recipients`; it creates only the shortfall. The test builds all 10 with direct SQL. **Prevent:** before relying on seed data for a count-based criterion, query the actual maximum. Counts in `03_seed_demo.sql` are not guarantees.

### Matching the donor's blood group and weight makes every fixture eligible
- Two facts make provisioning trivial and should be reused: all 8 blood-group self-pairs are compatible in `blood_compatibility`, and Kidney's ratio band is 0.50–3.00. Creating recipients with the donor's own blood group and weight yields ratio 1.0, always inside the band. Using Kidney (30 h viability, 6 h response window) also stops `expire_stale_offers()` from expiring fixtures mid-run.

### A14 was observed, and the sweep is the reason
- `withTx(..., { sweep: true })` runs `SELECT expire_stale_offers()` on the pool **before** the transaction opens, and that function has no `SKIP LOCKED`. Ten parallel creates took 201 ms wall clock: fastest request 26 ms, median 176 ms, slowest 200 ms. The losers queued behind `FOR UPDATE` on the organ and behind the sweeping `UPDATE`s.
- This is correct behaviour, not a defect: one 201, nine `409 ACTIVE_OFFER_EXISTS`, one transport row, no deadlock, no timeout. The script now prints the min/median/max spread and an explicit observed/not-observed line instead of hiding it. **Prevent:** 05 §4.3 claims the sweep uses `SKIP LOCKED`; it does not. Treat the docs as wrong and record the measurement.

### Windows environment gotchas hit this cycle
- `npm` is not on `PATH`. Node v24.19.0 lives at `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`; `bun` provides the packages. Run `node` directly and use `./node_modules/.bin/` for `oxlint` and `vite build`.
- Git Bash `/tmp/x.json` paths handed to Windows Node resolve to `C:\tmp\x.json` and fail with `ENOENT`. Use `node:os` `tmpdir()` or keep everything in memory.
- `POST /api/donors/:id/organs` rejects a future `recoveredAt` with `ck_organ_not_future`. Always `new Date().toISOString()`.
- `bun install` writes `bun.lock`, but the repo tracks `package-lock.json`. Remove the stray `bun.lock` after installing so the diff stays clean.

### Assertion design
- The two phases share the winning offer id, and `node:test` does not pass one test's return value to the next. They are nested subtests of one parent `test` with a closure variable, which also makes the ordering requirement explicit instead of relying on file order. **Prevent:** when test phases depend on earlier phases' output, share it via closure and assert the dependency.
- Every assertion was checked for falsifiability: exactly 1x201, exactly 9x409 with `error.code === 'ACTIVE_OFFER_EXISTS'`, `count(*) ... IN ('CREATED','SENT','ACCEPTED') = 1`, `transport_record` count = 1, organ `ALLOCATED`. A bare "status is 201 or 409" would have passed even if the invariants were wrong.

## OL-031

### match_candidates() cannot be reused for historical rows
- **Symptom:** the obvious way to give 25 back-dated organs a plausible match history is to call the existing `match_candidates(organ_id)`. It excluded every candidate and put every `run_at` in the current month.
- **Root cause:** the function scores viability as `now() + travel_time > recovered_at + max_viability_hours`. With `recovered_at` 20 months old that is always true, so no candidate can ever qualify; it also stamps `run_at = now()` and derives `wait_score` from today's waiting time.
- **Fix:** the seed replicates the scoring expression (same regional weights, same `weighted_mm` DRB1 double-count, same `haversine_km`, same `100 * exp(-km/500)`) but evaluates it at `mr.run_at`. **Prevent:** any function that scores against `now()` is unusable for retrospective data — replicate the expression in the seed with an explicit clock instead of calling it.

### session_replication_role = replica is a trigger bypass, not a constraint bypass
- **Decision:** retrospective rows cannot be inserted through the workflow triggers, which all assume "this is happening now", and running hundreds of retrospective inserts through them would also write audit rows describing events that never happened.
- **Handling:** the whole historical block runs inside `BEGIN; SET LOCAL session_replication_role = replica; ... COMMIT`. CHECK, NOT NULL and unique indexes still apply — all 25 organs, 30 offers, 19 transplants and 228 match results passed them on the first load — but the audit and workflow triggers do not fire, which a test now asserts directly (`audit_log` has zero rows older than the historical cut-off).
- **Prevent:** keep the block in one transaction so the replica setting cannot leak, and assert the audit-log consequence instead of assuming it.

### History must never rest in a state the sweeps rewrite
- **Symptom:** the first draft used `SENT` for offers that timed out and `IN_TRANSIT` for organs still moving.
- **Root cause:** `GET /api/dashboard` and the reports endpoints call `expire_stale_offers()` on every request, which expires `SENT` offers, cancels abandoned `CREATED` ones, expires old `AVAILABLE` organs and fails their transports. Any such historical row would be silently rewritten minutes after the seed.
- **Fix:** historical rows only ever use terminal states — organs `TRANSPLANTED/EXPIRED/DISCARDED`, offers `ACCEPTED/DECLINED/EXPIRED/VOIDED/CANCELLED`, transports `DELIVERED/FAILED`. A test now snapshots the status multiset, calls the sweep twice, and asserts it is unchanged. **Prevent:** when adding retrospective data to any system that has a reaper, enumerate the states the reaper mutates first and assert on them.

### A recipient's final status retroactively excluded them from their own match run
- **Symptom:** matching evaluated `waitlist_entry.status <> 'ACTIVE'` against the row's *current* value, so every historical taker (now `TRANSPLANTED`, `SUSPENDED` or `INACTIVE`) came out as `RECIPIENT_INACTIVE` — history with zero successful matches.
- **Fix:** the timeline row names its `taker`; for that one candidate per run the status is read as `ACTIVE` (they were active when the run happened) and from the row itself for every other candidate. **Prevent:** when a run is scored against a table whose rows keep mutating, decide explicitly which fields are as-of-run and which are current.

### Historical compatibility has to be constructed, not assumed
- **Symptom:** 25 donors × 36 recipients with hand-picked blood groups is a lot of pairs to get right, and nothing in the schema forbids an ABO-incompatible offer — the workflow trigger is exactly what is disabled in replica mode.
- **Fix:** donor and taker blood groups are paired by `(n % 5)` (`O-`→`A+`, `O+`→`B+`, `A+`→`A+`, `B+`→`AB+`, `AB-`→`AB-`), compatible for every row by construction, and donor/recipient weights are paired to keep the ratio inside each organ type's band. A test recomputes compatibility from `blood_compatibility` and the ratio bounds for every `ACCEPTED` offer, so a later edit cannot quietly break it. **Prevent:** replica mode removes the guard that would have caught this, so the seed must carry its own proof.

### width_bucket makes the waiting-time chart a 5-month grid
- **Symptom:** the backlog asks for at least six populated buckets, but the present-day seed only fills buckets 1–5.
- **Root cause:** `v_waiting_time_distribution` uses `width_bucket(age_months, 0, 60, 12)` — twelve buckets of five months — so bucket 6 means 25–30 months.
- **Fix:** six historical recipients who are still waiting were given 25–30 months on the list; the view now returns eight populated buckets. **Prevent:** read the report view's bucketing arithmetic before designing seed data against it. Twelve buckets over 60 months is not twelve monthly buckets.

### Growing the seed broke every hardcoded count in the suite
- **Symptom:** `npm run test:server` failed twice after the historical block landed — `donors-read.test.js` asserted exactly 10 donors and 6 deceased.
- **Root cause:** those assertions pinned the size of the demo fixture, and OL-031 legitimately made the fixture bigger. OL-006's own report had flagged this as anticipated work.
- **Fix:** the listing test now asserts the API count equals `count(*) FROM donor` (and the same per filter), which tests the real contract — the endpoint returns the table — and survives future seed growth. The OL-006 fixture-shape test keeps its hard numbers but scopes them to the present-day block, which owns the lowest identity values. **Prevent:** in a repo whose seed is expected to grow, assert endpoint-vs-table agreement and scope fixture-shape assertions explicitly instead of counting everything.

### Windows environment gotchas hit this cycle
- `psql` is not on `PATH`; PostgreSQL 18 lives in `/c/Program Files/PostgreSQL/18/bin`. `scripts/db-reset.sh` calls `psql` by name, so prepend that directory.
- Unlike OL-030 there was no bundled Node runtime this time — no `node`, no `npm`, only `bun` 1.4.2 — so `npm run db:reset`, `test:server` and `smoke` could not start at all. A portable Node v24.21.0 win-x64 zip and `jq.exe` (required by `smoke-flow.sh`) were extracted into the pre-approved temp directory and put on `PATH`, leaving the repo untouched.

## OL-032

### A top-level RAISE NOTICE aborts psql under ON_ERROR_STOP
- **Symptom:** the original script died on its first `RAISE NOTICE` line with a nonzero psql exit, before any rule ran.
- **Root cause:** `RAISE` is a PL/pgSQL statement, not SQL. Outside a DO block psql sends it to PostgreSQL as ordinary SQL, gets a syntax error, and `-v ON_ERROR_STOP=1` turns that into a nonzero exit before any rule runs.
- **Fix:** the only statements outside DO blocks are `BEGIN`, `SET LOCAL`, `\set`/`\echo`, `SELECT` and `ROLLBACK`. All notices are raised from inside DO blocks. **Prevent:** psql scripts may only contain SQL and psql meta-commands at the top level — never bare PL/pgSQL statements.

### psql does not substitute `:variables` inside dollar-quoted bodies
- **Symptom:** every DO block that referenced `:something` failed at runtime with an unquoted-identifier or syntax error, and the error text pointed nowhere near the cause.
- **Root cause:** psql's variable interpolation skips quoted regions, and a dollar-quoted body counts as one — the `:name` form reaches PostgreSQL literally and is parsed as a cast/identifier, not as a psql variable.
- **Fix:** no `:vars` inside any `$$ ... $$` body. Ids are resolved with plain SQL subqueries; fixtures shared between blocks are passed through a temp `br_state(k, v)` table. **Prevent:** treat dollar-quoted bodies as un-substitutable; if a value must enter one, select it into a temp table first.

### Emit PASS/FAIL at the end, sorted, from a result table — not inline
- **Symptom:** the first passing run printed its 14 lines in block order, not BR-1..BR-14, and each block printed before its own failure path could be evaluated.
- **Root cause:** notices raised where the work happens are ordered by execution flow, and a block that exits through an exception handler never reaches its success notice.
- **Fix:** each block writes exactly one row into `br_results(rule_no, ok, detail)` — body path or exception path — and a final DO block emits `RAISE NOTICE 'BR-% %: %'` ordered by `rule_no`, followed by a gate that raises unless there are 14 rows with 0 failures. **Prevent:** a script whose acceptance criterion is "14 PASS lines" must generate those lines from persisted per-rule rows, so the count is structural rather than incidental.

### A demo harness that cannot fail tests nothing
- **Symptom:** `db/10_rule_demo.sql.test` contained only `\echo 'BR-n PASS'` lines — it asserted nothing and would exit 0 even if the demo crashed.
- **Fix:** the harness now runs the demo under `psql -X -v ON_ERROR_STOP=1`, requires exit 0, requires exactly 14 `BR-n PASS` lines (one each for n=1..14) and zero `BR-n FAIL`. **Prevent:** falsifiability was proven by mutation — flipping BR-8's assertion produced `BR-8 FAIL`, the gate's `ERROR: rule demo failed: 1 of 14`, and harness exit 1 with `found 13`. Any assertion-only deliverable gets one deliberate mutation before it is trusted.

### Rollback is the cheapest idempotency guarantee
- **Fix:** the whole demo runs in one transaction ending in `ROLLBACK`. Two consecutive runs on the live seeded DB were both green, and nine table counts (hospital, donor, recipient, waitlist_entry, organ, organ_offer, match_run, transplant_event, audit_log) were byte-identical before and after. **Prevent:** when a demo must not touch the database, prefer a rolled-back transaction over cleanup statements — cleanup that can itself fail leaves residue.

### Distinguishing "the rule demo failed" from "the seed aged out"
- **Symptom:** `npm run test:server` reported 6 failures (175/181) in the same cycle the demo went green.
- **Root cause:** all six are seed-age drift — the suite documents "Needs DATABASE_URL pointing at a freshly reset dev DB", the seed was ~11.5 h old, and Heart (6 h) / Liver (12 h) viability windows plus the 3 h `HIST`/audit cutoffs had elapsed. Earlier the same cycle, at ~5 h, the same suite was 177/181.
- **Prevent:** before attributing a suite failure to a change, check the age assumptions in the failing test's own header. The remediation (`npm run db:reset`) is destructive and needs explicit approval — recording it as a risk is correct; running it silently is not.

## OL-033

### `smoke` needs jq, which no install step in this repo has ever provided
- **Symptom:** `npm run smoke` aborts immediately with `smoke: jq is required` (exit 2). `command -v jq` returned nothing, and no `jq.exe` existed under the usual installer locations (scoop, choco, winget, msys64, Program Files) — only a stale note in an earlier report that jq had once been on PATH.
- **Root cause:** `scripts/smoke-flow.sh` (OL-019) declares jq as a prerequisite, but jq was present in earlier environments by coincidence; neither `package.json` nor the old one-line README ever installed or mentioned it. OL-033 is the first task that had to make the documented commands work from scratch.
- **Fix:** downloaded the official `jq-1.7.1` Windows binary to `~/bin/jq.exe` — a directory already on `PATH` — leaving the repo untouched; the file can be removed to reverse it. The README prerequisites table now lists `jq` (and `curl`, `bash`, `psql`) so the next machine installs it up front.
- **Prevent:** before trusting a shell script as a documented command, probe its whole toolchain (`command -v psql jq curl bash node`) on the validation machine first. An external tool missing from the repo's own install path is an environment gap, not a task blocker, when the fix is one file — record it as a prerequisite instead of working around it.

### Docs tasks need falsifiable tests too, and the cheapest proof is a mutation
- **Symptom/risk:** "the README is correct" has no natural test, so a documentation task can silently regress (a command removed from the README, a decision table losing a row) and nothing fails.
- **Fix:** `tests/docs/docs.test.js` (`npm run test:docs`, no database) asserts the content the backlog requires: prerequisites (Node 20+, Postgres 14+), `.env` setup, the four named scripts, the `VITE_DATA_SOURCE` flag, every route in the OL-DEC-03 live/mock table, and a recorded outcome row for each OL-DEC entry in `AUDIT_NOTES.md`.
- **Prevent / prove it can fail:** deleting `npm run db:rules` from the README made `test:docs` exit 1 on exactly the "documents every required npm script" test; restoring the line returned 10/10. Any assertion-only deliverable gets one deliberate mutation before it is trusted (same rule as OL-032).

### Near-miss: two suites that both assume "fresh reset" poison each other
- **Symptom (avoided):** `npm run test:server` asserts seed invariants (3 AVAILABLE organs, seed-history cutoffs) while `npm run smoke` leaves a fourth AVAILABLE organ and one transplanted waitlist entry behind. Run in the wrong order, the seed-count tests fail with counts that look like a real defect.
- **Handling:** the cycle ran `db:reset → test:server → (db:reset) → smoke`, and finished with a final `db:reset` so the next task starts on the documented seed state.
- **Prevent:** read each suite's own header comment before picking an order, and finish a validation cycle with the reset that the suite's precondition names. The order is now written down in the README ("Order matters"), so the next person does not have to rediscover it.

## OL-034

### PostgreSQL and Node client tools were not on `PATH`
- **Symptom:** `psql`, `pg_dump`, `node`, and `npm` all reported `command not found` in the
  task shell, even though PostgreSQL 18.6 is installed under
  `C:/Program Files/PostgreSQL/18/bin` and Node under
  `%TEMP%/opencode/node-v24.21.0-win-x64`.
- **Root cause:** neither directory is on the persistent shell `PATH`; the tool only
  inherited the OpenCode/Windows PATH, and exports do not survive between shell calls.
- **First attempt and why it failed:** copying `psql.exe` into `~/bin` (already on `PATH`)
  failed with exit 127 — the copied binary cannot locate its DLLs (`libpq`, `libz`, …) away
  from the install directory.
- **Fix:** prepend the real install directories on the `PATH` in every command
  (`export PATH="/c/.../node-v24.21.0-win-x64:/c/Program Files/PostgreSQL/18/bin:$PATH"`);
  the new scripts also honour `PGBIN` so they can be pointed at a PostgreSQL bin dir.
- **Prevent/detect:** do not `cp` Windows PostgreSQL client tools — they are not portable.
  When a tool is "installed but not found", locate the real `bin` and use `PATH`/`PGBIN`
  rather than copying executables.

### A dump that restores is not the same as a dump that runs
- **Context/design note:** OL-034's acceptance test is not "the file exists" but "restore it
  into an empty DB **and run the app against it**". `verify-submission.sh` therefore restores
  into a scratch `organlink_check`, asserts 24 tables / 8 views / 27 compatible pairs / the
  admin hash, and then runs the full OL-019 smoke suite on a private port bound to the
  restored DB — the dump is only trusted after the application exercises it.
- **Prevent/detect:** when the deliverable is data, validate by consuming it the way the app
  would, not by inspecting it. Keep the scratch restore isolated (separate DB, private
  port) and drop it on exit.

## OL-029 browser QA (in progress, through S3.21)

### Mock-shaped initial state crashed a live-only code path
- **Context:** `RecipientWaitlistPage` kept `bloodOptions`/`urgencyOptions` as plain strings (mock shape) until
  `/api/lookups` replaced them with `{value,label}` objects. Live mode derived filter labels with `.map((o) => o.label)`,
  so on first render Mantine `Select` received `[undefined, ...]` and threw `Cannot use 'in' operator ... 'value' in undefined`.
  It reproduced on every load, so a reload could not help. Unit tests never rendered the live branch.
- **Fix:** live mode starts with empty lists; lookups go through `recipientLookupOptions` (throws on a malformed response);
  filter labels go through `optionLabels`. An error boundary would only have hidden the cause.
- **Prevent/detect:** initial state must have the same shape as the loaded state. Tests should feed live-shaped data to the real
  Mantine component (`renderToString`), including the pre-load state.

### Same z-index, tree order decides
- Mantine Modal and Drawer both default to z-index 200. A modal opened from a drawer but declared earlier in the tree renders under the
  drawer's overlay. Set an explicit `zIndex` (250, below Select/DateTimePicker dropdowns at 300) on any modal opened from a drawer.

### Looking live ids up in mock lists
- The Record Accept modal looked offers' `O-0001`/`RCP-…` display ids up in `mockOrgans`/`mockRecipients`. Live ids never match, so
  every field was "—" (and a colliding id would have shown another record's data). The "accepted limitation" was really a missed
  live wiring. Live mode now loads `GET /api/organs` and `GET /api/recipients/:id` (existing contracts) when the modal opens.

### Browser noise is not an app defect
- `Extension context invalidated` (`content.js`) comes from a browser extension content script; no `content.js` or that string exists
  in `src/`, `public/` or the build. React DevTools banner is informational. Confirm in a clean/incognito profile before blaming the app.

### A later valid backend failure does not explain an earlier invalid UI state (OL-029, OL-035)
- **Context:** after Cancel Offer, the CANCELLED row still offered "Advance to Next" while its organ was AVAILABLE. Separately and later, the organ was discarded and Advance returned 422 `RULE_VIOLATION` ("Organ 3 is not available"). The 422 is correct enforcement, but I treated it, and then the contract's A4, as closing the UI question. The UI was exposing an action your acceptance step (4.8, "no actions remain") says should not exist.
- **Root cause:** the page's `ADVANCE_FROM` copied the server's list, which came from an adopted assumption (A4), not from the context specs (which tie Advance to Decline). Eligibility in the UI is a product decision; mirroring the server list was a silent one.
- **Fix:** OL-035: `UI_ADVANCE_FROM` omits CANCELLED; the server and contract are unchanged.
- **Prevent/detect:** (1) keep each observed event as its own finding; a later error never retroactively explains an earlier state. (2) Check the provenance of a rule (spec vs adopted assumption) before calling behaviour "correct". (3) Do not pin an unresolved behaviour in tests. (4) A UI may expose fewer actions than the API allows, but record that choice. (5) Read the Response body and the Network Initiator stack before theorising about a wrong request.

### Advance can be rejected for the organ, not the offer (OL-029)
- Advance on an offer can return 422 because the organ is no longer AVAILABLE (`trg_offer_viability` raises P0001; the route stops the walk). Found by read-only queries (offer, run results, organ audit trail). The offer row carries no organ status, so the UI cannot pre-empt it; the server message is shown in a toast.
