# OL-014 Report: Matching runs and console

## Files changed
- `server/routes/matching.js` (new): `POST /api/matching/runs`, `GET /api/matching/runs/:id`
- `server/util/matchRunSql.js` (new): `loadMatchRun`, `listOrganRuns` (shared by both routes)
- `server/routes/organs.js`: `GET /api/organs/:id/runs`; `server/index.js`: mounts `/api/matching`
- `src/api/matching.js`, `src/api/adapters/matching.js` (new): mock/live `runMatch`, `getLatestRun`, `getMatchRun`, `getDefaultWeights`; run adapter and "Run #MR-NNNN at HH:MM" label
- `src/data/mockMatching.js` (new): mock-mode ranker that emits the same run shape
- `src/pages/MatchingConsolePage.jsx` (rewritten around the API layer), `src/index.css` (one segment colour for the fourth weight)
- `tests/server/matching.test.js`, `tests/client/matching.test.js` (new)
- `docs/implementation/LESSONS_LEARNED.md`

## Behavior implemented
- `POST /api/matching/runs` sweeps, then calls `match_candidates` inside `withTx` (so `run_by` is the session user) and returns the full `MatchRun`, 201. Missing weights fall back to the regional policy. Errors:
  - 400 `VALIDATION_ERROR` for a bad `organId`, non-numeric, negative or over-999.99 weights (the column is NUMERIC(5,2)), and all-zero effective weights.
  - 404 `ORGAN_NOT_FOUND`.
  - Expired organs are not rejected (201, all excluded).
- `GET /api/matching/runs/:id` returns the `MatchRun`; 404 `MATCH_RUN_NOT_FOUND`. `GET /api/organs/:id/runs` returns run summaries, newest first, with counts; 404 `ORGAN_NOT_FOUND`; it sweeps first.
- Console:
  - The organ dropdown comes from `/api/organs`. Expired and non-available organs are listed, greyed out and disabled.
  - Four sliders (Waiting Time added) are preset to the organ's `defaultWeights`.
  - The latest saved run loads on open and on organ change.
  - Run Match and Re-run Match always create a new run. The page shows the "Run #MR-NNNN at HH:MM" label.
  - The ranked list is shown with scores, and a collapsible Excluded list shows code and description.
  - The run buttons are disabled when all weights are 0.
- Mock mode works with the same shapes via `mockMatching.js`.
- No change to API_CONTRACT.md or the schema.

## Tests and validations
Throwaway local PG 18.6 on port 5433, reset with `npm run db:reset -- --yes`.
- `npm run test:server`: 72 pass, 0 fail (9 new matching tests):
  - auth
  - default weights equal the `region` row
  - API ranks and scores equal `match_result` in order
  - `run_by = 1`, and `count(match_run)` rises by 1 per run
  - re-run gives a new id and the old run is still fetchable and identical
  - run list order and counts
  - all four weights at 100 keep every score within 0 to 100
  - known exclusion codes and descriptions
  - an expired organ gives 201 with 0 qualified and `VIABILITY_UNREACHABLE`
  - validation and 404s, and a rejected request creates no run
- `npm run test:client`: 38 pass, 0 fail (7 new: adapter, label, live POST body, latest-run loading, default weights, mock re-run and score bounds, page wiring).
- Live curl against a running server: run, run list and 404 all behaved per the contract.
- `vite build` OK; `npm run lint` shows no new warnings.
- SSR smoke of the page: 4 sliders, "Run Match" and "Waiting Time Weight" render.

## Failures encountered
Only a throwaway SSR smoke-script failure (see LESSONS_LEARNED, OL-014). No product failures.

## Remaining risks / follow-ups
- SSR does not run effects, so the dropdown, preset sliders, latest-run load, timestamp, Re-run and Excluded accordion were not exercised in a browser. Their logic is covered by the API-layer tests, but a quick look at `/matching` in live mode is advisable.
- Candidate cards no longer show HLA allele details, urgency tier or body-size text, because the contract's `MatchRun` carries scores only.
- "Create Offer" still navigates to `/offers` as before; the real create, disabled state and tooltip belong to OL-015.
- The sliders preset to `defaultWeights` even when the latest saved run used other weights. The run's own weights are in the run payload if you want to show them.
- Tests leave extra `match_run` rows on the seeded organs, and a `db:reset` clears them.

## Acceptance criteria
- Default-weight ranks match `match_result` in order: **satisfied** (API test).
- Re-run gives a new id, and the old run is retrievable: **satisfied** (API test; UI logic tested at the API layer).
- All four sliders at maximum keep scores within 0 to 100: **satisfied** (API and mock tests).
- Excluded candidates show codes with descriptions: **satisfied** (API test; rendered by the page). `ABO_INCOMPATIBLE` and `SIZE_MISMATCH` both appear in the seed data.
- `match_run.run_by` is 1: **satisfied**.
