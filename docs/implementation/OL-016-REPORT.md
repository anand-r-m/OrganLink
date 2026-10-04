# OL-016 Report: Offers (accept, decline, advance)

## Files changed
- `server/routes/offers.js`: `POST /api/offers/:id/accept`, `/decline`, `/advance`. The shared `transition()` helper now takes extra columns and validated input.
- `src/api/offers.js`: `acceptOffer`, `declineOffer`, `advanceOffer` (mock/live). The mock accept and decline now live in the API layer.
- `src/api/adapters/offers.js`: adds `respondedAt` to the row.
- `src/pages/OfferWorkflowPage.jsx`: Accept, Decline and Advance on the API; coded decline reasons from `/api/lookups`; skipped-ranks panel; new texts.
- `src/data/mockOffers.js`: one mock response text ("transplant scheduled" removed).
- `tests/server/offers-respond.test.js` (new); `tests/client/offers.test.js` (4 tests added).
- `docs/implementation/LESSONS_LEARNED.md`.
- No change to API_CONTRACT.md, BACKLOG.md, specs or schema.

## Behavior implemented
- **Accept** (SENT only, A2): conditional `UPDATE` under the organ `FOR UPDATE` lock, sets `responded_at` and optional `notes`. The DB triggers allocate the organ and create the transport (PENDING, or DELIVERED for the same hospital). Returns the Offer with `transport`.
- **Decline** (SENT only): requires `declineReasonId` (400 `VALIDATION_ERROR` if missing or not an id; 400 `REFERENCE_NOT_FOUND` if unknown); optional `notes`. Returns `declineReasonId` and `declineReasonCode`.
- Both return 404 `OFFER_NOT_FOUND`, and 409 `INVALID_STATE_TRANSITION` with `currentStatus`, `requiredStatus` and `voidReason`. The sweep runs first, so an offer on an expired organ is VOIDED by then.
- **Advance** (A4, U1): allowed from DECLINED, EXPIRED, VOIDED or CANCELLED with a non-null run (else 409 `INVALID_STATE_TRANSITION`). 409 `ACTIVE_OFFER_EXISTS` if the organ already has an open offer. It locks the organ and walks the run's qualified ranks below the source recipient's rank. Each insert runs under a SAVEPOINT. P0001 and 23505 failures are skipped and reported (`reasonCode` `RECIPIENT_ALREADY_DECLINED` or `RULE_VIOLATION`). An organ-level P0001 ("Organ % …") stops the walk with 422 `RULE_VIOLATION`. The new offer is CREATED (201 `{offer, skipped}`). If nothing is left, 422 `NO_ELIGIBLE_CANDIDATE` with `details.skipped`.
- **UI** (`/offers`): Record Accept only records acceptance. The "transplant scheduled" text is gone, the submit button reads "Record Accept", and the toast says "Accepted: organ allocated, transport created". The decline modal uses the coded reasons from lookups in live mode. Advance to Next (live) calls the API, shows a toast and a closable panel listing each skipped rank with its reason (or "No eligible candidate" with the skipped ranks on 422). Advance is offered only for offers that have a run. VOIDED and CANCELLED badges were already grey. Mock mode keeps its previous behaviour apart from the new texts.

## Tests and validations
Throwaway local PG 18 on port 5433 (`DATABASE_URL` via environment only), reset with `npm run db:reset -- --yes`.
- `npm run test:server`: 83 pass, 0 fail (5 new). They cover:
  - auth and 404s on the three endpoints;
  - the full flow with DB checks: create, send, state errors on CREATED, decline validation, decline with ORGAN_QUALITY, re-offer 409 `RECIPIENT_ALREADY_DECLINED`, advance skipping a prior decliner, advance 409 while an offer is open, send, accept (organ ALLOCATED, `transport_record` PENDING/DELIVERED by hospital, one row), then the final-state 409s; the open-offer count is checked at every step;
  - advance with no run (409), from CANCELLED (201), and exhausted ranks (422 `NO_ELIGIBLE_CANDIDATE`);
  - accept after expiry: 409 `INVALID_STATE_TRANSITION`, `currentStatus` VOIDED, organ EXPIRED, no transport.
- `npm run test:client`: 51 pass, 0 fail (4 new).
- Live curl against a running server (organ 1, run 17): send, decline ORGAN_QUALITY (DECLINED), re-create for the decliner (409 `RECIPIENT_ALREADY_DECLINED`), advance (CREATED, rank 2, `skipped: []`), send, accept (ACCEPTED, transport PENDING); DB shows organ ALLOCATED and transport PENDING.
- `vite build` OK. `npm run lint`: no warnings in files touched (one introduced warning fixed). SSR render of `/offers` shows the heading, Create Offer and the loading text. SSR does not run effects, so it does not show rows, the modals or the skipped panel.

## Failures encountered
Only an environment slip: Postgres did not start because its socket directory did not exist (see LESSONS_LEARNED, OL-016). No product failures.

## Manual interactive checks
No browser was opened. None of the checks below was performed in a browser.

| # | Page / route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|---|
| 1 | `/offers` | Click Record Accept on a SENT row | Modal "Record Accept" with no "transplant scheduled" or "Transplant" wording, button "Record Accept" | Deferred to consolidated manual QA (modal text covered by source test only) |
| 2 | `/offers` | Confirm Record Accept | Green toast "Accepted: organ allocated, transport created"; badge turns green Accepted; row actions disappear | Deferred to consolidated manual QA (API behaviour: automated test coverage) |
| 3 | `/offers` | Click Record Decline | Modal with a reason dropdown listing the coded reasons (descriptions) from the database | Deferred to consolidated manual QA (lookups: server test; dropdown not exercised) |
| 4 | `/offers` | Submit Decline without a reason | Inline error "Select a decline reason" | Deferred to consolidated manual QA |
| 5 | `/offers` | Submit Decline with ORGAN_QUALITY | Orange toast; badge turns red Declined; Response column shows ORGAN_QUALITY; Advance to Next appears | Deferred to consolidated manual QA (API: automated test coverage) |
| 6 | `/offers` | Click Advance to Next on a DECLINED row that has a run | Green toast; a new blue Created row for the next rank; blue panel listing "Skipped ranks" with name, id and reason (or "No ranks were skipped.") | Deferred to consolidated manual QA (API: automated test coverage) |
| 7 | `/offers` | Click Advance to Next when no candidate remains | Red toast "No remaining ranked candidate could be offered", red panel | Deferred to consolidated manual QA (API: automated test coverage) |
| 8 | `/offers` | Look at VOIDED and CANCELLED rows | Grey badges | Automated test coverage (status-variant test); rendering deferred to consolidated manual QA |
| 9 | `/offers` | Click Accept on a row that changed elsewhere | Red toast with the server message; the list reloads | Deferred to consolidated manual QA |
| 10 | `/matching` | Candidate that declined the organ | Create Offer disabled with "This recipient has already declined this organ" (carried over from OL-015 check 7, now producible) | Deferred to consolidated manual QA |
| 11 | `/offers` (page load) | Open the page | Page renders heading and Create Offer | Server-render check only |

## Remaining risks / follow-ups
- All UI interactions above need the consolidated manual QA pass (OL-029).
- In live mode the Record Accept modal's organ and recipient detail panels still read mock organ and recipient data (pre-existing), so they may show "—". The accept call itself uses the offer id and is unaffected. No backlog entry exists for this; add one if it matters.
- Advance treats any P0001 message starting with "Organ " as organ-level. A new trigger message with that prefix would also stop the walk.
- The accept notes and decline notes share `organ_offer.notes`.
- A same-hospital transfer (transport DELIVERED at accept) is handled by the existing trigger; the server test checks the expected status by comparing hospitals, but the seeded data may not contain such a case.

## Acceptance criteria
- After accept, the offer is ACCEPTED, the organ ALLOCATED, and a transport record exists (PENDING, or DELIVERED for same-hospital): **satisfied** (DB assertions; the DELIVERED branch is asserted conditionally and not exercised by seeded data).
- After decline, the offer is DECLINED with its reason; Advance creates a CREATED offer for the next eligible rank and lists skipped ranks: **satisfied**.
- Creating an offer for the recipient who declined returns 409 `RECIPIENT_ALREADY_DECLINED`: **satisfied**.
- Accepting after expiry returns 409 `INVALID_STATE_TRANSITION` with `details.currentStatus = "VOIDED"`: **satisfied** (organ expiry back-dated by SQL on a cloned organ).
- Advance with no eligible candidate returns 422 `NO_ELIGIBLE_CANDIDATE`: **satisfied**.
- UI changes (texts, coded reasons, skipped list, grey badges): **implemented; not verified in a browser** (deferred to manual QA).
