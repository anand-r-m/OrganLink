# OL-025 Report: Settings — blood compatibility matrix and HLA alleles

Status: **COMPLETE** (STRETCH task). Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/bloodCompatibility.js` (new): `GET` and `PATCH /api/blood-compatibility`.
- `server/routes/hlaAlleles.js` (new): `GET`, `POST` and `DELETE /api/hla-alleles`.
- `server/index.js`: mounts both routers after `requireAuth`.
- `server/errors.js`: SQLSTATE **23001** (restrict_violation) now maps to 409 `REFERENCE_IN_USE` (see "Contract note").
- `tests/server/tx-errors.test.js`: one added `translatePgError` case for 23001.
- `src/api/compatibility.js` (new): live and mock API module.
- `src/api/adapters/compatibility.js` (new): pure helpers. `pairsToGrid` and `countCompatible` build the grid; also mock adapters (DRB1, no description) and form helpers.
- `src/pages/SettingsPage.jsx`: `CompatibilityTab` rewritten. The unused `mockCompatibility` import and the local `BLOOD_GROUPS` / `isABOCompatible` are removed.
- `tests/server/compat-hla.test.js` (new, 7 tests), `tests/client/compatibility.test.js` (new, 8 tests).
- `src/data/mockCompatibility.js`, `/api/lookups`, the contract, backlog, schema and seed are untouched.

## Behavior implemented
- **`GET /api/blood-compatibility`:** `{bloodGroups (8), pairs (64)}` in the contract shape, ordered donor-major.
- **`PATCH /api/blood-compatibility`:** `{donorBloodGroupId, recipientBloodGroupId, compatible}`. Runs in `withTx` and returns 200 with the updated pair.
  - A bad body gives 400 `VALIDATION_ERROR` with `details.fields`.
  - An unknown pair gives 404 `BLOOD_COMPATIBILITY_NOT_FOUND`. The contract names no 404 code here, so this name follows the `<RESOURCE>_NOT_FOUND` pattern.
- **`GET /api/hla-alleles?locus=`:** a locus other than A/B/DRB1 gives 400 `VALIDATION_ERROR`.
- **`POST /api/hla-alleles`:** returns 201 HlaAllele.
  - The locus is not pre-validated; the DB CHECK gives 400 `CONSTRAINT_VIOLATION`.
  - Duplicate (locus, name) → 409 `DUPLICATE` (`ux_hla_allele_natural`).
  - A missing field → 400 `VALIDATION_ERROR`.
- **`DELETE /api/hla-alleles/:id`:** returns 204.
  - An allele used by a donor or recipient → 409 `REFERENCE_IN_USE`.
  - Unknown or non-numeric id → 404 `HLA_ALLELE_NOT_FOUND`.
- **Matching:** `match_candidates` reads `blood_compatibility`, so a toggled pair changes the next run's ABO exclusions with no other code.
- **Compatibility tab (both modes)**
  - 8×8 grid: rows are donor groups, columns are recipient groups, header "D \ R".
  - A "N compatible pairs" counter.
  - Clicking a cell opens the confirm modal. Confirming flips the cell optimistically and PATCHes (live), with a toast. On error the cell reverts and the server message is shown.
- **HLA table:** Allele Name (`.mono`), Locus and delete; **no description column**.
  - The locus filter (All/A/B/DRB1) runs client-side over the loaded list.
  - The Add modal (locus A/B/DRB1 plus name) shows the 409 message inline.
  - Delete asks for confirmation; a 409 `REFERENCE_IN_USE` shows as a red toast.
- **Mock mode:** reads come from the mock fixture through adapters, so the mock also shows DRB1 and no description. Toggles and add/delete change local state only.

## Contract note (needs recording by the team)
`API_CONTRACT.md` lists `REFERENCE_IN_USE` as "`23503` on DELETE — Proposed". But `donor_hla` and `recipient_hla` reference `hla_allele` with `ON DELETE RESTRICT`, and Postgres raises **23001** (restrict_violation) for those, not 23503. The reviewer confirmed this with a rolled-back DELETE.

Without a 23001 mapping, the contract's `REFERENCE_IN_USE` would never fire, and the request would return 500. The mapping keeps the contract's intent (FK violation on DELETE → 409 `REFERENCE_IN_USE`) and changes no response shape.

The only other server DELETEs remove child rows (`donor_hla`, `recipient_hla`), so they cannot raise 23001. This run may not edit `API_CONTRACT.md`. **The team should update the error table's source column to "23503 or 23001 on DELETE".**

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 152/152 pass |
| `npm run test:client` | 127/127 pass |
| `npm run build` | OK |
| Lint (file:line count) | **8** (baseline 9; the unused `mockCompatibility` import is gone; no new location). New baseline: 8 |
| `npm run smoke` (fresh reset) | SMOKE OK |
| AC1 | API: 64 pairs, 27 `compatible:true`; SQL count 27; `pairsToGrid` gives 8×8 and `countCompatible` 27 |
| AC2 (curl + psql) | Organ 3 (B+) run 1 qualified 6, mostly B+. PATCH B+→B+ false: DB `f`, and run 2 qualified only AB+ with every B+ recipient `ABO_INCOMPATIBLE`. PATCH back true: run 3 matches run 1 and the count is back to 27 |
| AC3 | DELETE a used allele → 409 `REFERENCE_IN_USE` (`donor_hla_allele_id_fkey`), row kept; new unused allele → 204; 999999 → 404 |
| AC4 | POST `B*99:01` → 201; repeat → 409 `DUPLICATE`; locus "DR" → 400 `CONSTRAINT_VIOLATION`; `?locus=DRB1` returns only DRB1; `?locus=DR` → 400 |
| UI (source) | no description column; loci A/B/DRB1; cell → confirm → PATCH (live) with revert on error; add and delete call the API and show 409 messages |

## Reviewer findings and resolution
Verdict: **APPROVE**, no blocking findings.
- The 23001 mapping was verified empirically and judged consistent with the contract's intent (above).
- `BLOOD_COMPATIBILITY_NOT_FOUND`, rows = donor orientation (matches the mock data's own header comment), the client-side locus filter, and no duplicate check in mock add: all accepted.
- NITs: POST trims `alleleName` (harmless). The GET test asserts the global count of 27, which also guards against a leaked toggle.

## Failures encountered
- No code failures. The checker's first psql query used wrong column names (`donor_bg_id` / `recipient_bg_id` are correct) and was re-run.

## Remaining risks / follow-ups
- No browser verification.
- `API_CONTRACT.md` error-table wording for `REFERENCE_IN_USE` (see Contract note).
- Toggling a pair affects all future matching; there is no audit trigger on `blood_compatibility`.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/settings` Compatibility Matrix (live) | Open the tab | 8×8 grid (rows donor, columns recipient) and "27 compatible pairs" | Deferred to consolidated manual QA (API + helper automated) |
| Compatibility Matrix (live) | Click a compatible cell, then Confirm | Cell flips to ✗; toast; count drops to 26; persists after reload | Deferred to consolidated manual QA (API automated) |
| Compatibility Matrix (live) | Click a cell, then Cancel | Nothing changes | Deferred to consolidated manual QA |
| `/matching` (live) | After making B+→B+ incompatible, run a match on a B+ organ | B+ recipients appear under Excluded with ABO_INCOMPATIBLE | Deferred to consolidated manual QA (API automated) |
| HLA table (live) | Look at the columns and the locus filter | Allele Name and Locus columns only; filter options A, B, DRB1 | Deferred to consolidated manual QA |
| HLA table (live) | Add Allele B / `B*99:01` | Row added; "Allele Added" toast | Deferred to consolidated manual QA (API automated) |
| HLA table (live) | Add the same allele again | Modal stays open: "A record with these values already exists" | Deferred to consolidated manual QA (API automated) |
| HLA table (live) | Delete A*02:01 | Red toast "This record is referenced by other data and cannot be deleted"; row stays | Deferred to consolidated manual QA (API automated) |
| `/settings` Compatibility Matrix (mock) | Open the tab, toggle, add and delete | DRB1 shown, no description; local changes only | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- The matrix shows 27 compatible cells after reset: **satisfied** (API, SQL, helper); visual check deferred.
- Toggling a cell persists it and changes the ABO exclusions on the next match run: **satisfied** (curl + psql by the checker; server test with own fixtures).
- Deleting an allele a donor or recipient uses returns 409 `REFERENCE_IN_USE`: **satisfied**.
- Adding a duplicate (locus, name) returns 409 `DUPLICATE`: **satisfied**.
