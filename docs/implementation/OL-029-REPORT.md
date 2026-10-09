# OL-029 — Manual interactive QA pass (PARTIAL: S1–S3.21 observed, S4 onward NOT yet checked)

OL-029 is **not complete**. This report covers the defect-fixing pass after the S3.21 browser failure.

## Issues

| # | Issue | Status | Evidence |
|---|---|---|---|
| 1 | Recipient Waitlist crashes (`'in' operator ... 'value' in undefined`, `RecipientWaitlistPage.jsx:606`) | **Fixed (automated); browser recheck pending** | Cause: live initial state was strings, `.map(o => o.label)` produced `undefined` Select data. Test reproduces the exact Mantine error with the old data and renders fine with the new. |
| 2 | Procure Organ modal hidden behind Donor Profile drawer overlay | **Fixed (source-level); browser recheck pending** | Modal and Drawer both z-index 200, modal earlier in tree. Modal now `zIndex={250}`; drawer is not closed, donor context kept. No browser tooling here, so the visual result is unverified. |
| 3 | Record Accept shows "—" for organ blood group/hospital and recipient name/blood group/urgency/hospital | **Confirmed; fixed (automated); browser recheck pending** | Cause: modal looked up live display ids in mock lists. Now loads `GET /api/organs` and `GET /api/recipients/:id`; urgency is the recipient's entry for the offer's organ type. Missing values stay "—". No contract change. |
| 4 | `Extension context invalidated` / `content.js` | **Unrelated (browser extension)** | No `content.js` or that text in `src/`, `public/`, `dist/`. Fires on any click per the log. Not changed. Confirm via incognito/extensions disabled. |
| 4b | React DevTools banner | **Unrelated (informational)** | Standard React dev message. |
| 5a | Small grey element beside Transport viability counter | **Pending** | By spec (ui_mastercontext §4.6) `ViabilityCountdown` renders a progress-bar track (`.neu-inset`, grey) with a coloured fill next to the `HH:MM:SS` text. It is likely that bar; whether it is rendered too small is unconfirmed. Needs a DOM/size check. No code change. |
| 5b | Perceived slowdown | **Pending, no evidence** | No reproducible measurement. Not investigated; no optimisation done. |

## Files changed
`src/api/adapters/recipientForm.js`, `src/api/adapters/offers.js`, `src/pages/RecipientWaitlistPage.jsx`, `src/pages/DonorRegistryPage.jsx`, `src/pages/OfferWorkflowPage.jsx`, `tests/client/ol029-qa-fixes.test.js` (9 tests). No schema, API contract or server change. Database untouched.

## Tests run
- `npm run test:client`: 160 pass, 0 fail (includes 9 new).
- `npm run test:docs`: 10 pass. `npm run lint`: no errors (existing warnings). `npm run build`: succeeds.
- Server suite not run: no server code changed, and it uses the database, which was to stay untouched.
- Not verified: any visual or interactive behaviour (no browser tooling used).

## Remaining limitations
- Mock mode of Record Accept and the Create Offer modal's live lists still use mock data (unchanged).
- Items 1–3 and 5a need browser confirmation. S4 onward unchecked.

## Browser QA update (after the first fix pass)

Reported by you in the browser: Recipient Waitlist loads (issue 1), Record Accept fields populated (issue 3), Procure Organ modal visible above the drawer (issue 2). These three are now **browser-confirmed by you**, not by me. Extension errors: you will compare in a clean profile (issue 4 stays "unrelated, pending your comparison").

### S3 data evidence (read-only SQL; no HTTP calls)
- transplant_event #20 (OF-0031): Kidney O-0029, donor Anil Kapoor, recipient Arjun Mehta, SUCCESS at AIIMS New Delhi; transport #21 DELIVERED; waitlist (1, Kidney) TRANSPLANTED. Foreign keys all consistent; names correctly assigned, not swapped.
- transplant_event #21 (OF-0032): Heart O-0030, donor Rekha Deshmukh, recipient Kavya Nair, SUCCESS. OF-0033: Liver O-0031 for Deepa Menon, Accepted, transport Pending.
- Why the Kidney was hard to find: Waitlist entries view is unfiltered and sorted by priority, so Arjun's TRANSPLANTED entry is rank 30 of 59 (page 3 at 10 rows per page); a Status = ACTIVE filter hides it; recipient status stays ACTIVE by contract; the Matching Console lists only available organs.

### Viability bar (issue 5a)
Confirmed by your screenshot: 8px horizontal track with 2px padding (4px fill), hard to see. The spec (§4.6) gives no dimensions, and the Matching Console distance bar is thinner. **Recorded as a cosmetic concern; styling unchanged; no design decision or backlog task requested now.**

### Checklist adapted (DEMO_SMOKE_CHECKLIST.md)
S4–S6 rewritten for the current database state (no data changed):
- S4 uses O-0003 Kidney (about 5 eligible candidates by my replication of the matching rules, not a real run). The Liver O-0002 expires at 20:20 and is not used.
- S5 had no suitable organ, so step 5.0 procures a Pancreas from Anil Kapoor through the UI, then discards it.
- S6 expectations are now relative to a new baseline recorded in step 4.0.
- OF-0031, OF-0032, OF-0033 and their records are listed as do-not-touch.

### Status
OL-029 remains **open**. S4–S7 and the pending browser checks (Waitlist entry for Arjun, viability bar already screenshotted, clean-profile extension comparison) are not yet done.

## Live defect: cancelled offer still showed "Advance to Next" (S4 step 4.8) — RESOLVED by OL-035 (UI only)

Two separate events, kept separate:

**1. Original defect (organ AVAILABLE).** After Cancel Offer succeeded, the offer was CANCELLED but its Actions area still showed an enabled "Advance to Next", which could create a next offer while the organ stayed AVAILABLE. S4 step 4.8 expects no actions to remain.
- **Cause:** the page's `ADVANCE_FROM` (added in OL-016) included CANCELLED, mirroring the server's `ADVANCE_FROM` and API_CONTRACT A4 (an adopted assumption, not a `docs/context` spec; the specs tie Advance to Decline, and `ui_mastercontext.md` §5.6 shows it for Declined only). The button was therefore rendered by design, not by a stale-state or handler bug. This was a UI eligibility/product question.
- **Decision (user, approved R2):** cancellation is terminal in the Offer Workflow UI. Backlog entry OL-035.
- **Fix:** `UI_ADVANCE_FROM = ['DECLINED','EXPIRED','VOIDED']` and `canAdvanceInUi(offer, live)` in `src/utils/offerTransitions.js`, used by `getRowActions` in `OfferWorkflowPage.jsx` (live and mock). A CANCELLED row now has no action controls. Live mode still needs a match run for the other statuses.
- **Not changed:** server `ADVANCE_FROM`, API_CONTRACT A4, schema, seed, backend routes. The endpoint still accepts Advance from CANCELLED; the UI does not offer it.

**2. Later, separate event (organ DISCARDED).** After organ 3 was discarded (audit log: 20:45:53), clicking Advance on CANCELLED offer 36 returned `422 RULE_VIOLATION` "Organ 3 is not available (status DISCARDED)". That is valid backend enforcement (`trg_offer_viability`; the route stops on organ-level failures; API_CONTRACT documents it). It happened **after** the original defect and does **not** explain, close or downgrade it. The original defect is resolved only by OL-035.

**Unexplained earlier report.** A `POST /api/offers/36/cancel` 409 after clicking Advance was reported once; the later screenshots showed Advance calling `/advance` (stack: `OfferWorkflowPage.jsx:513 → :427 → :409 → offers.js:102`), and the user confirmed the earlier capture was not that click. Source tracing and a jsdom mount found no path from Advance to `/cancel`. Treated as a misattributed capture; not reproduced.

**Also kept:** `singleFlight` guard on Send/Cancel (hardening; not claimed as the cause of anything above).

**Tests (all non-destructive; no DB):** `tests/client/ol029-cancel-advance.test.js` (CANCELLED has no actions, live and mock; Advance stays for DECLINED/EXPIRED/VOIDED and needs a run live; row-action handler wiring; `advanceOffer` posts to `/advance` for the given ID, never `/cancel`; decline → advance → cancel endpoints and IDs; 422 message passthrough; guard) and `tests/server/advance-organ-unavailable.test.js` (P0001 → 422 `RULE_VIOLATION` verbatim; organ-level failure ends the walk). Real-page check in jsdom with a fake API: after Cancel, the CANCELLED row rendered with no buttons. Results: `test:client` 169 pass, new server file 2 pass, lint 0 errors, build succeeds. Full server suite not run (needs a resettable DB; the live QA DB was not touched).

**Browser recheck (shortest):** on a spare AVAILABLE organ, create an offer, click **Cancel Offer**, and confirm the CANCELLED row's Actions cell shows "—" and no buttons. Reload to confirm it persists. (Then re-check a DECLINED row still shows **Advance to Next**.)
