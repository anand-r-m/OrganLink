# OL-005 Report — Frontend API client, mock/live switch, first live resource

## Files changed
- `server/routes/hospitals.js` (new): `GET /api/hospitals` (filters `regionId`, `status`; 400 on bad values). POST/PATCH stay in OL-024.
- `server/routes/lookups.js` (new): `GET /api/lookups` (blood groups, urgencies, decline/discard/exclusion reasons, organ types, HLA alleles).
- `server/index.js`: both routers mounted after `requireAuth`.
- `src/api/client.js`: `apiFetch` gains `params` (query string) and wraps network failures as `ApiError(0, 'NETWORK_ERROR')`; `import.meta.env` is optional-chained so node tests can import it.
- `src/api/notify.js` (new): `showApiError` shows a red Mantine notification with the server's `message`.
- `src/api/hospitals.js`, `src/api/lookups.js`, `src/api/adapters/hospitals.js` (new): the mock/live pattern. Mock mode returns `mockHospitals`; live mode calls the API and adapts rows to the table's existing shape. Lookups are cached per session and failures are not cached.
- `src/utils/displayId.js` (new): `D-`, `R-`, `O-`, `OF-`, `T-`, `MR-` formats (A11), plus `HSP-001` for hospitals to match the mock.
- `src/pages/SettingsPage.jsx`: Hospitals tab loads through the module (spinner, error notification); `traumaLevel` null renders "—"; in live mode Add/Edit/Suspend are disabled (writes arrive in OL-024); the Regions tab keeps mock hospitals in live mode so its counts don't change.
- `tests/server/lookups-hospitals.test.js`, `tests/client/api.test.js` (new); `package.json` (`test:client` script); `docs/implementation/LESSONS_LEARNED.md`.
- `.env.example` was not changed: it already has everything. `VITE_DATA_SOURCE` is a Vite flag and was not added, since OL-004 left it undocumented there and it is OL-033's README job.

## Behavior implemented
- Live mode (`VITE_DATA_SOURCE=api`): Settings → Hospitals shows DB hospitals; an API error shows a notification with the server message. Mock mode: unchanged (`mockHospitals`).
- Both new endpoints require a session (401 `UNAUTHENTICATED`).

## Tests and validations (throwaway local Postgres 18 on :5433, `db:reset -- --yes`; `.env` untouched)
- `npm run test:server`: 30/30 pass (4 new).
- `npm run test:client`: 10/10 pass (client error envelope, query building, adapter, display IDs, mock/live branches, lookups cache).
- Through the Vite proxy with `VITE_DATA_SOURCE=api npm run dev`: both endpoints 401 without a cookie; with the cookie, `/api/hospitals` returned the inserted hospital; `/api/lookups` counts were 8/3/6/6/5/5 (plus 18 HLA alleles); after `UPDATE hospital SET name=name||' *'` the next request showed the change.
- `npm run build`: succeeds. `npm run lint`: only warnings that were already there (for example the unused `mockCompatibility` import in SettingsPage).

## Failures encountered
- No failing tests. Setup issues and one review catch are in LESSONS_LEARNED.

## Risks / follow-ups
- **Not verified in a real browser.** The Hospitals tab rendering in both modes, the loading state, and the error notification are covered by unit tests of the data layer and by the build only. A manual check is advised: run once without the flag and once with `VITE_DATA_SOURCE=api`, and stop the API to see the notification.
- Live-mode hospital writes are disabled (with a tooltip) rather than silently local-only. This is my choice; OL-024 re-enables them.
- Live hospitals show the full region name ("Southern Region") and no trauma level; the schema has no trauma level (A9). The `StatusBadge` colour for SUSPENDED stays red until OL-010.
- The reference seed has no hospitals, so the live table is empty until OL-006.
- `GET /api/lookups` is Proposed (A5) and is implemented as written in the contract, including `hlaAlleles`.

## Acceptance criteria
- Live mode Hospitals tab shows DB hospitals; mock mode shows `mockHospitals`: **satisfied for the data layer and API (tests, curl); UI rendering not browser-verified**
- `GET /api/lookups` returns 8 / 3 / 6 / 6 / 5 / 5: **satisfied**
- An API error shows a Mantine notification with the server's `message`: **implemented (`showApiError` wired to the load); notification display not browser-verified**
- No page other than Settings → Hospitals changes behaviour: **satisfied by inspection** (the Regions tab is pinned to mock data in live mode)
- API tests: with cookie returns data, without cookie 401: **satisfied**
