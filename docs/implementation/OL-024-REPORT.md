# OL-024 Report: Settings — hospitals, regions with policy weights, organ types

Status: **COMPLETE** (STRETCH task). Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/hospitals.js`: `POST /api/hospitals`, `PATCH /api/hospitals/:id`. GET is unchanged and reuses `HOSPITAL_SQL`.
- `server/routes/regions.js` (new): `GET`/`POST`/`PATCH /api/regions`.
- `server/routes/organTypes.js` (new): `GET`/`POST`/`PATCH /api/organ-types`.
- `server/util/settingsSql.js` (new): shared `ORGAN_TYPE_SQL`, `REGION_SQL` and small helpers (`paramId`, `checkShape`, `pick`).
- `server/routes/lookups.js`: now uses the shared `ORGAN_TYPE_SQL`. The response is unchanged, and a test compares it with `/api/organ-types`.
- `server/index.js`: mounts `/api/regions` and `/api/organ-types` after `requireAuth`.
- `src/api/settings.js` (new): hospitals write functions plus regions and organ types (live, or mock where needed). Writes refuse in mock mode.
- `src/api/adapters/settings.js` (new): `regionToSliderValues`, `sliderValuesToPatch`, `weightShares`, form → body mappers, `formatRatioRange`, `settingsErrorToForm`.
- `src/pages/SettingsPage.jsx`: live Hospitals, Regions, Organ types and Policy Weights tabs.
- `tests/server/settings.test.js` (new, 11 tests), `tests/client/settings.test.js` (new, 9 tests).
- `src/api/hospitals.js`, `src/data/mockRegions.js` and the Compatibility tab (OL-025) are untouched.

## Behavior implemented
- **API**
  - All writes run in `withTx`. None of these tables has an audit trigger, and none was added.
  - The API checks shape only (types). The DB owns the values:
    - all-zero weights → 400 `CONSTRAINT_VIOLATION` `ck_region_weights_nonzero`
    - negative weight → 400 `region_*_weight_check`
    - latitude/longitude range → 400 `hospital_latitude_check` / `hospital_longitude_check`
    - ratio order → 400 `ck_organ_type_ratio_order`
    - positive checks → 400 `CONSTRAINT_VIOLATION`
    - duplicate region code or organ type name → 409 `DUPLICATE`
    - unknown region on a hospital → 400 `REFERENCE_NOT_FOUND`
    - unknown ids → 404 `HOSPITAL_` / `REGION_` / `ORGAN_TYPE_NOT_FOUND`
  - Dynamic UPDATEs take column names only from fixed allow-lists; every value is a bind parameter.
  - `PATCH /api/regions/:id` changes only the supplied weight keys.
  - `POST /api/regions` leaves unsent weights to the column defaults (25/35/20/20).
  - An empty PATCH returns 200 with the current row.
  - Region shape: `{id, code, name, weights:{hla, urgency, distance, wait}, hospitalCount}`.
- **Weights drive matching** (AC1): `match_candidates` and `GET /api/organs/:id` `defaultWeights` read the region row, so a saved region policy becomes the default for the next run with no further code.
- **Hospitals tab (live)**
  - Add, Edit and Suspend/Activate are enabled, and the stale "not available in live mode" tooltip is removed.
  - The form has name, region (from `/api/regions`), address, phone, latitude, longitude and status. Trauma level is omitted in live mode (A9).
  - Server errors show in the form. Success shows a toast and reloads the hospital and region lists.
  - SUSPENDED renders grey (`muted` → `.badge-expired`, `#9ba3a9`).
- **Regions tab (live):** list from the API with code, name, the 4 weights and the API `hospitalCount` (no more `mockHospitals` stand-in). Add and Edit take code and name only.
- **Organ types tab (live):** list from the API with max viability (h), response window (h), ratio range (`0.50–3.00`) and priority weight. Add and Edit show server errors. The mock "Code" column is dropped in live mode, because the schema has no organ-type code.
- **Policy Weights tab**
  - Region Select plus 4 sliders (HLA, Urgency, Distance, Waiting time) bound to the selected region. Switching region loads its weights.
  - Save PATCHes `/api/regions/:id {weights}`; a 400 shows the server message under the sliders. Reset restores the saved values.
  - Slider step is 1 (was 5) so any stored weight fits.
- **Mock mode:** the hospitals, regions and organ types tabs keep their mock forms and state. Mock regions get the schema-default weights so Policy Weights works on session state.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 145/145 pass |
| `npm run test:client` | 119/119 pass |
| `npm run build` | OK |
| Lint (file:line count) | 9 = baseline (the `mockCompatibility` warning moved from SettingsPage.jsx:40 to :49) |
| `npm run smoke` (fresh reset) | SMOKE OK |
| AC1 (curl + psql) | PATCH SR 40/30/15/15 → 200, region row 40/30/15/15; SR organ 3 `defaultWeights` 40/30/15/15; default `POST /api/matching/runs` gives `match_run` weights 40/30/15/15 |
| AC2 | all zeros → 400 `ck_region_weights_nonzero`; −1 → 400 `region_hla_weight_check`; row unchanged |
| AC3 | `PATCH /api/hospitals/2 {"status":"SUSPENDED"}` → 200, DB SUSPENDED; table renders `StatusBadge`, which is grey; Suspend is enabled in live mode (source) |
| AC4 | Kidney `30 / 6 / 0.5 / 3` as numbers; `formatRatioRange` gives "0.50–3.00"; live tab renders it |
| Hospitals | POST 201 (Hospital shape); lat 99 → 400; unknown region → 400 `REFERENCE_NOT_FOUND`; 999999 → 404 |
| Regions | POST without weights 201 (25/35/20/20, `hospitalCount` 0); duplicate code 409; unknown 404 |
| Organ types | ratio min 2 / max 1 → 400 `ck_organ_type_ratio_order`; duplicate name 409; unknown 404; POST 201; Kidney unchanged after failures |
| `GET /api/lookups` | `organTypes` keys unchanged |
| Policy Weights (source) | region Select → effect loads that region's weights into the sliders; Save calls `updateRegion` → `PATCH /regions/:id` |

## Reviewer findings and resolution
Verdict: **APPROVE**, with NITs:
1. `PATCH /api/regions/:id {"weights":{"hla":1000}}` returns **500 `INTERNAL`**. Numeric overflow on `NUMERIC(5,2)` (SQLSTATE 22003) has no mapping in `translatePgError`, and very large integer hours behave the same way. The UI cannot trigger it, because sliders cap at 100. **Not fixed, recorded as a follow-up.** The fix is to map 22003 to a 400 in the shared error translator, which extends `API_CONTRACT.md`'s error table and needs approval. This run may not edit `BACKLOG.md`, so it is listed in PHASE3-REPORT for the team to add.
2. `{"weights": null}` is accepted as `{}` and has dead-code null handling. Harmless; **accepted**.
3. Empty hospital address and phone are stored as `''` rather than NULL. **Accepted**.
4. The Policy Weights behaviour is tested by helper and page source only, which is the project convention. **Accepted**.

## Failures encountered
- None.

## Remaining risks / follow-ups
- No browser verification.
- 22003 numeric overflow returns 500 (see reviewer finding 1).
- Hospital edit pre-fills the region by matching `regionCode`, because `adaptHospital` has no `regionId`. That works while region codes are unique, which the DB enforces.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/settings` Hospitals (live) | Click Add Hospital, fill the form, submit | Toast; the row is added; its region's hospital count rises on the Regions tab | Deferred to consolidated manual QA (API automated) |
| Hospitals (live) | Submit latitude 99 | Form shows the server message; modal stays open | Deferred to consolidated manual QA (API automated) |
| Hospitals (live) | Click Suspend on a hospital | Grey SUSPENDED badge; the icon becomes Activate | Deferred to consolidated manual QA (API + CSS verified) |
| Hospitals (live) | Click Edit | Form pre-filled, including the region | Automated (pre-fill helper); visual deferred |
| Regions (live) | Open the tab | Codes SR/WR/NR/ER, the 4 weights and DB hospital counts | Deferred to consolidated manual QA |
| Regions (live) | Add a region with a duplicate code | Error "A record with these values already exists" | Deferred to consolidated manual QA (API automated) |
| Organ Types (live) | Open the tab | Kidney: 30 h, 6 h, 0.50–3.00 | Deferred to consolidated manual QA (API + formatter automated) |
| Organ Types (live) | Edit Kidney with max ratio ≤ min | Message "Maximum weight ratio must exceed the minimum" | Deferred to consolidated manual QA (API automated) |
| Policy Weights (live) | Change the Region select | The 4 sliders jump to that region's weights | Automated (`regionToSliderValues`); visual deferred |
| Policy Weights (live) | Move sliders, click Save Configuration | Toast; reload shows the saved values | Deferred to consolidated manual QA |
| Policy Weights (live) | Set all four to 0 and Save | "At least one policy weight must be greater than zero"; nothing saved | Deferred to consolidated manual QA (API automated) |
| `/matching` (live) | After saving NR weights, select an NR organ | Sliders preset to the new NR weights; the run uses them | Deferred to consolidated manual QA (API + DB automated for SR) |
| `/settings` (mock) | Use all four tabs | Mock behaviour as before; Policy Weights binds to mock regions | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- Changing SR's weights is persisted, and the next match run on an SR-recovered organ uses them as defaults: **satisfied** (curl + psql; server test).
- All-zero weights return 400 (`ck_region_weights_nonzero`): **satisfied**.
- Suspending a hospital shows a grey SUSPENDED badge: **satisfied** at API, CSS and source level; visual check deferred.
- The organ-type tab shows Kidney with 30 h, 6 h and 0.50–3.00: **satisfied** at API, formatter and source level; visual check deferred.
- DB tests (region row after PATCH; `match_run` weights for the next default run) and API tests (valid 200, all zeros 400): **satisfied**.
