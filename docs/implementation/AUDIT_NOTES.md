# OrganLink — Audit Notes

Audit of the repo at `9d5b524` (main) against the nine spec files in `docs/context/`. The specs are treated as authoritative.

> **Spec filenames.** On disk the specs have no `-N` suffix: `05_tdd.md`, `07_design_brief.md`, `06_user_flow.md`, `03_db_design_document.md`, and so on. Citations below use the on-disk names.

---

## Repo layout confirmation

- **Frontend** is at the repo root: Vite 8 + React **19** (05_tdd.md §1 says 18) + Mantine 7. Code is in `src/`: `pages/` (9 pages plus `Phase0SmokePage`), `components/` (AppShell, DataTable, FormModal, StatusBadge, ViabilityCountdown, TransportMap, …), `context/AuthContext.jsx`, `utils/offerTransitions.js`.
- **No backend skeleton exists.** The repo has no `server/` and no `db/`. `package.json` has no express/pg/bcrypt dependencies, and `vite.config.js` has no `/api` proxy. The SQL exists only as specs in `docs/context/`.
- **Mock data** is in `src/data/mock*.js` (8 files: donors, recipients, organs, offers, transports, hospitals, regions, compatibility+HLA). **There is no API/hook layer.** Pages import mocks directly into `useState` (for example `src/pages/DonorRegistryPage.jsx:66`, `src/pages/OfferWorkflowPage.jsx:59`). Dashboard and Reports use inline constants (`ALLOCATION_TRENDS`, `WAITING_TIME`, …), and the audit PDF reads `mockOffers` (`src/pages/reportsAuditPdf.js`).
- **Auth** is hardcoded `admin`/`admin` with a localStorage flag (`src/context/AuthContext.jsx`).
- **Environment:** local Postgres is 18.6 (the specs say 16 and the schema needs 14+, so this is fine). `docs/context/` is not yet committed to git.

## Consistency with specs

- **05_tdd.md §5/§7, endpoints and integration: not consistent.** 05 §7 says "whatever shape `mockDonors` has is what `GET /api/donors` returns". The mocks, however, follow the older `ui_mastercontext.md` §8, not `01_schema.sql`. Integration therefore can't be "close to mechanical" (see C1). The mock/live flag in 05 §7 (`VITE_DATA_SOURCE`) is not implemented anywhere yet.
- **07_design_brief.md §7, UI additions: none of the nine exist yet.**
  - There is no Procure Organ button and no Organs tab or page.
  - The donor badge still conflates type and status (`Deceased`/`Active`/`Inactive`).
  - "Record Accept" still says "transplant scheduled" and there is no Record Transplant action.
  - The Transport page is display-only.
  - The status set has no VOIDED or CANCELLED.
  - The Matching console has 3 sliders, no run timestamp, and no Re-run.
  - Policy Weights is a single global set with no region selector.
- **07 §4, status colours:** `StatusBadge.jsx` differs. `expired` renders grey (spec: red), `suspended` renders red (spec: grey), and UPPER_SNAKE values (`IN_TRANSIT`, `VOIDED`, `CANCELLED`, `FAILED`, `DISCARDED`) fall through to the default.
- **07 §5, reuse:** consistent. `FormModal`, `DataTable`, `StatusBadge`, and `ViabilityCountdown` exist and cover every addition.

## Contradictions / ambiguities

| # | Where | Issue |
|---|---|---|
| C1 | 05 §7 vs 01_schema / 08 §1 | Mock shapes contradict the schema. Mocks use string IDs (`DNR-0912`, `K-0912`), Title Case states (`Waiting`, `Offered`, `Preparing`), one HLA allele per locus (schema: a set of up to 6), `donor.organType` (organs come only from procurement), a single `recipient.organNeeded` (schema: many waitlist entries), and `viabilityHours/elapsedHours` (schema: `recovered_at`). → **OL-DEC-01** |
| C2 | Mocks vs 02_seed | Mocks have 5 regions including "Central" with text policies and no weights; the seed has 4 regions (SR/WR/NR/ER) with 4 weights. Mock hospitals have `traumaLevel`, which is not in the schema. Mock HLA locus is `DR`; the schema says `DRB1`, and 3 mock alleles aren't in the seed. Kidney viability is 24 in mocks, 36 in Settings, and 30 in the seed. Decline reasons are free text in mocks but coded in the seed. *(Resolved by the seed: see U2, U6.)* |
| C3 | 05 §6 code sample | `SET LOCAL app.user_id = $1` will fail because `SET` can't take bind parameters. → A1 |
| C4 | 06 Stage 6 vs 01_schema §13 | The user flow says an organ that expires in transit fails the transport and blocks the transplant. The sweep only expires `AVAILABLE` organs, so allocated organs never expire, sweep step 6 never fires, and no guard checks viability at transplant. → **OL-DEC-02** |
| C5 | 01_schema | Offer and transport state machines have no transition trigger. At DB level, `DECLINED → ACCEPTED` or `DELIVERED → PENDING` would succeed. → A2 |
| C6 | 05 §5 vs 01_schema | `POST /api/transplants {offerId, transplantAt, outcome}` omits `hospital_id`, which is NOT NULL. → A3 |
| C7 | 05 §5 vs repo | `GET /api/reports/audit.pdf` is a server endpoint in the spec, but the repo already builds the PDF client-side with jsPDF. → A6 |
| C8 | 08 §9 vs triggers | The historical seed requires offers on organs recovered months ago, and `trg_offer_viability` rejects every one. → A7 |
| C9 | 01_schema footer / 05 §4, §10 | The footer says "10 views", 05 §4 says 8, and 8 exist. 05 §10 counts 48 indexes against 10 declared; the rest are PK/UNIQUE. 05 §4.3 claims the sweep uses `SKIP LOCKED`, but the function doesn't. → A14, A15 |
| C10 | 05 §5 | There is no endpoint for urgency tiers or decline/discard reasons, which the waitlist, decline, and discard modals need. → A5 |
| C11 | Reports page vs views | The UI's waiting-time buckets (0–3 mo, 3–6 mo, …) and fairness chart (actual vs expected) don't match `v_waiting_time_distribution` (12 × 5-month buckets) or `v_allocation_fairness` (rate, median wait, retention). The views are the spec, so the charts adapt (OL-026). |
| C12 | 01_schema | Discarding an organ that has an open offer leaves the offer dangling. The sweep only voids offers on EXPIRED organs. → A17 |

## Critical unknowns

### Resolved by the specs (do not reopen)

| ID | Question | Answer | Source |
|---|---|---|---|
| U1 | What does Advance-to-next do? | It walks down qualified ranks of the **same run**, skips candidates that fail guards, and returns the new offer plus the skipped list. The new offer is **CREATED, not auto-sent**. | 05_tdd.md §5 (route comment), §5.1; 06_user_flow.md Stage 4 ("created … then sent"), Stage 5 |
| U2 | Which regions? | 4 regions (SR/WR/NR/ER), each with 4 weights. The mock "Central" region is dropped. | 02_seed_reference.sql (Regions block); 08_data_model.md §8 |
| U3 | Where are organs created? | Only through Procure Organ in the donor drawer. `organType` is removed from the donor form. | 06_user_flow.md Stage 2; 04_prd.md FR-4; 07_design_brief.md §7 |
| U4 | Can a recipient need several organs? | Yes: one waitlist entry per organ type, each independent. | 03_db_design_document.md §3.1 BR-4; 04_prd.md FR-7 |
| U5 | How are donor/recipient IDs displayed? | `D-0042` / `R-0118`, formatted in the application; the key is the integer. | 08_data_model.md §1 |
| U6 | Where do reasons, viability hours, and size ratios come from? | DB reference tables, not UI constants. | 02_seed_reference.sql; 08_data_model.md §2 |
| U7 | What are the default match weights? | The recovering hospital's regional policy. | 05_tdd.md §4.4; 01_schema.sql `match_candidates` |
| U8 | Does Re-run overwrite? | No. It creates a new append-only run, and the run timestamp is shown. | 03 §3.1 BR-6; 06_user_flow.md Stage 3 |
| U9 | Are VOIDED and CANCELLED the same thing? | They're visually the same (grey) but distinct in data. Only DECLINED blocks a re-offer. | 07_design_brief.md §4; 03 §3.1 BR-10 |

### NON-BLOCKING ASSUMPTIONS (adopted now; change only by updating this table)

| ID | Gap | Assumption (lowest risk, spec-consistent) | Tasks affected if changed |
|---|---|---|---|
| A1 | C3: `SET LOCAL` with a parameter | `SELECT set_config('app.user_id', $1::text, true)`. The `true` argument scopes it to the transaction, the same as `SET LOCAL`. | OL-003 |
| A2 | C5: no transition guard | Conditional `UPDATE … WHERE status = <required>`. If 0 rows change, return 409 `INVALID_STATE_TRANSITION`. Required states: send needs CREATED; accept and decline need SENT; cancel needs CREATED or SENT; depart needs PENDING; deliver needs IN_TRANSIT. This orchestrates the flow and doesn't duplicate any DB rule (06 Stages 4–6; 05 §5 preamble). | OL-015, OL-016, OL-017 |
| A3 | C6: transplant hospital | `hospitalId` is optional in the body and defaults to the transport's `destination_hospital_id` (06 Stage 7: "the performing hospital"). | OL-018 |
| A4 | Advance details | Allowed only from DECLINED, EXPIRED, VOIDED, or CANCELLED with a non-null `matchRunId`. Candidates are tried in rank order below the source recipient's rank, each under a SAVEPOINT. If every remaining candidate fails, return 422 `NO_ELIGIBLE_CANDIDATE` with `details.skipped`. | OL-016 |
| A5 | C10: lookups | **Proposed — needs approval:** a read-only `GET /api/lookups`. Fallback is to hardcode values from 02_seed in the frontend. | OL-005, OL-016, OL-022, OL-023 |
| A6 | C7: audit PDF | Keep the client-side jsPDF generator, fed by the live report and offer endpoints. `GET /api/reports/audit.pdf` stays in the contract as "specified, deferred". The "Expected allocation" column is replaced by `v_allocation_fairness` metrics. | OL-028 |
| A7 | C8: historical seed | Wrap historical inserts in `SET session_replication_role = replica`, which bypasses triggers and needs the local superuser. Present-day demo rows go through triggers normally. | OL-031 |
| A8 | The admin hash in 02_seed claims to be bcrypt of `admin` but hasn't been verified | Verify it in OL-001. If it fails, regenerate it in the `db/02_seed_reference.sql` copy only. Spec files stay untouched. | OL-001, OL-004 |
| A9 | Demo hospitals aren't specified | Reuse the mock hospital names and coordinates, mapped onto SR/WR/NR/ER. Central hospitals move to ER. `traumaLevel` is dropped. | OL-006, OL-031 |
| A10 | Where the Organs tab lives (05 §8 says "Settings or new tab"; 07 §7 says "New") | A new route `/organs` with a nav item. | OL-013, OL-023 |
| A11 | Other display IDs | Organ `O-0007`, offer `OF-0012`, transport `T-0003`, run `MR-0042`. All formatted in the frontend. | Adapters in OL-011 to OL-018 |
| A12 | `pg` returns INT8 and NUMERIC as strings | Register `pg.types` parsers so they arrive as JS numbers. The server emits timestamps as ISO UTC (`…Z`). | OL-002 |
| A13 | `09_verification_tests.sql` COMMITs its test rows and uses psql `\gset` | Run it with `psql` on a freshly reset DB, then run `db:reset` again. | OL-001, OL-032 |
| A14 | The sweep has no `SKIP LOCKED` | Accept that at demo scale and note it in the docs. Watch for it in the concurrency test. | OL-030 |
| A15 | Count and version mismatches (C9) | Cosmetic; no action. | none |
| A16 | No task owners | Suggest owners from `dev_split.md` page ownership: Dev1 Dashboard/Reports/Transport, Dev2 Donors/Recipients/Settings, Dev3 Login/Matching/Offers. Foundation is shared. | all |
| A17 | C12: discard with an open offer | Discard requires no CREATED or SENT offer (409 `ACTIVE_OFFER_EXISTS`, telling the user to cancel it first). Only allowed from AVAILABLE or EXPIRED. ALLOCATED organs are discarded through the transplant outcome. | OL-023 |

A8 (admin hash): The hash in docs/context/02_seed_reference-2.sql was incorrect. OL-001 verified this and used a corrected hash in db/02_seed_reference.sql (admin verified with bcryptjs).

### BLOCKING HUMAN DECISIONS (left TBD; each has a gate task in BACKLOG.md)

**OL-DEC-01: API response shape strategy (C1).**
- **Option A, mock-shaped API:** the backend emits the mock shapes (string IDs, Title Case, `organNeeded`, `viabilityHours`, one HLA per locus).
  - *Changes:* pages barely change, but the server has to synthesize lossy fields and reverse-map string IDs on every write. Multi-organ waitlists and 2-alleles-per-locus can't be represented.
- **Option B, schema-shaped API with frontend adapters:** camelCase JSON with integer IDs and UPPER_SNAKE enums. Thin `src/api/adapters/*.js` map rows to the props the components already use.
  - *Changes:* one adapter per resource. The API stays faithful to the schema and the BRs.
- *Files/tasks:* OL-005 and every endpoint/UI task from OL-010 to OL-028; all shapes in `API_CONTRACT.md`.
- **Fastest low-risk option: B.** `API_CONTRACT.md` is drafted assuming B.
- **✅ RESOLVED 2026-10-04: Option B approved (schema-shaped API + frontend adapters).**
  - *Mismatches confirmed* (`src/data/mock*.js` vs `01_schema.sql`): string IDs (`DNR-0912`, `K-0912`, `OFR-2201`, `TRN-0044`) vs `BIGINT` identity keys; Title Case statuses (`Waiting`, `Sent`, `In Transit`, `Preparing`) vs UPPER_SNAKE CHECK values (`ACTIVE`, `SENT`, `IN_TRANSIT`, `PENDING`); `donor.organType` and `donor.status: 'Deceased'` vs organs coming only from `organ` rows and `donor_type`/`status` being separate columns; `age` vs `date_of_birth`; one `hlaA/hlaB/hlaDR` string per locus vs `donor_hla`/`recipient_hla` sets; single `recipient.organNeeded`/`urgency`/`waitTime` vs many `waitlist_entry` rows; `viabilityHours`/`elapsedHours` vs `organ.recovered_at` plus `organ_type.max_viability_hours`; display names (`hospital`, `region`) vs FK ids.
  - *Feasibility confirmed:* the mismatches are field-level and mechanical. `05_tdd.md` §7 keeps the mock layer behind `VITE_DATA_SOURCE`, so one pure adapter per resource (`src/api/adapters/<resource>.js`) can map API rows to the existing mock-shaped props, and the mock files stay as the fallback. Option A is rejected because multi-organ waitlists and multi-allele HLA can't be represented in the mock shapes.
  - *Consequence:* all response shapes in `API_CONTRACT.md` are final for this strategy. No adapters are implemented as part of this decision.

**OL-DEC-02: in-transit expiry gap (C4).**
- **Option A, document only:** record it as a known limitation and keep the schema as specified. The demo avoids letting an in-transit organ expire.
  - *Changes:* nothing in code. The BR-2 demo must not claim the in-transit failure path.
- **Option B, patch the schema copy:** in `db/01_schema.sql`, extend sweep step 3 to `ALLOCATED` organs whose transport isn't `DELIVERED`, and add a viability check to `fn_transplant_requires_delivery`.
  - *Changes:* the DB copy diverges from `docs/context/01_schema.sql`, 09 must be re-run, and OL-032 gains a test.
- *Files/tasks:* `db/01_schema.sql` (new follow-up task OL-001b if B), OL-017, OL-018, OL-032.
- **Fastest low-risk option: A.**
- **✅ RESOLVED 2026-10-04: Option A approved (documented limitation; schema unchanged).**
  - *Gap confirmed:* `expire_stale_offers()` step 3 only expires organs with `status = 'AVAILABLE'`. An `ALLOCATED` organ in transit is never set to `EXPIRED`, so step 6 (fail transports carrying expired organs) never fires for it. `fn_transplant_requires_delivery()` checks only offer status and transport `DELIVERED`, with no viability check. This contradicts `06_user_flow.md` Stage 6.
  - *Why not fixed:* a proper fix needs changes to the sweep and the transplant trigger in `01_schema.sql` (Option B), which would diverge the DB copy from `docs/context/`, force a re-run of 09, and add a test. The deadline doesn't allow it.
  - *Accepted limitation:* an organ whose viability window elapses after allocation stays `ALLOCATED`, its transport is not auto-failed, and a transplant can still be recorded once the transport is `DELIVERED`. The demo must not exercise or claim the in-transit failure path, and BR-2 and BR-13 are demonstrated only for `AVAILABLE` organs and the delivery gate. No OL-001b task is created.

**OL-DEC-03: demo bar, all screens live or mixed (04_prd.md §7 vs 05_tdd.md §7).**
- **Option A, all live:** every screen reads from Postgres (PRD §7 "every UI screen backed by real queries").
  - *Changes:* all of Phase 3 is mandatory before the rehearsal.
- **Option B, mixed:** the Phase 2 slice plus donors, recipients, and organs are live. Settings, Reports, and Dashboard may fall back to mock through the flag (05 §7, "a half-finished endpoint never blocks a page").
  - *Changes:* Phase 3 becomes priority-ordered and the rehearsal script marks mock pages.
- *Files/tasks:* priority of OL-020 to OL-028; OL-033; OL-034.
- **Fastest low-risk option: B.** Aim for A if time allows.
- **✅ RESOLVED 2026-10-04: Option B approved (mixed mock/live), with the core allocation flow fully live.**
  - *Core flow, must be live:* Login, Donors (registry, drawer, Procure Organ), Organs, Matching console, Offers (create, send, accept, decline), Transport (depart, deliver), and Record Transplant. These are OL-011 to OL-019, the Phase 2 slice.
  - *Also MUST:* Recipients and waitlist (OL-021, OL-022), donor create/update (OL-020), and organ discard (OL-023), since the demo reads and edits these records.
  - *STRETCH (may stay mock behind `VITE_DATA_SOURCE`):* Settings (OL-024, OL-025), Reports (OL-026), Dashboard (OL-027), and Audit PDF (OL-028). Aim for all-live if time allows.
  - *Consequence:* the rehearsal script (OL-034) and README (OL-033) must mark which pages are live and which are mock.

---

## Final status recorded at OL-033 (documentation and run instructions)

### Decision gate outcomes

Every `OL-DEC` entry in `BACKLOG.md` has a recorded outcome; none is open.

| Decision | Outcome | Resolved | Where the outcome lives |
|---|---|---|---|
| OL-DEC-01 — API response shape strategy | **Option B**: schema-shaped camelCase JSON + frontend adapters | 2026-10-04 | this file (above); `API_CONTRACT.md` banner; implemented as `src/api/adapters/*.js` (OL-005 onward) |
| OL-DEC-02 — in-transit expiry handling | **Option A**: documented limitation; schema unchanged; no OL-001b | 2026-10-04 | this file (above); `API_CONTRACT.md` banner; no viability check in `server/routes/transport.js` (deliver) or `server/routes/transplants.js`; demo avoids the path |
| OL-DEC-03 — demo bar (all-live vs mixed) | **Option B**: mixed; core allocation flow MUST be live, Settings/Reports/Dashboard/Audit PDF STRETCH with mock fallback | 2026-10-04 | this file (above); `BACKLOG.md` Phase 3 tagging; `README.md` → "Which pages are live, per OL-DEC-03" |

### Assumption status

A1–A17 stand as written in the table above. Status of the ones implementation consumed:

| ID | Final status |
|---|---|
| A1 | Implemented in `server/db.js` (`set_config('app.user_id', …, true)`); asserted by `tests/server/tx-errors.test.js`. |
| A2 | Implemented as conditional updates in the offer/transport routes (OL-015 to OL-017). |
| A3 | Implemented: `hospitalId` optional, defaults to the transport's destination (OL-018). |
| A4 | Implemented as the advance walker in `server/routes/offers.js` (OL-016). |
| A5 | **Adopted as proposed:** `GET /api/lookups` shipped in OL-005 and is the only lookup source in live mode. The "Proposed — needs approval" note above is superseded by its implementation and use. |
| A8 | Resolved by OL-001: the admin hash in `docs/context/02_seed_reference-2.sql` was wrong; `db/02_seed_reference.sql` carries a corrected hash (see note above). |
| A9, A11, A12 | Implemented in OL-006, the adapters, and `server/db.js` respectively. |
| A13 | Followed: OL-001 ran `09_verification_tests.sql` on a fresh DB, then reset again. |
| A14 | **Observed and accepted (OL-030):** the sweep has no `SKIP LOCKED`; 10 parallel creates queued behind `FOR UPDATE`/the sweep's UPDATEs with no deadlock and no timeout (~200 ms at demo scale). No code change. Documented in `README.md` → "Known limitations". |
| A16 | Cosmetic owner suggestions only; `BACKLOG.md` still says TBA. |
| A17 | Implemented in OL-023 (`server/routes/organs.js`): discard requires no open offer, AVAILABLE/EXPIRED only. |

No assumption was retracted or rewritten during implementation. Changing one still means
editing its row in the table above.

### Open items at OL-033

- `GET /api/reports/audit.pdf` stays "specified, deferred" (A6); the client-side jsPDF
  generator is the shipped path (OL-028).
- OL-029 (manual interactive QA pass) has not run yet; browser checks deferred by earlier
  reports are listed in `MANUAL_QA_CHECKLIST.md` and in each report's
  "Manual interactive checks" section.
- The OL-DEC-02 Option A limitation (allocated organs never expire in transit) is a
  permanent, accepted gap for this submission; it is documented in `README.md` →
  "Known limitations and assumptions" and in `API_CONTRACT.md`.
