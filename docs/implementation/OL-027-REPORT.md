# OL-027 Report: Dashboard endpoint and page

Status: **COMPLETE** (STRETCH task). Phase 3 orchestrated run: implementer, independent reviewer and independent checker. It ran in parallel with OL-028 (disjoint files).

## Files changed
- `server/routes/dashboard.js` (new): `GET /api/dashboard`. The definitions are documented in a comment at the top.
- `server/index.js`: mounts `/api/dashboard` after `requireAuth`.
- `src/api/dashboard.js` (new): live and mock `getDashboard`.
- `src/api/adapters/dashboard.js` (new): pure mappers for stats → StatCards, alerts → display rows, trend → chart data, recent offers → table rows, plus `emptyDashboard()`.
- `src/pages/DashboardPage.jsx`: bound to `getDashboard()`. The inline `ALLOCATION_TRENDS`, `CRITICAL_ALERTS` and `RECENT_OFFERS` are now only the mock source.
- `tests/server/dashboard.test.js` (new, 7 tests), `tests/client/dashboard.test.js` (new, 7 tests).

## Behavior implemented
- **`GET /api/dashboard`** runs `expire_stale_offers()` first, then returns exactly the contract's (Proposed) shape.
- **Stats**
  - `availableOrgans`: `v_organ` AVAILABLE and not expired, the same set as `/api/organs?available=true`.
  - `activeWaitlist`: waitlist **entries** with status ACTIVE. The specs don't define it; the contract example (22) matches the seed's entry count.
  - `pendingOffers`: CREATED or SENT, per the contract.
  - `transplantsThisMonth`: SUCCESS `transplant_event` rows whose `transplant_at` falls in the current calendar month (`date_trunc('month', now())` in the DB session timezone).
- **`criticalAlerts`**
  - `ORGAN_EXPIRING` / `danger`: AVAILABLE, not expired, under 2 h remaining (`v_organ`), soonest first.
  - `OFFER_AWAITING_RESPONSE` / `warning`: SENT offers under 1 h before `offer_expires_at` (`v_offer`).
  - `hoursRemaining` is rounded to 2 dp. Alerts carry structured fields only (A11).
- **`allocationTrend`:** the 12 calendar months ending this month, oldest first, `month` as `YYYY-MM`. Built with `generate_series` plus LEFT JOIN, so empty months are 0. It counts SUCCESS transplants.
- **`recentOffers`:** the 5 newest offers (`created_at DESC, offer_id DESC`), in the exact `GET /api/offers` shape. Built through the existing `offerSql` and `adaptOfferRow`, with no duplicated SQL.
- **Page**
  - The four StatCards show the API stats.
  - Critical Alerts render red (danger) and amber (warning) rows with frontend-built text using display IDs, e.g. "Organ O-0001 expires in 1 h", linking to `/organs` and `/offers`. An empty list shows "No critical alerts".
  - The trend chart has month labels such as "Nov 25".
  - Recent Organ Offers reuses the offers adapter; "View All" still goes to `/offers`.
  - On API failure: a `showApiError` notification, and the page renders zeros and an empty 12-month trend.
- **Mock mode:** the same API shape, derived from the old constants, with the trend re-dated to the last 12 months and the first 5 mock offers. Visually the same as before, except the StatCard trend arrows (see below).

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (fresh reset) | 166/166 pass |
| `npm run test:client` | 151/151 pass |
| `npm run build` | OK |
| Lint (file:line count) | 8 = baseline |
| `npm run smoke` | SMOKE OK |
| Seed integrity after `test:server` | waitlist ACTIVE 21 / SUSPENDED 2 before and after; organ count unchanged (no leaked fixtures) |
| AC1 (after smoke) | API = SQL: availableOrgans 4, activeWaitlist 20, pendingOffers 0, transplantsThisMonth 1. After creating one CREATED offer: pendingOffers 1 on both sides |
| AC2 | Heart organ 1 back-dated 5 h → `{ORGAN_EXPIRING, danger, organId 1, hoursRemaining 1}`; at 3 h remaining → not listed |
| Offer alert | SENT offer inside the 1 h Heart window → `{OFFER_AWAITING_RESPONSE, warning}`; with about 1.5 h left → not listed |
| AC3 | 12 consecutive months 2025-11 … 2026-10, ending with the current month; 11 zero-filled; 2026-10 = 1 = the SQL SUCCESS count |
| recentOffers | newest first; identical (`jq -S`) to the leading `GET /api/offers` rows; `LIMIT 5` in source |
| 401 without a session | yes |
| UI (source) | StatCards from adapted stats; danger→red, warning→amber; display IDs; "No critical alerts"; error keeps the `emptyDashboard()` zeros |

## Reviewer findings and resolution
Verdict: **APPROVE**, NITs only:
1. The trend test has a conditional `if (empty.length > 0)` assertion. Harmless, because an exact 12-month `deepEqual` precedes it. **Accepted.**
2. Waitlist restore resets `status` only. The rows touched are clones or backed-up entries, and the checker confirmed seed integrity after the suite. **Accepted.**
3. Month boundaries use the DB session timezone. On this cluster it is `Asia/Kolkata`, which matches the IST display. On a UTC-configured server, transplants within 5.5 h of a month boundary could fall in the adjacent month. **Accepted; recorded as a risk.**
4. StatCard trend arrows were removed (the contract has no trend data, and `trend` is optional in `StatCard`). The alert timestamp line was dropped. The alert text has no organ type, because the alert fields don't carry it. **Accepted.**

## Failures encountered
- No code failures in OL-027. The implementer saw a build break in `ReportsPage.jsx` caused by concurrent OL-028 work; it correctly reported it rather than editing that file. The orchestrator fixed it (see OL-028-REPORT).

## Remaining risks / follow-ups
- No browser verification.
- Month boundaries depend on the DB server's `timezone` setting (see NIT 3).
- `activeWaitlist` counts entries, not recipients. Revisit if the team reads FR-2 differently.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/dashboard` (live) | Open the page after reset | Four StatCards show DB counts (3 available organs, active waitlist entries, 0 pending offers, 0 transplants this month) | Deferred to consolidated manual QA (API automated) |
| `/dashboard` (live) | In psql set an AVAILABLE Heart's `recovered_at` to now − 5 h, then reload | Red alert "Organ O-000N expires in 1 h", linking to `/organs` | Deferred to consolidated manual QA (API automated) |
| `/dashboard` (live) | Send an offer on a Heart organ, then reload | Amber alert "Offer OF-000N awaiting response…" linking to `/offers` | Deferred to consolidated manual QA (API automated) |
| `/dashboard` (live) | Open with no expiring organs or offers | "No critical alerts" | Deferred to consolidated manual QA |
| `/dashboard` (live) | Look at Allocation Trends | 12 months ("Nov 25" … "Oct 26") with zero months included; the current month counts SUCCESS transplants | Deferred to consolidated manual QA (API automated) |
| `/dashboard` (live) | Look at Recent Organ Offers; click View All | The 5 newest offers; navigates to `/offers` | Deferred to consolidated manual QA |
| `/dashboard` (live) | Stop the API, then reload | Error notification; zeros and an empty trend; no crash | Deferred to consolidated manual QA |
| `/dashboard` (mock) | Open the page | Same look as before, minus the StatCard trend arrows | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- The 4 StatCards match direct SQL counts: **satisfied** (API equals SQL; the cards render the API stats).
- An organ back-dated to 1 h of viability remaining appears as a red alert: **satisfied** at API and adapter level (danger → red); visual check deferred.
- The trend has 12 points, and zero-filled months are included: **satisfied**.
