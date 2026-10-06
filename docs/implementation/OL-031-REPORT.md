# OL-031 — Historical demo data (24 months of depth) — Report

## Summary

`db/03_seed_demo.sql` gained a retrospective block: 25 recoveries spread over the last 24 months, with the donors, recipients, HLA, waitlist movement, match runs and scores, offers, transports and transplant events that explain them. It runs inside `BEGIN; SET LOCAL session_replication_role = replica; … COMMIT`, so the workflow and audit triggers do not fire for rows that describe the past, while CHECK / NOT NULL / unique-index constraints still apply. Nothing historical is left in a state `expire_stale_offers()` can rewrite, so history survives the first dashboard or report request. Reports now return data for all four regions with real numbers, the waiting-time chart spans eight buckets instead of five, and the dashboard allocation trend is non-zero in 11 of the last 12 months (it was 0).

## Files changed

| File | Change |
|---|---|
| `db/03_seed_demo.sql` | added the historical block: HLA set catalogue, 25-row organ timeline, 36 historical people, donors/recipients/HLA/waitlist/organs, 25 match runs with 228 scored results, 30 offers, 20 transports, 19 transplant events |
| `tests/server/seed-history.test.js` | new — 11 tests covering depth, terminal states, sweep stability, chain consistency, compatibility, match coverage, audit isolation and the three report/dashboard criteria |
| `tests/server/seed-demo.test.js` | scoped the OL-006 fixture-shape assertions to the present-day block (`donor_id <= 10`, `recipient_id <= 20`); the all-rows HLA checks stay global |
| `tests/server/donors-read.test.js` | hardcoded seed counts (10 / 6 / 4 / 10) replaced with counts read from the `donor` table, so the endpoint-vs-table contract is asserted and the test survives further seed growth |
| `docs/implementation/LESSONS_LEARNED.md` | appended the OL-031 section |
| `docs/implementation/OL-031-REPORT.md` | new — this report |

Untouched: `API_CONTRACT.md`, `BACKLOG.md`, `docs/context/`, `db/01_schema.sql`, `db/02_seed_reference.sql`, `server/`, `scripts/`, `package.json`, every file under `src/`.

## Shape of the data

After `npm run db:reset -- --yes`:

| Table | Present-day (OL-006) | Historical (OL-031) | Total |
|---|---|---|---|
| `donor` | 10 | 25 deceased | 35 |
| `recipient` | 20 | 36 | 56 |
| `organ` | 3 `AVAILABLE` | 17 `TRANSPLANTED`, 5 `DISCARDED`, 3 `EXPIRED` | 28 |
| `organ_offer` | 0 | 20 `ACCEPTED`, 6 `DECLINED`, 2 `VOIDED`, 1 `EXPIRED`, 1 `CANCELLED` | 30 |
| `transport_record` | 0 | 19 `DELIVERED`, 1 `FAILED` | 20 |
| `transplant_event` | 0 | 17 `SUCCESS`, 1 `FAILED`, 1 `ORGAN_NOT_USED` | 19 |
| `waitlist_entry` | 23 | 36 | 59 |
| `match_run` / `match_result` | 0 | 25 / 228 | 25 / 228 |
| `audit_log` | 56 rows | 0 rows | 56 |

Design decisions worth knowing when editing the block:

- **One timeline drives everything.** 25 rows `(n, donor, organ, hospital, outcome, taker, cause, weight, blood group)` anchor the whole block; `n = 0` is `now() - 8 h` and `n >= 1` is the 9th of the month, `n` months back, so the trend stays aligned to calendar months regardless of when the seed runs. Donors, organs, offers, transports and transplants are all derived from it, which is why the data cannot drift out of sync as rows are added.
- **Outcomes are spread, not uniform.** 17 successful transplants, 1 failed, 1 organ-not-used, 3 expiries, and discards for viability elapsed, no suitable recipient and transport failure — so utilization, decline-reason and fairness charts each have something to say. Declines cover all six `decline_reason` codes.
- **Regions and organ types are all covered.** By recovering hospital the 25 organs split SR 10, ER 6, NR 5, WR 4, with 6 / 4 / 4 / 3 transplanted; by the recipient's hospital the fairness view reports SR 4, NR 7, ER 4, WR 2. All five organ types appear (Kidney 9, Heart 6, Liver 5, Lung 3, Pancreas 2), and retention by origin region ranges from 33% to 100%.
- **Compatibility is constructed.** Donor and taker blood groups are paired by `(n % 5)` so every accepted offer is genuinely ABO/Rh compatible, and donor/recipient weights are paired to sit inside each organ type's ratio band. `seed-history.test.js` recomputes both from `blood_compatibility` and `organ_type` so a later edit cannot quietly break it.
- **Match results are computed, not invented.** The seed replicates the `match_candidates()` scoring expression but evaluates viability and waiting time at `run_at` instead of `now()` — the live function would mark every historical candidate `VIABILITY_UNREACHABLE`. Each run ranks qualified candidates and carries `RECIPIENT_INACTIVE` / `ABO_INCOMPATIBLE` / `SIZE_MISMATCH` exclusions for the rest.
- **The taker's own run sees them as active.** A timeline taker is `TRANSPLANTED`, `INACTIVE` or `SUSPENDED` today; for that single candidate per run the status is read as `ACTIVE` (as it was when the run happened) and from the row itself for everyone else.
- **No sweep-mutable state.** No historical `AVAILABLE` organ, no `CREATED`/`SENT` offer, no `PENDING`/`IN_TRANSIT` transport.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Report views return data for all four regions | **PASS** | `utilization and fairness report every region with real numbers` — utilization covers 4 regions (each with `totalRecovered > 0`, `transplanted > 0`, and at least one expired or discarded); fairness returns 4 rows, all with `waitlistSize > 0`, `transplantsCompleted > 0`, non-null `medianWaitDays` and `retentionPct`, `allocationRatePct` from 20.00 to 43.75 |
| Waiting-time distribution has ≥ 6 populated buckets | **PASS** | `waiting-time report spans at least six buckets` — 8 distinct buckets (1–8), longest bucket 8, no zero counts. Was 5 buckets (1–5) before |
| Dashboard allocation trend non-zero in ≥ 10 of the last 12 months | **PASS** | `dashboard allocation trend is non-zero in at least 10 of the last 12 months` — 11 non-zero months, only 2025-12 empty (that recovery's transplant failed), `transplantsThisMonth ≥ 1` |
| `npm run smoke` still passes after reset | **PASS** | `SMOKE OK`, 20 `PASS` lines, exit 0 |
| Consistency: every `TRANSPLANTED` organ has an `ACCEPTED` offer, `DELIVERED` transport and `SUCCESS` transplant | **PASS** | `every transplanted organ has an accepted offer, a delivered organ and a SUCCESS event` — 0 broken |
| History spans 18–24 months across all organ types and regions | **PASS** | `history spans 18-24 months across every organ type and region` — 25 organs, 6 older than 18 months, 5 types, 4 regions, span 24 months |
| The sweep cannot rewrite history | **PASS** | `expire_stale_offers() leaves the historical block untouched` — status multiset of organs, offers and transports identical after two calls |
| Historical rows are facts, not audited events | **PASS** | `historical rows are facts, not audited events` — 0 `audit_log` rows older than the historical cut-off, 56 present-day rows retained |

## Tests run

| Command | Result |
|---|---|
| `npm run db:reset -- --yes` | `db:reset complete`, first load of the new block with no errors |
| `node --test --test-concurrency=1 tests/server/seed-history.test.js tests/server/seed-demo.test.js` | 19 pass, 0 fail |
| `npm run test:server` | **181 pass, 0 fail** (was 169 before OL-031; +11 new, +1 unaffected) |
| `npm run test:client` | 151 pass, 0 fail |
| `npm run smoke` | `SMOKE OK` — 20 steps, `procure (organ AVAILABLE)`, `match (run, 19 then 40)`, through `offer-has-transplant` |
| `npm run lint` | 0 errors, the same 8 pre-existing warnings (`src/components/*`, `.phase0-verify/*`), none in the changed files |
| `npm run build` | built, only the pre-existing >500 kB chunk-size advisory |

Order matters on this machine: `db:reset` → `test:server` → `test:client` → `lint` → `build` → `smoke`. Smoke leaves a donor, two organs, an offer chain and a transplant behind by design, and the OL-006 test asserts exactly 3 `AVAILABLE` organs, so smoke must run last (or be followed by another reset).

## Failures hit and fixed

1. **`task()` unavailable again** — `Model not found: openai/gpt-6-luna`, same infrastructure failure as OL-030. Implemented directly rather than retrying.
2. **No Node.js on the machine** — unlike OL-030, no bundled runtime existed: no `node`, no `npm`, only `bun` 1.4.2, so every required command failed at `npm: command not found`. A portable Node v24.21.0 (win-x64 zip) and `jq.exe` (required by `smoke-flow.sh`) were extracted into the pre-approved temp directory and put on `PATH`. No repo file changed; recorded in the lessons log so the next cycle does not rediscover it.
3. **`psql` not on `PATH`** — PostgreSQL 18 is at `/c/Program Files/PostgreSQL/18/bin`, and `db-reset.sh` calls `psql` by name. Prepended to `PATH` for every command.
4. **`donors-read.test.js` failed twice** (`35 !== 10`, `31 !== 6`) — hardcoded seed sizes. Replaced with table-derived counts, which is what the test should have been asserting anyway.
5. **First draft would have been swept away** — it used `SENT` offers and `IN_TRANSIT` transports. Reaping runs on every dashboard and report request, so that history would have been rewritten minutes after seeding. Replaced with terminal states and pinned by a test.

No API contract, schema, or backlog change was needed: the block adds data only, and every endpoint it affects already existed.

## Risks and limits

- **The block assumes the reference data it leans on.** It names the five organ types, the six `decline_reason` and seven `discard_reason` codes, the three urgency codes and the eight blood groups by literal. Renaming or removing any of those silently changes or breaks the seed. The load fails loudly on a missing join target, not silently — except for `discard_reason`, where `LEFT JOIN` would quietly yield `NULL` and trip `ck_organ_discard_reason`, which is also loud.
- **Match scores are self-consistent, not independently verified.** The seed recomputes the live scoring formula at `run_at`, so scores are reproducible and ranked, but there is no golden-value test against the function itself; the only reason the function is not reused is that it reads `now()`.
- **`audit_log` intentionally under-reports the historical block.** That is the point — history is not a live event stream — but anyone auditing "who changed this organ" will only see present-day activity. The report should not be read as a claim that the retrospective rows went through the workflow.
- **Waitlist dates reach ~50 months back** (a 26-month wait for a recovery that happened 24 months ago). Internally consistent and invisible in the waiting-time chart, which only counts `ACTIVE` entries, but it will show up in `median_wait_days` if a region has few transplants.
- **Fixture-shape tests are pinned to identity ranges.** `seed-demo.test.js` scopes itself with `donor_id <= 10` / `recipient_id <= 20`. That is stable because the present-day block is inserted first, but if the present-day block is ever reordered or trimmed, that test fails by design rather than silently.
- **Not covered:** multi-region inter-state allocation realism, re-listing after `REMOVED`, historical organ-quality measurements (no such table exists), and any non-`DECEASED` historical donor.

## Manual interactive checks

No browser was opened and no UI file was modified, so there is nothing new to click through; the user-visible surface is the data the existing screens now render. Everything below is asserted by `tests/server/seed-history.test.js` against a freshly reset DB and is marked accordingly.

| Check | Route / page | Action | Expected | Status |
|---|---|---|---|---|
| Dashboard allocation trend | `GET /api/dashboard` → Dashboard | Load the dashboard after a reset | 12 zero-filled months, ≥ 10 with ≥ 1 transplant, current month ≥ 1 | Automated test coverage |
| Dashboard recent offers | `GET /api/dashboard` | Load the dashboard | Recent-offer list still reflects the live flow only; no 20-month-old offers appear | Automated test coverage (sweep no-op test) |
| Waiting-time report | `GET /api/reports/waiting-times` → Reports | Open the waiting-time chart | ≥ 6 distinct buckets, longest ≥ 6, no empty bar | Automated test coverage (8 buckets) |
| Utilization report | `GET /api/reports/utilization` → Reports | Open the utilization chart/donut | All four regions with non-zero recovered, transplanted and expired/discarded counts | Automated test coverage |
| Fairness report | `GET /api/reports/fairness` → Reports | Open the fairness table | Four regions, each with completed transplants, a median wait in days and a retention percentage | Automated test coverage |
| Decline-reason report | `GET /api/reports/decline-reasons` → Reports | Open the decline chart | Several distinct causes with percentages | Automated test coverage (6 codes) |
| Donor list | `GET /api/donors` → Donors | Open the donor list after a reset | 35 rows, filters (type/status/hospital) match the table, each row shows `organCount` | Automated test coverage |
| Donor detail | `GET /api/donors/:id` → Donor detail | Open a donor that has a historical organ | 6 HLA alleles grouped A/B/DRB1, organs listed with their terminal status | Automated test coverage (`donors-read.test.js`) |
| Core allocation flow | `/api/donors` → match → offer → transport → transplant | Run `npm run smoke` after a reset | All 20 steps pass; matching now ranks ~19–40 candidates per fresh organ | Automated test coverage, `SMOKE OK` |
| Reports page rendering | `/reports` (React) | Open the page and switch tabs | Bars/tables render the values above; no client change needed | **not manually verified** — build passes and the client suite is green, but no browser was used |
| Dashboard page rendering | `/` (React) | Open the dashboard | Trend line renders 12 points | **not manually verified** — same reason |