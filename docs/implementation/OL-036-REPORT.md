# OL-036 — Matching: deterministic unique ranks for tied candidates — Report

Status: **complete** (database and API level). No browser check was performed.
Nothing committed or pushed. The live QA database was not touched.

## 1. Defect

`match_candidates()` ranked qualified candidates with
`RANK() OVER (PARTITION BY (exclusion_code IS NULL) ORDER BY match_score DESC, wait_score DESC)`.
`RANK()` gives equal values to rows tied on every ORDER BY key, and `ux_match_rank`
(`UNIQUE (run_id, rank) WHERE qualified`) rejects the second one. The whole function call
rolls back: no run is stored and the API answers 409 `DUPLICATE`. Re-running with the same
inputs fails the same way.

Two candidates tie when every scoring input is equal: hospital, blood group, weight, HLA set,
urgency, and listing date (or, once both have waited more than 60 months, `wait_score` saturates
at 100 even with different listing dates).

## 2. Reproduction (before the fix, disposable cluster, port 5433)

Fixtures in a rolled-back transaction: two ACTIVE B+ recipients at the same hospital, same
weight, no HLA, urgency 1B, listed 2024-01-15, offered the seeded Kidney (organ 3):

```
ERROR:  duplicate key value violates unique constraint "ux_match_rank"
DETAIL:  Key (run_id, rank)=(26, 7) already exists.
runs persisted after failed call: 0
```

The new test file, run against the unfixed schema: 0 of 5 pass (`actual: 409, expected: 201`).

## 3. Fix (`db/01_schema.sql` only)

- `listed_date` is carried through the `candidate` CTE.
- `RANK()` becomes `ROW_NUMBER()` ordered by
  `match_score DESC, wait_score DESC, listed_date ASC, recipient_id ASC`.
- `ux_match_rank` and every other constraint are unchanged.
- The final `recipient_id` key is for reproducibility only; it is not a clinical fairness claim.

Not changed, deliberately: `docs/context/01_schema.sql` and `05_tdd.md` §4.4 (original specs,
which still say `RANK()`), and the historical seed's `ROW_NUMBER() OVER (… match_score DESC,
wait_score DESC)`, which has no final tie-break (historical run 9 holds one tied pair, ranks 14
and 15, whose order is therefore not guaranteed on a re-seed).

## 4. Result (after the fix)

Same fixtures, two consecutive runs, scores identical (38.73 / 85.63):

```
 run_id | recipient_id |   name   | rank
     34 |           64 | T1 Tie A |    7
     34 |           65 | T1 Tie B |    8
     35 |           64 | T1 Tie A |    7
     35 |           65 | T1 Tie B |    8
```

`tests/server/match-rank-ties.test.js` (5 tests): the fixtures really tie; ranks are unique and
run 1..N; full tie, lower `recipient_id` first; score tie with an earlier `listed_date` on the
higher id, earlier listing first; three repeat runs keep the same order. 5/5 pass.

## 5. Install paths

- **Fresh install:** `npm run db:reset` (loads the fixed `db/01_schema.sql`).
- **Existing install:** `db/upgrades/OL-036_OL-037.sql` (see README → "Upgrading an existing
  database"). Verified on a disposable database built from the previous schema: a schema-only
  `pg_dump` of the upgraded database is identical to one of a fresh install.

## 6. Limits

- Verified at database and API level only. No browser was used.
- Match runs stored before the fix cannot contain duplicate ranks (the index forbade them), so
  there is nothing to repair.
