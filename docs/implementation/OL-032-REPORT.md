# OL-032 — Business-rule demonstration script

Status: complete. `npm run db:rules` prints **14 PASS lines and 0 FAIL** and exits 0.
No commits were made; nothing was pushed.

## 1. What was delivered

| File | Change |
|---|---|
| `db/10_rule_demo.sql` | Rewritten (998 lines). One DO block per rule BR-1..BR-14; attempts a real violation, asserts the outcome, records PASS/FAIL. |
| `db/10_rule_demo.sql.test` | Rewritten (70 lines). The previous content was a vacuous `\echo 'BR-n PASS'` stub that tested nothing. It is now a bash assertion harness that runs the demo and fails unless there are exactly 14 PASS lines, zero FAIL lines, and psql exits 0. |
| `package.json` | Added `"db:rules": "bash db/10_rule_demo.sql.test"` (backlog requires `db:rules`). |
| `docs/implementation/LESSONS_LEARNED.md` | Appended the `## OL-032` section. |
| `docs/implementation/OL-032-REPORT.md` | This report. |

Not modified: `API_CONTRACT.md`, `BACKLOG.md`, specs, server code, frontend code, seeds, schema.

## 2. Behaviour of the script

- **Single transaction, always rolled back.** `BEGIN; ... ROLLBACK;` — no rows persist, so
  the script is idempotent and safe on a freshly reset DB *and* on the existing seeded DB
  (verified on the current seeded DB: the counts of hospital, donor, recipient,
  waitlist_entry, organ, organ_offer, match_run, transplant_event and audit_log are
  byte-identical before and after two consecutive runs).
- **One result row per rule.** Each block writes exactly one row into a temporary table
  `br_results(rule_no, ok, detail)` — on success in the body, on failure in the exception
  handler. The final gate raises an exception unless there are exactly 14 rows and none
  failed, so with `ON_ERROR_STOP` psql exits non-zero on any defect.
- **PASS/FAIL lines are printed once, at the end, sorted by rule number**, so they always
  read `BR-1 .. BR-14` regardless of the order the blocks had to execute in.
- **No `:psql` variables inside `$$ ... $$` bodies.** psql does not substitute them there
  (the previous version's DO blocks were all broken by this). Ids are resolved with plain
  SQL; fixtures shared between blocks are handed over through a second temporary table
  `br_state(k, v)`.
- **Fixtures are self-contained** (hospitals `OL32 Hosp A/B/C`, one `OL32 Donor`, eight
  recipients, waitlist entries) and cannot collide with existing data.

### Rule → enforcement → what is demonstrated

| Rule | Enforcement point | Demonstration |
|---|---|---|
| BR-1 | `ck_donor_death_fields` | LIVING donor with a death date and DECEASED donor without one are both rejected |
| BR-2 | `v_organ.is_expired`, `trg_offer_viability`, sweep step 3 | 40 h kidney reads expired, offer refused, sweep flips it to EXPIRED; an ALLOCATED organ past its window is left alone (**OL-DEC-02 scope**) |
| BR-3 | `ck_organ_discard_reason` | DISCARDED without a reason rejected, reason without DISCARDED rejected, valid discard accepted |
| BR-4 | `PRIMARY KEY (recipient_id, organ_type_id)` | duplicate Kidney entry rejected, second organ type (Liver) allowed |
| BR-5 | `match_candidates()` exclusion ladder | one run excludes `ABO_INCOMPATIBLE`, `SIZE_MISMATCH`, `RECIPIENT_INACTIVE`, `VIABILITY_UNREACHABLE`, `ALREADY_OFFERED` (one fixture each) and still qualifies the reachable candidate |
| BR-6 | `match_run.run_id GENERATED ALWAYS AS IDENTITY` | explicit `run_id` rejected with SQLSTATE 428C9; a re-run appends a second run and leaves the first intact. API side: only `POST /api/matching/runs` and `GET` exist (`server/routes/matching.js`) — see limitation L2 |
| BR-7 | `ux_offer_active` | second concurrent active offer rejected; exactly one active offer remains |
| BR-8 | `expire_stale_offers()` step 2 | CREATED offer abandoned 2 h is CANCELLED |
| BR-9 | `expire_stale_offers()` step 1 | SENT offer past the 6 h Kidney response window is EXPIRED and stamped `responded_at` |
| BR-10 | `ux_offer_no_reoffer` | re-offer to the decliner rejected, while the organ still advances to the next candidate |
| BR-11 | `trg_offer_accepted` cascade | acceptance → organ ALLOCATED + transport PENDING, **no** transplant event |
| BR-12 | `trg_accept_recheck` | acceptance refused for an organ that aged past its window and for a recipient deactivated after the offer; neither cascade fired |
| BR-13 | `trg_transplant_requires_delivery` | transplant refused while transport is PENDING and while the offer is not accepted (**OL-DEC-02 scope: the DELIVERED gate**) |
| BR-14 | `trg_transplant_recorded` | SUCCESS closes only the transplanted Kidney entry; the same recipient's Pancreas entry and every other kidney entry stay ACTIVE |

## 3. Validation and results

All commands were run in this order on the current (seeded) dev DB.

| Command | Result |
|---|---|
| `npm run db:rules` (3 runs, incl. after a mutation test) | **exit 0**, `BR-1 PASS` … `BR-14 PASS`, `0 FAIL`, gate notice `OL-032 result: 14 of 14 business rules passed`, final line `transaction rolled back, no rows persisted` |
| residue check (9 table counts before/after two consecutive runs) | identical: hospital 8, donor 35, recipient 56, waitlist 59, organ 28, offer 30, match_run 39, transplant 19, audit 832 |
| **falsifiability test** — BR-8 assertion mutated to an impossible expectation, then restored | harness **exit 1** with `BR-8 FAIL: …`, `ERROR: rule demo failed: 1 of 14 rules failed (BR-8)`, `psql exited 3`, `expected 14 PASS lines, found 13`, `BR-8 PASS appeared 0 time(s)`; file restored byte-identical and re-verified green |
| `npm run test:client` | 151/151 pass |
| `npm run lint` | 0 errors, 8 warnings (baseline, unchanged — no JS/JSX touched) |
| `npm run test:server` | 175/181 — 6 failures, all pre-existing seed-age drift (section 4) |
| `npm run build`, `npm run smoke` | not re-run: OL-032 changes no frontend or API code (backlog marks API/UI tests as n/a) |

## 4. Failures observed

`npm run test:server` fails 6 of 181. None is caused by OL-032 (the demo script commits
nothing; table counts are unchanged by it), and all six are the seed ageing out of the
tests' own time windows — the suite header says *"Needs DATABASE_URL pointing at a freshly
reset dev DB (`npm run db:reset`)"*. The seed was loaded ~11.5–12 h before this run
(`min(audit_log.changed_at)` = 11.54 h), while the tests assume a reset within 3 h.

| Failing test | Observed | Cause |
|---|---|---|
| `seed-demo`: exactly 3 AVAILABLE unexpired organs | `['Kidney']` vs `['Heart','Kidney','Liver']` | Heart (6 h) and Liver (12 h) windows elapsed |
| `seed-demo`: match on each available organ | 1 organ vs 3 | same |
| `donors-read`: donor detail first organ `AVAILABLE` | `EXPIRED` | same |
| `matching`: excluded candidates (needs an AVAILABLE Heart) | `TypeError` on `heart.organ_id` | no AVAILABLE Heart remains |
| `seed-history`: every historical organ reached a terminal state | `stale_available` 1 vs 0 | `HIST = recovered_at < now() - 3 h`; the present-day seed now falls inside that window |
| `seed-history`: historical rows are not audited events | 832 vs 0 | audit rows are 11.5 h old, past the 3 h cutoff |

Earlier in the same cycle, at ~5 h seed age, the suite was 177/181 — the two additional
failures are the same drift (Heart/Liver crossing their viability windows), which is the
expected monotonic pattern.

**Remediation:** `npm run db:reset` restores 181/181. It is destructive and was **not**
run (CLAUDE.md requires explicit approval of the target DB). This is recorded as a risk,
not as an OL-032 defect.

## 5. Manual interactive checks

No browser was opened during OL-032, so no row below claims visual or browser
verification. Statuses are one of: `Automated test coverage` (a test asserts it),
`Server-render check only` (only the API/DB layer was exercised), `Deferred to
consolidated manual QA`.

| Page / route | Action | Expected result | Status | Evidence |
|---|---|---|---|---|
| `/login` | sign in `admin`/`admin`; wrong password | session cookie + redirect to `/dashboard`; 401 `INVALID_CREDENTIALS` | Automated test coverage | `tests/server/auth.test.js` (9 tests), `tests/client/api.test.js` |
| `/dashboard` | load tiles, expiry alerts | each stat equals an independent SQL count; organ ≤1 h left is a red alert | Automated test coverage | `tests/server/dashboard.test.js`, `tests/client/dashboard.test.js` |
| `/donors` | create a DECEASED donor with a death date; a LIVING donor with a death date | 201 / rejected with `ck_donor_death_fields` (BR-1) | Automated test coverage | `tests/server/donors-write.test.js`, `tests/client/donorForm.test.js`, `db:rules` BR-1 |
| `/donors` | procure an organ with a future `recoveredAt` | 400 `CONSTRAINT_VIOLATION`, nothing persisted | Automated test coverage | `tests/server/donors-procure.test.js` |
| `/recipients` | submit the same organ type twice in one create | 409 `DUPLICATE`, whole recipient rolled back (BR-4) | Automated test coverage | `tests/server/recipients.test.js`, `tests/client/recipients.test.js`, `db:rules` BR-4 |
| `/recipients` (waitlist view) | list, filter, change urgency | sorted by `priorityScore`; score updates; no HLA/distance in the tooltip | Automated test coverage | `tests/server/waitlist.test.js`, `tests/client/waitlist.test.js` |
| `/organs` | discard without a reason; discard with a reason (BR-3); expired organs still listed (BR-2) | rejected / DISCARDED / listed as EXPIRED after sweep | Automated test coverage | `tests/server/organs-discard.test.js`, `tests/server/organs-read.test.js`, `tests/client/organs-discard.test.js`, `db:rules` BR-2, BR-3 |
| `/matching` | run a match, then re-run (BR-5, BR-6) | ranked qualified list + excluded list with known reasons; second run gets a new id and the old run stays retrievable | Automated test coverage | `tests/server/matching.test.js`, `tests/client/matching.test.js`, `db:rules` BR-5, BR-6 |
| `/offers` | create a second active offer; decline then re-offer; accept; accept after expiry (BR-7, BR-10, BR-11, BR-12) | 409 `ACTIVE_OFFER_EXISTS` / re-offer blocked, advance skips decliner / organ ALLOCATED + transport row / 409 after sweep | Automated test coverage | `tests/server/offers.test.js`, `offers-respond.test.js`, `tx-errors.test.js`, `concurrency.test.js`, `tests/client/offers.test.js`, `db:rules` BR-7/10/11/12 |
| `/transport` | depart, then deliver, repeat | 200 / 200 / 409 `INVALID_STATE_TRANSITION`, timestamps ordered, organ stays ALLOCATED | Automated test coverage | `tests/server/transport.test.js`, `tests/client/transport.test.js` |
| Record transplant action | record before delivery; record after delivery (BR-13, BR-14) | 422 `RULE_VIOLATION` / 201, organ TRANSPLANTED, only that organ type's waitlist entry closes | Automated test coverage | `tests/server/transplants.test.js`, `tests/client/transplants.test.js`, `db:rules` BR-13, BR-14 |
| `/reports` | load the five report endpoints; export PDF | endpoint payloads equal their SQL views; PDF is non-empty | Automated test coverage | `tests/server/reports.test.js`, `tests/client/reports.test.js`, `tests/client/auditPdf.test.js` |
| `/reports` | visual check of charts (labels, colours, layout) | charts render correctly at the supported viewport sizes | Deferred to consolidated manual QA | none — no browser opened |
| `/settings` | change region weights, hospital, organ type | PATCH persists and drives the next default match run; constraint violations mapped to fields | Automated test coverage | `tests/server/settings.test.js`, `tests/client/settings.test.js` |
| `/settings` | compatibility matrix 8×8 grid and HLA list | toggles persist; duplicate HLA 409; delete of an in-use allele 409 | Automated test coverage | `tests/server/compat-hla.test.js`, `tests/client/compatibility.test.js` |
| all routes | responsive layout, spacing, visual polish, status badge colours in the browser | renders correctly from 360 px to desktop | Deferred to consolidated manual QA | component/model tests only (`tests/client/status.test.js` etc.) |
| all routes | flip `VITE_DATA_SOURCE` between mock and live and confirm each page reads from the intended source | mock pages work with no network; live pages hit `/api/*` | Deferred to consolidated manual QA | adapter logic is covered (`tests/client/api.test.js`); page-level switching not exercised in a browser |
| `/__phase0-smoke` | phase-0 dev page | dev artifact, not part of the demo flow | Server-render check only | route exists (`src/App.jsx:33`); no test coverage claimed |

## 6. Acceptance criteria (BACKLOG.md OL-032)

| Criterion | State |
|---|---|
| 14 PASS lines and 0 FAIL | **Satisfied** — `npm run db:rules` prints exactly `BR-1 PASS` … `BR-14 PASS`, no FAIL, exit 0 |
| Idempotent (transaction rolled back, or a reset follows) | **Satisfied** — single transaction ending in `ROLLBACK`; two consecutive runs green; 9 table counts unchanged |
| DB tests: the script itself | **Satisfied** — `db/10_rule_demo.sql.test` asserts 14×PASS/0×FAIL and the psql exit code; falsified deliberately (exit 1) to prove it can fail |
| API tests: n/a; UI checks: n/a | Per backlog |
| Extends the 09 pattern | **Satisfied** — same DO-block + `EXCEPTION` + `RAISE NOTICE` core, plus a result table, a gate, and no cross-block psql variables |
| BR-2 and BR-13 scope follows OL-DEC-02 | **Satisfied** — BR-2 asserts the sweep expires AVAILABLE organs only and leaves an ALLOCATED organ alone; BR-13 asserts the `DELIVERED` transport gate only |
| Files: `db/10_rule_demo.sql`, `package.json` (`db:rules`) | **Satisfied** |
| Demo step: `npm run db:rules` reads the 14 PASS lines | **Satisfied** |

## 7. Risks and limitations

- **L1 — psql-only.** The script uses `\set`, `\echo`, dollar-quoted DO blocks and NOTICE
  output; it must be run with `psql` (as `db:rules` does). A generic SQL client cannot
  execute it. Documented in the file header.
- **L2 — BR-6 is enforced at the DB identity column plus the API surface, not by a
  trigger.** `match_run.run_id` refuses explicit values (428C9) and the API exposes only
  `POST`/`GET` for runs, but a hand-written `UPDATE match_run ...` is not blocked inside
  the database. This matches the approved scope (append-only through the application);
  a DB-level immutability trigger would be a schema change needing approval.
- **L3 — Server suite failures are seed age, not this task.** `npm run db:reset`
  (destructive, requires explicit approval) is what clears them; it was not run.
- **L4 — The harness counts PASS lines by regex.** It relies on the single emission point
  (the final report block). If PASS lines were ever also emitted inline, the count check
  would catch it as a failure (count ≠ 14), so the failure mode is loud rather than silent.
- **L5 — The script briefly locks rows the sweep touches** (`expire_stale_offers()`
  updates stale seeded rows inside the transaction). Concurrent API traffic would block
  until the rollback; invisible rows are never visible to other transactions. Run the demo
  with the dev server idle for a clean demo.
- **L6 — Fixtures are visible only inside the transaction**; nothing leaks between runs,
  so the script does not depend on database state other than the reference seeds
  (regions, organ types, blood groups, decline/discard/exclusion reasons, admin user 1).

## 8. Assumptions

- "Freshly reset DB" in the backlog is satisfied trivially because the script rolls back;
  it was validated against the existing seeded dev DB instead of resetting it (reset is
  destructive and unapproved).
- `SET LOCAL app.user_id = 1` assumes the seeded admin (`db/02_seed_reference.sql`),
  which is the same assumption `docs/context/09_verification_tests.sql` already makes.
