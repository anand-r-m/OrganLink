# OL-021 Report: Recipients CRUD

Status: **COMPLETE**. Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/recipients.js` (new): `GET /api/recipients`, `GET /api/recipients/:id`, `POST /api/recipients`, `PATCH /api/recipients/:id`.
- `server/util/waitlistSql.js` (new): `WAITLIST_ENTRY_SQL`, the contract's WaitlistEntry shape from `v_waitlist_scored` plus names. It has no WHERE or ORDER BY, so OL-022 can reuse it.
- `server/index.js`: mounts `/api/recipients` after `requireAuth`.
- `src/api/recipients.js` (new): `listRecipients`, `getRecipient`, `createRecipient`, `updateRecipient` (live and mock).
- `src/api/adapters/recipients.js` (new): `adaptRecipient`, `adaptMockRecipient`, `filterRecipients` (pure mock filter).
- `src/api/adapters/recipientForm.js` (new): form state, validation, waitlist-row add/remove, body mapping, pre-fill, server-error mapping.
- `src/pages/RecipientWaitlistPage.jsx`: live table, server-side filters, new detail drawer, register and edit forms.
- `tests/server/recipients.test.js` (new, 12 tests), `tests/client/recipients.test.js` (new, 18 tests).
- `src/data/mockRecipients.js` is untouched, so OfferWorkflowPage, `mockMatching` and Phase0SmokePage are unaffected.

## Behavior implemented
- **`GET /api/recipients`**
  - Filters, all bound parameters:
    - `organ`: any waitlist entry of that organ type
    - `bloodGroup`: by group name, so `A%2B` works; an unknown name returns `[]`
    - `urgency`: any entry with that code
    - `status`
  - Invalid `organ`, `urgency` (not `1A`/`1B`/`2`) or `status` returns 400 `VALIDATION_ERROR` with `details.fields`.
  - Rows carry `waitlistCount`, `hasOpenOffer` (a CREATED or SENT offer exists) and `hla`, with no `waitlist`. HLA is loaded in one batched query.
- **`GET /api/recipients/:id`**: the Recipient with `hla` and every `waitlist` entry (WaitlistEntry shape, scores unrounded, sorted by priority). No sweep, per the contract index. 404 `RECIPIENT_NOT_FOUND`.
- **`POST /api/recipients`**: inserts the recipient, its HLA and its optional waitlist entries in one `withTx`, and returns 201 with `waitlist`.
  - The DB owns the value rules: height and weight ranges and `ck_waitlist_not_future` return 400 `CONSTRAINT_VIOLATION`, and FKs return 400 `REFERENCE_NOT_FOUND`.
  - A duplicate organ type within `waitlist` hits the PK, returning 409 `DUPLICATE` and rolling back the whole POST.
- **`PATCH /api/recipients/:id`**: any subset of the POST fields.
  - `hlaAlleleIds` replaces the set.
  - Sending `waitlist` returns 400 `VALIDATION_ERROR`.
  - The UPDATE always runs, so an audit row exists even for an HLA-only edit, as in OL-020.
  - The API does nothing special for INACTIVE. The next sweep (`expire_stale_offers()` step 5) voids the recipient's open offers.
- **Page, live mode**
  - The table has one row per recipient: `R-0001` ID, name, blood group, "Waitlist Entries" count, status, an open-offer badge and hospital.
  - Urgency, Priority Score and Wait Time show "—" until OL-022 switches the table to waitlist rows.
  - Filter changes re-query the server.
- **Drawer (both modes):** details, HLA by locus, every waitlist entry (organ, urgency badge, listed date, status badge, priority score), and Edit.
- **Register form**
  - Fields: name, DOB, blood group, hospital, height, weight, and HLA multi-selects (max 2 per locus).
  - One or more waitlist rows (organ, urgency, optional listed date), with add and remove.
  - Live mode POSTs. A server error shows in a red Alert and the modal stays open. Success shows a toast and refreshes the table.
- **Edit form:** the same fields without the waitlist, plus a Status select. Saving PATCHes and reopens the drawer on the saved recipient.
- **Mock mode**
  - Rows load once into session state and filters run in memory, so locally added or edited rows survive filter changes. This was a reviewer fix.
  - The original mock columns, including the priority tooltip, are unchanged.
  - Mock statuses map to the 4 API statuses: Waiting and Offered become ACTIVE (Offered also sets the open-offer flag), Inactive becomes INACTIVE, Transplanted becomes TRANSPLANTED.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 120/120 pass |
| `npm run test:client` | 95/95 pass |
| `npm run build` | OK |
| `npx oxlint` | 9 warnings, identical to baseline (orchestrator re-counted by file:line) |
| `npm run smoke` (fresh reset) | SMOKE OK |
| curl `GET /api/recipients` | 20 seeded recipients; rows carry `waitlistCount`, `hasOpenOffer`, `hla`, and no `waitlist` |
| curl POST with Kidney 1A + Pancreas 1B, then GET | 201; both entries returned with numeric scores. `priorityScore` 72.94 / 43.84 equals `v_waitlist_scored` |
| curl GET unknown id | 404 `RECIPIENT_NOT_FOUND` |
| Deactivate then sweep (curl + psql) | match run, then offer CREATED; PATCH recipient INACTIVE leaves the offer `CREATED`; `GET /api/offers` (sweep) makes it `VOIDED`, "Recipient no longer active" |
| Filters vs SQL | `bloodGroup=A%2B` 5/5, `organ=4` 10/10, `urgency=1A` 6/6, `status=ACTIVE` 21/21; `urgency=9` and `status=NOPE` return 400 |
| Page source | live table uses `listRecipients(filters)`; drawer maps every `waitlist` entry; live filters are sent as query params |

## Reviewer findings and resolution
Verdict: **APPROVE**, with 4 NITs:
1. Mock-mode filter changes re-read `mockRecipients` and discarded rows added in the session. **Fixed:** in-memory filtering over session state (`filterRecipients`), with a client test.
2. The `urgency` filter was not validated, unlike `status` and `organ`. **Fixed:** 400 `VALIDATION_ERROR` for values other than `1A`/`1B`/`2`, with a server test.
3. In live mode the Urgency, Priority Score and Wait Time columns show "—". **Accepted**; this is OL-022's scope.
4. A mock-mode recipient added through the form gets a random priority score, as in the original code. **Accepted** (mock only).

The fixes were spot-checked by the orchestrator and then validated by the checker.

## Failures encountered
- The implementer was cut off mid-task by an API usage limit, after writing the server route and part of its tests. The same agent was resumed after the limit reset and finished. This was not a code failure.

## Remaining risks / follow-ups
- No browser verification.
- Register requires at least one waitlist row in the UI ("one or more"); the API keeps `waitlist` optional.
- Height and weight are required in the recipient form (the columns are NOT NULL). The old mock form treated them as optional.
- `waitlist_entry` audit rows use `row_id = 'composite'` (schema), so they cannot be traced to a recipient from `audit_log` alone.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/recipients` (live) | Open the page | Table lists DB recipients with `R-00NN` IDs, a Waitlist Entries count, a status badge and an open-offer badge | Deferred to consolidated manual QA (API automated) |
| `/recipients` (live) | Set Blood Group = A+ | Table narrows to A+ recipients; the request carries `?bloodGroup=A%2B` | Deferred to consolidated manual QA (API automated) |
| `/recipients` (live) | Set Organ / Urgency / Status filters, then clear them | Each narrows server-side; clearing restores the list | Deferred to consolidated manual QA (API automated) |
| `/recipients` (live) | Click a recipient row | Drawer shows details, HLA by locus and every waitlist entry with organ, urgency, listed date, status and priority score | Deferred to consolidated manual QA |
| `/recipients` (live) | Add Recipient with Kidney and Pancreas rows, submit | Toast; recipient appears; drawer shows both entries | Deferred to consolidated manual QA (API automated) |
| Register form | Remove all waitlist rows and submit | Inline validation error ("at least one waitlist entry") | Automated (`validateRecipientForm`); visual deferred to consolidated manual QA |
| Register form (live) | Submit a future listed date | Red Alert "Listing date cannot be in the future"; modal stays open | Deferred to consolidated manual QA (API automated) |
| Register form | Pick a third allele in one HLA locus | Blocked at 2 | Deferred to consolidated manual QA |
| Drawer (live) | Edit, set Status = Inactive, save | Toast; drawer reopens with an Inactive badge. If the recipient had an open offer, it shows VOIDED ("Recipient no longer active") on `/offers` after reload | Deferred to consolidated manual QA (API and DB automated) |
| `/recipients` (mock) | Add a recipient, then change and clear filters | The added recipient remains in the list | Automated (`filterRecipients` test); visual deferred to consolidated manual QA |
| `/recipients` (mock) | Hover a priority score | The existing breakdown tooltip still shows | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- The table lists recipients and the drawer shows every waitlist entry: **satisfied** at API and source level (two-entry recipient returned with view-matching scores; the drawer maps every entry). Visual check deferred.
- INACTIVE with an open offer becomes VOIDED ("Recipient no longer active") on the next sweeping request: **satisfied** (curl + psql by the checker; automated server test).
- Filters work server-side: **satisfied** (all four compared with SQL; invalid values return 400).
- DB test (offer status after deactivate then sweep), API tests (create → get → patch; `?bloodGroup=A%2B`): **satisfied**.
