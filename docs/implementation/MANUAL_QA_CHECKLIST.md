# Manual QA Checklist (retroactive, OL-001 to OL-014)

Compiled from `docs/implementation/OL-*-REPORT.md`. Every report so far states that the browser-level behaviour was **not** verified in a real browser, so the last column starts as "No".

Notes:
- Reports exist for OL-001 to OL-006 and OL-010 to OL-014. There are no reports for OL-007, OL-008 or OL-009, so they contribute nothing.
- OL-001 and OL-003 are DB and API only and have no browser interaction. They are listed once as non-UI rows so the gap is explicit.
- "Live" means `VITE_DATA_SOURCE=api npm run dev` with a reset local dev DB. "Mock" means the flag is unset.
- Organs expire a few hours after `npm run db:reset` (Heart about 6 h, Liver about 12 h, Kidney about 30 h). Reset shortly before running any organ or matching item.

| # | Task ID | Page / route | Exact user action | Expected visible result | Source report section | Browser-verified? |
|---|---------|--------------|-------------------|-------------------------|-----------------------|-------------------|
| 1 | OL-001 | n/a (terminal) | Run `npm run db:reset` against the local dev DB, answering `y` at the prompt | The script prints "Resetting <host>/organlink", then completes. The app loads seed data afterwards | Safety; How to verify | No |
| 2 | OL-002 | `/api/health` | Open `http://localhost:5173/api/health` with `npm run dev` running | Browser shows `{"status":"ok","db":"ok"}` | Tests run (Browser test) | No |
| 3 | OL-002 | `/api/health` | Stop Postgres, reload `/api/health` | Browser shows 503 with `{"error":{"code":"DB_UNAVAILABLE",...}}` | Tests run (Manual) | No |
| 4 | OL-002 | `/dashboard` (mock mode) | Open `http://localhost:5173/dashboard` with no flag | The existing app renders in mock mode, with no blank page and no console errors | Tests run; Acceptance criteria (partially verified) | No |
| 5 | OL-003 | n/a (API only) | No browser interaction. Malformed JSON gives a 400 envelope, which is covered by tests only | n/a | Behavior implemented | No |
| 6 | OL-004 | `/login` (live) | Enter admin / admin and submit | Redirects to the dashboard and the user is shown as logged in | Behavior; Acceptance criteria | No |
| 7 | OL-004 | `/login` (live) | Enter admin with a wrong password and submit | The card shakes and shows an invalid credentials error | Acceptance criteria (shake not browser-verified) | No |
| 8 | OL-004 | `/login` (live) | Stop the API server, then submit valid credentials | The message "Unable to reach the server" is shown | Files changed (LoginPage) | No |
| 9 | OL-004 | any page (live) | Log in, then refresh the page (F5) | The user stays logged in with no redirect flash to `/login` and no blank flash | Risks (refresh persistence); Files changed (AppShell) | No |
| 10 | OL-004 | any page (live) | Click Log out, then try to open a protected route directly | Redirects to `/login`. The browser Back button does not show protected data | Risks (redirect after logout) | No |
| 11 | OL-004 | any page (live) | Restart the API server while logged in, then reload | Session is lost, so the user is returned to `/login` (in-memory store, by design) | Risks | No |
| 12 | OL-004 | `/login` (mock) | Log in with admin / admin, refresh | Login works and persists via localStorage. Behaviour is unchanged from before | Behavior; Acceptance criteria | No |
| 13 | OL-005 | `/settings`, Hospitals tab (mock) | Open the Hospitals tab | Table shows the mock hospitals, with Add, Edit and Suspend enabled | Behavior implemented | No |
| 14 | OL-005 | `/settings`, Hospitals tab (live) | Open the Hospitals tab | A loading spinner appears, then the 8 DB hospitals. Region shows the full name (e.g. "Southern Region"). Trauma level shows "—" | Behavior; Risks | No |
| 15 | OL-005 | `/settings`, Hospitals tab (live) | Hover over the Add, Edit and Suspend buttons | The buttons are disabled and a tooltip explains why (writes arrive in OL-024) | Risks | No |
| 16 | OL-005 | `/settings`, Hospitals tab (live) | Stop the API, then open the tab | A red Mantine notification shows the server or network error message | Risks; Acceptance criteria | No |
| 17 | OL-005 | `/settings`, Regions tab (live) | Open the Regions tab | Hospital counts per region are unchanged and still come from mock data | Files changed; Acceptance criteria | No |
| 18 | OL-005 | `/settings`, Hospitals tab (live) | Look at the KGMU Lucknow row | Its SUSPENDED badge is grey (after OL-010) | Risks (StatusBadge) | No |
| 19 | OL-006 | `/donors`, `/organs`, `/matching` (live) | After `db:reset`, open each page | Seed data is visible: 10 donors, 3 AVAILABLE organs (Heart, Liver, Kidney), 8 hospitals | Behavior implemented | No |
| 20 | OL-006 | `/organs`, `/matching` (live) | Rehearse the demo several hours after the last reset | Organs show expired or close to expiry. Run `db:reset` again before the demo | Remaining risks | No |
| 21 | OL-010 | `/__phase0-smoke` | Open the page | All 20 spec statuses plus 4 Title Case mock statuses render as badges with a readable label | Files changed; Acceptance criteria | No |
| 22 | OL-010 | `/__phase0-smoke` | Compare badge colours to 07 §4 | Green: ACCEPTED, DELIVERED, TRANSPLANTED, ACTIVE. Amber: SENT, IN_TRANSIT, PENDING, 1B. Red: DECLINED, FAILED, EXPIRED, 1A. Blue: CREATED, ALLOCATED, 2. Grey: VOIDED, CANCELLED, DISCARDED, SUSPENDED, INACTIVE | Behavior implemented | No |
| 23 | OL-010 | `/__phase0-smoke` | Check the EXPIRED, SUSPENDED and ALLOCATED badges | EXPIRED is red, SUSPENDED is grey, ALLOCATED is blue | Behavior implemented (behaviour changes) | No |
| 24 | OL-010 | `/__phase0-smoke` | Check `IN_TRANSIT` and `In Transit` | Both render the same amber badge with the label "In Transit" | Behavior implemented | No |
| 25 | OL-010 | any page with badges (mock) | Browse pages that use mock Title Case values | Badges render the same as before with no visual regression | Remaining risks | No |
| 26 | OL-010 | `/__phase0-smoke` | Look for an unknown status value | It renders grey | Remaining risks | No |
| 27 | OL-011 | `/donors` (live) | Open the page | Table lists the 10 seed donors with IDs like `D-0001`. Type (Deceased/Living) and Status (Active/Inactive) are separate columns with badges | Behavior; Acceptance criteria | No |
| 28 | OL-011 | `/donors` (live) | Set the Type filter to Deceased | Table narrows to 6 deceased donors and the request carries `?type=DECEASED` (visible in the Network tab) | Behavior; Acceptance criteria | No |
| 29 | OL-011 | `/donors` (live) | Set the Status filter | Table re-queries and shows only matching donors | Behavior implemented | No |
| 30 | OL-011 | `/donors` (live) | Set the Hospital filter | Table shows only that hospital's donors | Behavior implemented | No |
| 31 | OL-011 | `/donors` (live) | Combine Type, Status and Hospital filters, then clear them | Results combine correctly and clearing restores the full list | Behavior implemented | No |
| 32 | OL-011 | `/donors` (live) | Click a donor row | Drawer opens with the donor details and the HLA grouped by locus (HLA-A, HLA-B, HLA-DRB1, 6 alleles) | Behavior; Acceptance criteria | No |
| 33 | OL-011 | `/donors` (live) | Look at the organs list in the drawer of a donor with an AVAILABLE organ | Organ shows a status badge and a live `ViabilityCountdown` | Behavior implemented | No |
| 34 | OL-011 | `/donors` (live) | Open the drawer of a donor with no organs | The text "No organs procured" is shown | Behavior implemented | No |
| 35 | OL-011 | `/donors` (live) | Check the Date Registered column | Shows "—" (the schema has no registration date) | Remaining risks | No |
| 36 | OL-011 | `/donors` (live) | Hover over Register, Edit and Deactivate | The buttons are disabled until OL-020 | Behavior; Remaining risks | No |
| 37 | OL-011 | `/donors` (mock) | Open the page, use the filters and the drawer | Mock donors show with Type and Status normalised ("Deceased" becomes type DECEASED / status ACTIVE). Filters work client-side | Behavior; Acceptance criteria | No |
| 38 | OL-011 | `/donors` (live) | Open the drawer of a donor whose organ has expired since the last view | The organ shows EXPIRED after the sweep | Tests run (sweep) | No |
| 39 | OL-012 | `/donors`, drawer (live) | Open a donor and click Procure Organ | A modal opens with an organ type select (from lookups), the recovering hospital defaulting to the donor's, and a date-time picker defaulting to now | Files changed; Behavior implemented | No |
| 40 | OL-012 | `/donors`, drawer (mock) | Hover over the Procure Organ button | The button is disabled with a "needs live mode" tooltip | Behavior implemented | No |
| 41 | OL-012 | Procure Organ modal (live) | Submit with no organ type chosen | Required-field validation message appears and the modal stays open | Behavior implemented | No |
| 42 | OL-012 | Procure Organ modal (live) | Open the date picker and try to pick a future date or time | Future dates are blocked in the picker | Files changed | No |
| 43 | OL-012 | Procure Organ modal (live) | Type or force a future recovery time, then submit | The error "Recovery time cannot be in the future" shows on the timestamp field and the modal stays open | Behavior; Acceptance criteria | No |
| 44 | OL-012 | Procure Organ modal (live) | Choose Heart with recovery time now, then submit | The modal closes and a success toast appears. The new organ shows in the drawer with a `ViabilityCountdown` | Remaining risks; Acceptance criteria | No |
| 45 | OL-012 | `/donors` (live) | After procuring, close the drawer and look at the registry | The donor's organ count is updated in the table | Files changed | No |
| 46 | OL-012 | Procure Organ modal (live) | Procure a Kidney with recovery 1 h ago | The organ is AVAILABLE with about 29 h remaining | Acceptance criteria | No |
| 47 | OL-012 | Procure Organ modal (live) | Stop the API from serving `/api/lookups` (or let it fail), then open the modal | A toast is shown and the organ type select stays empty | Remaining risks | No |
| 48 | OL-012 | Procure Organ modal (live) | Pick a different recovering hospital, then submit | The organ is created with that hospital | Behavior implemented | No |
| 49 | OL-013 | sidebar nav | Look at the nav order | "Organs" sits between Recipient Waitlist and Matching Console | Files changed; Acceptance criteria | No |
| 50 | OL-013 | sidebar and breadcrumb | Click Organs | Routes to `/organs`, the nav item highlights and the breadcrumb says Organs | Files changed | No |
| 51 | OL-013 | `/organs` (live) | Open the page | Table shows every organ with ID, type, donor, blood group, recovering hospital, recovered time, countdown, status badge and an active-offer indicator, newest recovery first | Behavior implemented | No |
| 52 | OL-013 | `/organs` (live) | Look at an organ with less than 1 h left | The `ViabilityCountdown` shows a red pulse | Remaining risks; Acceptance criteria | No |
| 53 | OL-013 | `/organs` (live) | Look at an expired organ | It stays listed with a red EXPIRED badge | Behavior; Acceptance criteria | No |
| 54 | OL-013 | `/organs` (live) | Look at ALLOCATED, TRANSPLANTED and DISCARDED organs | The countdown column shows "—" | Remaining risks | No |
| 55 | OL-013 | `/organs` (live) | Use the status filter | Table narrows to the chosen status and the request carries `?status=` | Behavior implemented | No |
| 56 | OL-013 | `/organs` (mock) | Open the page | Page renders `mockOrgans` with no errors | Behavior implemented | No |
| 57 | OL-013 | `/organs` (live) | Leave the page open as an organ's time passes | The countdown ticks. After a reload the organ shows EXPIRED | Behavior; Remaining risks | No |
| 58 | OL-014 | `/matching` (live) | Open the page | The organ dropdown is filled from `/api/organs`. The latest saved run for the selected organ loads automatically | Behavior implemented | No |
| 59 | OL-014 | `/matching` (live) | Open the organ dropdown | Expired and non-available organs are listed, greyed out and disabled | Behavior implemented | No |
| 60 | OL-014 | `/matching` (live) | Select an organ | Four sliders (including Waiting Time) are preset to that organ's regional `defaultWeights` | Behavior implemented | No |
| 61 | OL-014 | `/matching` (live) | Change to another organ | Sliders reset to that organ's default weights and its latest run loads | Behavior implemented | No |
| 62 | OL-014 | `/matching` (live) | Click Run Match | A new run is created and a label "Run #MR-NNNN at HH:MM" shows. The ranked list appears with scores | Behavior; Acceptance criteria | No |
| 63 | OL-014 | `/matching` (live) | Click Re-run Match | A new run id is created and the label updates. The earlier run is still stored | Behavior; Acceptance criteria | No |
| 64 | OL-014 | `/matching` (live) | Drag the sliders to different values, then Run Match | The run uses the chosen weights and the ranking and scores change accordingly | Behavior implemented | No |
| 65 | OL-014 | `/matching` (live) | Set all four sliders to maximum and run | All scores stay within 0 to 100 | Acceptance criteria | No |
| 66 | OL-014 | `/matching` (live) | Set all four sliders to 0 | Run Match and Re-run Match are disabled | Behavior implemented | No |
| 67 | OL-014 | `/matching` (live) | Expand the Excluded accordion | Excluded candidates show a code and a description. ABO_INCOMPATIBLE and SIZE_MISMATCH appear on the seed data | Behavior; Acceptance criteria | No |
| 68 | OL-014 | `/matching` (live) | Look at the candidate cards | They show scores only. HLA details, urgency tier and body size are no longer shown | Remaining risks | No |
| 69 | OL-014 | `/matching` (live) | Reopen the page after a run that used non-default weights | Sliders show the organ's defaults, not the saved run's weights (known behaviour) | Remaining risks | No |
| 70 | OL-014 | `/matching` (live) | Click Create Offer on a candidate | Navigates to `/offers` as before (real create is OL-015) | Remaining risks | No |
| 71 | OL-014 | `/matching` (live) | Select an organ that has expired since the page loaded and run | Run is created with 0 qualified and all excluded (`VIABILITY_UNREACHABLE`), with no crash | Behavior implemented; Tests | No |
| 72 | OL-014 | `/matching` (mock) | Select an organ, move sliders, Run Match and Re-run | The mock ranker returns the same shape, with scores in 0 to 100 and a run label | Behavior implemented | No |
| 73 | OL-014 | `/matching` (live) | Stop the API and click Run Match | An error notification with the server or network message appears and the page stays usable | Behavior (implied by the API error path) | No |

## Items that are not user-visible and are excluded

OL-001 (schema, seed, hash), OL-003 (error translation, `withTx`) and the server endpoints in OL-006 and OL-011 to OL-014 are covered by API tests and are not repeated here, apart from rows 1 and 5.
