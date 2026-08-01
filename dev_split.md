# OrganLink — Dev Split & Sprint Plan

> **Deadline:** August 3rd, 2026 — 11:59 PM IST
> **Team:** 3 developers (equal skill level)
> **Scope:** Frontend only (React + Vite + Mantine)
> **Reference:** See `ui_mastercontext.md` for all design specs

---

## Timeline Overview

| Phase | When | What |
|---|---|---|
| **Phase 0** | Aug 1, 3:00–5:00 PM | Project setup + shared foundation (ALL 3 devs together) |
| **Phase 1** | Aug 1, 5:00 PM – Aug 2, 2:00 PM | Core pages (parallel, each dev on their own) |
| **Phase 2** | Aug 2, 2:00 PM – Aug 3, 2:00 PM | Remaining pages (parallel) |
| **Phase 3** | Aug 3, 2:00–8:00 PM | Polish, integration, bug fixes |
| **Phase 4** | Aug 3, 8:00–11:59 PM | Final review, testing, submission |

---

## Phase 0: Foundation (ALL DEVS — 2 hours)

**Everyone works together on the same codebase to set up the skeleton.**

### Tasks (do in this order):

- [ ] **Scaffold project:** `npx create-vite@latest ./ --template react`, install all dependencies
  ```bash
  npm install @mantine/core @mantine/hooks @mantine/dates @mantine/notifications
  npm install mantine-react-table
  npm install react-router-dom recharts
  npm install react-leaflet leaflet
  npm install jspdf jspdf-autotable
  npm install @tabler/icons-react
  npm install dayjs
  ```
- [ ] **Create `src/index.css`** — Global neumorphic classes (`.neu-raised`, `.neu-inset`, `.neu-raised-sm`, `.mono`, all CSS variables from mastercontext Section 2)
- [ ] **Create `src/theme.js`** — Mantine theme override (Manrope font, color tokens, radius defaults)
- [ ] **Create `src/main.jsx`** — MantineProvider + BrowserRouter + NotificationsProvider wrapper
- [ ] **Create `src/context/AuthContext.jsx`** — Simple auth context (isAuthenticated, login, logout)
- [ ] **Create `src/components/AppShell.jsx`** — Sidebar + Header + `<Outlet />` (per mastercontext Section 3)
- [ ] **Create `src/App.jsx`** — All routes (per mastercontext Section 6)
- [ ] **Create ALL mock data files** in `src/data/` (per mastercontext Section 8)
- [ ] **Create shared components:**
  - `src/components/StatCard.jsx`
  - `src/components/StatusBadge.jsx`
  - `src/components/FormModal.jsx`
  - `src/components/DataTable.jsx` (mantine-react-table wrapper with neu styles)
- [ ] **Verify:** App runs, sidebar navigates between empty pages, login redirects work

**Deliverable:** Fully scaffolded app where all routes render placeholder pages, sidebar works, auth context works, and all shared components exist.

---

## Dev 1: Dashboard + Reports + Transport

### Phase 1 (Aug 1 5PM – Aug 2 2PM)

#### Task 1.1: Dashboard Page (`/dashboard`)
- [ ] Build stat cards row (4 cards using `StatCard` component)
- [ ] Build "Allocation Trends" AreaChart with Recharts
- [ ] Build "Critical Alerts" panel with mock alert items
- [ ] Build "Recent Organ Offers" table (5 rows, uses shared DataTable)
- [ ] Add "View All →" link to offers page
- [ ] Add hover animations on stat cards (translateY -2px)
- [ ] Test responsive layout at 1280px+

**Reference:** mastercontext Section 5.2

#### Task 1.2: CircularProgress Component
- [ ] Build SVG-based circular progress indicator
- [ ] Gradient fill (primary → success)
- [ ] Center percentage text in `.mono`
- [ ] Accept `value` (0-100) and `label` props

**Reference:** mastercontext Section 4.5

### Phase 2 (Aug 2 2PM – Aug 3 2PM)

#### Task 1.3: Reports Page (`/reports`)
- [ ] Build date range picker (Mantine DatePickerInput, `.neu-inset` style)
- [ ] Build "Waiting Time Distribution" BarChart (`.neu-raised` card)
- [ ] Build "Organ Utilization by Region" donut PieChart (`.neu-raised` card)
- [ ] Build "Decline Reasons" horizontal BarChart (`.neu-raised` card)
- [ ] Build "Allocation Fairness" RadarChart or grouped BarChart (`.neu-raised` card)
- [ ] Build compliance summary section (94.2% large metric + sub-metrics)
- [ ] Implement "Export Audit Report" PDF generation (jsPDF + autotable)
  - Header with title + date range
  - Summary stats table
  - Allocation history table
  - Auto-download as `OrganLink_Audit_Report_YYYY-MM-DD.pdf`

**Reference:** mastercontext Section 5.8

#### Task 1.4: Transport Page (`/transport`)
- [ ] Set up Leaflet map with OpenStreetMap tiles (400px height, `.neu-raised` card)
- [ ] Add grayscale filter to map tiles
- [ ] Plot hospital markers from mockHospitals coordinates
- [ ] Draw polylines between origin/destination for active transports
- [ ] Color-code polylines by status (primary=active, green=delivered, red=expired)
- [ ] Add marker popups (hospital name, transport count)
- [ ] Build transport records data table below map
- [ ] Build ViabilityCountdown component (progress bar with color transitions + `.mono` timer)
- [ ] Add pulsing red glow animation for < 1 hour remaining

**Reference:** mastercontext Sections 4.6, 5.7

### Phase 3 (Aug 3 2PM – 8PM)
- [ ] Polish all chart animations and responsive sizing
- [ ] Test PDF export with realistic data
- [ ] Verify map renders correctly with all markers and routes
- [ ] Fix any integration issues with shared components

---

## Dev 2: Donors + Recipients + Settings

### Phase 1 (Aug 1 5PM – Aug 2 2PM)

#### Task 2.1: Donor Registry Page (`/donors`)
- [ ] Build page header with "Register Donor" button
- [ ] Build full-width data table with all columns (per mastercontext)
- [ ] Apply `.mono` styling to Donor ID, Blood Group, Date columns
- [ ] Add status badges (Active/Deceased/Inactive)
- [ ] Implement row click → detail drawer (320px right panel)
  - Show full donor profile, HLA alleles in `.mono`, body size data
  - Edit / Deactivate buttons (visual only for now)
- [ ] Build "Register Donor" form modal with all fields
  - Full Name, DOB, Blood Group (select), Hospital (select), Region (auto-fill), Organ Type (multi-select), HLA fields, Height, Weight
- [ ] Submit → adds row to table + success toast notification
- [ ] Populate with 15-20 mock donor records

**Reference:** mastercontext Section 5.3

#### Task 2.2: Recipient Waitlist Page (`/recipients`)
- [ ] Build page header with "Add Recipient" button
- [ ] Build filter bar row (4 select dropdowns: Organ, Blood Group, Urgency, Status)
- [ ] Style filter selects with `.neu-inset`
- [ ] Build data table with all columns
- [ ] Urgency badges: 1A=danger, 1B=warning, 2=info colors
- [ ] Priority Score tooltip on hover showing weight breakdown
- [ ] Build "Add Recipient" form modal
- [ ] Populate with 20-25 mock recipient records

**Reference:** mastercontext Section 5.4

### Phase 2 (Aug 2 2PM – Aug 3 2PM)

#### Task 2.3: Settings Page (`/settings`)
- [ ] Set up Mantine Tabs with neumorphic styling (active = `.neu-inset`)
- [ ] **Tab 1 — Hospitals:**
  - Data table with all columns
  - "Add Hospital" modal
  - Edit modal (row action)
  - Suspend/Activate toggle with status badge
- [ ] **Tab 2 — Regions:**
  - Data table + "Add Region" modal
  - Region Code in `.mono`
- [ ] **Tab 3 — Organ Types:**
  - Simple table + "Add Organ Type" modal
  - Max viability hours, priority weight
- [ ] **Tab 4 — Compatibility Matrix:**
  - 8×8 blood group grid (interactive toggle cells)
  - Green = compatible, Red = incompatible
  - Pre-fill with standard ABO rules
  - HLA Allele reference CRUD table below
- [ ] **Tab 5 — Policy Weights:**
  - 4 sliders with `.neu-inset` track styling
  - Visual weight distribution bar
  - "Save Configuration" button + "Reset to Defaults"

**Reference:** mastercontext Section 5.9

### Phase 3 (Aug 3 2PM – 8PM)
- [ ] Polish all form validations (required fields, number ranges)
- [ ] Ensure all modals have proper close/cancel behavior
- [ ] Test CRUD operations (add → appears in table, filter works)
- [ ] Verify blood group matrix renders correctly

---

## Dev 3: Login + Matching + Offers

### Phase 1 (Aug 1 5PM – Aug 2 2PM)

#### Task 3.1: Login Page (`/login`)
- [ ] Full-screen layout with NO sidebar/header
- [ ] Biomedical background image (full-bleed, darkened overlay)
- [ ] Slow CSS `background-position` drift animation
- [ ] Centered glassmorphic card (420px width):
  - `backdrop-filter: blur(16px)`, semi-transparent white bg
  - "OrganLink" logo text (Manrope 700, 28px, white)
  - "Transplant Operations Hub" subtitle
  - Username + Password inputs (glass variant of `.neu-inset`)
  - "Sign In" button (full width, primary color)
- [ ] Hardcoded auth: `admin` / `admin`
- [ ] Success → redirect to `/dashboard`
- [ ] Failure → red shake animation on card + "Invalid credentials" error text
- [ ] Enter key submits form
- [ ] Wire up AuthContext (set isAuthenticated on success)

**Reference:** mastercontext Section 5.1

#### Task 3.2: Matching Console Page (`/matching`)
- [ ] Two-panel layout (40% left config / 60% right results)
- [ ] **Left panel (`.neu-raised`):**
  - "Select Organ" dropdown (`.neu-inset`) with mock available organs
  - On select → show donor info card (ID, blood group, HLA, hospital, viability)
  - Algorithm parameter sliders (HLA Weight, Urgency Weight, Distance Weight)
  - "Run Match" button (full-width, primary, 48px)
  - Loading state with spinner
- [ ] **Right panel — Ranked candidates:**
  - Staggered animation (cards appear with 80ms delay each)
  - Each card: Rank #, Recipient ID (.mono), CircularProgress score, distance progress bar, "Review →" button
  - "Review →" opens detail modal with compatibility breakdown
- [ ] **Filtered-out section:**
  - Collapsible accordion
  - Each entry: Recipient ID + reason badge
- [ ] "Create Offer" button next to #1 → navigates to `/offers` with pre-filled data

**Reference:** mastercontext Section 5.5

### Phase 2 (Aug 2 2PM – Aug 3 2PM)

#### Task 3.3: Offer Workflow Page (`/offers`)
- [ ] Page header with "Create Offer" button
- [ ] Full-width data table with all columns
- [ ] Status badges: Created (info), Sent (warning), Accepted (success), Declined (danger), Expired (muted)
- [ ] **Row actions per status:**
  - Created → "Send Offer" button
  - Sent → "Record Accept" / "Record Decline" buttons
  - Declined → "Advance to Next" button
- [ ] **One-active-offer rule:** Disable "Create Offer" for organ if active offer exists (show tooltip)
- [ ] **"Record Decline" modal:**
  - Decline Reason dropdown (6 options)
  - Optional notes textarea
  - Submit → update status + toast
- [ ] **"Record Accept" modal:**
  - Organ + recipient summary display
  - "Confirm Transplant" button
  - Success → green toast, update statuses
- [ ] **"Create Offer" modal:**
  - Organ select, Recipient select (from match results)
  - Pre-fill if coming from Matching page
- [ ] Populate with 8-10 mock offers in various statuses

**Reference:** mastercontext Section 5.6

### Phase 3 (Aug 3 2PM – 8PM)
- [ ] Polish login page animations (background drift, shake)
- [ ] Ensure matching → offer navigation passes data correctly
- [ ] Test offer status transitions work properly
- [ ] Verify one-active-offer rule disabling logic

---

## Phase 4: Final Review (ALL DEVS — Aug 3, 8PM – 11:59 PM)

- [ ] Cross-page navigation testing (every sidebar link works)
- [ ] Auth flow testing (login → dashboard → logout → login required)
- [ ] Visual consistency check (all pages use same neumorphic styles)
- [ ] Check all `.mono` classes applied correctly
- [ ] Check all status badges show correct colors
- [ ] Check all animations work (hover, press, page transitions)
- [ ] Check empty states render properly
- [ ] Run `npm run build` — fix any build errors
- [ ] Browser test at 1280×1024 and 1920×1080
- [ ] Final commit and tag

---

## Git Workflow

```
main (protected)
├── dev/foundation     ← Phase 0 (merge immediately after done)
├── dev/dev1-dashboard ← Dev 1 branch
├── dev/dev2-donors    ← Dev 2 branch
├── dev/dev3-login     ← Dev 3 branch
```

- Phase 0: Everyone works on `dev/foundation`, merge to `main`
- Phase 1-2: Each dev works on their branch
- Phase 3: Merge all branches to `main`, resolve conflicts together
- Phase 4: All work on `main` directly for final fixes

---

## Dependencies Between Devs

| Dependency | Who needs it | Who builds it | When ready |
|---|---|---|---|
| `StatCard` component | Dev 1 | Phase 0 (all) | Aug 1, 5 PM |
| `StatusBadge` component | All | Phase 0 (all) | Aug 1, 5 PM |
| `DataTable` component | All | Phase 0 (all) | Aug 1, 5 PM |
| `FormModal` component | Dev 2, Dev 3 | Phase 0 (all) | Aug 1, 5 PM |
| `CircularProgress` component | Dev 3 (matching) | Dev 1 | Aug 2, 12 PM |
| `ViabilityCountdown` component | Dev 1 (transport) | Dev 1 | Aug 2, 4 PM |
| Mock data files | All | Phase 0 (all) | Aug 1, 5 PM |
| Auth context | Dev 3 (login) | Phase 0 (all) | Aug 1, 5 PM |

> **Critical:** Dev 3 needs `CircularProgress` from Dev 1 by Aug 2 noon. Dev 1 should prioritize building this component early in Phase 1.

---

*End of Dev Split — Refer to `ui_mastercontext.md` for all design specifications.*
