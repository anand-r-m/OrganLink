# OL-006 Report — Minimal demo seed (v1)

## Files changed
- `db/03_seed_demo.sql` (new)
- `tests/server/seed-demo.test.js` (new)
- `docs/implementation/LESSONS_LEARNED.md` (OL-006 section appended)
- `docs/implementation/OL-006-REPORT.md` (this file)

No schema, API contract, backlog, or spec changes. `scripts/db-reset.sh` already loads `03_seed_demo.sql`.

## Behavior implemented
All inserts go through the triggers (no replica mode). Times are relative to the moment the seed runs. All people are fictional.
- **8 hospitals:** the mock names and coordinates, mapped onto regions (A9): SR = Apollo Chennai, CMC Vellore, Narayana Bangalore; WR = KEM Mumbai; NR = AIIMS New Delhi, PGIMER Chandigarh; ER = KGMU Lucknow (SUSPENDED, as in the mock), SCB Cuttack.
- **10 donors:** 6 DECEASED and 4 LIVING, each with 6 HLA alleles (2 A, 2 B, 2 DRB1).
- **20 recipients:** each with 6 HLA alleles. **23 waitlist entries**, listed 1–24 months ago. Karthik Iyer and Rohan Joshi are kidney+pancreas candidates, and Zoya Ali has Heart+Kidney. All three have 2 ACTIVE entries. Two entries are SUSPENDED (one for Liver, one for Kidney).
- **3 AVAILABLE organs:** Heart (recovered 60 min ago, AIIMS Delhi), Liver (90 min ago, KEM Mumbai), Kidney (30 min ago, Apollo Chennai). Organ IDs are 1 = Heart, 2 = Liver, 3 = Kidney, and hospital and donor IDs follow list order.
- **Match results per organ:**
  - Heart: 4 qualified; 2 excluded (SIZE_MISMATCH, ABO_INCOMPATIBLE).
  - Liver: 5 qualified; 1 excluded (RECIPIENT_INACTIVE).
  - Kidney: 6 qualified; 3 excluded (ABO_INCOMPATIBLE).

## Tests and validations run
Throwaway Postgres 18.6 on `localhost:5433`, with `DATABASE_URL` passed through the environment only (`.env` untouched).
- `npm run db:reset -- --yes`: loads all three files with no errors. Run repeatedly, so it's re-runnable.
- `npm run test:server`: **37 pass, 0 fail**. This includes 7 new tests in `seed-demo.test.js`: hospital/region counts; donors (type mix, 6 HLA each); recipients and waitlist (counts, listed dates, 6 HLA each); 2-ACTIVE and kidney+pancreas recipients; the `v_organ` check (3 AVAILABLE, not expired, recovered 0.5–2 h ago); `match_candidates` on each available organ inside a rolled-back transaction (≥3 qualified, ≥1 excluded); admin and reference counts unchanged.
- `npm run test:client`: 10 pass, 0 fail.
- `npm run lint`: warnings only, all in files this task didn't touch.
- Manual check: server started on a spare port; logged in as admin, `GET /api/hospitals` returned the 8 seed hospitals.

## Failures encountered
- No Postgres running: started a throwaway cluster (see LESSONS_LEARNED).
- Seed syntax error from using `WITH ORDINALITY` on a VALUES list, then a bad regex edit of my own: fixed with `row_number()` subselects and a hand repair (see LESSONS_LEARNED).

## Remaining risks / follow-ups
- Organs are time-relative: the Heart expires about 6 h after the reset, the Liver about 12 h, the Kidney about 30 h. Demos and rehearsals must run `db:reset` shortly beforehand.
- Seed counts are asserted exactly in the tests. If OL-031 extends the seed, the OL-006 tests must be adjusted or scoped.
- `GET /api/hospitals` and later list endpoints now return seed rows. Tests should look rows up by name or type, not hard-coded IDs.
- No new backlog items discovered.

## Acceptance criteria
- `npm run db:reset` loads all three files with no errors: **satisfied**
- `match_candidates(<each available organ>)` gives ≥3 qualified and ≥1 excluded: **satisfied** (4/2, 5/1, 6/3)
- At least one recipient has 2 ACTIVE waitlist entries: **satisfied** (three do)
- Admin user and reference data are unchanged: **satisfied** (tested)
- DB test: `v_organ` has ≥3 AVAILABLE, non-expired organs right after reset: **satisfied**
