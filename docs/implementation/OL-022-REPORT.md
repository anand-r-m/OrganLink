# OL-022 Report: Waitlist and priority score

Status: **COMPLETE**. Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/waitlist.js` (new): `GET /api/waitlist`, `POST /api/waitlist`, `PATCH /api/waitlist/:recipientId/:organTypeId`. Reuses `WAITLIST_ENTRY_SQL` (`server/util/waitlistSql.js`, OL-021).
- `server/index.js`: mounts `/api/waitlist` after `requireAuth`.
- `src/api/waitlist.js` (new): `listWaitlist`, `addWaitlistEntry`, `updateWaitlistEntry`. In mock mode the writes refuse.
- `src/api/adapters/waitlist.js` (new):
  - `priorityBreakdown`, `formatWaitMonths`, `formatScore`
  - `adaptWaitlistRow`, `mockWaitlistRows`, `filterWaitlistRows`
  - PATCH/POST body helpers
- `src/api/adapters/recipients.js`: drawer entries also carry `urgencyScore` and `waitScore` (additive).
- `src/pages/RecipientWaitlistPage.jsx`:
  - Waitlist-entries view (default) beside the OL-021 Recipients view
  - two-component priority tooltip
  - per-entry urgency/status editor and "Add organ listing" in the drawer
- `tests/server/waitlist.test.js` (new, 6 tests), `tests/client/waitlist.test.js` (new, 8 tests).
- `tests/client/recipients.test.js`: one OL-021 page-wiring assertion banned the string `api/waitlist` in the page source. The page now legitimately imports `src/api/waitlist.js`, so the assertion was replaced by "no raw `fetch(` in the page".

## Behavior implemented
- **`GET /api/waitlist`**
  - WaitlistEntry rows from `v_waitlist_scored` plus names, sorted by `priorityScore` DESC with a recipient/organ-type tie-break. No sweep.
  - Filters:
    - `organ`: organTypeId
    - `bloodGroup`: by name; an unknown name gives `[]`, the same as OL-021
    - `urgency`: `1A`/`1B`/`2`
    - `status`: `ACTIVE`/`SUSPENDED`/`TRANSPLANTED`/`REMOVED`
  - Invalid values return 400 `VALIDATION_ERROR` with `details.fields`.
- **`POST /api/waitlist`**
  - Runs in `withTx` with shape checks only; `listedDate` defaults to today in the DB. Returns 201 WaitlistEntry.
  - Errors are translated from the DB:
    - duplicate → 409 `DUPLICATE`
    - future date → 400 `CONSTRAINT_VIOLATION` (`ck_waitlist_not_future`)
    - unknown reference → 400 `REFERENCE_NOT_FOUND`
- **`PATCH /api/waitlist/:recipientId/:organTypeId`**
  - `urgencyId`, `status` (`ACTIVE`/`SUSPENDED`/`REMOVED`; `TRANSPLANTED` → 400 `VALIDATION_ERROR`) and `listedDate`. Unknown entry → 404 `WAITLIST_ENTRY_NOT_FOUND`.
  - The UPDATE always runs, so the audit trigger records the edit.
  - `waitlist_entry` has no trigger besides the audit trigger.
- **Recipients page**
  - A "Waitlist entries | Recipients" switch. The default is Waitlist entries: one row per listing, highest priority first.
    - Columns: ID, name, blood group, organ, urgency badge, priority score, wait time ("14 months", "2.5 years", "< 1 month"), entry status and hospital.
    - Live-mode filters go to `/api/waitlist`. In this view the status filter means entry status.
  - The Recipients view is the OL-021 table, with recipient-status semantics. Switching views clears the status filter.
  - Clicking a row opens the OL-021 recipient drawer.
- **Priority tooltip**
  - Exactly two components, from the pure `priorityBreakdown(entry)`:
    - **Urgency**: code and `urgencyScore`
    - **Waiting time**: formatted `waitMonths` and `waitScore`
  - Then the total, and a note that it is "Weighted by the region's urgency and wait policy weights". The orchestrator added this note after a reviewer NIT, because the total is the region-weighted mean and does not equal a simple sum.
  - No HLA, distance, size or match score.
  - The old mock tooltip's fabricated "Policy Bonus / Urgency Weight" split is replaced in both modes. Mock component scores use the seed urgency values (1A = 100, 1B = 60, 2 = 25) and the view's wait formula.
- **Drawer, live mode:** each entry that is not TRANSPLANTED has urgency and status selects with Save.
  - Save sends a PATCH with the changed fields only, re-fetches the recipient and refreshes the table, so the new score shows at once.
  - TRANSPLANTED entries are read-only.
  - "Add organ listing" (organ, urgency, optional date) POSTs. 409 and future-date messages from the DB appear in an inline alert.
- **Mock mode:** both views work from session state, with in-memory filtering. The drawer says that changing urgency or adding listings needs live mode.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 126/126 pass |
| `npm run test:client` | 103/103 pass (also re-run by the orchestrator after its tooltip-note edit) |
| `npm run build` | OK |
| Lint (file:line count) | 9 = baseline |
| `npm run smoke` (fresh reset) | SMOKE OK |
| Every `GET /api/waitlist` row vs `v_waitlist_scored` (23 rows) | identical at 2 dp; JSON numbers; descending order |
| Urgency 2 → 1A (recipient 20, Heart) | 45.46 → 90.46 in the PATCH response and in the next GET |
| Future `listedDate` on POST and PATCH | 400 `CONSTRAINT_VIOLATION`, `ck_waitlist_not_future` |
| Duplicate POST | 409 `DUPLICATE` (`waitlist_entry_pkey`) |
| Filters vs SQL | `urgency=1A` 6/6, `bloodGroup=A%2B` 6/6, `organ=1` 6/6, `status=SUSPENDED` 3/3, `status=ACTIVE` 19/19; invalid enums return 400 |
| PATCH `TRANSPLANTED` / unknown entry | 400 `VALIDATION_ERROR` / 404 `WAITLIST_ENTRY_NOT_FOUND` |
| POST new entry (orchestrator curl) | 201; `priorityScore` 43.85 equals the view; `listedDate` defaults to today |
| Tooltip (source inspection) | two items plus total plus weighting note; no hla, distance or match |
| OL-021 `GET /api/recipients` | still 200 |

## Reviewer findings and resolution
Verdict: **APPROVE**, with NITs:
1. No server test for an empty-body PATCH writing an audit row. Accepted: the behaviour exists and mirrors the tested OL-020 and OL-021 pattern.
2. The 2-dp property is implied by equality with the view, not asserted separately. Accepted: the checker compared all rows at 2 dp.
3. The tooltip total does not reconcile visibly with the two components, because it is region-weighted, and mock totals are mock data. **Partly fixed by the orchestrator**: a "weighted by the region's policy weights" note. Mock totals are left as mock data.
3b. The page now defaults to the Waitlist entries view, not the OL-021 Recipients table. Accepted: the Recipients view is one click away. The consolidated QA list reflects it.
4. The page filter wiring is checked by regex only. Accepted, given the project's no-JSX-transform constraint; behaviour is covered by the adapter and server tests.

## Failures encountered
- None.

## Remaining risks / follow-ups
- No browser verification.
- `bloodGroup` filters return `[]` for an unknown name rather than 400 (consistent across OL-021 and OL-022, documented in the route).
- Mock entries are always ACTIVE, so the mock status filter is effectively trivial. A newly added mock recipient's extra entries have no wait months, so their tooltip shows "—".

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/recipients` (live) | Open the page | "Waitlist entries" view: one row per listing, highest priority first | Deferred to consolidated manual QA (API automated) |
| `/recipients` (live) | Hover a priority score | Tooltip: "Urgency (1A): 100.00", "Waiting time (…): …", the total, and the weighting note; no HLA or distance | Automated (`priorityBreakdown`; source check); visual deferred to consolidated manual QA |
| `/recipients` (live) | Change Organ, Blood Group, Urgency or Status filters | The table reloads from `/api/waitlist` with the query string | Deferred to consolidated manual QA (API automated) |
| `/recipients` (live) | Switch to "Recipients" | The OL-021 per-recipient table appears; the status filter uses recipient statuses | Deferred to consolidated manual QA |
| `/recipients` (live) | Click a waitlist row | The recipient drawer opens with every entry | Deferred to consolidated manual QA |
| Drawer (live) | Change an entry's urgency from 2 to 1A, then Save | "Waitlist entry updated" toast; the entry's priority score rises immediately; the table row updates | Deferred to consolidated manual QA (API automated) |
| Drawer (live) | Set an entry's status to Suspended or Removed, then Save | Badge changes; the row shows the new status | Deferred to consolidated manual QA |
| Drawer (live) | Look at a TRANSPLANTED entry | Read-only, with no editor | Deferred to consolidated manual QA |
| Drawer (live) | Add organ listing for an organ already listed | Red inline alert "A record with these values already exists" | Deferred to consolidated manual QA (API automated) |
| Drawer (live) | Add organ listing with a future date | Inline alert "Listing date cannot be in the future" | Deferred to consolidated manual QA (API automated) |
| `/recipients` (mock) | Hover a priority score; open the drawer | Two-component tooltip; the drawer says editing needs live mode | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- The priority score matches `v_waitlist_scored.priority_score` to 2 dp: **satisfied** (all 23 rows compared by the checker; server test).
- The tooltip shows two components and no HLA or distance: **satisfied** (unit test of `priorityBreakdown`; source inspection). Visual check deferred.
- Changing urgency from 2 to 1A raises the score immediately: **satisfied** (API 45.46 → 90.46). The drawer re-fetch is in the source; visual check deferred.
- A future `listedDate` returns 400 (`ck_waitlist_not_future`): **satisfied** (POST and PATCH).
- A duplicate entry returns 409 `DUPLICATE`: **satisfied**.
