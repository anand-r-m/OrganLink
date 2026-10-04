# OL-017 Report: Transport (list, depart, deliver)

## Files changed
- `server/routes/transport.js` (new): `GET /api/transport`, `POST /api/transport/:id/depart`, `POST /api/transport/:id/deliver`.
- `server/util/transportSql.js` (new): shared transport query and adapter.
- `server/index.js`: mounts `/api/transport` behind `requireAuth`.
- `src/api/transport.js`, `src/api/adapters/transport.js` (new): live and mock API layer, adapter, marker and action helpers.
- `src/pages/TransportPage.jsx`: reads from the API layer; adds Arrived At and Actions columns, two confirmation modals, toasts.
- `src/components/TransportMap.jsx`: takes a `transports` prop instead of importing mock data; one marker per origin/destination hospital.
- `tests/server/transport.test.js`, `tests/client/transport.test.js` (new).
- `docs/implementation/LESSONS_LEARNED.md`, this report.
- Local only, not committed: `.env` (copied from `.env.example`, gitignored).

## Behavior implemented
- `GET /api/transport` sweeps first, supports `?status=` (comma list, 400 on unknown values) and lists PENDING/IN_TRANSIT first, then newest first. Items follow the contract's Transport shape, plus an additive `maxViabilityHours` (the UI needs it to size the countdown bar; no existing field changed).
- `depart`: conditional `UPDATE ... WHERE status = 'PENDING'`, sets `departed_at`. `deliver`: `WHERE status = 'IN_TRANSIT'`, sets `arrived_at`. The organ is locked `FOR UPDATE` first. Zero rows gives 404 `TRANSPORT_NOT_FOUND` or 409 `INVALID_STATE_TRANSITION` (with `currentStatus` and `requiredStatus`).
- The countdown uses the organ's `expiresAt`/`hoursRemaining` (v_organ), not a separate clock, and is shown only for PENDING and IN_TRANSIT.
- Expiry in transit follows OL-DEC-02 Option A: no check, documented limitation (no code).
- UI: the Mark In Transit button shows only for PENDING and Mark Delivered only for IN_TRANSIT; other states show "—". Each opens a confirmation modal; success shows a toast, errors show the server message and reload the list.
- Mock mode keeps working: mock rows are held in memory, statuses are mapped to schema values, and mock transitions raise the same 409.

## Tests and validations
| Check | Result |
|---|---|
| `npm run db:reset -- --yes` (new local `organlink` DB) | OK |
| Baseline `npm run test:server` before changes | 83/83 pass |
| `npm run test:server` after | 89/89 pass (6 new transport tests) |
| `npm run test:client` | 59/59 pass (8 new transport tests) |
| `npm run build` | OK |
| `npx oxlint` | no new warnings (pre-existing warnings only) |
| Running server (`node server/index.js`): login, `GET /api/transport`, depart on unknown id | 200, `[]`, 404 `TRANSPORT_NOT_FOUND` |

Server tests cover: auth (401), 404s, response shape and coordinates, PENDING row for the OL-016 accept, filtering and bad status (400), skip deliver (409, no change), depart, repeat depart (409, timestamp unchanged), deliver, repeat deliver and depart-after-deliver (409), `arrived_at >= departed_at`, DB rows after each step, organ stays ALLOCATED, and the offer embedding `transport: {id, status}`.

## Failures encountered
- Environment only: Postgres was stopped and `.env` was missing. Fixed locally and reversibly (see LESSONS_LEARNED). No code failures.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/transport` | Open the page after OL-016 accepted an offer | New PENDING row, with origin and destination markers and a line on the map | Deferred to consolidated manual QA (API data and the adapter are covered by tests; build passes) |
| `/transport` | Click **Mark In Transit** on a PENDING row | Confirmation modal; on confirm a green toast, status becomes In Transit, "Departed At" filled, button becomes Mark Delivered | Deferred to consolidated manual QA (endpoint: automated; mock transition: automated) |
| `/transport` | Click **Mark Delivered** on an IN_TRANSIT row | Confirmation modal; on confirm a toast, status becomes Delivered, "Arrived At" filled, no button | Deferred to consolidated manual QA (endpoint: automated) |
| `/transport` | Cancel in either modal | Modal closes, nothing changes | Deferred to consolidated manual QA |
| `/transport` | Act on a row whose state changed elsewhere | Red toast with the 409 message, list reloads | Deferred to consolidated manual QA (409 API: automated) |
| `/transport` | Click a hospital marker | Popup with origin/destination/active counts | Deferred to consolidated manual QA |
| `/transport` | Row in DELIVERED or FAILED state | No action button, no countdown ("—") | Automated test coverage for the action rule (`nextTransportAction`); visual part deferred |

No browser was opened for this task.

## Remaining risks / follow-ups
- All UI interactions above are unverified in a browser.
- OL-DEC-02 (A) limitation stands: an ALLOCATED organ in transit can pass its viability window without the transport failing.
- Mock "Expired" transports map to FAILED, which is the closest schema status.
- `GET /api/transport` returns an empty list on a fresh seed (no seeded transports), so the page is empty until an offer is accepted.

## Acceptance criteria
- Transport created by OL-016 shows PENDING with origin and destination markers: **satisfied at API/data level** (tested); marker rendering deferred to manual QA.
- Mark In Transit then Mark Delivered move status forward and each timestamp is shown: **satisfied** (API tested; timestamps in table columns, display deferred to manual QA).
- Repeating or skipping returns 409 `INVALID_STATE_TRANSITION`, and the button is hidden for invalid states: **satisfied** (409 tested; button rule tested via `nextTransportAction` and the page source).
- Expiry in transit follows OL-DEC-02: **satisfied** (Option A, documented limitation, no code).
