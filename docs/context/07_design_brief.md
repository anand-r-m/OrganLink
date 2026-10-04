# OrganLink — Design Brief

**Group A12** | 23CSE202 Database Management Systems

> This document records the design system already implemented in the frontend, plus the additions required by the backend design review. It is descriptive of built work, not a proposal.

---

## 1. Design intent

A transplant coordinator works under time pressure with data where a misread is consequential. The interface therefore prioritises **legibility and state clarity** over visual novelty:

- Status is always communicated by a labelled badge, never by colour alone
- Identifiers, blood groups, HLA alleles, scores and timers are set in a monospaced face so they align in columns and cannot be misread
- Countdown timers escalate visually as viability shortens
- Destructive or irreversible actions require a modal, never a single click

The chosen visual language is **soft neumorphism**: raised surfaces for content that sits above the page, inset surfaces for anything receiving input. The metaphor is consistent and load-bearing — if a surface is inset, it is editable.

## 2. Typography

| Use | Face | Weight | Size |
|---|---|---|---|
| Headings | Manrope | 700 | 28 / 20 / 16 px |
| Body | Manrope | 400–500 | 14 px |
| Data (`.mono`) | monospace | 400 | 13 px |

`.mono` is applied to: donor and recipient IDs, blood groups, HLA alleles, dates, viability countdowns, match and priority scores, region codes, and all numeric table columns.

## 3. Surfaces

| Class | Use |
|---|---|
| `.neu-raised` | Cards, panels, chart containers, modals |
| `.neu-raised-sm` | Stat cards, list items, secondary panels |
| `.neu-inset` | Inputs, selects, slider tracks, active tabs |

Tokens — colour variables, shadow definitions, radii and spacing — are defined in `src/index.css`. The Mantine theme in `src/theme.js` overrides fonts, colour tokens and default radii so that Mantine components inherit the system rather than fighting it.

## 4. Status colour semantics

Colour is consistent across every page. A badge's colour means the same thing wherever it appears.

| Meaning | Colour | Appears as |
|---|---|---|
| Success / terminal good | green | Accepted, Delivered, Transplanted, Active |
| In progress / attention | amber | Sent, In Transit, Pending, 1B urgency |
| Failure / critical | red | Declined, Failed, Expired, 1A urgency |
| Informational | blue | Created, Allocated, 2 urgency |
| Inactive / terminal neutral | grey | Voided, Cancelled, Discarded, Suspended |

**Additions from the backend review:** `VOIDED` and `CANCELLED` both render grey. They are visually alike because they mean the same thing to a coordinator — the offer ended without a decision — but they are distinct in the data, and only a decline blocks a future re-offer.

## 5. Component inventory

**Shared primitives** — `AppShell`, `StatCard`, `StatusBadge`, `FormModal`, `DataTable` (mantine-react-table wrapper), `CircularProgress` (SVG, gradient fill, monospace centre label), `ViabilityCountdown` (progress bar with colour transitions and a pulsing red glow under one hour).

**Pages** — Login (glassmorphic card over a darkened biomedical background with slow drift), Dashboard, Donor Registry, Recipient Waitlist, Matching Console, Offer Workflow, Transport, Reports, Settings.

## 6. Interaction patterns

| Pattern | Where used |
|---|---|
| Row click → right detail drawer (320px) | Donors, Recipients |
| Row action buttons vary by status | Offers, Transport, Organs |
| Modal for every state change | Offers, Transplants, Discard |
| Staggered card entry, 80ms delay | Matching results |
| Toast on success | All mutations |
| Disabled button + tooltip explaining why | One-active-offer rule, transplant-before-delivery |

That last pattern matters: when the database forbids an action, the UI disables the control **and says why**. A greyed-out button with no explanation reads as a bug.

## 7. Additions required by the backend design

| Addition | Page | Rationale |
|---|---|---|
| **Procure Organ** button and modal | Donor detail drawer | Organs had no creation point; this is where the viability clock starts |
| **Organs tab** — table, countdown, Discard action | New | Allocated, expired and discarded organs had nowhere to live |
| **Donor Type / Status split** | Donor registry and form | The existing Active/Deceased/Inactive badge conflated a type with a status |
| **Record Transplant** action and modal with outcome | Offers | Accepting an offer and performing surgery are separate events with separate timestamps |
| **Mark In Transit / Mark Delivered** | Transport | Transport was display-only; its status must be advanceable |
| **VOIDED / CANCELLED badges** | Offers | Two new terminal states from the sweep |
| **Run timestamp + Re-run Match** | Matching Console | Saved runs go stale; staleness must be visible |
| **Fourth weight slider** (waiting time) | Matching Console | The schema carries four weights; the console exposed three |
| **Region selector** | Settings → Policy Weights | Policy is per-region; the tab edited a single global set |

Every addition reuses `FormModal`, `DataTable` or `StatusBadge`. No new primitives are required.

## 8. Responsive scope

Desktop-first, targeting 1280×1024 and 1920×1080. Coordinators work at workstations. Mobile layout is explicitly out of scope.

## 9. Accessibility

Labelled form controls, descriptive button text, focus states on all interactive elements, and status communicated by text as well as colour. The `.mono` treatment of identifiers is itself an accessibility measure: monospaced digits cannot be transposed as easily when scanning a column.
