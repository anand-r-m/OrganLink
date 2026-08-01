# OrganLink — UI Master Context

> **Purpose:** This document is the single source of truth for building the OrganLink frontend. It contains every detail needed to implement the UI without ambiguity. A developer reading this should be able to build each page without asking questions.

> **App Name:** OrganLink
> **Type:** Desktop admin dashboard (1280×1024+ target)
> **Auth:** Hardcoded `admin` / `admin` credentials
> **Mock Data:** All pages use realistic mock/dummy data. Shapes described per-page.

---

## 1. Tech Stack

| Layer | Package | Version |
|---|---|---|
| Framework | React | 18.x |
| Build | Vite | 5.x |
| Component Lib | @mantine/core, @mantine/hooks | 7.x |
| Data Tables | mantine-react-table | 2.x |
| Charts | recharts | 2.x |
| Routing | react-router-dom | 6.x |
| Maps | react-leaflet + leaflet | 4.x / 1.9.x |
| PDF Export | jspdf + jspdf-autotable | 2.x |
| Icons | @tabler/icons-react | 3.x |
| Fonts | Manrope (Google Fonts), JetBrains Mono (Google Fonts) | — |

---

## 2. Design System

### 2.1 Design Philosophy: "Bio-Tactile Sci-Fi"

A 50/50 blend of **Neumorphism** (tactile, physical UI) and **Glassmorphism + Biotech HUD** (sci-fi, technical overlays). The result feels like a premium medical research console.

### 2.2 Color Tokens

```css
:root {
  /* Base */
  --bg-base: #E8ECF1;
  --bg-sidebar: #DEE3EA;
  --bg-header: #E8ECF1;

  /* Shadows (neumorphic) */
  --shadow-light: #FFFFFF;
  --shadow-dark: #C5CAD3;

  /* Accent */
  --color-primary: #5B8A9A;
  --color-primary-hover: #4A7585;
  --color-primary-light: rgba(91, 138, 154, 0.12);
  --color-success: #6AB07B;
  --color-warning: #D4A056;
  --color-danger: #C75C5C;
  --color-info: #7B9ACC;

  /* Text */
  --text-primary: #2D3436;
  --text-secondary: #636E72;
  --text-muted: #9BA3A9;
  --text-on-accent: #FFFFFF;

  /* Glass (login page + modals) */
  --glass-bg: rgba(255, 255, 255, 0.25);
  --glass-border: 1px solid rgba(255, 255, 255, 0.35);
  --glass-blur: blur(16px);

  /* Misc */
  --radius-card: 20px;
  --radius-input: 12px;
  --radius-button: 12px;
  --radius-badge: 8px;
  --transition-default: all 0.2s ease;
}
```

### 2.3 Neumorphic Shadow Mixins

```css
/* Raised element (cards, buttons in default state) */
.neu-raised {
  background: var(--bg-base);
  box-shadow: 8px 8px 16px var(--shadow-dark),
              -8px -8px 16px var(--shadow-light);
  border-radius: var(--radius-card);
}

/* Inset element (input fields, pressed buttons) */
.neu-inset {
  background: var(--bg-base);
  box-shadow: inset 4px 4px 8px var(--shadow-dark),
              inset -4px -4px 8px var(--shadow-light);
  border-radius: var(--radius-input);
}

/* Subtle raised (smaller elements, table rows on hover) */
.neu-raised-sm {
  box-shadow: 4px 4px 8px var(--shadow-dark),
              -4px -4px 8px var(--shadow-light);
  border-radius: var(--radius-input);
}

/* Button press effect */
.neu-button:active {
  box-shadow: inset 3px 3px 6px var(--shadow-dark),
              inset -3px -3px 6px var(--shadow-light);
}
```

### 2.4 Typography

```css
body {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

/* Headings */
h1 { font-size: 28px; font-weight: 700; }
h2 { font-size: 22px; font-weight: 600; }
h3 { font-size: 18px; font-weight: 600; }

/* Data/Technical labels */
.mono {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--color-primary);
  letter-spacing: 0.5px;
}

/* Use .mono for: Donor IDs, Recipient IDs, Organ IDs, Match Scores,
   CPRA percentages, Blood groups, HLA codes, timestamps */
```

### 2.5 Spacing Scale

Use multiples of 4px: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Card padding: `24px`
- Section gap: `24px`
- Card gap in grid: `20px`
- Sidebar item padding: `12px 16px`

---

## 3. Layout: App Shell

### 3.1 Structure

```
┌──────────────────────────────────────────────────────────┐
│ SIDEBAR (240px fixed)  │  HEADER (60px height, full)     │
│                        │  [Breadcrumb]     [Avatar/Name] │
│  Logo: "OrganLink"     ├─────────────────────────────────┤
│  ──────────────────     │                                 │
│  🏠 Dashboard          │        CONTENT AREA              │
│  👤 Donor Registry     │        (scrollable)              │
│  🫀 Recipient Waitlist │        padding: 32px             │
│  🔬 Matching Console   │                                 │
│  📋 Offer Workflow     │                                 │
│  🚚 Transport          │                                 │
│  📊 Reports            │                                 │
│  ──────────────────     │                                 │
│  ⚙️ Settings           │                                 │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Sidebar

- **Width:** 240px, fixed left
- **Background:** `var(--bg-sidebar)` with subtle neumorphic right-edge shadow
- **Logo area:** Top, 80px height. Text "OrganLink" in Manrope 700, 20px, `var(--color-primary)`
- **Nav items:** Tabler icon (20px) + label. Padding `12px 16px`. Border-radius `12px`.
  - **Default:** transparent background, `var(--text-secondary)` color
  - **Hover:** `var(--color-primary-light)` background
  - **Active:** `neu-inset` shadow, `var(--color-primary)` text and icon
- **Divider:** 1px solid `rgba(0,0,0,0.06)` before Settings
- **Icons mapping:**
  - Dashboard → `IconLayoutDashboard`
  - Donor Registry → `IconUserPlus`
  - Recipient Waitlist → `IconHeartbeat`
  - Matching Console → `IconDna`
  - Offer Workflow → `IconClipboardCheck`
  - Transport → `IconTruck`
  - Reports → `IconChartBar`
  - Settings → `IconSettings`

### 3.3 Header Bar

- **Height:** 60px
- **Background:** `var(--bg-base)` with bottom shadow: `0 2px 8px rgba(0,0,0,0.04)`
- **Left:** Breadcrumb trail (e.g., "Dashboard" or "Donors > Register")
- **Right:** Admin avatar circle (36px, `var(--color-primary)` bg, white initials "A") + "Admin" label

---

## 4. Reusable Components

### 4.1 Stat Card

Used on Dashboard. A neumorphic raised card showing a single metric.

```
┌─────────────────────────┐
│  Icon (in circle)    ▲5%│   ← trend indicator (optional)
│  142                    │   ← value (Manrope 700, 32px)
│  Available Organs       │   ← label (text-secondary, 13px)
└─────────────────────────┘
```
- Size: flexible width, ~160px min, equal-width in grid
- Padding: 24px
- Icon: 40px circle with `var(--color-primary-light)` bg, colored icon inside
- Apply `.neu-raised` shadow

### 4.2 Data Table

Uses `mantine-react-table`. Override styles to match neumorphism:
- Table container: `.neu-raised` card with 24px padding
- Header row: `var(--text-secondary)`, 12px uppercase, font-weight 600, letter-spacing 1px
- Body rows: 48px height, hover → subtle `var(--color-primary-light)` bg
- Cell text: 14px Manrope. ID columns use `.mono` class
- Pagination: neumorphic small buttons at bottom-right
- Search input: `.neu-inset` style
- Column filters: Mantine `Select` dropdowns

### 4.3 Status Badge

Small pill-shaped badge for status values.
```css
.badge { padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; }
.badge-active    { background: rgba(106,176,123,0.15); color: #6AB07B; }
.badge-pending   { background: rgba(212,160,86,0.15);  color: #D4A056; }
.badge-declined  { background: rgba(199,92,92,0.15);   color: #C75C5C; }
.badge-completed { background: rgba(91,138,154,0.15);  color: #5B8A9A; }
.badge-expired   { background: rgba(155,163,169,0.15); color: #9BA3A9; }
```

### 4.4 Form Modal

Mantine `Modal` with neumorphic override:
- Overlay: `rgba(0,0,0,0.3)` with `backdrop-filter: blur(4px)`
- Modal body: `var(--bg-base)` background, `.neu-raised` shadow, `border-radius: 20px`, padding `32px`
- All form inputs: `.neu-inset` style, height 44px, border-radius 12px
- Submit button: `var(--color-primary)` bg, white text, `.neu-raised-sm` shadow, hover → darker shade
- Cancel button: transparent bg, `var(--text-secondary)`, hover → light bg

### 4.5 Circular Progress (Match Score)

Used on Matching page. SVG circle showing percentage.
- Size: 64px diameter
- Track: `var(--shadow-dark)` at 15% opacity
- Fill: gradient from `var(--color-primary)` to `var(--color-success)`
- Center text: percentage in `.mono`, 16px bold
- Below circle: label text, 11px, `var(--text-muted)`

### 4.6 Viability Countdown

Used on Transport page. Visual urgency timer.
- Horizontal progress bar inside a `.neu-inset` track
- Bar color transitions: `var(--color-success)` (>50%) → `var(--color-warning)` (20-50%) → `var(--color-danger)` (<20%)
- Time remaining shown in `.mono` next to bar: e.g., `04:23:11`
- Pulsing red glow animation when < 1 hour

---

## 5. Page Specifications

### 5.1 LOGIN (`/login`)

**Layout:** NO sidebar, NO header. Full-screen standalone page.

**Background:**
- Full-bleed biomedical image (DNA helix / cellular structure) covering entire viewport
- Slightly darkened overlay: `rgba(0, 0, 0, 0.3)`
- Subtle CSS animation: slow `background-position` drift (creates "living" feel)

**Login Card (centered):**
- Width: 420px, centered both axes
- Style: Glassmorphic — `var(--glass-bg)`, `var(--glass-blur)`, `var(--glass-border)`
- Border-radius: 24px
- Padding: 48px 40px
- Content top-to-bottom:
  1. **Logo text:** "OrganLink" — Manrope 700, 28px, white
  2. **Subtitle:** "Transplant Operations Hub" — Manrope 400, 14px, `rgba(255,255,255,0.7)`
  3. **Spacer:** 32px
  4. **Username input:** label "Username", `.neu-inset` on glass variant (white bg at 15% opacity, white placeholder text at 50%), 44px height
  5. **Password input:** label "Password", same style, type=password
  6. **Spacer:** 24px
  7. **Sign In button:** Full width, 48px height, `var(--color-primary)` bg, white text, Manrope 600 16px, border-radius 12px, subtle shadow

**Behavior:**
- Hardcoded credentials: username=`admin`, password=`admin`
- On success → redirect to `/dashboard`
- On failure → red shake animation on card + error text "Invalid credentials" below button
- On Enter key → submit form

---

### 5.2 DASHBOARD (`/dashboard`)

**Layout:** Standard app shell (sidebar + header). Breadcrumb: "Dashboard"

**Content grid (top to bottom):**

#### Row 1: Stat Cards (4 across, equal width, 20px gap)
| Card | Icon | Value | Label | Trend |
|---|---|---|---|---|
| 1 | `IconHeart` (danger color) | 12 | Available Organs | ▲ 3 |
| 2 | `IconUsers` (primary) | 847 | Active Waitlist | ▲ 12 |
| 3 | `IconClipboardCheck` (warning) | 3 | Pending Offers | ▼ 2 |
| 4 | `IconActivity` (success) | 28 | Transplants This Month | ▲ 5 |

#### Row 2: Two-column layout (60% / 40%, 20px gap)

**Left — "Allocation Trends" chart (`.neu-raised` card):**
- Recharts `AreaChart`, 280px height
- X-axis: months (Jan–Dec), Y-axis: count
- Single area fill: gradient from `var(--color-primary)` (top, 30% opacity) to transparent
- Line: solid `var(--color-primary)`, 2px stroke
- Grid lines: `rgba(0,0,0,0.04)`
- Card title: "Allocation Trends" — h3 style, top-left

**Right — "Alerts" panel (`.neu-raised` card):**
- Title: "Critical Alerts"
- List of 3-4 alert items:
  - Each: red/yellow dot + message + timestamp
  - Example: 🔴 "Organ K-0912 viability expires in 2h 15m"
  - Example: 🟡 "3 offers pending response > 4 hours"
- Scrollable if overflow

#### Row 3: Recent Offers Table (`.neu-raised` card, full width)
- Title: "Recent Organ Offers"
- Columns: Offer ID (.mono), Organ Type, Donor ID (.mono), Recipient ID (.mono), Status (badge), Hospital, Created (timestamp .mono)
- Show 5 rows of mock data
- "View All →" link in top-right corner → navigates to `/offers`

---

### 5.3 DONOR REGISTRY (`/donors`)

**Breadcrumb:** "Donor Registry"

**Top bar:** Page title "Donor Registry" (h2) + "Register Donor" button (primary, right-aligned)

**Main content:** Full-width data table in `.neu-raised` card

**Table columns:**
| Column | Type | Width | Notes |
|---|---|---|---|
| Donor ID | .mono | 120px | e.g., `DNR-0912` |
| Full Name | text | 180px | |
| Blood Group | .mono badge | 80px | e.g., `A+`, `O-` |
| Age | number | 60px | |
| Organ Type | text | 120px | e.g., Kidney, Liver |
| Hospital | text | 200px | |
| Region | text | 120px | |
| Status | badge | 100px | Active / Deceased / Inactive |
| Date Registered | .mono | 140px | `YYYY-MM-DD` |

**Row click:** Opens detail drawer/panel on right (320px wide, `.neu-raised`) showing:
- Full donor profile
- Medical data: Blood group, HLA-A, HLA-B, HLA-DR alleles (all `.mono`)
- Body size: height, weight, BMI
- Linked organs (if any)
- Edit / Deactivate buttons

**"Register Donor" modal:** Form modal (component 4.4) with fields:
- Full Name (text), Date of Birth (date picker), Blood Group (select: A+, A-, B+, B-, AB+, AB-, O+, O-), Hospital (select), Region (auto-filled from hospital), Organ Type (multi-select), HLA-A (text), HLA-B (text), HLA-DR (text), Height cm (number), Weight kg (number)
- Submit → adds row to table + success notification toast

**Mock data:** 15-20 rows with realistic Indian hospital names and regions.

---

### 5.4 RECIPIENT WAITLIST (`/recipients`)

**Breadcrumb:** "Recipient Waitlist"

**Top bar:** Title "Recipient Waitlist" (h2) + "Add Recipient" button (primary)

**Filter bar (below title):** Row of Mantine `Select` dropdowns in `.neu-inset` style:
- Organ Needed (All, Kidney, Liver, Heart, Lung, Pancreas)
- Blood Group (All, A+, A-, B+, B-, AB+, AB-, O+, O-)
- Urgency (All, 1A, 1B, 2)
- Status (All, Waiting, Offered, Transplanted, Inactive)

**Table columns:**
| Column | Type | Width | Notes |
|---|---|---|---|
| Recipient ID | .mono | 120px | e.g., `RCP-415-T` |
| Full Name | text | 180px | |
| Blood Group | .mono | 80px | |
| Organ Needed | text | 120px | |
| Urgency | badge | 80px | 1A=danger, 1B=warning, 2=info |
| Priority Score | .mono | 100px | 0-100 decimal, e.g., `87.4` |
| Wait Time | text | 100px | e.g., "14 months" |
| Status | badge | 110px | Waiting/Offered/Transplanted/Inactive |
| Hospital | text | 180px | |

**Priority Score tooltip (on hover):** Shows breakdown:
```
Urgency Weight:    35.0  (40%)
Wait Time Weight:  28.4  (32%)
Policy Bonus:      24.0  (28%)
─────────────────────────
Total Score:       87.4
```

**"Add Recipient" modal:** Form fields:
- Full Name, DOB, Blood Group (select), Organ Needed (select), Hospital (select), Urgency Level (select: 1A/1B/2), HLA-A, HLA-B, HLA-DR, Height, Weight
- Priority score auto-calculated on submit

**Mock data:** 20-25 rows.

---

### 5.5 MATCHING CONSOLE (`/matching`)

**Breadcrumb:** "Matching Console"

This is the most complex page. Two-panel layout.

#### Left Panel: Match Configuration (40% width, `.neu-raised` card)

**Title:** "Matching Algorithm"

**Section 1 — "Select Organ":**
- Dropdown (`.neu-inset`): lists available organs by ID + type
- Example options: `K-0912 (Kidney, A+)`, `L-4431 (Liver, O-)`, `H-2201 (Heart, B+)`
- On select → auto-populates donor info card below:
  - Donor ID, Blood Group, HLA profile, Hospital, Region, Viability remaining

**Section 2 — "Algorithm Parameters":**
- Sliders (Mantine `Slider` with neumorphic track) for:
  - HLA Weight: 0-100 (default 40)
  - Urgency Weight: 0-100 (default 35)
  - Distance Weight: 0-100 (default 25)
- Weights should visually show they sum to 100 (or normalize)

**Section 3:**
- Large "Run Match" button (primary, full-width, 48px height)
- Loading state: button shows spinner + "Computing matches..."

#### Right Panel: Ranked Results (60% width)

**Title:** "Ranked Match Candidates"

After "Run Match" is clicked, display ranked candidate cards:

**Each candidate card (`.neu-raised-sm`, stacked vertically, 12px gap):**
```
┌──────────────────────────────────────────────────────────────┐
│ #1    Recipient ID        Match Score (CPRA)   Center Distance│
│       RCP-992-K           ◉ 99%  ████████████  📍 45 Mi (Local)│
│                                                 [Review →]   │
├──────────────────────────────────────────────────────────────┤
│ #2    RCP-415-T           ◉ 94%  ██████████░░  📍 120 Mi (Regional)│
│                                                 [Review →]   │
└──────────────────────────────────────────────────────────────┘
```

- Rank number: large, bold, `var(--color-primary)`, 28px
- Recipient ID: `.mono`
- Match Score: Circular progress component (4.5) + percentage
- Center Distance: progress bar (full=far, empty=close) + miles + (Local/Regional/National) label
- "Review Chart →" button: text button, opens detail modal showing:
  - Full compatibility breakdown (HLA match detail, ABO compatibility, size match)
  - Bar chart comparing this candidate vs. other top candidates

**Filtered-out candidates section (collapsed by default):**
- Accordion/expandable: "12 candidates filtered out"
- Each row: Recipient ID + reason badge (e.g., "ABO Incompatible", "Size Mismatch", "Exceeded Distance")

**"Create Offer" button:** Appears next to #1 candidate. Primary style. On click → navigates to Offer Workflow with pre-filled data.

**Mock data:** Generate 5-8 ranked candidates + 10-12 filtered-out entries.

---

### 5.6 OFFER WORKFLOW (`/offers`)

**Breadcrumb:** "Offer Workflow"

**Top bar:** Title "Active Organ Offers" (h2) + "Create Offer" button (primary, right)

**Main content:** Full-width data table in `.neu-raised` card

**Table columns:**
| Column | Type | Width | Notes |
|---|---|---|---|
| Offer ID | .mono | 110px | e.g., `OFR-2201` |
| Organ ID | .mono | 100px | e.g., `K-0912` |
| Organ Type | text | 100px | |
| Donor ID | .mono | 110px | |
| Recipient ID | .mono | 110px | |
| Status | badge | 120px | Created/Sent/Accepted/Declined/Expired |
| Offered At | .mono | 150px | datetime |
| Response | text | 140px | accept reason or decline reason |
| Actions | buttons | 120px | |

**Status workflow (enforced in UI):**
```
Created → Sent → Accepted → (creates TransplantEvent)
                → Declined → (logs reason, enables "Next Candidate" button)
                → Expired  → (auto after viability window)
```

**Row actions (context menu or inline buttons):**
- **Created:** "Send Offer" button
- **Sent:** "Record Accept" / "Record Decline" buttons
- **Declined:** "Advance to Next" button → pre-fills new offer for next-ranked candidate

**One-active-offer rule:** If an organ already has a "Created" or "Sent" offer, the "Create Offer" button for that organ is disabled with tooltip: "Active offer exists for this organ"

**"Record Decline" modal:** Form with:
- Decline Reason (select): "Medical contraindication", "Patient too ill", "Organ quality concern", "Logistical timeout", "Patient refused", "Other"
- Notes (textarea, optional)
- Submit → updates status to Declined + logs reason

**"Record Accept" modal:** Confirmation dialog:
- Shows organ + recipient summary
- "Confirm Transplant" button → creates TransplantEvent record, updates organ status to "Allocated", recipient status to "Transplanted"
- Success → green notification toast: "Transplant event recorded successfully"

**Mock data:** 8-10 offers in various statuses.

---

### 5.7 TRANSPORT & VIABILITY (`/transport`)

**Breadcrumb:** "Logistics & Viability Tracking"

**Two-section layout: top map + bottom table**

#### Top Section: Map View (`.neu-raised` card, height 400px)

**Leaflet/OpenStreetMap integration:**
- Default center: India (lat 20.5, lng 78.9), zoom level 5
- **Markers:** Hospital locations as custom markers (teal circles with hospital icon)
- **Routes:** When a transport record exists, show a polyline between origin and destination hospitals
  - Color: `var(--color-primary)` for active transports, `var(--color-success)` for delivered, `var(--color-danger)` for expired
- **Popups:** Click marker → hospital name, active transports count
- **Map tiles:** Use `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Custom styling:** Apply subtle grayscale filter to map tiles to match neumorphic aesthetic: `filter: saturate(0.3) contrast(1.1)`

#### Bottom Section: Transport Records Table (`.neu-raised` card)

**Table columns:**
| Column | Type | Width | Notes |
|---|---|---|---|
| Transport ID | .mono | 110px | e.g., `TRN-0044` |
| Organ ID | .mono | 100px | |
| Organ Type | text | 100px | |
| Origin Hospital | text | 180px | |
| Destination Hospital | text | 180px | |
| Status | badge | 110px | Preparing/In Transit/Delivered/Expired |
| Viability Remaining | countdown | 160px | Uses Viability Countdown component (4.6) |
| Departed At | .mono | 140px | datetime or "—" |

**Mock hospital coordinates (for map markers):**
- AIIMS Delhi: 28.5672, 77.2100
- Apollo Chennai: 13.0604, 80.2496
- CMC Vellore: 12.9249, 79.1369
- KEM Mumbai: 19.0002, 72.8422
- PGIMER Chandigarh: 30.7641, 76.7761
- Narayana Bangalore: 12.9061, 77.5980
- KGMU Lucknow: 26.8580, 80.9425
- SCB Cuttack: 20.4734, 85.8830

**Mock data:** 6-8 transport records, some in transit (with polylines on map), some delivered.

---

### 5.8 REPORTS & ANALYTICS (`/reports`)

**Breadcrumb:** "Analytics & Compliance"

**Top bar:** Title "Analytics & Compliance" (h2) + Date range picker (Mantine `DatePickerInput` range, `.neu-inset`) + "Export Audit Report" button (primary, right)

**Grid layout: 2×2 chart cards + 1 full-width summary**

#### Card 1 (top-left): "Waiting Time Distribution" (`.neu-raised`)
- Recharts `BarChart`
- X-axis: time buckets ("0-3 mo", "3-6 mo", "6-12 mo", "1-2 yr", "2+ yr")
- Y-axis: recipient count
- Bar fill: `var(--color-primary)`, border-radius on top: 6px
- Show 5 bars with mock data

#### Card 2 (top-right): "Organ Utilization by Region" (`.neu-raised`)
- Recharts `PieChart` (donut style, inner radius 60%)
- Segments: North (teal), South (green), East (amber), West (coral), Central (blue)
- Center text: total count, "Total Organs"
- Legend below chart

#### Card 3 (bottom-left): "Decline Reasons" (`.neu-raised`)
- Recharts horizontal `BarChart`
- Categories: "Medical contraindication", "Patient too ill", "Organ quality", "Logistical timeout", "Patient refused"
- Bar fill: `var(--color-danger)` at 60% opacity

#### Card 4 (bottom-right): "Allocation Fairness" (`.neu-raised`)
- Recharts `RadarChart` or grouped `BarChart`
- Compare allocation rates across 5 regions
- Overlay line: "Expected (fair)" vs "Actual"

#### Bottom: Compliance Summary (`.neu-raised`, full width)
- Large metric: "94.2%" compliance score (Manrope 700, 48px, `var(--color-success)`)
- Sub-metrics row: "Response Time Avg: 2.3h", "Viability Window Compliance: 97%", "ABO Match Rate: 100%"
- All in `.mono` styling

**"Export Audit Report" button behavior:**
- Generates a PDF using jsPDF containing:
  - Header: "OrganLink — Audit Report" + date range + generated timestamp
  - Section 1: Summary statistics table
  - Section 2: Allocation history table (all offers with outcomes)
  - Section 3: Decline reason breakdown chart (rendered as table in PDF)
  - Section 4: Regional fairness metrics
  - Footer: "Generated by OrganLink Console"
- Downloads automatically as `OrganLink_Audit_Report_YYYY-MM-DD.pdf`

---

### 5.9 SETTINGS (`/settings`)

**Breadcrumb:** "System Configuration"

**Tab layout** using Mantine `Tabs` with neumorphic styling (active tab uses `.neu-inset`):

#### Tab 1: "Hospitals"
- Data table: Hospital ID (.mono), Name, Region (select), Trauma Level (select: I/II/III), Network Status (● Active / ⊘ Suspended badge), Address
- Row actions: "Edit" (opens modal), "Suspend"/"Activate" toggle
- "Add Hospital" button → modal with fields: Name, Region, Trauma Level, Address
- Hospital detail card (from Stitch): shows Region name, Trauma Level, Network Status with Edit and ⊘ Suspend buttons

#### Tab 2: "Regions"
- Data table: Region Code (.mono), Region Name, Allocation Policy, Hospital Count
- "Add Region" modal: Name, Code, Policy description
- Inline edit support

#### Tab 3: "Organ Types"
- Simple table: Code (.mono), Name, Max Viability (hours), Default Priority Weight
- "Add Organ Type" modal

#### Tab 4: "Compatibility Matrix"
- **Blood group compatibility grid:**
  - 8×8 matrix (A+, A-, B+, B-, AB+, AB-, O+, O- on both axes)
  - Green cell = compatible, Red cell = incompatible
  - Click cell to toggle (with confirmation)
  - Standard ABO/Rh rules pre-filled
- **HLA Allele Reference:**
  - Simple CRUD table: Allele Code (.mono), Locus (A/B/DR), Description
  - "Add Allele" button

#### Tab 5: "Policy Weights"
- Sliders (`.neu-inset` track, teal thumb) for:
  - Urgency Weight (0-100, default 40)
  - Wait Time Weight (0-100, default 35)
  - Distance Weight (0-100, default 15)
  - HLA Match Weight (0-100, default 10)
- Visual bar showing weight distribution
- "Save Configuration" button → success toast
- "Reset to Defaults" link

---

## 6. Routing Configuration

```jsx
<BrowserRouter>
  <Routes>
    {/* Public */}
    <Route path="/login" element={<LoginPage />} />

    {/* Protected — wrapped in AppShell layout */}
    <Route element={<AppShell />}>
      <Route path="/" element={<Navigate to="/dashboard" />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/donors" element={<DonorRegistryPage />} />
      <Route path="/recipients" element={<RecipientWaitlistPage />} />
      <Route path="/matching" element={<MatchingConsolePage />} />
      <Route path="/offers" element={<OfferWorkflowPage />} />
      <Route path="/transport" element={<TransportPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>

    <Route path="*" element={<Navigate to="/login" />} />
  </Routes>
</BrowserRouter>
```

**Auth guard:** Simple React context. On login success, set `isAuthenticated = true` in context + localStorage. AppShell checks this — if false, redirect to `/login`. Logout clears it.

---

## 7. Project File Structure

```
OrganLink/
├── public/
│   ├── favicon.ico
│   └── assets/
│       └── bg-login.jpg          ← biomedical background (provided)
├── src/
│   ├── main.jsx                  ← entry point, MantineProvider + Router
│   ├── App.jsx                   ← route definitions
│   ├── theme.js                  ← Mantine theme overrides (colors, fonts, radius)
│   ├── index.css                 ← global CSS (neumorphic classes, fonts, resets)
│   ├── context/
│   │   └── AuthContext.jsx       ← auth state (isAuthenticated, login, logout)
│   ├── components/
│   │   ├── AppShell.jsx          ← sidebar + header + Outlet
│   │   ├── StatCard.jsx
│   │   ├── StatusBadge.jsx
│   │   ├── CircularProgress.jsx  ← match score circles
│   │   ├── ViabilityCountdown.jsx
│   │   ├── FormModal.jsx         ← reusable modal wrapper
│   │   └── DataTable.jsx         ← mantine-react-table wrapper with neu styles
│   ├── pages/
│   │   ├── LoginPage.jsx
│   │   ├── DashboardPage.jsx
│   │   ├── DonorRegistryPage.jsx
│   │   ├── RecipientWaitlistPage.jsx
│   │   ├── MatchingConsolePage.jsx
│   │   ├── OfferWorkflowPage.jsx
│   │   ├── TransportPage.jsx
│   │   ├── ReportsPage.jsx
│   │   └── SettingsPage.jsx
│   └── data/
│       ├── mockDonors.js
│       ├── mockRecipients.js
│       ├── mockOrgans.js
│       ├── mockOffers.js
│       ├── mockTransports.js
│       ├── mockHospitals.js
│       ├── mockRegions.js
│       └── mockCompatibility.js
├── package.json
├── vite.config.js
└── index.html
```

---

## 8. Mock Data Shape Reference

All mock data lives in `src/data/`. Each file exports an array. Fields marked `.mono` should be rendered with the monospace class.

### mockHospitals.js
```js
{ id: "HSP-001", name: "AIIMS New Delhi", region: "North", traumaLevel: "I",
  status: "active", lat: 28.5672, lng: 77.2100, address: "Ansari Nagar, New Delhi" }
```

### mockDonors.js
```js
{ id: "DNR-0912", name: "Rajesh Kumar", bloodGroup: "A+", age: 42,
  organType: "Kidney", hospital: "AIIMS New Delhi", region: "North",
  status: "Deceased", dateRegistered: "2026-07-15",
  hlaA: "A*02:01", hlaB: "B*07:02", hlaDR: "DRB1*03:01",
  height: 175, weight: 72 }
```

### mockRecipients.js
```js
{ id: "RCP-415-T", name: "Priya Sharma", bloodGroup: "A+",
  organNeeded: "Kidney", urgency: "1A", priorityScore: 87.4,
  waitTime: "14 months", status: "Waiting", hospital: "Apollo Chennai",
  hlaA: "A*02:01", hlaB: "B*44:02", hlaDR: "DRB1*03:01",
  height: 162, weight: 58 }
```

### mockOffers.js
```js
{ id: "OFR-2201", organId: "K-0912", organType: "Kidney",
  donorId: "DNR-0912", recipientId: "RCP-415-T", status: "Sent",
  offeredAt: "2026-07-28T14:30:00", response: null, declineReason: null }
```

### mockTransports.js
```js
{ id: "TRN-0044", organId: "K-0912", organType: "Kidney",
  originHospital: "AIIMS New Delhi", destHospital: "Apollo Chennai",
  originCoords: [28.5672, 77.2100], destCoords: [13.0604, 80.2496],
  status: "In Transit", viabilityHours: 24, elapsedHours: 8,
  departedAt: "2026-07-28T16:00:00" }
```

---

## 9. Animations & Micro-interactions

| Element | Animation |
|---|---|
| Page transitions | Fade in content area (opacity 0→1, 200ms ease) |
| Sidebar nav click | Active item animates shadow from raised → inset (150ms) |
| Stat card hover | Slight lift: translate Y -2px + shadow intensify (200ms) |
| Button press | Shadow transitions from raised → inset (100ms) |
| Login error | Card shakes horizontally (keyframes, 400ms) |
| Viability < 1hr | Pulsing red glow (`box-shadow` animation, 1.5s infinite) |
| Match results load | Cards stagger in from right (each delayed 80ms) |
| Status badge | Subtle scale pop on status change (1.0→1.1→1.0, 200ms) |
| Charts | Recharts default enter animation (enabled) |
| Modal open | Fade in overlay + scale card from 0.95→1.0 (200ms) |
| Toast notification | Slide in from top-right, auto-dismiss 4s |

---

## 10. Accessibility & Edge Cases

- All interactive elements must have `aria-label` attributes
- Color-coded status badges must ALSO have text labels (not color-only)
- Viability countdown must have `aria-live="polite"` for screen readers
- All tables must be keyboard-navigable
- Login form supports Enter key submission
- Empty states: Each table shows "No records found" message with relevant icon when data is empty
- Loading states: Skeleton loaders (Mantine `Skeleton`) inside `.neu-raised` cards while data loads

---

*End of UI Master Context — This document contains everything needed to build the complete OrganLink frontend.*
