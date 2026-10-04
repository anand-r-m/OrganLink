# OL-028 Report: Audit report PDF from live data

Status: **COMPLETE** (STRETCH task). Phase 3 orchestrated run: implementer, independent reviewer and independent checker. It ran in parallel with OL-027; the files were disjoint and this task did not touch the DB.

## Files changed
- `src/pages/reportsAuditPdf.js` (rewritten). It no longer imports `mockOffers`. It exports pure helpers (`filterOffersByDateRange`, `buildSummaryRows`, `buildOfferRows`, `buildDeclineReasonRows`, `buildFairnessRows`, `formatDateRange`), `buildAuditReportPdf(data)`, which returns the jsPDF doc, and `generateAuditReportPdf(data)`, which builds and saves it.
- `src/pages/ReportsPage.jsx`:
  - Async export handler.
  - The Export button is gated until the report data has settled.
  - The inline `DECLINE_REASONS`, `ALLOCATION_FAIRNESS` and `TOTAL_ORGANS` mock constants are removed.
  - The orchestrator aliased Mantine's `Tooltip` as `MantineTooltip` to fix a build break (see Failures).
- `tests/client/auditPdf.test.js` (new).

## Behavior implemented
- **Data sources:** the PDF is built from `{dateRange, offers, declineReasons, fairness, compliance}`.
  - `offers` comes from `listOffers()`: `/api/offers` in live mode, the in-session mock offers in mock mode.
  - Decline reasons, fairness and compliance are the **same state the Reports page renders**: one API response each, through the OL-026 adapters, which don't round. The PDF figures therefore equal the page's figures.
- **Date range**
  - Filters offers on `offeredAt` (the adapted API `createdAt`), falling back to `createdAt`.
  - Inclusive local-day bounds (`startOf('day')` … `endOf('day')`); a null bound is open.
  - Compliance figures are all-time and labelled "(all time)", because the compliance view has no date parameter. Offer counts and rows follow the range.
- **Sections**
  1. Summary: compliance totals and placement rate, plus offer counts by status in the range.
  2. Offers in period: `OF-0012` display IDs, organ type, recipient (falling back to the `R-` display ID), status and created date.
  3. Decline reasons: reason, occurrences, share.
  4. Allocation fairness: Region, Waitlist size, Transplants completed, Allocation rate %, Median wait (days), Retention %. Nulls show "—". **"Expected allocation" and "Variance" are removed** (A6, C11).
- **Export button:** disabled with the tooltip "Loading report data…" until the decline, fairness and compliance loads have settled, whether they succeeded or failed. An `/api/offers` failure shows `showApiError` and produces no PDF.
- **Mock mode:** exports from mock offers plus the OL-026 mock report rows.
- The server-side `audit.pdf` stays deferred (A6).

## Tests and validations (checker, independent)
| Check | Result |
|---|---|
| `npm run test:server` (fresh reset; includes the concurrent OL-027 tests) | 166/166 pass |
| `npm run test:client` | 151/151 pass |
| `npm run build` | OK (after the orchestrator's import fix) |
| Lint (file:line count) | 8 = baseline |
| `npm run smoke` | SMOKE OK |
| AC1: end-to-end pipeline in node against the live API after smoke (same adapters as the page), open range | the PDF text contains both DB offers, OF-0001 and OF-0003 |
| AC1: range in 2020 | neither offer appears |
| AC2 | compliance as the page tile shows it (total organs 5, transplanted 1, "20%") appears in the PDF; so do the smoke decline description "Recipient medically unfit at time of offer" and the fairness region names |
| "Expected" | absent from the live, empty-range and mock PDFs |
| AC3: mock pipeline (`listOffers(…, false)`, mock report data) | PDF starts with `%PDF`; contains the mock offer ID, "(104)" and "94.23%" |
| Source | no `mockOffers` in `reportsAuditPdf.js`; handler calls `listOffers()` then the generator with the page's `declines`/`fairness`/`compliance`; `disabled={!reportDataReady}` |
| Client tests | real PDFs generated under node; asserts fixture strings (OF-0012, a decline description, a region, "all time") and no "Expected"; end-day inclusion at 23:30 and exclusion at 00:05 the next day |

## Reviewer findings and resolution
Verdict: **APPROVE**, with NITs:
1. Export could run before the report data loaded and silently produce zeros. **Fixed:** the button is gated with a tooltip.
2. The PDF tests checked only `%PDF` and the length. **Fixed:** content assertions plus end-of-day boundary cases.
3. Mock-mode data source (observation) and 4. timezone handling were confirmed correct. No change.

## Failures encountered
- **Build break introduced by the NIT-1 fix.** The fix imported Mantine's `Tooltip` into a page that already imports Recharts' `Tooltip`, causing `Identifier 'Tooltip' has already been declared`. The implementer's hand-back claimed the build succeeded. The concurrently running OL-027 implementer caught the failure. The orchestrator fixed it by aliasing the Mantine import, then confirmed build OK, lint 8 and client 151/151; the checker re-confirmed. See LESSONS_LEARNED.

## Remaining risks / follow-ups
- No browser verification of the download, the button tooltip or the PDF's visual layout.
- Compliance totals in the PDF are all-time even when a date range is selected (labelled). A date-scoped compliance figure would need a contract change.
- `listOffers()` fetches all offers and filters them client-side; fine at project scale.

## Manual interactive checks
| Page/route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| `/reports` (live) | Open the page and immediately hover Export Audit Report | Button disabled with tooltip "Loading report data…" until the reports load | Deferred to consolidated manual QA (source-checked) |
| `/reports` (live) | With no date range, click Export Audit Report and open the PDF | Lists every DB offer (OF-00NN) with organ, recipient, status and date; summary totals equal the Compliance tile; decline and fairness tables match the page; no "Expected" column | Deferred to consolidated manual QA (node pipeline automated against the live API) |
| `/reports` (live) | Pick a date range excluding all offers, then export | PDF with an empty offers table; compliance still shown "(all time)" | Deferred to consolidated manual QA (pipeline automated) |
| `/reports` (live) | Stop the API, then click Export | Red notification; no PDF | Deferred to consolidated manual QA |
| `/reports` (mock) | Click Export Audit Report | PDF downloads with mock offers and mock report figures | Deferred to consolidated manual QA (mock pipeline automated) |

No browser was opened for this task.

## Acceptance criteria
- In live mode the exported PDF lists DB offers within the selected date range: **satisfied**. Generation was verified end to end in node against the live API; the browser download is deferred.
- Its totals match the Reports page: **satisfied**. Same state and adapters; figures verified in the PDF text.
- Mock mode still exports: **satisfied** (PDF generated in the mock pipeline).
