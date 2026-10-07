# OL-034 — pg_dump and full demo rehearsal — Report

Status: **complete.**

Produced the submission dump `submission/organlink.sql` from a freshly reset + seeded
database, proved it restores into an empty database and that the whole app runs against the
restored copy, and rehearsed the ten-step demo end to end. No commits; nothing pushed.
`API_CONTRACT.md`, `BACKLOG.md`, and the `docs/context/` specs were not modified.

## 1. Files changed

| File | Change |
|---|---|
| `submission/organlink.sql` | **New.** Plain-SQL `pg_dump` of a freshly reset `organlink` (129,405 bytes; 24 tables, 8 views, 24 data sections). |
| `scripts/submission-dump.sh` | **New.** Reproducible dump: loads `DATABASE_URL` (env or `.env`), optionally runs `db-reset.sh --yes`, runs `pg_dump`, and fails if the dump is not 24 tables / 8 views or is suspiciously small. |
| `scripts/verify-submission.sh` | **New.** Restores the dump into a scratch `organlink_check` DB, asserts the schema/seed invariants, runs the OL-019 smoke suite against the restored DB, then drops the scratch DB. |
| `scripts/demo-rehearsal.sh` | **New.** Repeatable API+script rehearsal of demo steps 1–10. |
| `tests/server/submission.test.js` | **New.** 5 tests over the dump artifact (no DB): object counts, all 24 tables, seed markers, 27 compatible pairs, restorable plain-SQL shape. |
| `package.json` | Added `db:dump`, `verify:submission`, `demo:rehearsal`. |
| `docs/implementation/DEMO_SCRIPT.md` | **New.** The ten-step demo script + mock-mode fallback. |
| `README.md` | Added the three new scripts to the npm-script table. |
| `docs/implementation/LESSONS_LEARNED.md` | Appended the `## OL-034` section. |
| `docs/implementation/OL-034-REPORT.md` | This report. |

## 2. Behaviour implemented

- **Submission dump.** `npm run db:dump` resets `organlink` (schema + reference + both seed
  blocks), then writes `submission/organlink.sql` with `pg_dump`. It refuses any database
  other than `organlink`, and rejects a truncated dump. `--no-reset` dumps the current DB.
- **Restore proof.** `npm run verify:submission` creates `organlink_check`, restores the
  dump with `psql -f`, checks 24 tables / 8 views / 27 compatible blood pairs / the admin
  account and `admin` hash / seed donors and organs, then starts the API on a private port
  bound to the restored database and runs the full smoke flow. It drops the scratch DB on
  exit. This is exactly the OL-034 DB acceptance test.
- **Demo rehearsal.** `npm run demo:rehearsal` runs steps 1–10 (login, procure, match +
  re-run, offer/decline/advance/accept, transport, transplant, discard, reports, rule
  script, concurrency) and prints a `PASS demo-step-*` line per step.

## 3. Tests and validations run, with results

All commands run on this machine (Node v24.21.0, PostgreSQL 18.6) with `psql`/`pg_dump`
on `PATH` (via `PGBIN`/`PATH`) and `DATABASE_URL` from `.env`.

| Check | Result |
|---|---|
| `npm run db:dump` | exit 0 — fresh reset, then `submission-dump: wrote …/organlink.sql (129405 bytes, 24 tables, 8 views)` |
| `node --test tests/server/submission.test.js` | **5/5 pass**, exit 0 |
| `npm run verify:submission` | **exit 0** — `PASS tables (24)`, `PASS views (8)`, `PASS compatible blood pairs (27)`, `PASS admin user (admin)`, `PASS admin password matches 'admin' (true)`, `PASS demo donors/organs present`, **`PASS smoke against restored DB`** (20 smoke PASS lines), `VERIFY SUBMISSION OK` |
| `npm run demo:rehearsal` (fresh reset) | **exit 0** — steps 1–10 all `PASS`, `DEMO REHEARSAL OK (steps 1-10, 20s)`; the re-run produced run 28 while run 27 stayed retrievable |
| `npm run db:reset -- --yes && npm run test:server` | **186/186 pass**, exit 0 (was 181; +5 submission tests) |
| `npm run test:client` | **151/151 pass**, exit 0 |
| `npm run test:docs` | **10/10 pass**, exit 0 |
| `npm run lint` | exit 0 — only the pre-existing baseline warnings, none in the changed files |
| `npm run build` | exit 0 (mock mode is the default; existing >500 kB chunk warning only) |
| Mock-mode check (`npm run dev:web`, no `VITE_DATA_SOURCE`) | `GET /` and every `/src/pages/*.jsx` returned **200** from Vite (compile/serve level); mock data modules are covered by `test:client` |
| Final `npm run db:reset -- --yes` | exit 0 — dev DB left on the clean seed |

## 4. Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Restoring the dump into an empty DB (`psql -f`) succeeds and the app runs against it | **PASS** | `npm run verify:submission`: restore + 7 invariant assertions + smoke (20 PASS) against `organlink_check` |
| The rehearsal completes in the time limit with no unhandled errors | **PASS** | `npm run demo:rehearsal` exit 0, steps 1–10 PASS, 20 s wall time |
| The fallback mock mode is verified on the demo machine | **PASS (render/build level)** | build succeeds with the flag unset; Vite serves `/` and every page module at 200 in mock mode; `test:client` 151/151. Browser interaction deferred to OL-029 |
| DB test: restore the dump into `organlink_check` | **PASS** | `verify-submission.sh` step 2 |
| API test: `npm run smoke` against the restored DB | **PASS** | `verify-submission.sh` step 4, `SMOKE OK` |
| UI checks: the full rehearsal | **Deferred** | No browser available in this environment; recorded in §5 and DEMO_SCRIPT.md |

## 5. Manual interactive checks

No real browser was available, so every browser interaction below is
**"Deferred to manual QA (OL-029)"**. The API/script behaviour behind each is covered
automatically as noted.

| # | Page / route | Exact action | Expected result | Automation | Status |
|---|---|---|---|---|---|
| 1 | `/login` | Enter `admin` / `admin`, submit | Dashboard loads; refresh keeps session | smoke + `demo-step-1-login` | Deferred to manual QA (OL-029) |
| 2 | `/donors` | Open donor → Procure Organ → set recovery to now → submit | Toast; AVAILABLE organ with countdown in drawer | `demo-step-2-*` | Deferred to manual QA (OL-029) |
| 3 | `/matching` | Pick organ → Run Match → move slider → Re-run | Ranked list, Excluded section, new run id, old run retrievable | `demo-step-3-*` | Deferred to manual QA (OL-029) |
| 4 | `/matching`, `/offers` | Create Offer rank 1; try rank 2; Send; Decline; Advance; Send; Accept | Disabled rank-2 button + tooltip; statuses CREATED→SENT→DECLINED→CREATED→SENT→ACCEPTED; organ ALLOCATED; transport PENDING | `demo-step-4-*` (incl. 409) | Deferred to manual QA (OL-029) |
| 5 | `/transport` | Mark In Transit → Mark Delivered | PENDING→IN_TRANSIT→DELIVERED; timestamps; map origin/destination | `demo-step-5-*` | Deferred to manual QA (OL-029) |
| 6 | `/offers` | Record Transplant (disabled before delivery) → Success | Organ TRANSPLANTED; matching waitlist entry closes; outcome shown | `demo-step-6-*` | Deferred to manual QA (OL-029) |
| 7 | `/organs` | Discard an AVAILABLE/EXPIRED organ with a reason | Grey DISCARDED badge with reason | `demo-step-7-*` | Deferred to manual QA (OL-029) |
| 8 | `/reports` | View charts; Export Audit PDF | Charts render; PDF lists offers and totals match | `demo-step-8-*` (endpoints only) | Deferred to manual QA (OL-029) |
| 9 | CLI | `npm run db:rules` | 14 PASS, 0 FAIL, rolled back | `demo-step-9-rules` | Automated test coverage |
| 10 | CLI | `npm run concurrency` | 1 create / 1 accept win; one transport row | `demo-step-10-concurrency` | Automated test coverage |
| 11 | all pages | Unset `VITE_DATA_SOURCE`, restart `npm run dev` | Every page loads from mock data | build + Vite 200s + `test:client` | Deferred to manual QA (OL-029) |

## 6. Failures encountered and how they were resolved

1. **Toolchain not on `PATH`.** `psql`, `pg_dump`, and `node`/`npm` were not on the shell
   `PATH` (Node lives under `%TEMP%/opencode/node-v24.21.0-win-x64`, PostgreSQL under
   `Program Files`). Copying `psql.exe` to `~/bin` failed with exit 127 (missing DLLs).
   *Fix:* export the real directories on `PATH` (and support `PGBIN` in the new scripts)
   instead of copying binaries. Logged in `LESSONS_LEARNED.md`.

No implementation defects were found; no retries beyond the `PATH` fix were needed.

## 7. Remaining risks / follow-ups

- **`submission/organlink.sql` is a snapshot.** It is generated from local seed data and
  contains the regenerated admin hash (A8) but no real patient data. Regenerate with
  `npm run db:dump` if the schema or seeds change.
- **Restore uses the same major `psql` as the host `pg_dump` (18.6).** No cross-version
  guard is added; a much older `psql` may reject the PG-18 `\restrict` directives.
- **Browser rehearsal is deferred** to OL-029 (no browser in this environment).
- The concurrency step (~hundreds of ms) and smoke mutate data; `demo:rehearsal` resets at
  the start and prints a reminder to reset before an actual demo.

## 8. Acceptance criteria summary

- Dump produced after fresh reset/seed: **satisfied** (`submission/organlink.sql`, 24/8).
- Restore into empty DB succeeds and app runs against it: **satisfied** (`verify:submission`).
- Rehearsal completes in time with no unhandled errors: **satisfied** (20 s, 10/10 steps).
- Fallback mock mode verified: **satisfied at build/render level**; browser pass deferred to OL-029.
- Automated test for the new artifact: **satisfied** (`tests/server/submission.test.js`, 5/5).

**OL-034 complete.**