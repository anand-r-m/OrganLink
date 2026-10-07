# OrganLink — Demo Script (OL-034)

A repeatable walkthrough of the full system, covering the ten steps the OL-034 backlog
requires. The API-level parts are automated by `npm run demo:rehearsal`; the browser parts
are listed as a checklist for the live rehearsal.

- **Time budget:** the automated rehearsal (`npm run demo:rehearsal`) completes in ~20–30 s.
  A human run with narration fits comfortably in 10–15 minutes.
- **Prepare (destructive, local only):** `npm run db:reset -- --yes`, then
  `VITE_DATA_SOURCE=api npm run dev` and open <http://localhost:5173>.
- **Admin login:** `admin` / `admin`.

> Reset shortly before demoing. Organs expire a few hours after a reset
> (Heart ≈ 6 h, Liver ≈ 12 h, Kidney ≈ 30 h).

---

## 0. Automated rehearsal (run this first)

```bash
npm run demo:rehearsal          # reset + API steps 1-6 + 7 discard + 8 reports + 9 rules + 10 concurrency
npm run verify:submission       # restore submission/organlink.sql into organlink_check and smoke it
```

Expected tail: `DEMO REHEARSAL OK (steps 1-10, Ns)`. Both commands reset/mutate data, so
reset again before the live run.

---

## 1. Login

1. Open <http://localhost:5173/login>.
2. Sign in with `admin` / `admin`.

**Expected:** redirected to the Dashboard; the session survives a page refresh (live mode
uses `GET /api/auth/me`).

Automation: `demo:rehearsal` step 1 (`POST /api/auth/login`).

## 2. Procure an organ

1. Go to **Donors**, open a donor, click **Procure Organ**.
2. Choose an organ type and set the recovery time to now (future times are rejected).

**Expected:** a toast, the new organ appears in the drawer with a viability countdown, and
status `AVAILABLE`.

Automation: step 2 (`POST /api/donors/:id/organs` then `GET /api/organs/:id`).

## 3. Match and re-run

1. Go to **Matching**, pick the procured organ, click **Run Match**.
2. Note the run timestamp (`Run #MR-NNNN at HH:MM`), then move a slider and click
   **Re-run Match**.

**Expected:** a ranked qualified list (with an Excluded section), a new run ID on re-run,
and the old run still retrievable.

Automation: step 3 — runs the match twice, asserts a new run id and that the previous run
still returns `200` via `GET /api/matching/runs/:oldId`.

## 4. Offer → decline → advance → accept

1. On the matching console, **Create Offer** for rank 1. Try rank 2 — the button is
   disabled with "This organ already has an active offer".
2. On **Offers**, **Send** the offer, then **Decline** it with a reason.
3. Click **Advance** on the declined offer; a new offer is created for the next candidate.
4. **Send**, then **Accept** the new offer.

**Expected:** statuses `CREATED → SENT → DECLINED → (advance) CREATED → SENT → ACCEPTED`;
the organ becomes `ALLOCATED` and a `PENDING` transport is created.

Automation: step 4 (including the negative `409 ACTIVE_OFFER_EXISTS`).

## 5. Transport

1. Go to **Transport**, **Mark In Transit**, then **Mark Delivered**.

**Expected:** `PENDING → IN_TRANSIT → DELIVERED`, with `departedAt` / `arrivedAt` set; the
map shows the origin and destination.

Automation: step 5.

## 6. Transplant

1. Back on **Offers**, open the accepted offer, click **Record Transplant** (enabled only
   after delivery; otherwise tooltip "Organ has not been delivered yet").
2. Choose outcome **Success**, confirm.

**Expected:** organ becomes `TRANSPLANTED`; only the matching waitlist entry closes; the
offer row shows the recorded outcome.

Automation: step 6.

## 7. Organs page and discard

1. Go to **Organs**; note the countdowns. Back-date an organ in `psql` if you want to show
   the sweep flipping it to `EXPIRED` on refresh.
2. Click **Discard** on an `AVAILABLE`/`EXPIRED` organ with no open offer and pick a reason.

**Expected:** grey `DISCARDED` badge with the reason.

Automation: step 7 (`GET /api/organs?available=true` then `POST /api/organs/:id/discard`).

## 8. Reports and PDF

1. Go to **Reports**; show the waiting-time buckets, utilization, decline reasons, and
   fairness charts, plus the compliance headline.
2. Click **Export Audit PDF** and open the file.

**Expected:** all charts render with live data; the PDF lists DB offers for the selected
range and its totals match the Reports page.

Automation: step 8 hits the five report endpoints and asserts `200`. The PDF is generated
client-side, so it is a manual/visual check.

## 9. Rule script

```bash
npm run db:rules
```

**Expected:** 14 `PASS` lines (`BR-1` … `BR-14`), 0 `FAIL`; the transaction rolls back, so
the DB is unchanged.

Automation: step 9.

## 10. Concurrency script

```bash
npm run concurrency
```

**Expected:** exactly 1 of 10 parallel offer creates succeeds (9 × `409`), exactly 1 of 2
parallel accepts succeeds, and exactly one `transport_record` exists for the organ.

Automation: step 10.

---

## Fallback: mock mode

If the API/DB is unavailable on the demo machine, run without the flag:

```bash
npm unset VITE_DATA_SOURCE   # or remove it from .env
npm run dev
```

Every page (`/login`, `/donors`, `/recipients`, `/organs`, `/matching`, `/offers`,
`/transport`, `/settings`, `/reports`, `/dashboard`) must load from `src/data/mock*.js`.
The quick CLI check is `GET /` and each `/src/pages/*.jsx` returning `200` from the Vite
dev server. (OL-029 records the consolidated browser pass.)