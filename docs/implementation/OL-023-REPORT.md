# OL-023 Report: Organ discard

Status: **COMPLETE**. Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/organs.js`: `POST /api/organs/:id/discard`. The `GET /:id` body was extracted into `loadOrganWithWeights(db, id)`, which GET and discard share; GET's response is unchanged.
- `src/api/adapters/organs.js`: `canDiscard`, `DISCARD_BLOCKED_TOOLTIP`, `discardReasonOptions`, `defaultDiscardReasonId`.
- `src/api/organs.js`: `discardOrgan(organ, discardReasonId, live)`, a mock discard store (a separate Map; `mockOrgans` is never mutated) and `resetMockOrgans`.
- `src/pages/OrgansPage.jsx`: Actions column with Discard, a reason modal (`FormModal`), and a list reload after submit.
- `tests/server/organs-discard.test.js` (new, 8 tests), `tests/client/organs-discard.test.js` (new, 7 tests).

## Behavior implemented
- **`POST /api/organs/:id/discard` `{discardReasonId}`**, inside `withTx(userId, …, { sweep: true })`. The sweep runs first, so an organ past its viability is EXPIRED before the check. Then:
  1. `SELECT status … FOR UPDATE`; a missing row gives 404 `ORGAN_NOT_FOUND`.
  2. A status other than AVAILABLE or EXPIRED gives 409 `INVALID_STATE_TRANSITION` with `details {currentStatus, requiredStatus}`.
  3. A CREATED or SENT offer on the organ gives 409 `ACTIVE_OFFER_EXISTS`, "…cancel it before discarding the organ", with `details.offerId`. This is A17; the schema has no rule for it (C12).
  4. A conditional `UPDATE … SET status='DISCARDED', discard_reason_id=$2 WHERE … AND status IN ('AVAILABLE','EXPIRED')`.
  5. Returns 200 with the full Organ (same keys as `GET /api/organs/:id`, including `defaultWeights`).
- **Validation and backstops**
  - A missing or non-integer `discardReasonId` (including `"2"`) gives 400 `VALIDATION_ERROR`.
  - An unknown reason gives 400 `REFERENCE_NOT_FOUND` (FK).
  - `trg_organ_status_transitions` remains the DB backstop.
- **Race safety:** the offer-create route also locks the organ `FOR UPDATE`, so the open-offer check and the discard are serialised.
- **Organs page**
  - A Discard button appears only for AVAILABLE or EXPIRED organs; the Actions cell is empty for ALLOCATED, TRANSPLANTED and DISCARDED. With an active offer it is disabled, with the tooltip "Cancel the active offer before discarding".
  - The modal has a required reason select from lookups `discardReasons` ("CODE – description"). An EXPIRED organ pre-selects VIABILITY_ELAPSED.
  - Success shows a toast and reloads the list, and the row shows the grey DISCARDED badge (`muted` → `.badge-expired`, `#9ba3a9`). An error shows the server message in an in-modal Alert and the list also reloads.
- **Mock mode:** discard is held in a module-memory store, with a fixed list of the six seed reasons (codes and ids match `02_seed_reference.sql`). It refuses terminal organs and organs with an open offer, checking status first like the server. Matching Console shows a mock-discarded organ as disabled. OfferWorkflowPage and Phase0SmokePage are unaffected.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 134/134 pass |
| `npm run test:client` | 110/110 pass |
| `npm run build` | OK |
| Lint (file:line count) | 9 = baseline |
| `npm run smoke` (fresh reset) | SMOKE OK |
| AC1: organ 1 back-dated → swept to EXPIRED → discard with VIABILITY_ELAPSED (id 3) | 200 DISCARDED; DB `DISCARDED|3`; `audit_log` UPDATE row with `user_id` 1; response keys identical to `GET /api/organs/1` |
| AC2: match + offer on organ 2 → discard | 409 `ACTIVE_OFFER_EXISTS` (`details.offerId` 1); organ still AVAILABLE. After cancelling the offer, discard gives 200 |
| AC3: smoke-created TRANSPLANTED organ 5 → discard | 409 `INVALID_STATE_TRANSITION`, `currentStatus` TRANSPLANTED; re-discarding a DISCARDED organ also 409 |
| AC4: source inspection | `canDiscard` is AVAILABLE/EXPIRED only; the cell is null otherwise; disabled plus tooltip with an active offer; reasons come from lookups |
| Errors | missing reason 400; `"2"` 400; reason 999999 → 400 `REFERENCE_NOT_FOUND` (organ unchanged); organ 999999 → 404 |

## Reviewer findings and resolution
Verdict: **APPROVE**, with 3 NITs:
1. Mock `discardOrgan` checked the open offer before the status, unlike the server. **Fixed by the orchestrator:** status first. The client suite passed in the checker run, which came after this fix.
2. If lookups fail to load, the modal opens with an empty reason list. The lookup error is already shown as a notification, and the user can close the modal. **Accepted.**
3. The columns `useMemo` carries an `eslint-disable` comment. The reviewer confirmed it hides no stale closure, because `reasons` is the only captured value that changes. **Accepted.**

## Failures encountered
- None.

## Remaining risks / follow-ups
- No browser verification.
- Discarding an ALLOCATED organ is not possible here, by design (A17). It goes through the transplant outcome.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/organs` (live) | Look at the Actions column | Discard appears only on AVAILABLE and EXPIRED rows; none on ALLOCATED, TRANSPLANTED or DISCARDED | Automated (`canDiscard`; source); visual deferred to consolidated manual QA |
| `/organs` (live) | Hover Discard on an organ with an active offer | Button disabled; tooltip "Cancel the active offer before discarding" | Deferred to consolidated manual QA |
| `/organs` (live) | Click Discard on an EXPIRED organ | Modal opens with VIABILITY_ELAPSED pre-selected and the six coded reasons listed | Deferred to consolidated manual QA |
| Discard modal | Clear the reason and submit | Inline "Select a discard reason" | Deferred to consolidated manual QA |
| Discard modal (live) | Submit | Toast; modal closes; the row shows a grey "Discarded" badge and no Discard button | Deferred to consolidated manual QA (API automated) |
| Discard modal (live) | Submit when an offer was created after page load | In-modal red alert with the 409 message; list reloads | Deferred to consolidated manual QA (API automated) |
| `/matching` (live) | After discarding, open the organ dropdown | The discarded organ is listed but disabled | Deferred to consolidated manual QA |
| `/organs` (mock) | Discard an AVAILABLE mock organ | Row shows Discarded; nothing crashes | Deferred to consolidated manual QA (mock store unit-tested) |

No browser was opened for this task.

## Acceptance criteria
- Discarding an EXPIRED organ with VIABILITY_ELAPSED makes it DISCARDED with that reason: **satisfied** (curl and psql; server test).
- Discarding an organ with an open offer returns 409 `ACTIVE_OFFER_EXISTS`: **satisfied**.
- Discarding a TRANSPLANTED organ returns 409 `INVALID_STATE_TRANSITION`: **satisfied**.
- The button is hidden for terminal states: **satisfied** at helper and source level; visual check deferred.
- DB test (`status`, `discard_reason_id` after a discard): **satisfied**. The badge turns grey: CSS verified (`#9ba3a9`); visual check deferred.
