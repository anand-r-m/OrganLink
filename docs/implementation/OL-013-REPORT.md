# OL-013 Report: Organs read and Organs page

## Files changed
- `server/routes/organs.js` (new): `GET /api/organs`, `GET /api/organs/:id`
- `server/util/organSql.js` (new): organ SQL moved out of `donors.js`, shared
- `server/routes/donors.js`, `server/index.js`: import the shared SQL, mount `/api/organs`
- `src/api/organs.js`, `src/api/adapters/organs.js` (new): mock/live `listOrgans`, row adapters
- `src/pages/OrgansPage.jsx` (new), `src/App.jsx` (`/organs` route), `src/components/AppShell.jsx` (nav item "Organs" between Recipient Waitlist and Matching Console, breadcrumb)
- `tests/server/organs-read.test.js`, `tests/client/organs.test.js` (new)
- `docs/implementation/LESSONS_LEARNED.md`

## Behavior implemented
- `GET /api/organs` filters on `status`, `available=true` (AVAILABLE and not expired) and `organTypeId`. Order is newest `recoveredAt` first, and the sweep runs first. Bad filters return 400 `VALIDATION_ERROR`.
- `GET /api/organs/:id` returns the organ with `defaultWeights` from the recovering hospital's region. Missing or malformed ids return 404 `ORGAN_NOT_FOUND`. The sweep runs first.
- The Organs page is a `DataTable` with ID, type, donor, blood group, recovering hospital, recovered time, `ViabilityCountdown` (AVAILABLE and EXPIRED only; other statuses show "—"), status badge, and an active-offer indicator, plus a status filter. Expired organs stay listed with the EXPIRED badge. Mock mode uses `mockOrgans`.
- No change to API_CONTRACT.md. Discard is left to OL-023.

## Tests and validations
Throwaway local PG 18.6 on port 5433, reset with `npm run db:reset -- --yes`.
- `npm run test:server`: 63 pass, 0 fail. This includes 9 new organ tests:
  - auth
  - list shape and order, and that the list count equals `count(*)` from `organ`
  - back-dated Kidney becomes EXPIRED via the sweep (also persisted in the DB)
  - `?available=true`
  - status and type filters
  - 400 on bad filters
  - `:id` with weights matching the `region` row
  - the sweep on `:id`
  - 404 `ORGAN_NOT_FOUND`
- `npm run test:client`: 31 pass, 0 fail. This includes 4 new tests covering the adapter, mock mode, the live query string, and nav order and routing.
- Live curl on a running server: `/api/organs?available=true` returned the 3 seed organs, and `/api/organs/99999` returned 404 `ORGAN_NOT_FOUND`.
- `vite build` succeeded. `npm run lint` shows no new warnings (existing ones only).
- SSR smoke: `OrgansPage` renders, and the nav order is correct.

## Failures encountered
None.

## Remaining risks / follow-ups
- SSR does not run effects, so I did not visually verify the table rows or the red pulse in a browser. The pulse comes from the existing `ViabilityCountdown` (<1 h). I recommend a quick look at `/organs` in both modes.
- The countdown is hidden for ALLOCATED, TRANSPLANTED and DISCARDED organs. This is my choice, consistent with OL-DEC-02, since those organs never expire.

## Acceptance criteria
- Table lists every organ, and expired organs show the EXPIRED badge: **satisfied** (API test; the page renders all returned rows with the badge).
- Countdown reflects `expiresAt`, with the red pulse under 1 h: **satisfied by the existing component**. It is fed `maxViabilityHours - hoursRemaining`, and I did not check it in a browser.
- `?available=true` returns only AVAILABLE, non-expired organs: **satisfied**.
- Nav shows "Organs" between Recipients and Matching: **satisfied**.
