# OL-026 Report: Reports endpoints and charts

Status: **COMPLETE** (STRETCH task). Phase 3 orchestrated run: implementer, independent reviewer and independent checker.

## Files changed
- `server/routes/reports.js` (new): `GET /api/reports/waiting-times`, `/utilization`, `/decline-reasons`, `/fairness`, `/compliance`.
- `server/index.js`: mounts `/api/reports` after `requireAuth`.
- `src/api/reports.js` (new): live and mock API module. Mock mode returns rows in the API shapes, including one fairness region with null metrics.
- `src/api/adapters/reports.js` (new): pure, NaN-safe chart mappers:
  - bucket labels
  - waiting-time stacks
  - utilization per region
  - decline reasons
  - fairness
  - compliance label
- `src/pages/ReportsPage.jsx`: charts re-bound to the API.
- `tests/server/reports.test.js` (new, 7 tests), `tests/client/reports.test.js` (new, 9 tests).
- The orchestrator tightened the "view row counts" server test (reviewer NIT 2): each list endpoint's length must equal its view's row count, and the waiting-time view must be non-empty on the v1 seed.

## Behavior implemented
- **Endpoints**
  - Each returns `SELECT * FROM <view>` through `toCamel`, with an ORDER BY for deterministic output:
    - waiting-times by organ type, then bucket
    - utilization by region, then organ type
    - decline-reasons by occurrences desc, then code
    - fairness by region
  - `/compliance` returns a single object.
  - No columns are renamed or dropped. Counts and percentages are JSON numbers, and NULL stays null.
  - `/api/reports/audit.pdf` is not implemented (deferred, A6).
- **Sweep:** follows the API_CONTRACT endpoint index. `utilization` and `compliance` run `expire_stale_offers()` first. `waiting-times`, `decline-reasons` and `fairness` do not, because their views don't depend on statuses the sweep changes. The backlog's "runs the sweep first" wording differs; the contract index was treated as authoritative.
- **Waiting-time chart:** stacked by organ type over 13 zero-filled buckets labelled "0–5 mo" … "55–60 mo", "60+ mo" (bucket b covers [(b−1)×5, b×5) months). Bucket 0 (a future-dated listing) appears as "Future-dated" only when present.
- **Utilization:** one stacked bar per region (transplanted, expired, discarded), summed across organ types. This replaces the donut.
- **Decline reasons:** a horizontal bar per coded reason, labelled with its description. The tooltip shows count and percentage. Empty data shows "No declined offers yet".
- **Fairness (C11):** a full-width card with three small bar charts (allocation rate %, median wait in days, retention %) and a table. Null median wait or retention shows "—". "Actual vs expected" is removed.
- **Compliance:** the headline is `placementRatePct` ("20%", or "—" when null), plus transplanted, expired-unallocated, discarded and total organ counts. The old hard-coded stats (response time, viability window, ABO match rate) are removed, because no view backs them. The reviewer judged this in scope: AC3 plus FR-12, which asks only for "a compliance summary".
- **Loading and errors:** the five reports load independently. A failure raises a `showApiError` notification and leaves that chart empty; the other charts still render.
- **Date-range picker:** not wired to the report endpoints, because the views take no date parameters. It still feeds the audit PDF.
- **Audit PDF:** untouched (OL-028). The inline `DECLINE_REASONS`, `ALLOCATION_FAIRNESS` and `TOTAL_ORGANS` (now the literal 173, equal to the old derived sum) are kept only for the export, so its mock output is byte-identical to before.

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (after reset) | 159/159 pass |
| `npm run test:client` | 136/136 pass |
| `npm run build` | OK |
| Lint (file:line count) | 8 = baseline |
| `npm run smoke` (fresh reset) | SMOKE OK |
| AC1, fresh seed: API vs camelCased `SELECT * FROM view` | identical for all five (waiting-times 13 rows, utilization 3, decline-reasons 0, fairness 4, compliance object) |
| AC1, after `npm run smoke` (non-empty data) | identical for all five (utilization 5, decline-reasons 1); compliance `{transplanted:1, …, totalOrgans:5, placementRatePct:20}` |
| Nulls and types | `medianWaitDays` and `retentionPct` stay null; values are numbers |
| 401 without a session | all five |
| AC2: adapters fed the captured real JSON (empty and non-empty) | no NaN or undefined; labels well-formed; empty decline list gives `[]` |
| AC2: SSR render of ReportsPage (mock) | renders, 6681 characters, no throw, no NaN |
| AC2: visual chart rendering in live mode | **NOT AUTOMATABLE (needs browser)**; deferred |
| AC3 | headline renders `placementRateLabel`, built from `placementRatePct`; API 20 equals the view's 20.00; no hard-coded percentage |
| Export button | still present and still calls `generateAuditReportPdf` |

## Reviewer findings and resolution
Verdict: **APPROVE**, with NITs:
1. In **live** mode the "Export Audit Report" PDF still uses the hard-coded mock decline reasons, fairness and total of 173. It therefore does not match the live charts. This was also true before OL-026. **Accepted**: OL-028 (next) rewires the PDF to the live endpoints.
2. The row-count test was tautological (`n >= 0`). **Fixed by the orchestrator** (see Files changed); the reports suite passes 7/7.
3. "Every chart renders with no console errors" needs a browser. **Accepted**: stated as not browser-verified; adapters are proven NaN-safe on real data and an SSR render passes.
4. Fixture setup could throw after inserting rows, but `after` still cleans up. **Accepted.**
5. Mock-mode visuals changed shape (13 buckets, stacked utilization, 94.23%). **Accepted**: this follows from the re-binding.

## Failures encountered
- None.

## Remaining risks / follow-ups
- No browser verification of the charts.
- Right after reset the v1 seed is sparse: no decline reasons, null fairness medians and retention, placement rate 0%. The charts fill out after OL-031 (historical seed, Phase 4).
- The audit PDF is mock-fed until OL-028.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/reports` (live, fresh reset) | Open the page | Waiting-time chart stacked by organ type across "0–5 mo" … "60+ mo"; utilization bar per region; decline reasons "No declined offers yet"; fairness table with "—" medians; compliance "0%" with total organs 3 | Deferred to consolidated manual QA (data and adapters automated; SSR mock render passes) |
| `/reports` (live) | After `npm run smoke`, reload | Decline reasons shows one bar; compliance shows 20% | Deferred to consolidated manual QA (API automated) |
| `/reports` (live) | Hover any bar | Tooltip with values (and % for decline reasons) | Deferred to consolidated manual QA |
| `/reports` (live) | Open DevTools console while the page loads | No errors or NaN warnings | Deferred to consolidated manual QA |
| `/reports` (live) | Stop the API and reload | One red notification per failed report; empty charts; no crash | Deferred to consolidated manual QA |
| `/reports` (mock) | Open the page | Charts render from mock rows; compliance shows 94.23%; Western region fairness shows "—" | Server-render check only; deferred to consolidated manual QA |
| `/reports` | Click Export Audit Report | PDF downloads (content unchanged; OL-028 makes it live) | Deferred to consolidated manual QA |

No browser was opened for this task.

## Acceptance criteria
- Each endpoint's output equals `SELECT * FROM <view>` with camelCase keys: **satisfied**, on both empty and non-empty data.
- The charts render in live mode with the v1 seed, even if sparse: **partly verified**. The adapters are NaN-safe on real API output, empty states are handled, and an SSR mock render passes. **The visual render needs a browser and is deferred to consolidated manual QA.**
- The compliance headline shows `placementRatePct`: **satisfied** (source and API).
- DB: row counts per view; API: each endpoint: **satisfied**.
