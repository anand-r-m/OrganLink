# OrganLink — Implementation Backlog

Tasks are in dependency order: a task's dependencies always appear above it. Assumption IDs (A1…A17) and decision IDs (OL-DEC-0x) refer to `AUDIT_NOTES.md`. Endpoint shapes are in `API_CONTRACT.md`.

**Conventions**
- *Owner* says "TBA" with the owner suggested by `dev_split.md` page ownership (A16).
- *Live mode* means `VITE_DATA_SOURCE=api`.
- *Mock mode* means the flag is unset. Mock mode must keep working after every task.
- *DB tests* are psql scripts or queries.
- *API tests* are `curl` commands, or the smoke script once it exists (OL-019).
- *UI checks* are done manually in the browser.

---

## Decision gates

These are human decisions. None of them blocks Phase 1 tasks OL-001 to OL-004. Each one blocks the tasks that list it as a dependency.

### OL-DEC-01 — Decide API response shape strategy

- Status: **RESOLVED 2026-10-04 — Option B (schema-shaped API + frontend adapters).**

- Phase: gate
- Owner: TBA (whole team)
- Dependencies: none
- Scope: Choose between a mock-shaped API (Option A) and a schema-shaped API with frontend adapters (Option B). The options are set out in AUDIT_NOTES → OL-DEC-01. Recommended: B.
- Acceptance criteria:
  - The decision and date are recorded under OL-DEC-01 in `AUDIT_NOTES.md`.
  - The "Pending decision OL-DEC-01" banner in `API_CONTRACT.md` is removed, or the shapes are rewritten if A is chosen.
  - All three devs have read the conventions section of `API_CONTRACT.md`.
- Required tests:
  - DB tests: n/a
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `docs/implementation/AUDIT_NOTES.md`, `docs/implementation/API_CONTRACT.md`
- Demo steps:
  - Show the recorded decision in AUDIT_NOTES.

### OL-DEC-02 — Decide in-transit expiry handling

- Status: **RESOLVED 2026-10-04 — Option A (documented limitation; schema unchanged; no OL-001b).**

- Phase: gate
- Owner: TBA (whole team)
- Dependencies: none
- Scope: Choose between documenting the gap (Option A) and patching the DB copy of the sweep and transplant trigger (Option B). See AUDIT_NOTES → OL-DEC-02. Recommended: A.
- Acceptance criteria:
  - The decision is recorded in `AUDIT_NOTES.md`.
  - If B is chosen, a task OL-001b ("Patch sweep for allocated organs") is added after OL-001, and OL-017 and OL-018 list it as a dependency.
  - The transport and transplant error cases in `API_CONTRACT.md` are updated to match.
- Required tests:
  - DB tests: n/a. If B is chosen, OL-001b carries the tests.
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `docs/implementation/AUDIT_NOTES.md`, `docs/implementation/API_CONTRACT.md`, `docs/implementation/BACKLOG.md`
- Demo steps:
  - Show the recorded decision.

### OL-DEC-03 — Decide demo bar (all-live vs mixed)

- Status: **RESOLVED 2026-10-04 — Option B (mixed mock/live), core allocation flow fully live.** MUST: OL-020 to OL-023. STRETCH: OL-024 to OL-028.

- Phase: gate
- Owner: TBA (whole team)
- Dependencies: none
- Scope: Decide whether every screen must be live for the demo (Option A) or whether Settings, Reports, and Dashboard may stay mock behind the flag (Option B). See AUDIT_NOTES → OL-DEC-03. Recommended: B as the floor, A as the target.
- Acceptance criteria:
  - The decision is recorded in `AUDIT_NOTES.md`.
  - Phase 3 tasks are tagged MUST or STRETCH in this file.
- Required tests:
  - DB tests: n/a
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `docs/implementation/AUDIT_NOTES.md`, `docs/implementation/BACKLOG.md`
- Demo steps:
  - Show the tagged Phase 3 list.

---

## Phase 1: Foundation

These are sequential setup tasks that must be done before anyone else can work.

### OL-001 — Database bootstrap and reset script

- Phase: 1
- Owner: TBA (suggested: Dev1)
- Dependencies: none
- Scope: Copy `docs/context/01_schema.sql` and `02_seed_reference.sql` into `db/` without edits. The only allowed change is the admin hash, per A8. Add `scripts/db-reset.sh` and the npm script `db:reset`:
  - drop and recreate the database `organlink` (connection taken from `DATABASE_URL`, defaulting to the local socket)
  - load `db/01_schema.sql`, `db/02_seed_reference.sql`, and `db/03_seed_demo.sql` if present
  - stop on the first error (`psql -v ON_ERROR_STOP=1`)

  Then run `docs/context/09_verification_tests.sql` against a freshly reset DB, and reset again afterwards (A13).
- Acceptance criteria:
  - `npm run db:reset` finishes in under 10 s and exits with code 0.
  - Afterwards: `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'` returns 24, and the views count is 8.
  - `SELECT count(*) FROM blood_compatibility WHERE compatible` returns 27.
  - The 09 script prints `PASS` for sections 3, 4, 5, 7 and 10, and no `FAIL` anywhere.
  - Admin hash verified: `node -e "require('bcryptjs').compareSync('admin', '<hash>')"` prints `true`. If it doesn't, the hash is regenerated in `db/` and the change is noted in AUDIT_NOTES A8.
- Required tests:
  - DB tests: the counts above; `psql -f docs/context/09_verification_tests.sql` on a fresh DB.
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `db/01_schema.sql`, `db/02_seed_reference.sql`, `scripts/db-reset.sh`, `package.json` (scripts; `bcryptjs` as a devDependency for the check), `.env.example`
- Demo steps:
  - Run `npm run db:reset`.
  - Run `psql organlink -c "\dt"` and see 24 tables.
  - Run 09 and see a PASS line for each rule.

### OL-002 — Express server skeleton and DB pool

- Phase: 1
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-001
- Scope: Add an Express 4 server in `server/` (plain JS ESM, to match the repo). It needs:
  - a `pg` Pool configured from `DATABASE_URL`
  - `pg.types` parsers so INT8 (20) and NUMERIC (1700) come back as JS numbers (A12)
  - a `toCamel(row)` helper that maps snake_case to camelCase
  - `GET /api/health`, which runs `SELECT 1`

  Add a Vite dev proxy from `/api` to `http://localhost:3001`, and make `npm run dev` start both Vite and Express through `concurrently`.
- Acceptance criteria:
  - `npm run dev` starts both processes, and `curl localhost:5173/api/health` returns `{"status":"ok","db":"ok"}`.
  - When Postgres is stopped, `/api/health` returns 503 with the standard error envelope.
  - `SELECT 1::bigint, 1.50::numeric` through the pool returns JS numbers, not strings.
- Required tests:
  - DB tests: n/a
  - API tests: `curl` health with Postgres up and with it down.
  - UI checks: the existing app still loads in mock mode on :5173.
- Files likely affected:
  - `server/index.js`, `server/db.js`, `server/util/case.js`, `vite.config.js`, `package.json`
- Demo steps:
  - Run `npm run dev`.
  - Open `localhost:5173/api/health`.
  - Open `localhost:5173/dashboard` and see it unchanged.

### OL-003 — Transaction helper and error translation

- Phase: 1
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-002
- Scope: Add `withTx(userId, fn, { sweep })`, which follows 05_tdd.md §6:
  1. If `sweep` is set, run `SELECT expire_stale_offers()` before the transaction.
  2. `BEGIN`.
  3. `SELECT set_config('app.user_id', $1::text, true)` (A1).
  4. Run `fn(client)`.
  5. `COMMIT`, or `ROLLBACK` on error.
  6. Release the client.

  Also add `translatePgError(e)`, which implements the API_CONTRACT error table (SQLSTATE plus constraint name → HTTP status and code), and an Express error middleware that emits `{error:{code,message,details}}`.
- Acceptance criteria:
  - A test route that inserts a second CREATED offer on the same organ returns 409 `ACTIVE_OFFER_EXISTS`.
  - Inserting an ABO-incompatible offer returns 422 `RULE_VIOLATION`, with the trigger message verbatim.
  - After a write through `withTx(1, …)`, the newest `audit_log` row has `user_id = 1`.
  - Unknown errors return 500 `INTERNAL`, and the stack trace isn't leaked in the response.
- Required tests:
  - DB tests: `SELECT user_id FROM audit_log ORDER BY audit_id DESC LIMIT 1` after a test write.
  - API tests: a temporary `/api/__test/*` route (deleted at the end of this task) or a node script that calls `withTx` directly.
  - UI checks: n/a
- Files likely affected:
  - `server/db.js`, `server/errors.js`, `server/index.js`
- Demo steps:
  - Run the script that triggers the 409 and 422 errors and show the JSON envelopes.
  - Show `audit_log.user_id` populated.

### OL-004 — Authentication and session

- Phase: 1
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-003
- Scope: Implement `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`, using `express-session` with the in-memory store (05_tdd.md §1) and `bcryptjs` to check against `app_user.password_hash`. Add a `requireAuth` middleware on every `/api/*` route except `login` and `health`; it exposes `req.user.id` for `withTx`. In live mode `AuthContext` calls these endpoints; in mock mode it keeps the hardcoded admin/admin.
- Acceptance criteria:
  - admin/admin returns 200 `{user:{id:1,username:"admin",role:"ADMIN"}}` and sets an httpOnly `connect.sid` cookie.
  - A wrong password returns 401 `INVALID_CREDENTIALS`, and the login card shakes (the existing behaviour).
  - `GET /api/auth/me` without a cookie returns 401 `UNAUTHENTICATED`. With a cookie it returns the user.
  - After logout, `/me` returns 401. In live mode, a page refresh while logged in stays logged in (verified through `/me`).
- Required tests:
  - DB tests: n/a
  - API tests: `curl -c jar` login, then `-b jar` `/me`, then logout, then `/me` again (expect 401).
  - UI checks: log in and out in live mode; bad credentials show an error; mock mode is unchanged.
- Files likely affected:
  - `server/routes/auth.js`, `server/middleware/requireAuth.js`, `server/index.js`, `src/context/AuthContext.jsx`, `src/api/client.js` (minimal)
- Demo steps:
  - Start with `VITE_DATA_SOURCE=api npm run dev`.
  - Log in as admin/admin and land on the dashboard.
  - Log out, then visit `/dashboard` and get redirected to login.

### OL-005 — Frontend API client, mock/live switch, first live resource

- Phase: 1
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-004, OL-DEC-01
- Scope: Build the pattern that every later page task copies:
  - `src/api/client.js`: fetch wrapper with `credentials: 'include'` that parses the error envelope into a thrown `ApiError(code, message, details)`
  - `src/api/<resource>.js` modules, each exporting functions that return mock data or call the API depending on `import.meta.env.VITE_DATA_SOURCE === 'api'` (05 §7)
  - `src/api/adapters/<resource>.js`, which map API rows to the existing component props (if OL-DEC-01 = B)
  - `src/utils/displayId.js` (A11, U5)

  Implement `GET /api/hospitals` and `GET /api/lookups` (A5, Proposed), and wire the Settings → Hospitals tab table to the hospitals module.
- Acceptance criteria:
  - In live mode the Hospitals tab shows the hospitals from the DB. In mock mode it shows `mockHospitals`.
  - `GET /api/lookups` returns blood groups (8), urgencies (3), decline reasons (6), discard reasons (6), exclusion reasons (5), and organ types (5).
  - An API error shows a Mantine notification containing the server's `message`.
  - No page other than Settings → Hospitals changes behaviour.
- Required tests:
  - DB tests: n/a
  - API tests: `curl -b jar /api/hospitals` and `/api/lookups`; without the cookie, expect 401.
  - UI checks: toggle the env flag, restart, and compare the Hospitals tab in both modes.
- Files likely affected:
  - `src/api/client.js`, `src/api/hospitals.js`, `src/api/lookups.js`, `src/api/adapters/hospitals.js`, `src/utils/displayId.js`, `src/pages/SettingsPage.jsx`, `server/routes/hospitals.js`, `server/routes/lookups.js`, `.env.example`
- Demo steps:
  - Run in mock mode and show the Hospitals tab.
  - Restart with `VITE_DATA_SOURCE=api` and show the DB hospitals.
  - Run `psql -c "UPDATE hospital SET name=name||' *' WHERE hospital_id=1"`, refresh, and see the change.

### OL-006 — Minimal demo seed (v1)

- Phase: 1
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-001
- Scope: Create `db/03_seed_demo.sql` with present-day data for the Phase 2 slice:
  - the 8 mock hospitals with real coordinates, mapped onto SR/WR/NR/ER (A9)
  - about 10 donors (mix of LIVING and DECEASED, each with 6 HLA alleles)
  - about 20 recipients with 22 or more waitlist entries, including at least one kidney+pancreas recipient, listed 1–24 months ago
  - 3 AVAILABLE organs recovered 0.5–2 h ago (Heart, Liver, Kidney), each with at least 3 qualifying candidates

  Inserts go through the triggers (no replica mode in this file version).
- Acceptance criteria:
  - `npm run db:reset` loads all three files with no errors.
  - `SELECT match_candidates(<each available organ>)` produces at least 3 qualified and at least 1 excluded result.
  - At least one recipient has 2 ACTIVE waitlist entries.
  - The admin user and reference data are unchanged.
- Required tests:
  - DB tests: the queries above; `SELECT count(*) FROM v_organ WHERE status='AVAILABLE' AND NOT is_expired` returns at least 3 right after reset.
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `db/03_seed_demo.sql`
- Demo steps:
  - Run `npm run db:reset`.
  - Run `psql -c "SELECT * FROM v_organ"` and see 3 available organs with `hours_remaining`.
  - Run one `match_candidates` and list its results.

---

## Phase 2: Core workflow slice

> Procure organ → match → create/send/accept offer → deliver → transplant, plus the 07_design_brief.md §7 changes that this path touches.

### OL-010 — StatusBadge: new states and spec colours

- Phase: 2
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-DEC-01
- Scope: Extend `StatusBadge` so it maps the schema's UPPER_SNAKE states and fix the colours to match 07_design_brief.md §4:
  - green: ACCEPTED, DELIVERED, TRANSPLANTED, ACTIVE
  - amber: SENT, IN_TRANSIT, PENDING, 1B
  - red: DECLINED, FAILED, EXPIRED, 1A
  - blue: CREATED, ALLOCATED, 2
  - grey: VOIDED, CANCELLED, DISCARDED, SUSPENDED, INACTIVE

  Add a label formatter (`IN_TRANSIT` → "In Transit"). Existing Title Case mock values must still render.
- Acceptance criteria:
  - Each state above renders its colour and a readable label.
  - EXPIRED is red and SUSPENDED is grey; this is a change from the current behaviour.
  - The `__phase0-smoke` page still renders every mock badge.
- Required tests:
  - DB tests: n/a
  - API tests: n/a
  - UI checks: add every status to `Phase0SmokePage` temporarily or permanently and check each one visually.
- Files likely affected:
  - `src/components/StatusBadge.jsx`, `src/index.css` (only if a grey or red class is missing), `src/pages/Phase0SmokePage.jsx`
- Demo steps:
  - Open `/__phase0-smoke` and walk through the badge grid.

### OL-011 — Donors read: registry and drawer live

- Phase: 2
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-005, OL-006, OL-010
- Scope: Implement `GET /api/donors` (filters `status`, `type`, `hospital`) and `GET /api/donors/:id` (donor plus HLA plus organs, with the sweep). Wire the Donor Registry table and detail drawer through the `donors` API module and adapter. Split the single badge into a **Type** badge (Living/Deceased) and a **Status** badge (Active/Inactive) in the table and drawer (07 §7). The drawer lists the donor's organs with their status.
- Acceptance criteria:
  - In live mode the table shows the seed donors with `D-00NN` IDs, and the type and status columns are separate.
  - Each filter narrows results server-side; the query string is visible in the network tab.
  - The drawer shows the 6 HLA alleles grouped by locus, plus an organs list (empty for donors with no organs).
  - Mock mode still works.
- Required tests:
  - DB tests: n/a
  - API tests: `curl /api/donors?type=DECEASED` returns only deceased donors; `/api/donors/99999` returns 404 `DONOR_NOT_FOUND`.
  - UI checks: table, filters, and drawer in both modes.
- Files likely affected:
  - `server/routes/donors.js`, `src/api/donors.js`, `src/api/adapters/donors.js`, `src/pages/DonorRegistryPage.jsx`
- Demo steps:
  - Open `/donors` in live mode.
  - Filter Type = Deceased.
  - Open a donor and show the HLA alleles and organs.

### OL-012 — Procure Organ (endpoint and drawer modal)

- Phase: 2
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-011
- Scope: Implement `POST /api/donors/:id/organs`, which inserts into `organ` inside `withTx`. Add a **Procure Organ** button in the donor drawer that opens a `FormModal` with:
  - organ type (from lookups)
  - recovering hospital (defaulting to the donor's hospital)
  - recovery timestamp (date and time picker, defaulting to now, future values rejected)

  On success, show a toast, refresh the drawer's organ list, and show the new organ with its viability countdown (06 Stage 2; 07 §7).
- Acceptance criteria:
  - Procuring a Kidney with recovery 1 h ago creates an AVAILABLE organ whose `hoursRemaining` is about 29.
  - A future timestamp returns 400 `CONSTRAINT_VIOLATION` (`ck_organ_not_future`) and the modal shows the message.
  - An `audit_log` row is written with `table_name='organ'` and `user_id=1`.
- Required tests:
  - DB tests: `SELECT status FROM organ ORDER BY organ_id DESC LIMIT 1` returns AVAILABLE; check the audit row.
  - API tests: `curl -X POST /api/donors/1/organs` with a valid body (201) and with a future `recoveredAt` (400).
  - UI checks: open the modal, validate, submit, see the toast, see the organ in the drawer.
- Files likely affected:
  - `server/routes/donors.js`, `src/api/donors.js`, `src/pages/DonorRegistryPage.jsx` (or a new `src/components/ProcureOrganModal.jsx`)
- Demo steps:
  - Open a donor.
  - Click Procure Organ, choose Heart, recovery = now.
  - See the organ listed with a 6 h countdown.

### OL-013 — Organs read and Organs page

- Phase: 2
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-005, OL-006, OL-010
- Scope: Implement `GET /api/organs` (`status`, `available`, `organTypeId`) and `GET /api/organs/:id` from `v_organ`, with the sweep. Add a new `/organs` route and nav item (A10) with a `DataTable` showing ID, type, donor, blood group, recovering hospital, recovery time, `ViabilityCountdown`, status, and active-offer indicator. The Discard action is added later in OL-023.
- Acceptance criteria:
  - The table lists every organ. Expired organs show the EXPIRED badge rather than disappearing (06 Stage 3).
  - The countdown reflects `expiresAt`, and the red pulse appears under 1 h (existing component).
  - `?available=true` returns only AVAILABLE organs that aren't expired.
  - The nav shows "Organs" between Recipients and Matching.
- Required tests:
  - DB tests: back-date an organ (`UPDATE organ SET recovered_at = now() - interval '40 hours' WHERE …` on a Kidney), call the API, and confirm the status is now EXPIRED because of the sweep.
  - API tests: `curl /api/organs?available=true`; `/api/organs/99999` returns 404 `ORGAN_NOT_FOUND`.
  - UI checks: the page renders in both modes; in mock mode it uses `mockOrgans`.
- Files likely affected:
  - `server/routes/organs.js`, `src/api/organs.js`, `src/api/adapters/organs.js`, `src/pages/OrgansPage.jsx` (new), `src/App.jsx`, `src/components/AppShell.jsx`
- Demo steps:
  - Open `/organs`.
  - Point out the countdowns.
  - Back-date one organ in psql, refresh, and see it flip to EXPIRED.

### OL-014 — Matching runs and console

- Phase: 2
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-013
- Scope: Implement `POST /api/matching/runs` (calls `match_candidates` inside `withTx`, with the sweep), `GET /api/matching/runs/:id`, and `GET /api/organs/:id/runs`. Matching Console changes:
  - The organ dropdown comes from `/api/organs`. Expired organs are listed but greyed out and disabled (06 Stage 3).
  - Sliders preset to the organ's `defaultWeights`.
  - A **fourth slider (Waiting Time)** is added.
  - Run Match shows the ranked qualified list and a collapsible Excluded list with reason labels.
  - A **"Run #MR-NNNN at HH:MM"** timestamp is shown, with a **Re-run Match** button that creates a new run (U8; 07 §7).
  - The page loads the latest saved run for the selected organ on open.
- Acceptance criteria:
  - Running with default weights produces ranks that match `SELECT … FROM match_result WHERE run_id = …` in the same order.
  - Re-running produces a new run ID, and the old run is still retrievable through `GET /api/matching/runs/:oldId`.
  - Setting all four sliders to maximum keeps every score between 0 and 100.
  - Excluded candidates show `ABO_INCOMPATIBLE`, `SIZE_MISMATCH`, and other codes with their descriptions.
  - `match_run.run_by` is 1.
- Required tests:
  - DB tests: `SELECT count(*) FROM match_run WHERE organ_id = X` increases by 1 on each run; check `run_by`.
  - API tests: POST without weights uses the regional defaults (compare against the `region` row). POST on an expired organ returns 201 with 0 qualified results, all `VIABILITY_UNREACHABLE`, because `match_candidates` doesn't reject expired organs; the UI prevents this by disabling expired organs.
  - UI checks: 4 sliders, timestamp, Re-run, staggered cards (existing behaviour), excluded section.
- Files likely affected:
  - `server/routes/matching.js`, `server/routes/organs.js`, `src/api/matching.js`, `src/api/adapters/matching.js`, `src/pages/MatchingConsolePage.jsx`
- Demo steps:
  - Choose the Heart organ and run the match.
  - Show the ranked list and excluded reasons.
  - Move the Waiting Time slider, click Re-run, and show the new run number and timestamp.

### OL-015 — Offers: list, create, send, cancel

- Phase: 2
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-014
- Scope: Implement:
  - `GET /api/offers` (`status` filter, from `v_offer`, with the sweep)
  - `GET /api/offers/:id` (Proposed)
  - `POST /api/offers` with `{organId, recipientId, matchRunId}`, which locks the organ `FOR UPDATE` and inserts
  - `POST /api/offers/:id/send` and `POST /api/offers/:id/cancel`, as conditional updates (A2)

  In the Matching Console, add **Create Offer** on a candidate card. When the organ already has an open offer, the button is disabled and its tooltip says "This organ already has an active offer" (07 §6). Wire the Offer Workflow page list and Send action to the API.
- Acceptance criteria:
  - Creating an offer for rank 1 shows it as CREATED on `/offers`. Send changes it to SENT, sets `sentAt`, and shows `offerExpiresAt`.
  - A second create on the same organ returns 409 `ACTIVE_OFFER_EXISTS`, and the UI disables the button with the tooltip.
  - Sending a non-CREATED offer returns 409 `INVALID_STATE_TRANSITION`.
  - Cancel moves a CREATED or SENT offer to CANCELLED (grey badge), after which a new offer can be created.
- Required tests:
  - DB tests: `SELECT status, sent_at FROM organ_offer WHERE offer_id = …` after each step.
  - API tests: run create → create again (409) → send → send again (409) → cancel with curl.
  - UI checks: the disabled button tooltip, badge colours, and toasts.
- Files likely affected:
  - `server/routes/offers.js`, `src/api/offers.js`, `src/api/adapters/offers.js`, `src/pages/MatchingConsolePage.jsx`, `src/pages/OfferWorkflowPage.jsx`, `src/utils/offerTransitions.js` (mock mode only)
- Demo steps:
  - In the console, click Create Offer on rank 1, then try rank 2 and see the disabled button and tooltip.
  - On `/offers`, send the offer and see SENT with its deadline.

### OL-016 — Offers: accept, decline, advance

- Phase: 2
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-015
- Scope: Implement `POST /api/offers/:id/accept`, `/decline` (`{declineReasonId, notes}`), and `/advance`.
  - Accept and decline are conditional on SENT (A2) and lock the organ.
  - Advance walks down the ranks of the same run under SAVEPOINTs and returns `{offer, skipped}` (U1, A4).

  UI changes:
  - "Record Accept" now only records acceptance. The "transplant scheduled" text is removed, and the toast says "Accepted: organ allocated, transport created" (07 §7).
  - The decline modal uses the coded reasons from lookups.
  - Advance to Next calls the API and shows the skipped ranks with their reasons.
  - VOIDED and CANCELLED badges render in grey.
- Acceptance criteria:
  - After accept, the offer is ACCEPTED, the organ is ALLOCATED, and a transport record exists (PENDING, or DELIVERED for a same-hospital transfer, per 06 Stage 6).
  - After decline, the offer is DECLINED with its reason. Advance creates a CREATED offer for the next eligible rank and lists any skipped ranks.
  - Creating an offer for the recipient who declined returns 409 `RECIPIENT_ALREADY_DECLINED`.
  - Accepting after the organ has expired (back-dated in psql) returns 409 `INVALID_STATE_TRANSITION` with `details.currentStatus = "VOIDED"`, because the sweep voided the offer first.
  - Advance with no eligible candidate returns 422 `NO_ELIGIBLE_CANDIDATE`.
- Required tests:
  - DB tests: `SELECT status FROM organ WHERE …`; `SELECT status FROM transport_record WHERE organ_id = …`; `SELECT count(*) FROM organ_offer WHERE organ_id = … AND status IN ('CREATED','SENT')` is at most 1 at every step.
  - API tests: run decline → advance → send → accept with curl; also the expired-accept case and the re-offer case.
  - UI checks: modal texts, reason dropdown, skipped list, and badge colours.
- Files likely affected:
  - `server/routes/offers.js`, `src/api/offers.js`, `src/pages/OfferWorkflowPage.jsx`
- Demo steps:
  - Decline the SENT offer with reason ORGAN_QUALITY.
  - Click Advance to Next and see the rank 2 offer created.
  - Send and accept it, then show the organ ALLOCATED on `/organs`.

### OL-017 — Transport: list, depart, deliver

- Phase: 2
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-016, OL-DEC-02
- Scope: Implement `GET /api/transport` (with the sweep), `POST /api/transport/:id/depart` (PENDING → IN_TRANSIT, sets `departed_at`), and `POST /api/transport/:id/deliver` (IN_TRANSIT → DELIVERED, sets `arrived_at`) (A2). Wire the Transport page and map to the API. Add the **Mark In Transit** and **Mark Delivered** buttons, each behind a confirmation modal (07 §1, §7). The countdown uses the organ's `expiresAt`, not a separate clock (06 Stage 6).
- Acceptance criteria:
  - The transport created by OL-016 shows PENDING with origin and destination markers on the map.
  - Mark In Transit and then Mark Delivered move the status forward, and each timestamp is shown.
  - Repeating an action, or skipping one, returns 409 `INVALID_STATE_TRANSITION`, and the button is hidden for invalid states.
  - Behaviour on expiry while in transit follows OL-DEC-02 (A: documented as a limitation; B: FAILED).
- Required tests:
  - DB tests: `SELECT status, departed_at, arrived_at FROM transport_record WHERE …` after each step.
  - API tests: run depart → depart (409) → deliver with curl.
  - UI checks: map renders, buttons appear by status, modals, toasts.
- Files likely affected:
  - `server/routes/transport.js`, `src/api/transport.js`, `src/api/adapters/transport.js`, `src/pages/TransportPage.jsx`, `src/components/TransportMap.jsx`
- Demo steps:
  - Open `/transport` and see the new PENDING row on the map.
  - Click Mark In Transit, then Mark Delivered.

### OL-018 — Record Transplant

- Phase: 2
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-017, OL-DEC-02
- Scope: Implement `POST /api/transplants` with `{offerId, outcome, transplantAt?, hospitalId?, notes?}` (A3). On `/offers`, ACCEPTED offers get a **Record Transplant** action that opens a modal with the outcome (Success / Failed / Organ Not Used), timestamp, and notes (07 §7). The action is disabled until transport is DELIVERED, with the tooltip "Organ has not been delivered yet" (07 §6). The offers list embeds `transplant` once one is recorded.
- Acceptance criteria:
  - Recording before delivery returns 422 `RULE_VIOLATION` with the trigger message, and the UI also shows the action as disabled.
  - A SUCCESS outcome makes the organ TRANSPLANTED and the waitlist entry for **that organ type only** TRANSPLANTED. The recipient's other entries stay ACTIVE (BR-14).
  - A FAILED or ORGAN_NOT_USED outcome makes the organ DISCARDED (`TRANSPLANT_FAILED`) and the entry REMOVED.
  - Recording twice returns 409 `TRANSPLANT_ALREADY_RECORDED`.
- Required tests:
  - DB tests: organ and waitlist statuses after each outcome; a multi-organ recipient keeps the other entry ACTIVE.
  - API tests: run before delivery (422) → after delivery (201) → again (409) with curl.
  - UI checks: disabled tooltip, modal, toast, and the offer row showing the outcome.
- Files likely affected:
  - `server/routes/transplants.js`, `server/routes/offers.js` (embed), `src/api/transplants.js`, `src/pages/OfferWorkflowPage.jsx`
- Demo steps:
  - On the accepted offer, show Record Transplant disabled before delivery.
  - Deliver the organ on `/transport`, record SUCCESS, and see the organ TRANSPLANTED on `/organs`.

### OL-019 — Core slice smoke script

- Phase: 2
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-012, OL-018
- Scope: Write `scripts/smoke-flow.sh`, which uses curl and jq against a freshly reset DB:
  1. login
  2. procure
  3. match
  4. create, send, and decline the first offer
  5. advance, send, and accept the next offer
  6. depart, then deliver
  7. record the transplant

  It asserts the HTTP status and resulting entity status at each step and exits non-zero on the first mismatch. This becomes the regression check for every later task.
- Acceptance criteria:
  - `npm run db:reset && npm run smoke` passes end to end in under 30 s.
  - It prints one line per step: `PASS step-name`.
  - It also asserts the two negative cases: second active offer (409) and transplant before delivery (422).
- Required tests:
  - DB tests: indirect.
  - API tests: this script.
  - UI checks: n/a
- Files likely affected:
  - `scripts/smoke-flow.sh`, `package.json`
- Demo steps:
  - Run `npm run db:reset && npm run smoke` and show the PASS lines.

---

## Phase 3: Parallel features

These tasks are independent once Phases 1 and 2 are done. OL-DEC-03 tags each one MUST or STRETCH.

### OL-020 — Donor create and update (type/status split form)

- Phase: 3
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-011
- Scope: Implement `POST /api/donors` and `PATCH /api/donors/:id`, which replace the HLA set inside the transaction. The form gains a Donor Type select (Living/Deceased), a separate Status select, death date and cause shown only for Deceased (BR-1), up to 2 alleles per locus picked from lookups, and height and weight. Remove the organ-type field from the form (U3). Deactivate becomes `PATCH {status:'INACTIVE'}`.
- Acceptance criteria:
  - Creating a deceased donor without a death date returns 400 `CONSTRAINT_VIOLATION` (`ck_donor_death_fields`), and the form shows the message.
  - A living donor submitted with a death cause is also rejected.
  - An edit that changes HLA alleles is reflected in the drawer, and `audit_log` has an UPDATE row.
- Required tests:
  - DB tests: `donor_hla` rows after a PATCH equal the submitted set.
  - API tests: run create living (201) → create deceased without a date (400) → patch status with curl.
  - UI checks: conditional fields, validation, toasts.
- Files likely affected:
  - `server/routes/donors.js`, `src/pages/DonorRegistryPage.jsx`, `src/api/donors.js`
- Demo steps:
  - Register a deceased donor, see the death fields appear, and submit.
  - Edit the donor to Inactive and see the separate Status badge change.

### OL-021 — Recipients CRUD

- Phase: 3
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-005, OL-006, OL-010
- Scope: Implement `GET /api/recipients` (filters `organ`, `bloodGroup`, `urgency`, `status`), `GET /api/recipients/:id` (with HLA and waitlist entries), `POST /api/recipients` (optionally with initial waitlist entries in the same transaction), and `PATCH /api/recipients/:id`. Wire the Recipient page table, form, and drawer.
- Acceptance criteria:
  - The table lists recipients, and the drawer shows every waitlist entry.
  - Setting a recipient to INACTIVE while they have an open offer causes that offer to be VOIDED ("Recipient no longer active") on the next request that runs the sweep (06 failure paths).
  - The filters work server-side.
- Required tests:
  - DB tests: offer status after the deactivate-then-sweep sequence.
  - API tests: create → get → patch with curl; `?bloodGroup=A%2B` filter.
  - UI checks: form validation, drawer, both modes.
- Files likely affected:
  - `server/routes/recipients.js`, `src/api/recipients.js`, `src/api/adapters/recipients.js`, `src/pages/RecipientWaitlistPage.jsx`
- Demo steps:
  - Register a recipient with Kidney and Pancreas entries.
  - Open the drawer and see both entries.

### OL-022 — Waitlist and priority score

- Phase: 3
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-021
- Scope: Implement `GET /api/waitlist` (from `v_waitlist_scored`), `POST /api/waitlist`, and `PATCH /api/waitlist/:recipientId/:organTypeId` (urgency, status, listed date). The Recipients page shows one row per waitlist entry (or a grouped view) with the **priority score**. Its tooltip breaks the score down into urgency and waiting time **only** (06 secondary flows; 08 §7).
- Acceptance criteria:
  - The priority score matches `v_waitlist_scored.priority_score` to 2 decimal places.
  - The tooltip shows two components and no HLA or distance.
  - Changing urgency from 2 to 1A raises the score immediately.
  - A future `listedDate` returns 400 (`ck_waitlist_not_future`).
  - A duplicate (recipient, organ type) entry returns 409 `DUPLICATE`.
- Required tests:
  - DB tests: compare API values against the view.
  - API tests: post → patch → duplicate post with curl.
  - UI checks: tooltip content, filters by organ, blood group, urgency, and status.
- Files likely affected:
  - `server/routes/waitlist.js`, `src/api/waitlist.js`, `src/pages/RecipientWaitlistPage.jsx`
- Demo steps:
  - Hover a priority score to see its breakdown.
  - Change urgency to 1A and see the score rise.

### OL-023 — Organ discard

- Phase: 3
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-013
- Scope: Implement `POST /api/organs/:id/discard` with `{discardReasonId}`. It's allowed only from AVAILABLE or EXPIRED and only with no open offer (A17). Add a Discard action on the Organs page that opens a modal with the coded reasons (06 "candidate chain runs out").
- Acceptance criteria:
  - Discarding an EXPIRED organ with VIABILITY_ELAPSED makes it DISCARDED with that reason.
  - Discarding an organ with an open offer returns 409 `ACTIVE_OFFER_EXISTS`.
  - Discarding a TRANSPLANTED organ returns 409 `INVALID_STATE_TRANSITION`.
  - The button is hidden for terminal states.
- Required tests:
  - DB tests: `status` and `discard_reason_id` after a discard.
  - API tests: the three cases above with curl.
  - UI checks: modal, reasons, badge turns grey.
- Files likely affected:
  - `server/routes/organs.js`, `src/pages/OrgansPage.jsx`
- Demo steps:
  - Discard an expired organ and see the grey DISCARDED badge.

### OL-024 — Settings: hospitals, regions with policy weights, organ types

- Phase: 3
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-005
- Scope: Implement `POST` and `PATCH` for `/api/hospitals`, `GET`/`POST`/`PATCH` for `/api/regions` (including the 4 weights), and `GET`/`POST`/`PATCH` for `/api/organ-types`. The Policy Weights tab gets a **Region selector** and 4 sliders bound to the selected region (07 §7). The organ types tab shows viability hours, response window, and min/max weight ratio from the DB.
- Acceptance criteria:
  - Changing SR's weights is persisted, and the next match run on an SR-recovered organ uses them as defaults.
  - All-zero weights return 400 (`ck_region_weights_nonzero`).
  - Suspending a hospital shows a grey SUSPENDED badge.
  - The organ-type tab shows Kidney with 30 h viability, 6 h response window, and ratio 0.50–3.00.
- Required tests:
  - DB tests: the `region` row after PATCH; the `match_run` weights for the next default run.
  - API tests: PATCH region weights with valid values (200) and all zeros (400).
  - UI checks: region dropdown switches the slider values.
- Files likely affected:
  - `server/routes/hospitals.js`, `server/routes/regions.js`, `server/routes/organTypes.js`, `src/pages/SettingsPage.jsx`, `src/api/settings.js`
- Demo steps:
  - Open Settings → Policy Weights, select Northern Region, change HLA to 40, and save.
  - Run a match on an NR organ and see the new defaults.

### OL-025 — Settings: blood compatibility matrix and HLA alleles

- Phase: 3
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-005
- Scope: Implement `GET /api/blood-compatibility` and `PATCH /api/blood-compatibility` (one pair). Implement `GET`, `POST`, and `DELETE` on `/api/hla-alleles`. Render the 8×8 matrix from the DB. The HLA tab uses locus `DRB1`, and the description column is dropped.
- Acceptance criteria:
  - The matrix shows 27 compatible cells after reset.
  - Toggling a cell persists it and changes the ABO exclusions on the next match run.
  - Deleting an allele that a donor or recipient uses returns 409 `REFERENCE_IN_USE`.
  - Adding a duplicate (locus, name) returns 409 `DUPLICATE`.
- Required tests:
  - DB tests: `SELECT count(*) FROM blood_compatibility WHERE compatible`.
  - API tests: patch a pair, delete an in-use allele (409), add an allele (201).
  - UI checks: matrix toggles and allele CRUD.
- Files likely affected:
  - `server/routes/bloodCompatibility.js`, `server/routes/hlaAlleles.js`, `src/pages/SettingsPage.jsx`
- Demo steps:
  - Show the 8×8 grid.
  - Try to delete A*02:01 and see the "in use" message.

### OL-026 — Reports endpoints and charts

- Phase: 3
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-005, OL-006
- Scope: Implement `GET /api/reports/waiting-times`, `/utilization`, `/decline-reasons`, `/fairness`, and `/compliance`. Each maps 1:1 to its view and runs the sweep first. Re-bind the Reports charts:
  - waiting-time buckets are labelled from the view's 5-month buckets
  - fairness shows allocation rate, median wait, and retention per region instead of "actual vs expected" (C11)
  - utilization groups by region
- Acceptance criteria:
  - Each endpoint's output equals `SELECT * FROM <view>` with camelCase keys.
  - The charts render in live mode with the v1 seed, even if sparse; they fill out after OL-031.
  - The compliance headline shows `placementRatePct`.
- Required tests:
  - DB tests: row counts per view.
  - API tests: curl each endpoint.
  - UI checks: every chart renders with no console errors.
- Files likely affected:
  - `server/routes/reports.js`, `src/api/reports.js`, `src/pages/ReportsPage.jsx`
- Demo steps:
  - Open `/reports` in live mode and walk through the 4 charts and the compliance figure.

### OL-027 — Dashboard endpoint and page

- Phase: 3
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-026
- Scope: Implement `GET /api/dashboard` (Proposed shape; runs the sweep):
  - stat counts
  - critical alerts: organs with less than 2 h remaining and SENT offers within 1 h of expiry
  - a monthly transplant trend for the last 12 months
  - the 5 most recent offers

  Bind the Dashboard to it.
- Acceptance criteria:
  - The 4 StatCards match direct SQL counts.
  - An organ back-dated to 1 h of viability remaining appears as a red alert.
  - The trend has 12 points, and zero-filled months are included.
- Required tests:
  - DB tests: compare each stat against its SQL count.
  - API tests: curl and inspect the shape.
  - UI checks: the dashboard renders in both modes.
- Files likely affected:
  - `server/routes/dashboard.js`, `src/api/dashboard.js`, `src/pages/DashboardPage.jsx`
- Demo steps:
  - Open `/dashboard` and point out the live counts and alerts.

### OL-028 — Audit report PDF from live data

- Phase: 3
- Owner: TBA (suggested: Dev1)
- Dependencies: OL-026
- Scope: Feed `reportsAuditPdf.js` from the live endpoints (offers, decline reasons, fairness, compliance) instead of `mockOffers` (A6). Replace the "Expected allocation" column with `v_allocation_fairness` metrics. The server-side `audit.pdf` endpoint stays deferred.
- Acceptance criteria:
  - In live mode the exported PDF lists DB offers within the selected date range.
  - Its totals match the Reports page.
  - Mock mode still exports.
- Required tests:
  - DB tests: n/a
  - API tests: n/a, because it reuses existing endpoints.
  - UI checks: export in both modes and open the PDF.
- Files likely affected:
  - `src/pages/reportsAuditPdf.js`, `src/pages/ReportsPage.jsx`
- Demo steps:
  - Click Export Audit PDF and open the file to show the live offers.

---

## Phase 4: Hardening

### OL-030 — Concurrency proof (no double allocation)

- Phase: 4
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-016
- Scope: Write `scripts/concurrency.mjs`, which fires 10 parallel `POST /api/offers` requests for the same organ, to different eligible recipients. It then fires 2 parallel accepts on one SENT offer. This proves the `FOR UPDATE` lock plus `ux_offer_active` (05 §6; PRD §7). Note the sweep's lack of `SKIP LOCKED` if blocking is observed (A14).
- Acceptance criteria:
  - Exactly 1 of the 10 creates returns 201; the rest return 409 `ACTIVE_OFFER_EXISTS`.
  - Exactly 1 accept succeeds; the other returns 409.
  - Exactly one `transport_record` row exists for the organ.
- Required tests:
  - DB tests: `SELECT count(*) FROM organ_offer WHERE organ_id = X AND status IN ('CREATED','SENT','ACCEPTED')` returns 1.
  - API tests: the script.
  - UI checks: n/a
- Files likely affected:
  - `scripts/concurrency.mjs`, `package.json`
- Demo steps:
  - Run `node scripts/concurrency.mjs` and show "1 success, 9 conflicts".

### OL-031 — Historical demo seed (18–24 months)

- Phase: 4
- Owner: TBA (suggested: Dev2)
- Dependencies: OL-006, OL-019
- Scope: Extend `db/03_seed_demo.sql` with a historical block covering 18–24 months (08 §9), wrapped in `SET session_replication_role = replica` (A7):
  - organs across all regions and types
  - match runs and results
  - offers covering every terminal status, including DECLINED with spread reasons
  - transports
  - transplants with mixed outcomes
  - waitlist entries listed throughout the period

  Statuses must be internally consistent, because triggers are bypassed.
- Acceptance criteria:
  - After reset, every report view returns data for all 4 regions.
  - Waiting times populate at least 6 buckets.
  - The dashboard trend has non-zero values in at least 10 of 12 months.
  - The smoke script (OL-019) still passes after this seed.
  - A consistency query finds 0 violations: every TRANSPLANTED organ has an ACCEPTED offer, a DELIVERED transport, and a SUCCESS transplant.
- Required tests:
  - DB tests: the consistency query; row counts per view.
  - API tests: `npm run smoke`.
  - UI checks: Reports and Dashboard look populated.
- Files likely affected:
  - `db/03_seed_demo.sql`
- Demo steps:
  - Reset the DB, open `/reports`, and show full charts.

### OL-032 — Business-rule demonstration script

- Phase: 4
- Owner: TBA (suggested: Dev3)
- Dependencies: OL-019, OL-DEC-02
- Scope: Write `db/10_rule_demo.sql` (psql), which runs on a freshly reset DB. For each of BR-1 to BR-14 it attempts a violation and prints PASS or FAIL, extending the 09 pattern. The scope of BR-2 and BR-13 follows OL-DEC-02.
- Acceptance criteria:
  - 14 PASS lines and 0 FAIL.
  - The script is idempotent if wrapped in a transaction that is rolled back, or a reset follows it.
- Required tests:
  - DB tests: the script itself.
  - API tests: n/a
  - UI checks: n/a
- Files likely affected:
  - `db/10_rule_demo.sql`, `package.json` (`db:rules`)
- Demo steps:
  - Run `npm run db:rules` and read the 14 PASS lines.

### OL-033 — Documentation and run instructions

- Phase: 4
- Owner: TBA (any)
- Dependencies: OL-019, OL-DEC-03
- Scope: Update `README.md` with prerequisites (Node 20+, Postgres 14+), `.env` setup, `db:reset`, `dev`, `smoke`, and `db:rules`, plus the `VITE_DATA_SOURCE` flag and which pages are live per OL-DEC-03. Record the final decisions and assumptions in `AUDIT_NOTES.md`.
- Acceptance criteria:
  - A teammate on a clean clone reaches a logged-in dashboard by following only the README.
  - Every OL-DEC entry has a recorded outcome.
- Required tests:
  - DB tests: n/a
  - API tests: n/a
  - UI checks: a clean-clone walkthrough.
- Files likely affected:
  - `README.md`, `.env.example`, `docs/implementation/AUDIT_NOTES.md`
- Demo steps:
  - A teammate follows the README from scratch.

### OL-034 — pg_dump and full demo rehearsal

- Phase: 4
- Owner: TBA (whole team)
- Dependencies: OL-030, OL-031, OL-032, OL-033, OL-DEC-03
- Scope: Produce the submission dump with `pg_dump organlink > submission/organlink.sql` after a fresh reset and seed (05 §9). Rehearse the demo script:
  1. login
  2. procure
  3. match and re-run
  4. offer, decline, advance, accept
  5. transport
  6. transplant
  7. Organs page and discard
  8. reports and PDF
  9. rule script
  10. concurrency script
- Acceptance criteria:
  - Restoring the dump into an empty DB (`psql -f`) succeeds and the app runs against it.
  - The rehearsal completes in the time limit with no unhandled errors.
  - The fallback mock mode is verified on the demo machine.
- Required tests:
  - DB tests: restore the dump into `organlink_check`.
  - API tests: `npm run smoke` against the restored DB.
  - UI checks: the full rehearsal.
- Files likely affected:
  - `submission/organlink.sql`, `docs/implementation/DEMO_SCRIPT.md` (optional)
- Demo steps:
  - Run the full rehearsal end to end.
