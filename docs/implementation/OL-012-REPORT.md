# OL-012 Report — Procure Organ (endpoint and drawer modal)

## Files changed
- `server/routes/donors.js`: `POST /api/donors/:id/organs`; organ SQL refactored into `organSql(where, orderBy, extraSelect)` (same output for the existing GET)
- `src/api/donors.js`: `procureOrgan`
- `src/pages/DonorRegistryPage.jsx`: **Procure Organ** button in the drawer and the `FormModal` (organ type from lookups, recovering hospital defaulting to the donor's, `DateTimePicker` defaulting to now with future dates blocked); success toast, drawer organ list and registry organ counts refreshed
- `tests/server/donors-procure.test.js` (new), `tests/client/api.test.js` (+1 test)
- `package.json`: `test:server` now uses `--test-concurrency=1` (see Failures)
- `docs/implementation/LESSONS_LEARNED.md` (OL-012 section), this report

No schema, API contract, backlog or spec changes.

## Behavior implemented
- `POST /api/donors/:id/organs` sweeps, then inserts into `organ` inside `withTx` (audit attribution via `app.user_id`). Responds 201 with the contract `Organ` (from `v_organ`, plus region `defaultWeights`).
- Body validation: `organTypeId`/`recoveringHospitalId` positive integers; `recoveredAt` an ISO 8601 string with an offset; otherwise 400 `VALIDATION_ERROR` with `details.fields`. The future-timestamp rule is left to the DB: 400 `CONSTRAINT_VIOLATION` (`ck_organ_not_future`) with the contract message. Unknown donor or malformed id: 404 `DONOR_NOT_FOUND`; bad type/hospital: 400 `REFERENCE_NOT_FOUND`. No rule is re-checked in the API.
- UI: the modal validates required fields and rejects future times client-side; a server `CONSTRAINT_VIOLATION` message is shown on the timestamp field and the modal stays open. After success the new organ shows in the drawer with its `ViabilityCountdown`.
- Mock mode: the button is disabled ("needs live mode"), as with other live-only writes; there is no mock organ store.

## Tests and validations run
Throwaway Postgres 18.6 on `localhost:5433`, `DATABASE_URL` via the environment only; `db:reset --yes` run first.
- `npm run test:server`: **54 pass, 0 fail** (run twice). 9 new in `donors-procure.test.js`: auth; Kidney 1 h ago gives AVAILABLE with `hoursRemaining` ≈ 29 and the latest `organ` row AVAILABLE; `audit_log` INSERT row for `organ` with `user_id=1`; organ appears in donor detail; future timestamp gives 400 `CONSTRAINT_VIOLATION`/`ck_organ_not_future` and inserts nothing; 404 for unknown/malformed donor; 400 `REFERENCE_NOT_FOUND`; 400 `VALIDATION_ERROR` per bad field; `+05:30` offsets accepted.
- `npm run test:client`: **27 pass, 0 fail** (1 new: `procureOrgan` request and adaptation; refuses in mock mode).
- `npm run lint`: no warnings in touched files (pre-existing warnings elsewhere). `vite build`: succeeds.
- Live server (`node server/index.js`) with curl: a Liver (12 h viability) procured 1 h ago returned 201, AVAILABLE, `hoursRemaining` 11; a +2 h timestamp returned 400 `CONSTRAINT_VIOLATION` "Recovery time cannot be in the future".
- SSR smoke render of `DonorRegistryPage` (mock mode) succeeds.

## Failures encountered
- Throwaway Postgres start failures (socket path too long; missing `LC_ALL`).
- New tests collided with existing exact-count tests when files ran in parallel; fixed with `--test-concurrency=1` and a dedicated test donor.
- SSR smoke script module-graph problem. All in LESSONS_LEARNED.

## Remaining risks / follow-ups
- **Not verified in a real browser:** the modal, date-time picker, toast and drawer refresh were not clicked through; only API, unit tests, build and an SSR render of the closed page were checked. A manual pass in live mode is advisable (open a donor, Procure Organ, choose Heart, recovery now).
- The seed organs and any organs you procure expire hours after creation.
- The modal lists organ types from `/api/lookups`; if that fails a toast is shown and the select stays empty.
- No new backlog items discovered.

## Acceptance criteria
- Procuring a Kidney with recovery 1 h ago creates an AVAILABLE organ with `hoursRemaining` about 29: **satisfied** (server test)
- A future timestamp returns 400 `CONSTRAINT_VIOLATION` (`ck_organ_not_future`) and the modal shows the message: **satisfied for the API** (tested); modal display implemented but **not clicked through in a browser**
- An `audit_log` row is written with `table_name='organ'` and `user_id=1`: **satisfied** (server test)
- Required DB, API tests: **satisfied**. UI checks (open, validate, submit, toast, organ in drawer): **implemented; not verified in a browser**
