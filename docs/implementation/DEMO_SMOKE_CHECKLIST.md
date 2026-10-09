# OrganLink — Browser Smoke-Test Checklist

**Status: PLAN ONLY. Nothing in this file has been executed in a browser. Every Result cell starts blank.**
Passing this smoke test does **not** prove the whole project is correct. It checks only the central "organ → transplant" journey (and one decline branch) through the real browser in live mode.

Target time: about 40 minutes (not counting setup).

Sources used: `docs/context/06_user_flow.md`, `docs/implementation/{DEMO_SCRIPT,MANUAL_QA_CHECKLIST,AUDIT_NOTES,BACKLOG}.md`, `OL-015/016/017/018/022/023/026/027/028/031/033/034-REPORT.md`, `README.md`, `.env.example`, `scripts/db-reset.sh`, `db/03_seed_demo.sql`, and the page sources under `src/pages/`. Labels below were copied from those page sources.

---

## 0. How to use this file

- Work top to bottom. Later scenarios depend on notes from earlier ones (organ and offer IDs).
- For each row, fill the last column with **PASS**, **FAIL** or **BLOCKED** (definitions in section 3).
- Keep DevTools open (Chrome: `Cmd+Option+I` → **Console** tab). Any red console error during a step is worth a note, but only counts as FAIL if the step's expected result is also wrong.
- Write down these values as you go (a scratch notepad is fine):

| Note | Where it comes from | Your value |
|---|---|---|
| Baseline dashboard cards | S1 step 1.5 | Available Organs = __ ; Pending Offers = __ ; Transplants This Month = __ |
| Baseline "Transplanted" (Compliance Summary) | S1 step 1.7 | __ |
| Kidney organ ID (new) | S2 step 2.4 | O-____ |
| Kidney offer ID, recipient name, recipient hospital | S3 step 3.7 | OF-____ / ________ / ________ |
| Liver organ ID | S4 step 4.1 | O-____ |
| Heart organ ID | S5 step 5.1 | O-____ |

---

## 1. Setup

### 1.1 What is confirmed from the repository

| Item | Value | Source |
|---|---|---|
| Node.js | 20 or newer | `README.md` → Prerequisites |
| PostgreSQL | 14 or newer, `psql` on PATH | `README.md` → Prerequisites |
| Browser URL | `http://localhost:5173/login` (Vite prints the real URL when it starts; if 5173 is busy it may pick another port, use the printed one) | `README.md` Quick start |
| API port | 3001 (Vite proxies `/api` to it) | `README.md` env table, `vite.config.js` |
| Demo login | username `admin`, password `admin` | `README.md`, `DEMO_SCRIPT.md`, OL-001 report (hash verified) |
| Live-mode switch | environment variable `VITE_DATA_SOURCE=api`, read **once** when the dev server starts | `README.md` → Mock vs live |
| `.env` file | exists in the repo folder and contains a `DATABASE_URL=` line. It does **not** contain `VITE_DATA_SOURCE`, so you must add it on the command line (below). | checked by key name only; values not read |

### 1.2 Missing setup information (not guessed)

- **I do not know your PostgreSQL username, password or port.** They are inside `DATABASE_URL` in your `.env` (`.env.example` shows only `postgresql://localhost:5432/organlink`). Do not change anything unless step 1.3 fails.
- **I do not know whether PostgreSQL is currently running**, or when your `organlink` database was last reset. That is why step 1.3 checks first.
- Earlier OL reports record that on the developer's machine PostgreSQL had to be started by hand (e.g. `brew services start postgresql@18`). I have not verified that this applies to your machine.

### 1.3 Commands (run in a terminal, in the OrganLink project folder)

| # | Command | What it does |
|---|---|---|
| a | `pg_isready` | Asks PostgreSQL whether it is accepting connections. Expect `accepting connections`. If it says "no response", start PostgreSQL the way you normally do, then run it again. |
| b | `VITE_DATA_SOURCE=api npm run dev` | Starts the Vite web app (port 5173) and the Express API (port 3001) together, with the browser app set to **live** mode (reads and writes the database). Leave this terminal open. If a dev server is already running, stop it (`Ctrl+C`) and start it again with this command, because the flag is read only at startup. |

Then in the browser open `http://localhost:5173/api/health`. **Expected:** `{"status":"ok","db":"ok"}`. If you see `DB_UNAVAILABLE`, PostgreSQL or `DATABASE_URL` is wrong: stop here and mark S1 BLOCKED.

### 1.4 Is the existing data sufficient? Decide before you start

The scenarios need the three organs created by the demo seed to still be **Available and not expired**: Heart (expires about 6 h after the last reset), Liver (about 12 h), Kidney (about 30 h). They also assume nobody has run `npm run smoke`, `demo:rehearsal` or `test:server` since the last reset, because those consume seeded organs and waitlist entries (`README.md` → "Order matters"; OL-034 report).

Decide using the pages in step 1.5/2.1: after logging in, open **Organs**. If you see Heart, Liver and Kidney all with status Available and a Heart countdown of **more than about 1 hour**, the current data is sufficient. Otherwise a reset is needed.

> **Reset (only if needed, only for the local development DB).** `npm run db:reset` **deletes the current `organlink` database and everything in it**, then recreates it and reloads `db/01_schema.sql`, `db/02_seed_reference.sql` and `db/03_seed_demo.sql`. It asks you to type `y`. It refuses any database not named `organlink` and any non-local host (`scripts/db-reset.sh`). Do not run it if the data in that database matters to you. Stop the dev server first (`Ctrl+C`), run the reset, then start the dev server again with the command from 1.3b. After a reset the whole checklist is best done within about 1 hour (the Heart is the limiting organ).

### 1.5 Record the baseline

Done as step 1.5 in S1 below.

---

## 2. Scenarios

Result column: write PASS / FAIL / BLOCKED.

### S1 — Login, navigation, live-mode confirmation (about 4 min)

**Starting state:** not logged in; dev server running in live mode.
**Intended behaviour:** `06_user_flow.md` Stage 1; `OL-004`; `MANUAL_QA_CHECKLIST.md` rows 6, 7, 9.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 1.1 | `/login` | Open `http://localhost:5173/login`. In **Username** type `admin`; in **Password** type `wrong`; press the sign-in button. | The login card shakes and shows an invalid-credentials error. You stay on the login page. (The shake itself was never browser-verified; if only the shake is missing but the error shows, note it, and mark PASS.) | |
| 1.2 | `/login` | Clear the password field, type `admin`, submit. | You are redirected to the **Dashboard**. No error. | |
| 1.3 | Dashboard | Press `F5` (refresh). | You stay on the Dashboard, still logged in. No bounce to `/login`. | |
| 1.4 | Left sidebar | Look at the menu. | Items, in order: Dashboard, Donor Registry, Recipient Waitlist, **Organs**, Matching Console, Offer Workflow, Transport, Reports, and Settings. | |
| 1.5 | Dashboard | Without clicking anything, read the four cards: **Available Organs**, **Active Waitlist**, **Pending Offers**, **Transplants This Month**. Write the values in the notes table in section 0. | Cards show numbers (not all zero). On a freshly reset DB, Available Organs is 3 and Pending Offers is 0. (Do not require Transplants This Month = 0; see conflict C2.) | |
| 1.6 | Organs | Click **Organs** in the sidebar. | Table lists Heart, Liver and Kidney organs with status **Available**, each with a live viability countdown, plus older historical organs. IDs look like `O-0001`, not like mock IDs (`K-0912`). This also confirms you are in live mode. Apply the sufficiency test in 1.4. | |
| 1.7 | Reports | Click **Reports**. In **Compliance Summary**, write down the **Transplanted** number. | Page renders; Compliance Summary shows a Transplanted figure. | |

### S2 — Procure a Kidney (about 4 min)

**Starting state:** logged in; Kidney organs: the seeded one only.
**Intended behaviour:** `06_user_flow.md` Stage 2 ("organ enters from the donor detail drawer"; exact recovery timestamp; created AVAILABLE); `OL-012` report; `MANUAL_QA_CHECKLIST.md` rows 39–46.
**Why this donor and hospital:** donor **Anil Kapoor** is a deceased O+ donor (O+ can donate to every blood group, so many candidates qualify). Setting the recovering hospital to **PGIMER Chandigarh** matters: the seed has no active kidney candidate at that hospital, so the later transport is a real journey and not the automatic "same hospital → already Delivered" case (`06_user_flow.md` Stage 6). Source: `db/03_seed_demo.sql` waitlist entries.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 2.1 | Donor Registry | Click **Donor Registry**. In the **Search** box type `Anil Kapoor`. Click that row. | A drawer titled **Donor Profile** opens showing Anil Kapoor, with HLA alleles and an **Organs** section listing his existing Heart with a countdown. | |
| 2.2 | Donor drawer | Click **Procure Organ**. | A **Procure Organ** modal opens with fields **Organ Type**, **Recovering Hospital** (pre-filled with the donor's hospital) and **Recovery Time** (pre-filled with now). | |
| 2.3 | Procure Organ modal | Set **Organ Type** = `Kidney`. Set **Recovering Hospital** = `PGIMER Chandigarh`. Leave **Recovery Time** as now. Click **Procure**. | Modal closes; a success toast **Organ Procured** appears. | |
| 2.4 | Donor drawer | Look at the **Organs** list in the drawer. | A new **Kidney** with status Available and a countdown of about 30 hours. Close the drawer, open **Organs**: the newest row (top) is a Kidney, Recovering Hospital `PGIMER Chandigarh`, Available. **Write its Organ ID in your notes.** | |
| 2.5 | Procure Organ modal *(optional, 1 min)* | Reopen **Procure Organ**, choose any organ type, and enter a Recovery Time in the future (type it if the picker blocks it), then **Procure**. | Either future times cannot be picked, or the error **Recovery time cannot be in the future** shows and the modal stays open. Close the modal without saving. | |

### S3 — Central journey: match → re-run → offer → send → accept → transport → transplant (about 17 min)

**Starting state:** the new Kidney from S2 is Available with no offers.
**Intended behaviour:** `06_user_flow.md` Stages 3–7; `OL-014/015/016/017/018` reports; `DEMO_SCRIPT.md` steps 3–6.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 3.1 | Matching Console | Click **Matching Console**. Open the **Select Organ for Allocation** dropdown. | Organs are listed as `O-xxxx (Kidney, O+)` style labels. Any expired or non-available organ is listed greyed out / disabled, not hidden (Stage 3). | |
| 3.2 | Matching Console | Choose your new Kidney (the Organ ID from step 2.4). | The left panel shows the donor and organ specification (Donor ID, Blood Group, Hospital, Region, Viability Remaining). Four sliders show **non-zero preset values**: HLA Compatibility Weight, Medical Urgency Weight, Geographic Proximity Weight, Waiting Time Weight (defaults come from the recovering hospital's regional policy). The right panel says **No match run yet**. | |
| 3.3 | Matching Console | Click **Run Match**. | A brief "Computing matches…" state, then ranked cards `#1`, `#2`, … each with a name, recipient ID, hospital, distance and a **Match Score** inside 0–100. The top card has a **TOP MATCH** badge. A label **Run #MR-NNNN at HH:MM** shows; write the run number down. A badge shows "N Eligible Candidates". | |
| 3.4 | Matching Console | Scroll to the bottom of the right panel. If a section **"N Candidates Excluded"** appears, click it. | Each excluded person shows a reason **code** and a **description**. If no Excluded section appears for this organ, mark this row BLOCKED for the exclusion part and re-check on the Liver run in step 4.3. | |
| 3.5 | Matching Console | Move one slider: click the **Waiting Time Weight** slider handle, then press the **Right Arrow** key about 5 times (each press = 5%). Note the "Sum: N%" line. Click **Re-run Match**. | The "Sum" line shows the new total (with "(Normalized)" if not 100). The run label now shows a **different run number** and time. Scores stay within 0–100. The ranking may change; either outcome is fine. The old run is not overwritten (only checkable by number: the new run id is higher). | |
| 3.6 | Matching Console | Hover the mouse over **Create Offer** on the **#2** card. (Do not click yet.) | The button is enabled and no tooltip appears (no offer exists yet). | |
| 3.7 | Matching Console | Click **Create Offer** on card **#1**. Then read the toast. **Write down the offer ID (OF-NNNN), the recipient name and the recipient's hospital shown on the card.** | Green toast **Offer created**: `OF-NNNN created for R-NNNN (rank 1)`. The #1 card shows a **Created** badge. | |
| 3.8 | Matching Console | Hover over the **disabled** Create Offer button on card **#2**. | Every Create Offer button is disabled; tooltip says **This organ already has an active offer**. (This is the one-open-offer rule, Stage 4.) | |
| 3.9 | Offer Workflow | Click **Offer Workflow**. In **Search** type your offer ID (OF-NNNN). | Page title **Active Organ Offers**. One row: the offer, status **Created**, **Offered At** filled, **Sent At** and **Response Deadline** empty ("—"). Row buttons: **Send Offer** and **Cancel Offer**. | |
| 3.10 | Offer Workflow | Click **Send Offer** on that row. | Blue toast **Offer sent**. Status turns **Sent**; **Sent At** and **Response Deadline** fill in (deadline is after the Sent time, one response window later; for kidney the seed says six hours). Row buttons now: **Record Accept**, **Record Decline**, **Cancel Offer**. | |
| 3.11 | Offer Workflow | Click **Record Accept**. Read the modal, then click **Record Accept** inside it. | The modal text says recording acceptance marks the organ as Allocated and creates a transport record, and that surgery is recorded separately (no "transplant scheduled" wording). Organ/recipient detail boxes may show "—" (accepted limitation, see section 4.2). After confirming: toast **Offer accepted** / "Accepted: organ allocated, transport created"; status **Accepted**. A **Record Transplant** button appears and is **disabled**. | |
| 3.12 | Offer Workflow | Hover the disabled **Record Transplant** button. | Tooltip: **Organ has not been delivered yet**. | |
| 3.13 | Organs | Click **Organs**, search your Organ ID. | Status **Allocated**; countdown still shown or "—" (either is acceptable); Discard button absent. | |
| 3.14 | Transport | Click **Transport**. Search your Organ ID. | A new row with status **Pending**, Organ ID = yours, **Origin Hospital** = `PGIMER Chandigarh`, **Destination Hospital** = the recipient's hospital from step 3.7, a **Viability Remaining** countdown, and the map shows origin and destination. Button: **Mark In Transit**. **If the status is already Delivered:** the recipient is at PGIMER Chandigarh (same-hospital rule, expected by Stage 6). Mark steps 3.15–3.16 as BLOCKED (not FAIL) and list "Depart/Deliver in the browser" as unverified in section 4. Step 3.17 is then also BLOCKED unless the Record Transplant button is already enabled. | |
| 3.15 | Transport | Click **Mark In Transit**, then confirm in the modal (button **Mark In Transit**). | Green toast **Transport marked in transit**. Status **In Transit**; **Departed At** filled. Button changes to **Mark Delivered**. | |
| 3.16 | Transport | Click **Mark Delivered**, confirm in the modal (button **Mark Delivered**). | Toast **Transport marked delivered**. Status **Delivered**; **Arrived At** filled; no action button; countdown column shows "—". | |
| 3.17 | Offer Workflow | Open **Offer Workflow** again (reload the page, `F5`, so it reads the new transport state). Search your offer ID. Click **Record Transplant**. | The button is now **enabled**. A modal **Record Transplant** opens with **Outcome** (empty, placeholder "Select an outcome"), **Transplant time** (filled with now), **Notes** (optional). | |
| 3.18 | Record Transplant modal | Click the modal's **Record Transplant** button **without** choosing an outcome. | Inline error **Select an outcome**; the modal stays open. | |
| 3.19 | Record Transplant modal | Set **Outcome** = `Success`. Leave the time as is. Click **Record Transplant**. | Green toast **Transplant recorded**. In the row, a green **Success** badge appears; the Record Transplant button is gone. | |
| 3.20 | Organs | Click **Organs**, search your Organ ID. | Status **Transplanted** (green). | |
| 3.21 | Recipient Waitlist | Click **Recipient Waitlist**. Make sure the view is **Waitlist entries** (not Recipients). Search the recipient name from step 3.7. | That recipient's **Kidney** entry now has status **Transplanted** (no longer Active). If this recipient also holds a second entry (e.g. Karthik Iyer or Rohan Joshi have a Pancreas entry), the other entry **stays Active** (Stage 7: only the entry for that organ type closes). If there is no second entry, just confirm the Kidney entry. | |

### Revised S4–S6 plan (adapted to the database state read at 2026-10-09 20:12 IST)

S1–S3 were run against the live database, and the database was **not reset**. The original S4–S6 text (seeded Liver, seeded Heart, fresh-reset arithmetic) no longer matches, so S4–S6 below replace it. Everything here was derived from read-only queries. **No HTTP/API call was made to produce it, and no match was run.**

**Records to leave alone (do not edit, cancel, discard or re-run):**

| Record | State now |
|---|---|
| OF-0031 (Arjun Mehta, Kidney O-0029) | Accepted, transplant #20 SUCCESS, transport DELIVERED |
| OF-0032 (Kavya Nair, Heart O-0030) | Accepted, transplant #21 SUCCESS, transport DELIVERED |
| OF-0033 (Deepa Menon, Liver O-0031) | Accepted, transport **Pending** (organ Allocated). Leave the transport Pending |
| O-0001 Heart | Expired (cannot be used) |

**Organs usable now (live organs only, checked at 20:12):**

| Organ | Status | Use |
|---|---|---|
| **O-0003 Kidney** (donor Mohan Krishnan, B+; recovered at Apollo Chennai; about 19 h left; no offers) | Available | **S4**. By my reading of the matching rules there are about **5 eligible** candidates (all B+ or AB+): Meera Kulkarni, Karthik Iyer, Rohan Joshi, Sunita Rao, Divya Shetty, and about 15 excluded. Rank order depends on the match weights, so do not expect this exact order. |
| O-0002 Liver | Available, but **expires at 20:20** (about 8 minutes after the read). Only 1 eligible candidate | **Do not use.** Expect it to turn Expired |
| *(none)* | | **S5 has no existing suitable organ**, so S5 starts by procuring one in the UI (step 5.0) |

**Baseline to record (step 4.0 below), before any further action.** Do not use the earlier S1 numbers, because S3 and the extra workflows have since changed them. For reference, at 20:12 the database read: Available Organs 2 (O-0002 and O-0003; becomes 1 when the Liver expires), Active Waitlist 35, Pending Offers 0, Transplants This Month 3, Compliance Transplanted 19, Expired 4, Discarded 5, Total organs 31. These are context only; record what the screen shows.

### S4 — Decline → Advance branch on O-0003 Kidney (about 8 min)

**Starting state:** O-0003 Kidney is Available with no offers, and O-0002 Liver has expired (step 4.0). This is a different organ from S3, so accept and decline never share an organ.
**Intended behaviour:** `06_user_flow.md` Stage 5 (Decline; Advance walks down ranks; declined recipient never re-offered); `OL-016` report; `DEMO_SCRIPT.md` step 4.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 4.1 | Matching Console | Open **Matching Console**. In **Select Organ for Allocation** choose the **Liver** (label contains `Liver`; it is the one recovered about 90 minutes before the last reset). Write down its Organ ID. | Liver details show; sliders preset to non-zero values for its (Western) region. | |
| 4.2 | Matching Console | Click **Run Match**. | Ranked candidates appear with a run label. A Liver from an O- donor is blood-group compatible with all recipients, so most active liver-list entries qualify. | |
| 4.3 | Matching Console | If an **"N Candidates Excluded"** section exists, expand it (completes the exclusion check from 3.4). | Each excluded row shows a code and description. If none exists here either, 3.4 stays BLOCKED (not FAIL). | |
| 4.4 | Matching Console | Click **Create Offer** on card **#1**. Write the recipient name. | Toast **Offer created … (rank 1)**. | |
| 4.5 | Offer Workflow | Open **Offer Workflow**, search the new offer, click **Send Offer**. Then click **Record Decline**. | Modal **Record Decline** with **Decline Reason** (required) and **Notes**. | |
| 4.6 | Record Decline modal | Click **Record Decline** with no reason. Then choose the reason described as **Organ quality assessed as unsuitable** (code ORGAN_QUALITY) and click **Record Decline**. | First: inline error **Select a decline reason**. Then: orange toast **Offer declined**; status **Declined**; the response shows `ORGAN_QUALITY`; a button **Advance to Next** appears. | |
| 4.7 | Offer Workflow | Click **Advance to Next** on the Declined row. | Green toast **Advanced to next** (`OF-… created for R-… (rank N)`). A **new** row appears with status **Created** for a different recipient. A blue panel lists **Skipped ranks** with reasons, or says no ranks were skipped. | |
| 4.8 | Offer Workflow | On the new **Created** row, click **Cancel Offer**. | Gray toast **Offer cancelled**; status **Cancelled**; no actions remain. (Frees the Liver and tests Cancel, which the OL-015 report deferred.) | |
| 4.9 | Matching Console | Open **Matching Console**, choose the Liver again. | The latest saved run loads automatically. The recipient who declined shows a **Declined** badge and their **Create Offer** button is disabled; hovering it shows **This recipient has already declined this organ**. Other candidates' Create Offer buttons are enabled. | |

### S5 — Discard an unplaced organ (about 3 min)

**Starting state:** the seeded Heart is Available with no offers.
**Intended behaviour:** `06_user_flow.md` "The candidate chain runs out" (discard from the Organs tab with a reason); `OL-023` report; Audit A17.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 5.1 | Organs | Click **Organs**. Find the seeded **Heart** (Available). Write its ID. Hover its **Discard** button. | **Discard** is enabled (no open offer). Rows that are Allocated or Transplanted (your S3 Kidney) have **no** Discard button. | |
| 5.2 | Organs | Click **Discard** on the Heart. In the modal (title `Discard O-…`), click **Discard organ** with no reason selected. | Inline error **Select a discard reason** (if a reason is pre-selected, clear it first; if it cannot be cleared, note it and continue). | |
| 5.3 | Discard modal | Choose **No compatible recipient identified** (code NO_SUITABLE_RECIPIENT) and click **Discard organ**. | Orange toast **Organ discarded**; the Heart row shows a gray **Discarded** badge and no Discard button. | |
| 5.4 | Matching Console | Open the organ dropdown. | The discarded Heart is listed but disabled. | |

### S6 — Essential outcome: Dashboard and Reports (about 5 min)

**Intended behaviour:** `06_user_flow.md` "Secondary flows → Reports"; OL-026/027/028 reports (Dashboard, Reports and Audit PDF are STRETCH under OL-DEC-03, so a failure here does not block the central journey, see section 3).

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 6.1 | Dashboard | Click **Dashboard** and reload (`F5`). Compare with the baseline in step 1.5. | **Transplants This Month** is **baseline + 1**. **Available Organs** = baseline + 1 (procured Kidney) − 1 (Kidney allocated) − 1 (Heart discarded) = **baseline − 1** (2 on a fresh reset). **Pending Offers** equals the baseline (the Kidney offer is Accepted; the Liver offers are Declined/Cancelled). | |
| 6.2 | Dashboard | Scroll to **Allocation Trends** and **Recent Organ Offers**. | The trend chart shows a series over 12 months with no blank/NaN chart. Recent Organ Offers lists the newest offers; your S3 and S4 offers are near the top with statuses Accepted, Declined, Created/Cancelled. | |
| 6.3 | Reports | Click **Reports**. Read the **Transplanted** line in **Compliance Summary**. | Page title **Analytics & Compliance**. Sections: Waiting Time Distribution, Organ Utilization by Region, Decline Reasons, Compliance Summary, Allocation Fairness. All render with data (not just empty states). No red console errors. **Transplanted** is the step 1.7 baseline **+ 1**. | |
| 6.4 | Reports | Look at **Decline Reasons**. | Contains the decline you recorded in S4 (Organ quality / ORGAN_QUALITY). | |
| 6.5 | Reports | Click **Export Audit Report**. Open the downloaded PDF. | A PDF downloads. It lists offers (including OF-… from S3/S4) and its totals agree with the Compliance Summary. (The button is disabled with tooltip "Loading report data…" for a moment after the page opens; wait for it.) | |

### S7 — Mock-mode fallback (optional, about 3 min; skip if short on time)

**Intended behaviour:** `BACKLOG.md` OL-034 ("fallback mock mode is verified on the demo machine"); `DEMO_SCRIPT.md` fallback.

| Step | Page | Exact click/type/action | Expected visible result | Result |
|---|---|---|---|---|
| 7.1 | Terminal | Press `Ctrl+C` in the dev-server terminal, then run `npm run dev` (no flag; make sure `VITE_DATA_SOURCE` is not set in your shell). | Both processes start. | |
| 7.2 | Browser | Open `http://localhost:5173/login`, sign in `admin` / `admin`, visit Donor Registry, Recipient Waitlist, Organs, Matching Console, Offer Workflow, Transport, Settings, Reports, Dashboard. | Every page loads with sample data (IDs like `DNR-0912`), no blank page. | |

---

## 3. Failure handling

- **FAIL** = you ran the step and the visible result contradicts the "Expected visible result" column.
- **BLOCKED** = you could not run the step because setup, data or an earlier step prevented it (e.g. PostgreSQL down, organ already expired, an earlier step failed so there is no offer to work with, or a same-hospital transport that skips Depart/Deliver). Say why.

**Demo-blocking failures** (the central journey cannot be shown): any FAIL or BLOCKED in S1 steps 1.2–1.6, S2 steps 2.2–2.4, S3 steps 3.3, 3.7, 3.10, 3.11, 3.14–3.17, 3.19–3.20, and S4 steps 4.6–4.7. Stop and report these before doing anything else.

**Not demo-blocking** (record and continue): S1 1.1/1.3, S2 2.5, S3 3.4–3.6, 3.8, 3.12, 3.13, 3.18, 3.21, S4 4.3, 4.8, 4.9, all of S5, S6 (Dashboard/Reports/PDF are STRETCH per OL-DEC-03, though a broken Dashboard is still a visible problem), and S7.

If a step fails, do not retry endlessly: take the screenshot, fill the template, and either continue with the next independent scenario or stop if it was demo-blocking. If you need to reset, read the warning in 1.4 first.

**Defect template (copy per failure):**

```
Step:            (e.g. S3 step 3.10)
Expected:        (copy from the table)
Actual:          (what you saw)
Screenshot/error:(file name, red toast text, console error, terminal output)
Demo-blocking?:  yes / no
Notes:           (record IDs, time since last reset, anything unusual)
```

---

## 4. Deferred checks and limitations

### 4.1 Required features NOT covered here (unverified in a browser; deferred)

- Donor registration, edit and deactivate (OL-020); recipient registration, edit and adding waitlist listings (OL-021/022); Donor Registry filters and the HLA display (OL-011).
- The "expired organ stays listed but greyed out" display (needs an organ that has actually expired).
- The sweep behaviours on screen: Created offer auto-cancelled after one hour, Sent offer expiring after the response window, offer voided when an organ expires or when the recipient becomes unavailable (06 "Failure paths"). These need time to pass or manual DB changes; not suitable for a smoke test.
- Accept failing after the viability window has elapsed ("acceptance re-verifies viability").
- Transplant outcomes Failed and Organ Not Used, and future-dated transplant time rejection (OL-018 table).
- Cancel on a **Sent** offer; stale-view 409 toasts; "Advance with no remaining candidate" red panel.
- Settings: Hospitals, Regions with policy weights, Organ Types, 8×8 blood matrix, HLA data (OL-024/025). The sliders' default values are not compared with the Region's policy weights shown in Settings.
- Recipient Waitlist priority-score tooltip (urgency and waiting time only, OL-022).
- Reports with a date range; PDF content beyond the totals check.
- Concurrency (double-allocation) and business-rule scripts (`npm run concurrency`, `npm run db:rules`) are terminal checks, not browser checks.
- Logout, session loss after API restart, API-down error toasts (MANUAL_QA rows 8, 10, 11).
- All rows of `MANUAL_QA_CHECKLIST.md` and each OL report's "Manual interactive checks" tables that are not repeated above remain unverified until OL-029 is performed. **No OL-029-REPORT.md exists**; OL-029 has no recorded result.

### 4.2 Accepted limitations (kept as limitations, not passes)

- **In-transit expiry (OL-DEC-02, Option A):** an organ that expires while Allocated/in transit is not expired automatically, its transport is not failed, and a transplant can still be recorded once Delivered. `06_user_flow.md` Stage 6 describes the opposite. Not tested here and must not be claimed in a demo (`AUDIT_NOTES.md` OL-DEC-02; `README.md`).
- **Sessions are in memory:** restarting the API logs you out.
- **Record Accept modal** organ/recipient detail panels may show "—" in live mode (OL-016 report, remaining risks).
- **Matching sliders** reopen at the organ's default weights, not the weights of the last saved run (MANUAL_QA row 69).
- **Audit PDF** compliance totals are all-time even if a date range is chosen (OL-028 report).
- **Seed data ages:** organs expire hours after a reset. After the Heart passes about 6 h you will see it EXPIRED and S5/S1 expectations change.
- **Dashboard / Reports / Settings / Audit PDF** are STRETCH items that keep a mock fallback (OL-DEC-03). A "pass" there with silent mock data would be misleading; IDs like `OF-00NN` and numbers matching your actions confirm live data.

### 4.3 Source conflicts (not resolved here)

| # | Conflict | Sources | How this checklist handles it |
|---|---|---|---|
| C1 | Button name: scripts say **Export Audit PDF**, the page says **Export Audit Report** | `DEMO_SCRIPT.md` §8, OL-034 report vs `src/pages/ReportsPage.jsx` | Uses the page label. |
| C2 | Baselines: OL-026/027 reports say a fresh reset shows 0 transplants this month and 3 total organs; OL-031 added a historical seed with at least one transplant in the current month | OL-026, OL-027 vs OL-031 report | Compares **before/after deltas** instead of absolute numbers. |
| C3 | Stage 6 says expiry in transit fails the transport; OL-DEC-02 accepts that it does not | `06_user_flow.md` vs `AUDIT_NOTES.md` | Not tested; listed in 4.2. |
| C4 | `DEMO_SCRIPT.md` fallback says `npm unset VITE_DATA_SOURCE`, which is not a valid npm command | `DEMO_SCRIPT.md` | S7 just starts `npm run dev` without the flag. |
| C5 | `DEMO_SCRIPT.md` §7 suggests back-dating an organ in `psql`; this checklist forbids manual SQL | `DEMO_SCRIPT.md` vs task rules | Not used. |
| C6 | Recipient/candidate ranks are computed by the database. This plan cannot predict who is #1 or what the exact scores are; steps use "whoever is #1" and record names as you go. | n/a | Expected results are structural, not name-specific, except the named donor and seeded organs. |

---

## 5. Cross-reference (scenario → intended behaviour)

| Scenario | Primary sources |
|---|---|
| S1 | `06_user_flow.md` Stage 1; OL-004 report; `MANUAL_QA_CHECKLIST.md` rows 6, 7, 9, 19 |
| S2 | `06_user_flow.md` Stage 2; OL-012 report; MANUAL_QA rows 39–46; `DEMO_SCRIPT.md` §2 |
| S3 | `06_user_flow.md` Stages 3, 4, 5 (Accept), 6, 7; OL-014, OL-015 (checks 2, 3, 9), OL-016, OL-017, OL-018 reports; `DEMO_SCRIPT.md` §3–6; `API_CONTRACT.md` offer/transport/transplant sections |
| S4 | `06_user_flow.md` Stage 5 (Decline, Advance); `AUDIT_NOTES.md` U1, A4; OL-015 checks 7, 10; OL-016 checks 3–7, 10; `DEMO_SCRIPT.md` §4 |
| S5 | `06_user_flow.md` "The candidate chain runs out"; `AUDIT_NOTES.md` A17; OL-023 report; `DEMO_SCRIPT.md` §7 |
| S6 | `06_user_flow.md` "Secondary flows → Reports"; OL-026, OL-027, OL-028 reports; `DEMO_SCRIPT.md` §8 |
| S7 | `BACKLOG.md` OL-034; `DEMO_SCRIPT.md` fallback; OL-034 report check 11 |

---

## 5b. S3 completion evidence (database only; browser confirmation is separate)

| Item | Database evidence (read-only SQL, 2026-10-09; no HTTP/API call made) | Browser confirmation |
|---|---|---|
| S3 offer OF-0031 | organ_offer 31 ACCEPTED: Kidney O-0029 to Arjun Mehta (B+, AIIMS New Delhi); donor Anil Kapoor (O+) | Reported by you through 3.20; 3.21 reported the Waitlist now loads. |
| Transport | transport_record 21 DELIVERED, PGIMER Chandigarh → AIIMS New Delhi | Reported by you |
| Transplant | transplant_event 20 SUCCESS at AIIMS New Delhi; organ TRANSPLANTED | Reported by you (an accidental extra click completed it; no data repeated) |
| Waitlist | waitlist_entry (recipient 1, Kidney) TRANSPLANTED; recipient status stays ACTIVE by design | **Pending**: Waitlist entries view, page 3 (rank 30 of 59), or search `Arjun`, to be confirmed in the browser |
| Extra workflows | OF-0032 Heart (Kavya Nair) transplanted (transplant #21); OF-0033 Liver (Deepa Menon) Accepted, transport Pending | Not checked |

---

## 6. Results log (fill in after running)

| Field | Value |
|---|---|
| Date/time of run | |
| Time since last `db:reset` | |
| Run by | |
| S1 / S2 / S3 / S4 / S5 / S6 / S7 overall | |
| Demo-blocking failures | |
| Defects filed | |
