# OL-011 Report — Donors read: registry and drawer live

## Files changed
- `server/routes/donors.js` (new): `GET /api/donors`, `GET /api/donors/:id`
- `server/index.js`: mounts the donors router behind `requireAuth`
- `src/api/donors.js` (new): `listDonors`, `getDonor` (mock/live switch)
- `src/api/adapters/donors.js` (new): `adaptDonor`, `adaptMockDonor`, `groupHla`, `adaptOrgan`, `calcAge`
- `src/pages/DonorRegistryPage.jsx`: reads through the API module; Type and Status badges; Type/Status/Hospital filters; drawer with HLA by locus and organs
- `tests/server/donors-read.test.js` (new), `tests/client/api.test.js` (extended)
- `docs/implementation/LESSONS_LEARNED.md` (OL-011 section), this report

No schema, API contract, backlog, or spec changes.

## Behavior implemented
- `GET /api/donors` filters `status`, `type`, `hospital` in SQL; bad values give 400 `VALIDATION_ERROR`. Items carry `organCount`, no `organs`. No sweep (per contract). `dateOfBirth` is sent as `YYYY-MM-DD` text to avoid timezone shifts.
- `GET /api/donors/:id` runs `expire_stale_offers()` first, then returns the donor, its HLA alleles (ordered A, B, DRB1) and `OrganSummary[]` from `v_organ` (with `hasActiveOffer`/`activeOfferId`). Unknown or malformed ids give 404 `DONOR_NOT_FOUND`.
- Registry: ID shown as `D-00NN`; separate **Type** (Deceased/Living) and **Status** (Active/Inactive) columns and drawer badges. Filters re-query on change; in live mode they are sent as query parameters. The drawer shows HLA grouped by locus (HLA-A, HLA-B, HLA-DRB1) and an organs list with status badge and `ViabilityCountdown` for AVAILABLE organs ("No organs procured" if empty).
- Mock mode: rows are normalised by `adaptMockDonor` (the old "Deceased" status becomes type DECEASED / status ACTIVE) and filtered client-side.
- In live mode Register, Edit and Deactivate are disabled, because they only change local state until OL-020.

## Tests and validations run
Throwaway Postgres 18.6 on `localhost:5433`, `DATABASE_URL` via the environment only; `db:reset --yes` run first.
- `npm run test:server`: **45 pass, 0 fail** (8 new in `donors-read.test.js`: auth, list shape, each filter, bad filters, detail with 6 HLA grouped plus organs, empty organs, sweep turns a back-dated Kidney into EXPIRED, 404 for `99999`/`abc`/oversized id).
- `npm run test:client`: **26 pass, 0 fail** (6 new: adapter, HLA grouping, mock normalisation, mock vs live `listDonors`, query string, `getDonor`).
- `npm run lint`: no warnings in touched files. `vite build`: succeeds.
- Live check through the Vite proxy (`VITE_DATA_SOURCE=api`): `/api/donors?type=DECEASED` returned 6 deceased only; `/api/donors/99999` returned 404 `DONOR_NOT_FOUND`; `/api/donors/1` returned 6 alleles and a Heart (AVAILABLE, ~4.96 h).
- SSR smoke render of `DonorRegistryPage` (mock mode) succeeds and contains the title, Type column and hospital filter.

## Failures encountered
- No Postgres running; wrong column name `bg.name`; a shell `&&` chain skipped an `export`; SSR script loaded two Mantine copies. All resolved; see LESSONS_LEARNED.

## Remaining risks / follow-ups
- **Not verified in a real browser:** the table, filters and drawer were checked by API calls, unit tests and an SSR render, not by clicking. A manual pass through `/donors` in both modes is advisable.
- Live "Date Registered" shows "—" because the schema has no registration date.
- Live Register/Edit/Deactivate are disabled until OL-020 (already in BACKLOG).
- The seed shows only AVAILABLE organs; organs expire hours after `db:reset`.
- No new backlog items discovered.

## Acceptance criteria
- Live table shows seed donors with `D-00NN` IDs, type and status in separate columns: **satisfied** (adapter and API tested; not clicked through in a browser)
- Each filter narrows results server-side and the query string is visible: **satisfied** (API and client tests; query string asserted)
- Drawer shows 6 HLA alleles grouped by locus plus organs list (empty if none): **satisfied** (API and adapter tested; not clicked through in a browser)
- Mock mode still works: **satisfied** (adapter and SSR render; not clicked through in a browser)
- API: `?type=DECEASED` returns only deceased; `/api/donors/99999` returns 404 `DONOR_NOT_FOUND`: **satisfied**
