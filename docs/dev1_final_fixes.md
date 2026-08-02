# Dev 1 — Final Frontend Fixes

Scope reviewed: Dashboard, Reports (incl. PDF export), Transport (map + table),
`CircularProgress`, `ViabilityCountdown`. Verified against `docs/dev1_control.md`,
`.phase0-backup/dev_split.md`, `.phase0-backup/ui_mastercontext.md`.

**Verification run tonight**
- `npm run build` → clean (D1-08 pass; only the generic >500 kB chunk-size note).
- PDF export runtime tested (jspdf 4 / jspdf-autotable 5): `autoTable(doc, …)`,
  `doc.lastAutoTable.finalY` chaining, and multi-page all work → D1-05 not broken.
- Map uses `CircleMarker` (no Leaflet default-icon 404), grayscale filter, India
  center z5, status-colored polylines → D1-06 sound.
- `CircularProgress` matches the Dev 3 contract (64px SVG, primary→success
  gradient, `.mono` center %, `value`/`label` props, clamped 0–100) → no Dev 3
  regression.
- All stat/chart/table values match the spec (Dashboard stats, 4 report charts,
  compliance metrics, recent/transport rows).

## Critical — fix before demo

_No critical issues found. No page is broken, the map and PDF export both work,
chart/table data is correct, and the shared `CircularProgress` that Dev 3 depends
on is intact._

## Important — fix only if time remains

- [ ] Issue: The signature "< 1 hour = pulsing red glow" viability state (D1-06 /
      mastercontext 4.6) is never visible in the demo — no transport row has under
      one hour remaining, so the flagship animation can't be shown.
  Evidence: `ViabilityCountdown.jsx:48` triggers `pulse-danger` only when
      `0 < remainingSeconds < 3600`. In `src/data/mockTransports.js` the
      remaining times (viabilityHours − elapsedHours) are 16h, 2h, 5h, 19h, 8h,
      0h, 2h — none fall in the 0–1h window.
  Smallest patch: change one row's `elapsedHours` to leave < 1h (e.g. TRN-0045
      Heart `elapsedHours: 4 → 5.5`, giving 0.5h remaining).
  File(s): `src/data/mockTransports.js` (single value).
  Manual proof: open `/transport`; that row's countdown bar is red and pulses.

- [ ] Issue: Transport records table shows a horizontal scrollbar at the smallest
      supported width (1280px), a minor visual blemish on a target resolution.
  Evidence: `src/pages/TransportPage.css:20-24` forces `.data-table` `min-width: 970px`
      (sum of column `size`s in `TransportPage.jsx:14-73`). At 1280px the content
      area is 1280 − 240 sidebar − 64 padding = 976px, and the card's own 24px
      padding leaves ~928px inner width < 970px → the table overflows/scrolls.
  Smallest patch: trim ~50px of column `size` (e.g. the two 130px hospital columns
      to ~110px) or lower the CSS `min-width` to ~920px.
  File(s): `src/pages/TransportPage.jsx` (column sizes) or `src/pages/TransportPage.css`.
  Manual proof: at 1280×1024 the transport table fits with no horizontal scrollbar.

- [ ] Issue: `CircularProgress` renders an empty caption and an `aria-label` of
      "undefined: N%" when used without a `label` — a robustness gap on the exact
      component Dev 3 consumes on matching cards.
  Evidence: `CircularProgress.jsx:30` (`aria-label={`${label}: ${displayValue}%`}`)
      and `:80-88` always render `<figcaption>{label}</figcaption>`.
  Smallest patch: only render the caption when `label` is truthy and fall back to
      `Match score` in the aria-label.
  File(s): `src/components/CircularProgress.jsx`.
  Manual proof: render `<CircularProgress value={87} />` — no empty caption box,
      screen reader announces a sensible label.

## Skip tonight

- [ ] Dashboard "Recent Organ Offers" table omits the **Hospital** column listed in
      mastercontext 5.2. `mockOffers` has no hospital field and `dev1_control.md`
      both lists the offer fields without it and forbids shared-data changes, so
      the current columns are consistent with Dev 1's contract.
      File(s): `src/pages/DashboardPage.jsx:74-109`.
- [ ] Reports "Allocation Fairness" is a grouped Actual/Expected BarChart without
      the optional "Expected (fair)" overlay line. Mastercontext 5.8 explicitly
      allows "RadarChart **or** grouped BarChart", so this satisfies the spec.
      File(s): `src/pages/ReportsPage.jsx:300-343`.
- [ ] Dev 1 data tables surface the default mantine-react-table toolbar icons
      (density / column visibility / fullscreen). This is shared `DataTable`
      behavior used by all devs, not Dev 1-owned, and harmless.
      File(s): `src/components/DataTable.jsx` (shared).
- [ ] Audit-report PDF header rows use a hardcoded blue `[41, 98, 255]` rather than
      the teal primary token. The "no hardcoded hex" rule targets the on-screen UI;
      jsPDF cannot read CSS tokens, and the mastercontext PDF spec sets no colors.
      File(s): `src/pages/reportsAuditPdf.js:177,198,215,227`.
- [ ] The Reports date-range picker filters only the exported PDF, not the on-page
      charts. Mastercontext 5.8 specifies static demo charts + date-scoped export,
      so this is the intended behavior.
      File(s): `src/pages/ReportsPage.jsx`, `src/pages/reportsAuditPdf.js`.
