# OL-015 Report: Offers (list, create, send, cancel)

## Files changed
- `server/routes/offers.js` (new): `GET /api/offers`, `GET /api/offers/:id`, `POST /api/offers`, `POST /api/offers/:id/send`, `POST /api/offers/:id/cancel`
- `server/util/offerSql.js` (new): the Offer query (`v_offer` plus names, rank, transport, transplant) and its adapter
- `server/index.js`: mounts `/api/offers`
- `src/api/offers.js`, `src/api/adapters/offers.js` (new): mock/live `listOffers`, `createOffer`, `sendOffer`, `cancelOffer`; Offer adapter
- `src/api/organs.js`: mock `listOrgans` reports `hasActiveOffer` from the mock offer store
- `src/utils/offerTransitions.js` (mock only): UPPER_SNAKE statuses, and `CANCELLED` transitions
- `src/pages/MatchingConsolePage.jsx`: Create Offer on every candidate card, with tooltip and toasts
- `src/pages/OfferWorkflowPage.jsx`: list, Send and Cancel on the API layer; new columns
- `tests/server/offers.test.js`, `tests/client/offers.test.js` (new); `tests/client/organs.test.js` (one assertion adjusted)
- `docs/implementation/LESSONS_LEARNED.md`
- No change to API_CONTRACT.md, BACKLOG.md, specs or schema.

## Behavior implemented
- `GET /api/offers` sweeps first, filters by `status` (comma list, validated) and `organId`, and returns newest first. `GET /api/offers/:id` returns 404 `OFFER_NOT_FOUND`.
- `POST /api/offers` sweeps, then in one transaction (session user attributed) locks the organ `FOR UPDATE` and inserts. `created_by` is the session user. Errors:
  - 409 `ACTIVE_OFFER_EXISTS` and 409 `RECIPIENT_ALREADY_DECLINED` via the DB indexes
  - 422 `RULE_VIOLATION` with the trigger text
  - 400 `VALIDATION_ERROR`
  - 400 `REFERENCE_NOT_FOUND` for a missing organ or run
  - 400 `VALIDATION_ERROR` if `matchRunId` belongs to another organ (a small guard I added, so Advance can't later walk the wrong run)
- Send and Cancel are conditional updates (A2) under the organ lock. Send is CREATED to SENT and sets `sent_at`. Cancel is CREATED or SENT to CANCELLED. A zero-row update returns 404 or 409 `INVALID_STATE_TRANSITION` with `details.currentStatus`, `requiredStatus`, and `voidReason` when set.
- Console: every ranked candidate card (and the Review modal) has Create Offer. It is disabled with the tooltip "This organ already has an active offer" when the organ has an open offer, and with "This recipient has already declined this organ" for a declined candidate. Success shows a toast and the card's offer badge. The organ list is re-read afterwards, on failure too. Weights and run are not reset.
- Offers page: the list loads from the API. Send and Cancel Offer buttons call the API, and failures show the server message. New Sent At and Response Deadline columns. Badges are blue for CREATED, amber for SENT, grey for CANCELLED and VOIDED.
- Live mode: Accept, Decline and Advance buttons are hidden because they are not wired until OL-016. The header Create Offer button goes to the Matching Console, since an offer needs a ranked candidate. Mock mode keeps the old modal and actions, now persisted in a shared mock store.

## Tests and validations
Throwaway local PG 18 on port 5433, reset with `npm run db:reset -- --yes`.
- `npm run test:server`: 78 pass, 0 fail (6 new offers tests):
  - auth on every endpoint
  - validation, 404s and bad references
  - cross-organ run rejected
  - the full flow with DB checks of `status` and `sent_at` after each step: create, create again (409), send, send again (409), cancel, re-create, cancel
  - `offerExpiresAt - sentAt` equals the response window
  - list filter, detail equality, and the organ's `hasActiveOffer` and `activeOfferId`
  - run-less create (rank null) and an excluded candidate (422)
  - a CREATED offer back-dated 2h is cancelled by the sweep, so Send returns 409 with `currentStatus` CANCELLED
- `npm run test:client`: 47 pass, 0 fail (9 new: adapter, live request shapes, 409 surfacing, mock-mode flow, badge colours, console and page wiring).
- Live curl against a running server (organ 1, run 23): create rank 1 gave 201 CREATED rank 1 and DB `CREATED|null`. Create rank 2 gave 409 `ACTIVE_OFFER_EXISTS`. Send gave 200 SENT with `sentAt` and `offerExpiresAt` one hour later, and DB `SENT|t`. Send again gave 409 `INVALID_STATE_TRANSITION`. Cancel gave 200 CANCELLED. Create rank 2 afterwards gave 201.
- `vite build` OK. `npm run lint` shows no new warnings. SSR smoke of both pages renders (headings, buttons, loading text). SSR does not run effects, so it does not show table rows or candidate cards.

## Failures encountered
See LESSONS_LEARNED (OL-015): one wrong test expectation (422 vs 400), one existing mock-mode test affected by the new overlay (assertion updated), and shell tooling slips. No product defects.

## Manual interactive checks
**No browser was available in this environment (no browser tool, Playwright or Chrome), so none of the checks below was verified in a browser.** The "Evidence" column says what covers each instead.

| # | Page / route | Exact user action | Expected visible result | Verified in browser | Evidence |
|---|---|---|---|---|---|
| 1 | `/matching` | Open the page with live mode on | The first available organ is selected and each ranked card has a Create Offer button, not only rank 1 | no | Source-wiring test; SSR renders the page only |
| 2 | `/matching` | Click Create Offer on the rank 1 card | Green toast "Offer OF-NNNN created for R-NNNN (rank 1)"; the card gets a blue Created badge; every Create Offer button becomes disabled | no. Deferred to manual QA pass (OL-029) | API flow by curl and tests; client-side state change not exercised |
| 3 | `/matching` | Hover the disabled Create Offer on rank 2 | Tooltip "This organ already has an active offer" | no. Deferred to manual QA pass (OL-029) | Source-wiring test checks the text only |
| 4 | `/matching` | Click Review on a card, then "Create Offer for R-NNNN" | The modal closes and the offer is created as in #2; if the organ has an open offer, the button is disabled with the same tooltip | no | None |
| 5 | `/matching` | Click Create Offer on a stale view where the organ already has an offer | Red toast "This organ already has an active offer"; the buttons then disable | no | 409 is covered by API tests and the client 409 test |
| 6 | `/matching` | After creating an offer, move a slider | Sliders and the run stay as they are (not reset) | no | Effect re-keyed by code change; not exercised |
| 7 | `/matching` | Candidate who previously declined the organ | Create Offer disabled with "This recipient has already declined this organ" | no | None (needs OL-016 to produce a decline) |
| 8 | `/offers` | Open the page | The offer appears as a blue Created badge, with Offered At and empty Sent At and Response Deadline | no | Adapter and API tests; SSR shows only the loading text |
| 9 | `/offers` | Click Send Offer on the CREATED row | Blue toast "Offer sent"; badge turns amber Sent; Sent At and Response Deadline (one window later) fill in; Send is replaced by Cancel Offer | no. Deferred to manual QA pass (OL-029) | API tested by curl; UI not exercised |
| 10 | `/offers` | Click Cancel Offer on a CREATED or SENT row | Grey toast "Offer cancelled"; badge turns grey Cancelled; no actions remain | no. Deferred to manual QA pass (OL-029) | API tested by curl |
| 11 | `/offers` | Click Send or Cancel on a row that changed elsewhere | Red toast with the server message (e.g. "Offer 35 is SENT; this action requires CREATED"); the list reloads | no | 409 body tested; toast not exercised |
| 12 | `/offers` | Live mode: look at the row actions | No Record Accept, Record Decline or Advance buttons (OL-016) | no | Source check only |
| 13 | `/offers` | Live mode: click the header Create Offer | Navigates to `/matching` | no | None |
| 14 | `/offers` | Mock mode: Create Offer modal, Send, Accept, Decline | Behaves as before, with uppercase statuses and persistence across navigation | no | Mock-mode unit tests only |

**Decision (user, after the first report):** API-level verification is accepted for the UI-dependent acceptance criteria. Checks 2, 3, 9 and 10 are deferred to the manual QA pass (OL-029). API-level behaviour for create, send, cancel and re-create is verified by the DB and API tests and the live curl run above. The other rows are unchanged and remain unverified in a browser. The pass is tracked as OL-029 in `BACKLOG.md`.

## Remaining risks / follow-ups
- Checks #2, #3, #9 and #10 are deferred to the manual QA pass (OL-029); the rest of the table also still needs a browser.
- `GET /api/offers` returns every offer with no pagination, as the contract says. A CREATED offer older than one hour is cancelled by the sweep, so a user may find an unsent offer already cancelled.
- The server test reuses an organ from the seeded data and deletes its own offers in cleanup. A crash mid-test could leave one open offer. Re-running `db:reset` clears it.
- OL-016 owns accept, decline and advance. The page logic for them is still the mock path until then.
- Not browser-checked: Mantine's tooltip on the disabled button (a wrapping span receives the hover).

## Acceptance criteria
- Creating an offer for rank 1 shows it as CREATED on `/offers`; Send changes it to SENT, sets `sentAt`, and shows `offerExpiresAt`: **satisfied** at the API and data level (curl, DB and API tests). The `/offers` rendering is covered by adapter tests only and not checked in a browser.
- A second create on the same organ returns 409 `ACTIVE_OFFER_EXISTS`: **satisfied**. The UI disables the button with the tooltip: **implemented, not verified in a browser**.
- Sending a non-CREATED offer returns 409 `INVALID_STATE_TRANSITION`: **satisfied**.
- Cancel moves a CREATED or SENT offer to CANCELLED (grey badge), after which a new offer can be created: **satisfied** at API level (the badge colour is covered by the status-variant test, not seen in a browser).
- Required tests (DB, API curl flow, UI checks): DB and API **done**; UI checks accepted at API level by the user and deferred to the manual QA pass (OL-029).
