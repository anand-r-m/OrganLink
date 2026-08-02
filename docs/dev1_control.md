# Dev 1 Control — Dashboard · Reports · Transport

## Foundation audit (verified present)
- React+Vite+Mantine, routes, `AppShell`: `src/App.jsx`, `src/components/AppShell.jsx` — `/dashboard`, `/reports`, `/transport` mount placeholders. **OK**
- Theme + neu CSS: `src/theme.js`, `src/index.css` (`.neu-raised`, `.neu-inset`, `.neu-raised-sm`, `.mono`, `.neu-hover-lift`, `.pulse-danger`, tokens). **OK**
- Shared components: `src/components/StatCard.jsx`, `StatusBadge.jsx`, `DataTable.jsx`, `FormModal.jsx`. **OK**
- Deps: `recharts`, `react-leaflet`+`leaflet`, `jspdf`+`jspdf-autotable`, `@tabler/icons-react`, `dayjs` in `package.json`; leaflet CSS imported in `src/main.jsx`. **OK**
- `CircularProgress`, `ViabilityCountdown`: **absent — Dev 1 owns these (not blockers).**

No blockers. No missing item owned by another dev. DataTable column filters not enabled → work around via `...tableOptions`.

## Conventions
- JSX default-export components in `src/components` and `src/pages`; import with `.jsx`.
- Reuse foundation; do not edit shared files. Add Dev 1 files only.
- Class-based neu styling from `index.css`; `.mono` for IDs/scores/timestamps.

## Component/page contracts
- `CircularProgress`: props `value` (0–100), `label`; 64px SVG, gradient primary→success, center % in `.mono`. Consumed by Dev 3 later.
- `ViabilityCountdown`: derive from `viabilityHours`/`elapsedHours`; `.neu-inset` track; success>50% / warning 20–50% / danger<20%; `.mono` timer; apply `.pulse-danger` when <1h; `aria-live="polite"`.
- Dashboard/Reports/Transport: replace placeholder body only; wrap sections in `.neu-raised` cards, 24px padding, 20px grid gap.

## Mock-data imports & fields
- `src/data/mockOffers.js` → `mockOffers`: `id, organId, organType, donorId, recipientId, status, offeredAt`.
- `src/data/mockHospitals.js` → `mockHospitals`: `id, name, region, lat, lng`.
- `src/data/mockTransports.js` → `mockTransports`: `id, organId, organType, originHospital, destHospital, originCoords, destCoords, status, viabilityHours, elapsedHours, departedAt`.
- Charts/compliance: use static demo arrays; no shared-data changes.

## Visual rules
Desktop 1280px+ only. Bio-Tactile Sci-Fi (neumorph + subtle HUD). Use CSS tokens (`--color-primary/success/warning/danger/info`, shadows, radii); no hardcoded hex. `.mono` for Offer/Donor/Recipient/Organ IDs, scores, timestamps, timers. Status via `StatusBadge` (text + color).

## Task order & acceptance
- **D1-01 CircularProgress** — renders 0/50/100 correctly; `.mono` center; gradient; `value`+`label` work.
- **D1-02 Dashboard** — 4 `StatCard`s; Recharts AreaChart; alerts panel; recent offers via `DataTable` (mono IDs, `StatusBadge`); "View All →" → `/offers`; no console errors.
- **D1-03 ViabilityCountdown** — color thresholds + `.pulse-danger` <1h; `.mono` timer; `aria-live`.
- **D1-04 Reports UI** — 4 chart cards + compliance summary in `.neu-raised`; date picker `.neu-inset`.
- **D1-05 PDF export** — jsPDF+autotable; downloads `OrganLink_Audit_Report_YYYY-MM-DD.pdf` with header/summary/history.
- **D1-06 Transport map** — Leaflet India center z5; hospital markers; status-colored polylines; grayscale tiles; 400px `.neu-raised`.
- **D1-07 Transport table** — `DataTable` below map; `ViabilityCountdown` column; mono IDs.
- **D1-08 Test/polish** — `npm run build` clean; 1280/1920 check; hover/press/badges/empty states.

## Blocking questions
None.
