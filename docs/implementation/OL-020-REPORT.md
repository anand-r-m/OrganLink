# OL-020 Report: Donor create and update (type/status split form)

Status: **COMPLETE**. Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/donors.js`:
  - `POST /api/donors` and `PATCH /api/donors/:id`
  - a shared `loadDonor()` helper, so GET, POST and PATCH return one shape
  - shape validation and HLA-set replacement
- `src/api/donors.js`: `createDonor`, `updateDonor`. Both are live only; mock mode saves to local state in the page.
- `src/api/adapters/donors.js`: `adaptDonor` also exposes `bloodGroupId` and `hlaIdsByLocus` for edit pre-fill.
- `src/api/adapters/donorForm.js` (new): pure form helpers:
  - initial state, `setDonorType`, `donorToForm`
  - `validateDonorForm`, `formToDonorBody`, `serverErrorToForm`
  - HLA option builders
- `src/pages/DonorRegistryPage.jsx`: new register/edit form; live Register, Edit and Deactivate.
- `tests/server/donors-write.test.js` (new, 11 tests), `tests/client/donorForm.test.js` (new, 11 tests).

## Behavior implemented
- **`POST /api/donors`** returns 201 `Donor` (the same shape as `GET /api/donors/:id`, with `hla` and `organs`).
  - It runs in `withTx`, so audit attribution applies.
  - The API checks shape only: required fields, enums, `YYYY-MM-DD` dates, offset-bearing ISO `deathDate`, and `hlaAlleleIds` as positive integers.
  - The death-field rule and the height and weight ranges are left to the DB CHECKs:
    - 400 `CONSTRAINT_VIOLATION` for `ck_donor_death_fields`, `ck_donor_death_after_birth`, and the range checks
    - 400 `REFERENCE_NOT_FOUND` for an unknown blood group, hospital or allele
  - Duplicate allele ids are de-duplicated.
- **`PATCH /api/donors/:id`**: any subset of the POST fields.
  - `hlaAlleleIds` replaces the whole set in the same transaction; `[]` clears it.
  - `null` is accepted only for `deathDate` and `deathCause`.
  - 404 `DONOR_NOT_FOUND` for an unknown id.
  - The UPDATE always runs (`name = name` when only HLA changes), so an HLA-only edit still writes an `audit_log` UPDATE row. `donor_hla` has no audit trigger in the schema.
- **Form:**
  - Fields: name, DOB, blood group, hospital, **Donor Type** and a separate **Status** select, height and weight (required, because the columns are NOT NULL), and HLA-A, HLA-B and HLA-DRB1 multi-selects capped at 2 each.
  - **Death date and cause are shown only for Deceased**. Switching to Living clears them and sends explicit nulls.
  - The **organ-type field is removed** (U3).
  - The client deliberately does not check the death rule, so the DB message appears in the form: a red Alert plus an inline field error, with the modal kept open.
  - Success shows a toast and refreshes the table. After an edit the drawer reopens with the saved donor, so new HLA shows at once.
- **Deactivate** sends `PATCH {status:'INACTIVE'}`. The Status badge changes while the Type badge stays. The button is disabled for an already inactive donor.
- **Live mode:** the OL-011 "not live yet" disabling is removed. Edit waits until drawer detail (HLA ids) has loaded. Region is hidden in the form because the server derives it from the hospital.
- **Mock mode:** register, edit and deactivate keep working against local state with the new fields.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 108/108 pass |
| `npm run test:client` | 77/77 pass |
| `npm run build` | OK (pre-existing chunk-size notice) |
| `npx oxlint` | 9 warnings = baseline, none new |
| `npm run smoke` (fresh reset) | SMOKE OK |
| curl on :3999, deceased without date | 400 `CONSTRAINT_VIOLATION`, `details.constraint = ck_donor_death_fields` |
| curl, living with `deathCause` | 400 `CONSTRAINT_VIOLATION` |
| curl sequence | create living 201, create deceased without date 400, PATCH INACTIVE 200 (DB `INACTIVE`) |
| curl PATCH `hlaAlleleIds [2,8,9]` | `donor_hla` = {2,8,9} exactly; `GET` returns the new HLA; `audit_log` has INSERT + 2 UPDATE rows for the donor, `user_id = 1` |
| curl PATCH unknown id | 404 `DONOR_NOT_FOUND` |
| SSR render of the page (mock mode) | rendered without throwing |
| Source inspection | separate Type/Status selects; death fields only for DECEASED; `maxValues` 2 per locus; live submit calls `createDonor`/`updateDonor`; Deactivate sends `{status:'INACTIVE'}`; mock path uses local state |

## Reviewer findings and resolution
Verdict: **APPROVE**, with no blocking findings. Four NITs, all accepted as they stand:
1. The HLA-only edit's audit row has identical old and new donor values, so it records that an edit happened, not which alleles changed. Recording allele detail would need a `donor_hla` audit trigger, which is a schema change and out of scope.
2. The UI keeps the original form's ranges, 100–220 cm and 20–200 kg. These are stricter than the DB's 30–260 cm and 1–400 kg. The specs say nothing about paediatric donors. This is a UI-only limit; the API enforces only the DB ranges.
3. The mock-mode edit pre-fill estimates the date of birth from age, which can shift the age by a year at a birthday boundary. Mock only.
4. The PATCH audit assertion uses `>= 1`. This is correct for an append-only shared table, because the donor is freshly created.

## Failures encountered
- None in code. The implementer's first run passed.
- Orchestrator issue: the Phase 3 lint baseline was first recorded as 2 warnings because `tail` truncated the output. The real baseline is 9. Corrected; see LESSONS_LEARNED.

## Remaining risks / follow-ups
- No browser verification: every UI interaction below is unverified in a real browser.
- The audit trail has no allele-level detail for HLA changes (see reviewer NIT 1).

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/donors` (live) | Click Register Donor | The form opens with Donor Type and Status selects, three HLA selects and no organ-type field | Server-render check only (mock) + source inspection; deferred to consolidated manual QA |
| Donor form | Choose Donor Type = Deceased | Death Date and Cause of Death fields appear | Deferred to consolidated manual QA |
| Donor form | Switch back to Living | Death fields disappear and their values are cleared | Automated test coverage (`setDonorType`); visual deferred to consolidated manual QA |
| Donor form | Pick a third allele in one HLA locus | Blocked at 2 | Deferred to consolidated manual QA |
| Donor form (live) | Submit Deceased with no death date | Modal stays open; red Alert "Deceased donors need a death date; living donors must not have death details"; Death Date field marked | Automated (API 400 + error-mapping helper); visual deferred to consolidated manual QA |
| Donor form | Submit with empty required fields | Inline errors | Automated (`validateDonorForm`); visual deferred to consolidated manual QA |
| Donor form (live) | Submit a valid new donor | "Donor Registered" toast; modal closes; the donor appears in the table | Deferred to consolidated manual QA (endpoint automated) |
| Drawer (live) | Click Edit, change HLA alleles, save | "Donor Updated" toast; the drawer reopens showing the new alleles by locus | Deferred to consolidated manual QA (API and DB automated) |
| Drawer (live) | Click Deactivate | Status badge becomes Inactive, Type badge unchanged, toast; button disabled afterwards | Deferred to consolidated manual QA (API automated) |
| `/donors` (mock) | Register, edit, deactivate | Works on local state with the new fields | Server-render check only; deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- Deceased donor without a death date gives 400 `CONSTRAINT_VIOLATION` (`ck_donor_death_fields`), and the form shows the message: **satisfied**. API checked by curl and tests; form mapping by unit test and source; visual deferred.
- A living donor with a death cause is rejected: **satisfied** (curl 400; test).
- An HLA edit is reflected in the drawer, and `audit_log` has an UPDATE row: **satisfied** at API and DB level (`GET` returns the new HLA; UPDATE audit row with `user_id = 1`). Drawer re-render is deferred to manual QA.
- DB test, `donor_hla` after PATCH equals the submitted set: **satisfied**.
- API sequence create living → deceased without date → patch status: **satisfied**.
