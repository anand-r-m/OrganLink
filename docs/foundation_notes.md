# OrganLink — Phase 0 Foundation Notes

Technical notes for the Phase 0 shared foundation: installed versions, compatibility decisions, verification results, intentional limitations, and deferred work.

**Specs:** `dev_split.md`, `ui_mastercontext.md`  
**Audit:** `docs/phase0_status.md`

---

## Installed Package Versions

Resolved versions from `npm ls --depth=0` (2026-08-01):

| Package | Installed | `ui_mastercontext.md` Section 1 |
|---|---|---|
| `react` | 19.2.8 | 18.x |
| `react-dom` | 19.2.8 | (with React) |
| `vite` | 8.2.0 | 5.x |
| `@vitejs/plugin-react` | 6.0.5 | — (scaffold) |
| `@mantine/core` | 7.17.8 | 7.x |
| `@mantine/hooks` | 7.17.8 | 7.x |
| `@mantine/dates` | 7.17.8 | 7.x |
| `@mantine/notifications` | 7.17.8 | 7.x |
| `mantine-react-table` | 2.0.0-beta.9 | 2.x |
| `react-router-dom` | 7.18.2 | 6.x |
| `recharts` | 3.10.1 | 2.x |
| `react-leaflet` | 5.0.0 | 4.x |
| `leaflet` | 1.9.4 | 1.9.x |
| `jspdf` | 4.2.1 | 2.x |
| `jspdf-autotable` | 5.0.8 | 2.x |
| `@tabler/icons-react` | 3.46.0 | 3.x |
| `dayjs` | 1.11.21 | — |

Scaffold-only dev dependencies: `oxlint@1.76.0`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`

No additional runtime packages were installed beyond the Phase 0 list in `dev_split.md`.

---

## Compatibility Decisions

Decisions made because installed package APIs or npm resolution differed from `ui_mastercontext.md` or `dev_split.md`.

### 1. Mantine 7 vs npm default `@mantine/core@9`

**Issue:** Running `npm install @mantine/core` without a major pin resolves to Mantine 9.x. `mantine-react-table@latest` (1.3.4) requires `@mantine/core ^6`.

**Decision:** Pin `@mantine/core`, `@mantine/hooks`, `@mantine/dates`, and `@mantine/notifications` to `^7` (resolved 7.17.8) to match Section 1 of `ui_mastercontext.md` and enable Mantine 7–compatible table usage.

### 2. mantine-react-table 2.0.0-beta.9

**Issue:** npm `latest` for `mantine-react-table` is 1.3.4 (Mantine 6 peer). No stable 2.x release exists on npm; 2.x is published as beta (`2.0.0-beta.9` peers `@mantine/core ^7.9`).

**Decision:** Install `mantine-react-table@2.0.0-beta.9`. `DataTable.jsx` uses `useMantineReactTable` + `MantineReactTable` from this package. Pagination styling targets the library’s stable `.mrt-table-pagination` class because `mantinePaginationProps.className` is overridden internally.

### 3. Notifications API (Mantine 7)

**Issue:** `dev_split.md` Phase 0 task lists `NotificationsProvider`. Mantine 7 `@mantine/notifications` does not export `NotificationsProvider`.

**Decision:** `src/main.jsx` renders `<Notifications position="top-right" autoClose={4000} />` inside `MantineProvider`. Toast calls use `showNotification` / `notifications` from `@mantine/notifications` when pages need them (not yet wired in placeholders).

### 4. Vite scaffold into non-empty directory

**Issue:** `npx create-vite@latest ./ --template react` cancelled when existing Markdown files were present.

**Decision:** Scaffold into a temporary directory, then copy scaffold files into the repo root without overwriting `dev_split.md`, `ui_mastercontext.md`, or the original `README.md`.

### 5. Newer major versions for other dependencies

**Issue:** npm resolved current majors for React, Vite, react-router-dom, recharts, react-leaflet, and jspdf — all ahead of the version table in `ui_mastercontext.md`.

**Decision:** Accept npm-resolved versions without manual downgrades (per Phase 0 instruction: do not change versions unless the package manager resolves them). Production build succeeds with these versions. Downstream devs should verify API usage against installed majors (especially Recharts 3, react-router-dom 7, react-leaflet 5, jsPDF 4) rather than older doc examples alone.

---

## Verification Performed

### Build

```bash
npm run build
```

**Result:** Success (verified 2026-08-01). Output: `dist/index.html`, CSS ~266 kB, JS ~773 kB. Warning only: chunk size > 500 kB (no compile errors).

### Import / compile checks

- All nine page components, four shared components, and eight mock-data modules resolve without import errors in the production bundle.
- `Phase0SmokePage.jsx` imports all shared components and all mock-data exports for compile verification.

### Manual / automated runtime checks (`.phase0-verify/`)

A temporary Chrome CDP script (`.phase0-verify/verify.mjs`) was used during Phase 0 implementation. Documented results:

| Check | Result |
|---|---|
| Unauthenticated `/dashboard` → `/login` | Pass |
| Login form renders (OrganLink, subtitle, fields, Sign In) | Pass |
| Invalid credentials + Enter key → error text | Pass |
| `admin`/`admin` → `/dashboard` with full sidebar (8 items) | Pass |
| All 8 sidebar routes: URL, breadcrumb, heading | Pass |
| Shared components + mock data on `/__phase0-smoke` | Pass |
| FormModal open/close with neu-inset inputs | Pass (intermittent in headless Chrome due to animation timing) |
| Session persists across reload (`localStorage`) | Pass |
| Logout → `/login`, clears storage | Pass |
| Protected route after logout → `/login` | Pass |
| Unknown route → `/login` | Pass |
| Browser console errors during checks | None observed |

**Note:** `/__phase0-smoke` and `.phase0-verify/` are internal verification artifacts, not part of the product spec.

---

## Known Intentional Limitations of Phase 0

These are deliberate scope boundaries, not bugs:

1. **Placeholder pages only** — Eight AppShell pages render a title and ownership note only. No charts, tables, maps, modals, or CRUD on those routes yet.

2. **Minimal LoginPage** — Auth flow works (credentials, redirect, error message, Enter submit). Full glassmorphic design, `bg-login.jpg`, drift animation, and `.shake` on error are not implemented (Dev 3 Task 3.1).

3. **No CircularProgress or ViabilityCountdown** — Explicitly excluded from Phase 0; assigned to Dev 1.

4. **DataTable column filters** — Global search, pagination styling, headers, row hover, and empty state are implemented. Per-column Mantine `Select` filters (Section 4.2) are not enabled in the wrapper defaults.

5. **Shared components not used on placeholder pages** — Components exist and compile; only `Phase0SmokePage` demonstrates them in-app.

6. **No backend** — Auth is hardcoded frontend-only. Mock data is static exported arrays; no global mutation layer.

7. **Missing asset** — `public/assets/bg-login.jpg` is documented in `ui_mastercontext.md` Section 7 but not included (needed for Dev 3 login polish).

8. **Non-spec route** — `/__phase0-smoke` remains in `App.jsx` for internal verification; remove before production handoff if desired.

9. **Breadcrumb is single-segment** — Shows one label per route, not multi-level trails (e.g. "Donors > Register") until pages add nested routes.

10. **Bundle size** — All library CSS/JS loads upfront; no route-based code splitting yet.

---

## Deferred Work by Developer

### Dev 1

| Item | Reference |
|---|---|
| Dashboard: stat cards, AreaChart, alerts, offers table | `dev_split.md` Task 1.1, Section 5.2 |
| `CircularProgress.jsx` | Task 1.2, Section 4.5 — **blocks Dev 3 matching** |
| Reports: 4 charts, compliance summary, PDF export | Task 1.3, Section 5.8 |
| Transport: Leaflet map, polylines, transport table | Task 1.4, Section 5.7 |
| `ViabilityCountdown.jsx` | Task 1.4, Section 4.6 |
| Replace placeholders: `DashboardPage`, `ReportsPage`, `TransportPage` | — |

### Dev 2

| Item | Reference |
|---|---|
| Donor Registry: table, drawer, register modal, toasts | Task 2.1, Section 5.3 |
| Recipient Waitlist: filters, table, tooltips, add modal | Task 2.2, Section 5.4 |
| Settings: 5 tabs (Hospitals, Regions, Organ Types, Matrix, Weights) | Task 2.3, Section 5.9 |
| Enable DataTable column filters on page tables if needed | Section 4.2 |
| Replace placeholders: `DonorRegistryPage`, `RecipientWaitlistPage`, `SettingsPage` | — |

### Dev 3

| Item | Reference |
|---|---|
| Login: glass card, background image, shake animation | Task 3.1, Section 5.1 |
| Matching Console: organ select, sliders, ranked cards, accordion | Task 3.2, Section 5.5 — uses Dev 1 `CircularProgress` |
| Offer Workflow: status machine, modals, one-active-offer rule | Task 3.3, Section 5.6 |
| Replace placeholders: `MatchingConsolePage`, `OfferWorkflowPage` | — |
| Wire `showNotification` toasts for accept/decline/create flows | Section 5.6 |

### All devs (Phase 4)

Cross-page testing, visual consistency, `.mono` usage audit, `npm run build`, browser testing at 1280×1024 and 1920×1080 — see `dev_split.md` Phase 4.

---

## Repository Hygiene Notes

- `.phase0-verify/` contains browser profile data and verification scripts; exclude from commits.
- `dist/` is build output; listed in `.gitignore`.
- Phase 0 source was untracked at audit time except original markdown files; commit foundation on `dev/foundation` per `dev_split.md` git workflow.
