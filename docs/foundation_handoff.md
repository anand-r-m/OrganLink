# OrganLink — Phase 0 Foundation Handoff

Shared frontend foundation for the OrganLink hackathon repository. Phase 0 delivers the scaffold, design system, auth shell, routes, shared components, and mock data. Page-specific functionality is intentionally deferred to Dev 1, Dev 2, and Dev 3 per `dev_split.md`.

**Authoritative specs:** `dev_split.md`, `ui_mastercontext.md`

---

## Project Overview

OrganLink is a desktop admin dashboard (1280×1024+ target) for transplant operations. The Phase 0 foundation provides:

- React + Vite application with Mantine UI and neumorphic design tokens
- Hardcoded frontend auth (`admin` / `admin`) with `localStorage` persistence
- Protected app shell (sidebar, header, breadcrumbs) and all documented routes
- Four reusable components: `StatCard`, `StatusBadge`, `FormModal`, `DataTable`
- Eight mock-data modules with realistic Indian hospital/regional data
- Nine page files (minimal login + eight labelled placeholders inside AppShell)

No backend, database, API, or deployment setup exists.

---

## Setup Instructions

From the repository root:

```bash
npm install
```

Install the Phase 0 dependencies (already listed in `package.json`; run the above if starting fresh):

```bash
npm install @mantine/core @mantine/hooks @mantine/dates @mantine/notifications
npm install mantine-react-table
npm install react-router-dom recharts
npm install react-leaflet leaflet
npm install jspdf jspdf-autotable
npm install @tabler/icons-react
npm install dayjs
```

Start the development server:

```bash
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173`).

**Test credentials:** username `admin`, password `admin`

---

## Build Instructions

Production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

Lint (Oxlint, from Vite scaffold):

```bash
npm run lint
```

---

## Developer Verification Utilities

The repository includes internal-only tools for verifying auth, routing, shared components, and mock data (`Phase0SmokePage`, `/__phase0-smoke`, `.phase0-verify/verify.mjs`, `.phase0-verify/probe.mjs`). These are **not** part of the OrganLink product spec.

See **[docs/developer_verification.md](developer_verification.md)** for the purpose of each artifact, when to use it, when not to use it, and how to run the CDP scripts.

---

## Folder Structure

```text
OrganLink/
├── dev_split.md                 # Sprint plan and dev ownership
├── ui_mastercontext.md          # Design specs (source of truth)
├── docs/
│   ├── phase0_status.md         # Phase 0 audit
│   ├── foundation_handoff.md    # This file
│   ├── foundation_notes.md      # Versions and compatibility decisions
│   └── developer_verification.md # Internal verification tools (not product)
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx                 # Entry: MantineProvider, Notifications, Router, Auth
│   ├── App.jsx                  # Route definitions
│   ├── theme.js                 # Mantine theme overrides
│   ├── index.css                # Global design system CSS
│   ├── context/
│   │   └── AuthContext.jsx
│   ├── components/
│   │   ├── AppShell.jsx
│   │   ├── StatCard.jsx
│   │   ├── StatusBadge.jsx
│   │   ├── FormModal.jsx
│   │   └── DataTable.jsx
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── DonorRegistryPage.jsx
│   │   ├── RecipientWaitlistPage.jsx
│   │   ├── MatchingConsolePage.jsx
│   │   ├── OfferWorkflowPage.jsx
│   │   ├── TransportPage.jsx
│   │   ├── ReportsPage.jsx
│   │   ├── SettingsPage.jsx
│   │   └── Phase0SmokePage.jsx  # Internal verification page (non-spec route)
│   └── data/
│       ├── mockDonors.js
│       ├── mockRecipients.js
│       ├── mockOrgans.js
│       ├── mockOffers.js
│       ├── mockTransports.js
│       ├── mockHospitals.js
│       ├── mockRegions.js
│       └── mockCompatibility.js
├── index.html
├── vite.config.js
└── package.json
```

**Not yet present (deferred):** `public/assets/bg-login.jpg`, `CircularProgress.jsx`, `ViabilityCountdown.jsx`

---

## Route Map

| Path | Layout | Page component | Breadcrumb (when in AppShell) | Owner |
|---|---|---|---|---|
| `/login` | None (standalone) | `LoginPage` | — | Dev 3 (Task 3.1 polish) |
| `/` | AppShell | redirect → `/dashboard` | — | — |
| `/dashboard` | AppShell | `DashboardPage` | Dashboard | Dev 1 |
| `/donors` | AppShell | `DonorRegistryPage` | Donor Registry | Dev 2 |
| `/recipients` | AppShell | `RecipientWaitlistPage` | Recipient Waitlist | Dev 2 |
| `/matching` | AppShell | `MatchingConsolePage` | Matching Console | Dev 3 |
| `/offers` | AppShell | `OfferWorkflowPage` | Offer Workflow | Dev 3 |
| `/transport` | AppShell | `TransportPage` | Logistics & Viability Tracking | Dev 1 |
| `/reports` | AppShell | `ReportsPage` | Analytics & Compliance | Dev 1 |
| `/settings` | AppShell | `SettingsPage` | System Configuration | Dev 2 |
| `/__phase0-smoke` | AppShell | `Phase0SmokePage` | (none mapped) | Internal only |
| `*` | — | redirect → `/login` | — | — |

Protected routes require `isAuthenticated === true`. Unauthenticated access to any AppShell route redirects to `/login`.

---

## AuthContext API

**Module:** `src/context/AuthContext.jsx`

### Exports

| Export | Type | Description |
|---|---|---|
| `AuthProvider` | React component | Wraps the app; provides auth state |
| `useAuth()` | Hook | Returns auth context; throws if used outside provider |
| `default` | Context object | Raw React context (prefer `useAuth`) |

### Context value

| Field | Type | Description |
|---|---|---|
| `isAuthenticated` | `boolean` | Current auth state; initialized from `localStorage` on load |
| `login(username, password)` | `(string, string) => boolean` | Validates against `admin`/`admin`; on success sets state and persists to `localStorage`; returns `true`/`false` |
| `logout()` | `() => void` | Clears `localStorage` and sets `isAuthenticated` to `false` |

### Persistence

- **Key:** `organlink.auth`
- **Value:** `'true'` when logged in; key removed on logout

### Protected-route behavior

- `AppShell` checks `isAuthenticated`; if false, renders `<Navigate to="/login" replace />`
- `LoginPage` redirects authenticated users to `/dashboard`
- Catch-all route `*` sends unknown paths to `/login`

---

## AppShell Responsibilities

**Module:** `src/components/AppShell.jsx`

- **Auth guard:** Redirects unauthenticated users to `/login`
- **Sidebar (240px fixed):**
  - Logo text: "OrganLink"
  - Nav items with Tabler icons (Section 3.2 of `ui_mastercontext.md`)
  - Divider before Settings
  - Active item: inset neumorphic shadow; hover: primary-light background
- **Header (60px):**
  - Left: breadcrumb label from `BREADCRUMBS` map keyed by pathname
  - Right: Admin avatar ("A") + "Admin" label; menu with Log out
- **Content:** `<Outlet />` in scrollable area with `page-fade-in` animation
- **Exported constants:** `NAV_ITEMS`, `SETTINGS_ITEM`, `BREADCRUMBS` (reusable by pages)

---

## Shared Component Contracts

### StatCard

**Import:** `import StatCard from '../components/StatCard.jsx'`

| Prop | Type | Default | Description |
|---|---|---|---|
| `icon` | Tabler icon component | — | Rendered in 40px circle |
| `value` | string \| number | required | Large metric (32px bold) |
| `label` | string | required | Secondary label below value |
| `trend` | number \| null | `null` | Positive = ▲ green; negative = ▼ red |
| `trendLabel` | string | — | Overrides numeric trend display |
| `color` | `'primary'` \| `'success'` \| `'warning'` \| `'danger'` \| `'info'` | `'primary'` | Icon accent color |
| `className` | string | `''` | Extra classes |

**Example:**

```jsx
import { IconHeart } from '@tabler/icons-react';
import StatCard from '../components/StatCard.jsx';

<StatCard icon={IconHeart} color="danger" value={12} label="Available Organs" trend={3} />
```

Uses `.neu-raised` and `.neu-hover-lift`.

---

### StatusBadge

**Import:** `import StatusBadge, { getStatusVariant } from '../components/StatusBadge.jsx'`

| Prop | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Status text; auto-maps to color variant |
| `variant` | `'success'` \| `'warning'` \| `'danger'` \| `'primary'` \| `'muted'` \| `'info'` | — | Overrides auto-mapping |
| `label` | string | — | Display text; defaults to `status` |
| `className` | string | `''` | Extra classes |

Renders visible text label (never color-only). Maps donor, recipient, offer, transport, organ, hospital, and urgency statuses per `dev_split.md` / Section 4.3.

**Example:**

```jsx
<StatusBadge status="Sent" />
<StatusBadge status="1A" />
<StatusBadge status="Waiting" variant="warning" />
```

---

### FormModal

**Import:** `import FormModal from '../components/FormModal.jsx'`

| Prop | Type | Default | Description |
|---|---|---|---|
| `opened` | boolean | required | Controls modal visibility |
| `onClose` | `() => void` | required | Called on cancel/overlay close |
| `title` | string | required | Modal title |
| `children` | ReactNode | required | Form fields (Mantine inputs) |
| `onSubmit` | `(event) => void` | — | Called on form submit (after `preventDefault`) |
| `submitLabel` | string | `'Save'` | Primary button text |
| `cancelLabel` | string | `'Cancel'` | Cancel button text |
| `loading` | boolean | `false` | Submit button loading state |
| `size` | Mantine modal size | `'md'` | Modal width |
| `...modalProps` | — | — | Passed to underlying Mantine `Modal` |

Neumorphic body, blurred overlay, inset-styled inputs via `.form-modal__body` CSS.

**Example:**

```jsx
<FormModal opened={opened} onClose={() => setOpened(false)} title="Register Donor" onSubmit={handleSave}>
  <TextInput label="Full Name" />
</FormModal>
```

---

### DataTable

**Import:** `import DataTable from '../components/DataTable.jsx'`

| Prop | Type | Default | Description |
|---|---|---|---|
| `columns` | MRT column defs | required | `mantine-react-table` column configuration |
| `data` | array | required | Row data |
| `emptyMessage` | string | `'No records found'` | Empty-state text |
| `emptyIcon` | Tabler icon | `IconDatabaseOff` | Empty-state icon |
| `...tableOptions` | — | — | Additional `useMantineReactTable` options (override defaults) |

**Defaults applied:** neumorphic paper container, uppercase header styling, 48px row hover, global search with inset styling, neumorphic pagination buttons, empty-state fallback.

Uses `useMantineReactTable` + `MantineReactTable` from `mantine-react-table` v2 beta.

**Example:**

```jsx
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const columns = [
  { accessorKey: 'id', header: 'Donor ID', Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
  { accessorKey: 'status', header: 'Status', Cell: ({ cell }) => <StatusBadge status={cell.getValue()} /> },
];

<DataTable columns={columns} data={mockDonors} />
```

---

## Mock-Data Modules

All files live in `src/data/`. Each primary array has a named export and a default export of the same array.

| File | Named export(s) | Records | Fields |
|---|---|---:|---|
| `mockHospitals.js` | `mockHospitals` | 8 | `id`, `name`, `region`, `traumaLevel`, `status`, `lat`, `lng`, `address` |
| `mockDonors.js` | `mockDonors` | 18 | `id`, `name`, `bloodGroup`, `age`, `organType`, `hospital`, `region`, `status`, `dateRegistered`, `hlaA`, `hlaB`, `hlaDR`, `height`, `weight` |
| `mockRecipients.js` | `mockRecipients` | 22 | `id`, `name`, `bloodGroup`, `organNeeded`, `urgency`, `priorityScore`, `waitTime`, `status`, `hospital`, `hlaA`, `hlaB`, `hlaDR`, `height`, `weight` |
| `mockOffers.js` | `mockOffers` | 10 | `id`, `organId`, `organType`, `donorId`, `recipientId`, `status`, `offeredAt`, `response`, `declineReason` |
| `mockTransports.js` | `mockTransports` | 7 | `id`, `organId`, `organType`, `originHospital`, `destHospital`, `originCoords`, `destCoords`, `status`, `viabilityHours`, `elapsedHours`, `departedAt` |
| `mockOrgans.js` | `mockOrgans` | 11 | `id`, `organType`, `bloodGroup`, `donorId`, `hospital`, `region`, `status`, `viabilityHours`, `elapsedHours` |
| `mockRegions.js` | `mockRegions` | 5 | `code`, `name`, `allocationPolicy`, `hospitalCount` |
| `mockCompatibility.js` | `mockCompatibility`, `BLOOD_GROUPS`, `mockHlaAlleles` | 8 / 8 groups / 23 alleles | Compatibility: `bloodGroup`, `compatibleWith[]`. Alleles: `code`, `locus`, `description` |

**Import examples:**

```js
import { mockDonors } from '../data/mockDonors.js';
import { mockHospitals } from '../data/mockHospitals.js';
import { mockCompatibility, BLOOD_GROUPS, mockHlaAlleles } from '../data/mockCompatibility.js';
```

Render ID, blood group, HLA, and timestamp fields with the `.mono` CSS class per Section 8.

---

## Global CSS Utilities

Defined in `src/index.css`:

| Class | Purpose |
|---|---|
| `.neu-raised` | Raised neumorphic card shadow |
| `.neu-inset` | Inset shadow for inputs/pressed states |
| `.neu-raised-sm` | Subtle raised shadow for buttons |
| `.neu-button` | Press effect (raised → inset on `:active`) |
| `.neu-hover-lift` | Stat card hover lift (-2px) |
| `.mono` | JetBrains Mono for technical IDs and codes |
| `.glass` | Glassmorphic surface (login/modals) |
| `.badge`, `.badge-active`, etc. | Status badge color variants |
| `.page-fade-in`, `.shake`, `.stagger-in`, `.pulse-danger` | Section 9 animations |

Design tokens are CSS variables on `:root` (Section 2.2 of `ui_mastercontext.md`).

---

## Responsibilities Handed Off

### Dev 1 — Dashboard, Reports, Transport

**Pages:** `/dashboard`, `/reports`, `/transport`

**Phase 0 provides:** `StatCard`, `StatusBadge`, `DataTable`, `mockOffers`, `mockHospitals`, `mockTransports`, Recharts/jspdf/leaflet dependencies

**Dev 1 builds:**
- Task 1.1: Full Dashboard (stat cards, AreaChart, alerts, recent offers table)
- Task 1.2: `CircularProgress.jsx` (needed by Dev 3 matching by Aug 2 noon)
- Task 1.3: Reports page (charts, date picker, PDF export)
- Task 1.4: Transport page (Leaflet map, transport table, `ViabilityCountdown.jsx`)

**Placeholder:** `DashboardPage.jsx`, `ReportsPage.jsx`, `TransportPage.jsx`

---

### Dev 2 — Donors, Recipients, Settings

**Pages:** `/donors`, `/recipients`, `/settings`

**Phase 0 provides:** `StatusBadge`, `FormModal`, `DataTable`, all donor/recipient/hospital/region/compatibility mock data

**Dev 2 builds:**
- Task 2.1: Donor Registry (table, drawer, register modal, toasts)
- Task 2.2: Recipient Waitlist (filters, table, tooltips, add modal)
- Task 2.3: Settings (5 tabs: Hospitals, Regions, Organ Types, Compatibility Matrix, Policy Weights)

**Placeholder:** `DonorRegistryPage.jsx`, `RecipientWaitlistPage.jsx`, `SettingsPage.jsx`

---

### Dev 3 — Login, Matching, Offers

**Pages:** `/login`, `/matching`, `/offers`

**Phase 0 provides:** `AuthContext`, minimal `LoginPage`, `StatusBadge`, `FormModal`, `DataTable`, `mockOrgans`, `mockOffers`, `mockRecipients`, `mockDonors`

**Dev 3 builds:**
- Task 3.1: Full Login page (glassmorphic card, background image, shake animation)
- Task 3.2: Matching Console (organ select, sliders, ranked candidates; depends on Dev 1 `CircularProgress`)
- Task 3.3: Offer Workflow (status transitions, modals, one-active-offer rule)

**Placeholder:** `MatchingConsolePage.jsx`, `OfferWorkflowPage.jsx`. Login has minimal auth UI only.

---

## Cross-Dev Dependencies

| Component / asset | Built by | Needed by | Ready after Phase 0 |
|---|---|---|---|
| `StatCard`, `StatusBadge`, `DataTable`, `FormModal` | Phase 0 | All | Yes |
| `AuthContext` | Phase 0 | Dev 3 | Yes |
| Mock data | Phase 0 | All | Yes |
| `CircularProgress` | Dev 1 (Task 1.2) | Dev 3 matching | No — Dev 1 Phase 1 |
| `ViabilityCountdown` | Dev 1 (Task 1.4) | Dev 1 transport | No — Dev 1 Phase 2 |

See `dev_split.md` for full task lists and references to `ui_mastercontext.md` sections.
