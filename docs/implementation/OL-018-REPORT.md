# OL-018 Report: Record Transplant

## Files changed
- `server/routes/transplants.js` (new): `POST /api/transplants`.
- `server/index.js`: mounts `/api/transplants` behind `requireAuth`.
- `src/api/transplants.js` (new): live and mock `recordTransplant`, outcome options.
- `src/api/adapters/offers.js`: offers rows now carry `transport` and `transplant`; adds `adaptTransplant`, `canRecordTransplant`, `TRANSPLANT_DISABLED_TIP`.
- `src/pages/OfferWorkflowPage.jsx`: Record Transplant action (disabled with tooltip), modal, Transplant column.
- `src/utils/status.js`: `SUCCESS` renders green.
- `tests/server/transplants.test.js`, `tests/client/transplants.test.js` (new).
- `docs/implementation/LESSONS_LEARNED.md`, this report.
- `server/routes/offers.js` was not changed: the offers read (`offerSql`, OL-015) already embeds `transplant`; the test now covers it.

## Behavior implemented
- Body `{offerId, outcome, transplantAt?, hospitalId?, notes?}`; validated (400 `VALIDATION_ERROR`). Unknown offer gives 404 `OFFER_NOT_FOUND`.
- The organ is locked `FOR UPDATE` (as the offer and transport flows do), then one INSERT into `transplant_event`. The DB owns the rules: `trg_transplant_requires_delivery` (422 `RULE_VIOLATION` with the trigger message, verbatim), unique `offer_id` (409 `TRANSPLANT_ALREADY_RECORDED`) and `trg_transplant_recorded`. No cascade is duplicated in the API.
- `hospitalId` defaults to the transport's destination hospital (A3). Without a transport it falls back to the recipient's hospital only so NOT NULL holds; the trigger rejects that insert anyway.
- Response 201 is the contract's Transplant shape (`id, offerId, hospitalId, hospitalName, transplantAt, outcome, notes`). Notes are trimmed, and blank becomes null.
- UI: ACCEPTED offers without a transplant show **Record Transplant**. It is disabled with the tooltip "Organ has not been delivered yet" until the embedded transport is DELIVERED. The modal has outcome (Success / Failed / Organ Not Used), a datetime-local field (defaults to now, future times rejected client-side) and notes. A toast follows success. Errors show the server message and reload the list. A new **Transplant** column shows the outcome badge, with a tooltip for time and notes.
- No contract change. No schema change. OL-DEC-02 (A): no viability check.

## Tests and validations
| Check | Result |
|---|---|
| `npm run test:server` | 97/97 pass (8 new transplant tests) |
| `npm run test:client` | 66/66 pass (7 new) |
| `npm run build` | OK (chunk-size warning only, pre-existing) |
| `npx oxlint` | no new warnings |
| Real server process on port 3999 with curl | unknown offer: 404 `OFFER_NOT_FOUND`; bad outcome: 400; no session: 401 |

Server tests (HTTP against the app, real DB): 401; validation 400s; 404; **before delivery** (PENDING and IN_TRANSIT) gives 422 with "has not been delivered" and no row, organ ALLOCATED, entry ACTIVE; not-accepted offer gives 422 "is not accepted"; **SUCCESS** gives 201, organ TRANSPLANTED, that organ type's entry TRANSPLANTED while the recipient's **other entry stays ACTIVE**, hospital defaults to the transport destination, timestamp and trimmed notes are stored; repeat gives 409 with a single row; the offers read and list embed the transplant; **FAILED / ORGAN_NOT_USED** give organ DISCARDED with `TRANSPLANT_FAILED` and entry REMOVED, explicit `hospitalId` wins; an unknown hospital gives 400 `REFERENCE_NOT_FOUND` with nothing recorded. The tests restore any seeded waitlist rows they touch.

The curl sequence "422, then 201, then 409" was run as automated HTTP tests rather than by hand against the seeded DB. This keeps the seed intact, because a recorded transplant cannot be undone through the API.

## Failures encountered
- None in code or environment. See LESSONS_LEARNED (one test rewritten for determinism).

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/offers` | Look at an ACCEPTED offer whose transport is not DELIVERED | Record Transplant button is disabled | Automated test coverage for the rule (`canRecordTransplant`, page source wiring); visual part deferred to consolidated manual QA |
| `/offers` | Hover the disabled Record Transplant button | Tooltip "Organ has not been delivered yet" | Deferred to consolidated manual QA |
| `/offers` | After Mark Delivered on `/transport`, reload `/offers` and click Record Transplant | Modal opens with outcome, time (now) and notes | Deferred to consolidated manual QA |
| `/offers` | Submit the modal with no outcome | Inline "Select an outcome" | Deferred to consolidated manual QA |
| `/offers` | Submit a future time | Inline error, no request | Deferred to consolidated manual QA |
| `/offers` | Submit Success | Green toast; row's Transplant column shows a green "Success" badge; button is gone | Deferred to consolidated manual QA (endpoint: automated) |
| `/offers` | Submit Failed / Organ Not Used | Orange toast; badge shows the outcome | Deferred to consolidated manual QA (endpoint: automated) |
| `/offers` | Record on an offer already recorded elsewhere | Red toast "A transplant is already recorded for this offer"; list reloads | Deferred to consolidated manual QA (409: automated) |
| `/organs` | After SUCCESS, open the organs page | The organ shows TRANSPLANTED | Deferred to consolidated manual QA (DB state: automated) |

No browser was opened for this task.

## Remaining risks / follow-ups
- All UI interactions are unverified in a browser.
- In mock mode, accepting creates no transport, so Record Transplant stays disabled there. The mock path is only unit-tested.
- The date input uses the browser's `datetime-local` field, not a Mantine date picker (the `dates` package is installed but not used anywhere, and its CSS is not imported).
- The organs page may not refresh until it is reloaded after a transplant (not part of this task's scope).
- OL-DEC-02 (A) stands: no viability check at record time.

## Acceptance criteria
- Recording before delivery returns 422 `RULE_VIOLATION` with the trigger message, and the UI shows the action disabled: **satisfied** (API tested; disabled rule tested; visual deferred).
- SUCCESS makes the organ TRANSPLANTED and only that organ type's entry TRANSPLANTED; other entries stay ACTIVE (BR-14): **satisfied** (tested with a two-entry recipient).
- FAILED or ORGAN_NOT_USED makes the organ DISCARDED (`TRANSPLANT_FAILED`) and the entry REMOVED: **satisfied** (tested for both).
- Recording twice returns 409 `TRANSPLANT_ALREADY_RECORDED`: **satisfied**.
- Offers list embeds `transplant` once recorded: **satisfied** (tested).
- UI checks (tooltip, modal, toast, outcome in the row): implemented; browser verification **deferred to consolidated manual QA**.
