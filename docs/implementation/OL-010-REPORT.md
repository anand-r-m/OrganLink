# OL-010 Report — StatusBadge: new states and spec colours

## Files changed
- `src/utils/status.js` (new): `getStatusVariant` (normalised lookup) and `formatStatusLabel`.
- `src/components/StatusBadge.jsx`: uses the new module, re-exports both functions, and formats the default label.
- `src/pages/Phase0SmokePage.jsx`: badge grid now shows all 20 spec states plus 4 Title Case mock values.
- `tests/client/status.test.js` (new).
- `docs/implementation/LESSONS_LEARNED.md`, `docs/implementation/OL-010-REPORT.md`.

`src/index.css` unchanged: the existing success/warning/danger/info/muted classes already cover every colour. No schema, API contract, backlog or spec changes.

## Behavior implemented
- Colours per 07 §4: green ACCEPTED/DELIVERED/TRANSPLANTED/ACTIVE; amber SENT/IN_TRANSIT/PENDING/1B; red DECLINED/FAILED/EXPIRED/1A; blue CREATED/ALLOCATED/2; grey VOIDED/CANCELLED/DISCARDED/SUSPENDED/INACTIVE.
- Keys are normalised (case-insensitive, spaces and underscores equivalent), so `IN_TRANSIT` and `In Transit` both work.
- Label formatter: `IN_TRANSIT` → "In Transit". Mixed-case values and urgency codes are unchanged.
- Behaviour changes: EXPIRED grey→red, SUSPENDED red→grey, ALLOCATED teal→blue (07 §4 lists Allocated as blue).
- Kept for mock compatibility: available (green), waiting (amber), offered/preparing (blue), deceased/completed (teal).

## Tests and validations run
- `npm run test:client`: 20 pass, 0 fail (10 new in `status.test.js`).
- Server-side render of `StatusBadge` for sample states: correct class and label (e.g. `IN_TRANSIT` → `badge-pending` "In Transit", `EXPIRED` → `badge-declined`, `SUSPENDED` → `badge-expired`).
- `npx vite build`: succeeds. `npm run lint`: warnings only, none in files touched by this task.
- DB and API tests: n/a. The server tests were not run, since no server code changed.
- Not done: a visual check in a browser of `/__phase0-smoke`. I verified the markup and CSS class mapping instead.

## Failures encountered
None.

## Remaining risks or follow-ups
- Pages that pass mock Title Case values still work. Pages that pass live UPPER_SNAKE values get correct colours and labels with no change.
- A genuinely unknown status renders grey.

## Acceptance criteria
- Each state above renders its colour and a readable label: **satisfied** (unit tests and SSR render).
- EXPIRED is red and SUSPENDED is grey: **satisfied**.
- `__phase0-smoke` still renders every mock badge: **satisfied** at build and markup level. The page was not opened in a browser.
