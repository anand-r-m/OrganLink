# OL-033 — Documentation and run instructions

Status: **complete.** `README.md` rewritten, `.env.example` documents the mock/live flag,
final decisions/assumptions recorded in `AUDIT_NOTES.md`, and the documented content is
now enforced by `npm run test:docs`.
No commits were made; nothing was pushed. `API_CONTRACT.md`, `BACKLOG.md` and the specs in
`docs/context/` were not modified.

## 1. Files changed

| File | Change |
|---|---|
| `README.md` | Rewritten (1 line → ~180). Prerequisites (Node 20+, PostgreSQL 14+, bash, curl, jq), clean-clone quick start to a logged-in dashboard, `.env` table, npm-script table, mock vs live (`VITE_DATA_SOURCE`) with the OL-DEC-03 page split, known limitations, project layout, docs map. |
| `.env.example` | Added the commented `# VITE_DATA_SOURCE=api` block (mock stays the default) and a comment on `DATABASE_URL`. OL-005 deferred this to OL-033. |
| `docs/implementation/AUDIT_NOTES.md` | Appended "Final status recorded at OL-033": a decision-gate outcome table (OL-DEC-01/02/03 with the chosen option and date), the final status of assumptions A1–A17 (A5 adopted, A8 resolved, A14 observed, A17 implemented), and the open items. |
| `tests/docs/docs.test.js` | **New.** 10 documentation acceptance tests (`node --test`, no database). |
| `package.json` | Added `"test:docs": "node --test tests/docs/*.test.js"`. |
| `docs/implementation/LESSONS_LEARNED.md` | Appended the `## OL-033` section. |
| `docs/implementation/OL-033-REPORT.md` | This report. |

## 2. Behaviour implemented

- **README quick start** takes a clean clone to a logged-in dashboard in four commands:
  `npm install` → copy `.env.example` to `.env` and set `DATABASE_URL` →
  `npm run db:reset` → `npm run dev`, then sign in `admin`/`admin` at
  `http://localhost:5173/login`. Live mode is enabled by `VITE_DATA_SOURCE=api`
  (in `.env`, or as a command prefix where the shell supports it) with a restart.
- **Script reference**: `dev`, `dev:web`/`dev:server`, `build`/`preview`, `lint`,
  `test:server`, `test:client`, `test:docs`, `db:reset`, `smoke`, `db:rules`,
  `concurrency`, with the seed-state caveats (`test:server` and `smoke` need a fresh
  reset and both mutate data; organs expire hours after a reset).
- **Mock vs live table** per OL-DEC-03: MUST-live routes (`/login`, `/donors`,
  `/recipients`, `/organs`, `/matching`, `/offers`, `/transport`) and STRETCH routes
  (`/settings`, `/reports`, `/dashboard`, plus the Audit PDF), noting that all of them
  currently have live endpoints and only the STRETCH rows keep a mock fallback.
- **Known limitations** carried from `AUDIT_NOTES`: OL-DEC-02 in-transit expiry gap,
  in-memory sessions, sweep without `SKIP LOCKED` (A14), smoke not cleaning up, seed age.
- **`AUDIT_NOTES.md` final record**: every `OL-DEC` entry now has an explicit outcome row
  (option + resolution date + where it is implemented), the assumption table has a final
  status column, and the still-open items are listed (deferred `audit.pdf` endpoint,
  OL-029 manual QA, the accepted OL-DEC-02 gap).
- **Automated docs coverage**: `npm run test:docs` asserts the README prerequisites,
  `.env` setup, required script names, `VITE_DATA_SOURCE` documentation, every route in
  the live/mock table, the credentials/quick-start path, the known-limitations section,
  the `.env.example` flag, and a recorded outcome row for OL-DEC-01/02/03 in
  `AUDIT_NOTES.md`.

## 3. Tests and validations run, with results

All commands run in this order on the working tree.

| Check | Result |
|---|---|
| Environment probe (`node --version`, `psql --version`, `command -v jq curl bash`) | Node v24.21.0, PostgreSQL 18.6, curl 8.21.0 present; **jq missing → fixed (§4)** |
| `npm run db:reset -- --yes` | exit 0 in 1.7 s; schema + reference + demo seed loaded |
| `npm run test:server` (fresh reset) | **181/181 pass**, exit 0 |
| `npm run test:client` | **151/151 pass**, exit 0 |
| `npm run test:docs` (new) | **10/10 pass**, exit 0 |
| Mutation check of the docs tests: removed `npm run db:rules` from README, re-ran, restored | `fail 1` (exactly the "documents every required npm script" test), exit 1; restored → 10/10 again |
| `npm run lint` | exit 0; only the pre-existing baseline warnings, none in `tests/docs/` |
| `npm run build` | exit 0 (46 s; existing >500 kB chunk warning only) |
| `npm run db:reset -- --yes && npm run smoke` (fresh reset) | **20 PASS lines, `SMOKE OK`**, exit 0 |
| `npm run db:rules` | exit 0 — `BR-1 PASS` … `BR-14 PASS`, 0 FAIL, transaction rolled back |
| Final `npm run db:reset -- --yes` | exit 0 — dev DB left on the documented seed for the next task |

### Clean-clone walkthrough (acceptance criterion 1)

Performed in `%TEMP%/opencode/organlink-clean` — a fresh `git clone` of this repo with the
three changed docs files copied over (the rules for this task forbid committing, so the
walkthrough simulates the post-commit state). Steps followed **only** from the new README:

| Step (as written in README) | Result |
|---|---|
| `npm ci` | ok — 214 top-level packages |
| `cp .env.example .env`, set `DATABASE_URL`, uncomment `VITE_DATA_SOURCE=api` | ok — exactly the README's `.env` instructions |
| `npm run db:reset -- --yes` | `db:reset complete` |
| `npm run dev` | Vite ready on `http://localhost:5173` in 1.9 s, API listening on `:3001` |
| `GET :5173/api/health` | `{"status":"ok","db":"ok"}` |
| `POST :5173/api/auth/login` `admin`/`admin` | 200 `{"user":{"id":1,"username":"admin","role":"ADMIN"}}` + session cookie |
| `GET :5173/api/auth/me` with the cookie | 200, same user |
| `GET :5173/api/dashboard` with the cookie | 200 — `availableOrgans: 3`, `activeWaitlist: 37`, `transplantsThisMonth: 1`, 12-point trend |
| `GET :5173/api/donors` without a cookie | 401 (auth enforced) |
| STRETCH live endpoints: `/api/reports/compliance`, `/api/reports/waiting-times`, `/api/hospitals`, `/api/regions`, `/api/lookups`, `/api/offers` | all 200 |
| `GET :5173/` | `index.html` served (app shell) |
| `npm run smoke` in the clone | `SMOKE OK`, exit 0 |
| `npm run db:rules` in the clone | 14/14, exit 0 |
| Mock mode: comment the flag back out, restart | Vite boots; `/`, `/src/pages/DashboardPage.jsx`, `/src/pages/LoginPage.jsx` all 200 (compile/render level) |

All clone processes were stopped and ports 5173/3001 verified free afterwards; the shared
local dev DB was reset once more at the end.

## 4. Failures encountered and how they were resolved

1. **`jq` was not installed**, so `npm run smoke` would have exited 2 with
   `smoke: jq is required`. Not caused by this task — the repo never documented or
   installed jq, and earlier environments had it by luck.
   *Fix:* downloaded the official `jq-1.7.1` Windows binary to `~/bin/jq.exe` (already on
   `PATH`) — local, reversible, no repo change. *Resolution:* `jq` is now a listed
   prerequisite in the README; smoke then ran green. Logged in `LESSONS_LEARNED.md`.
2. **A stray `cp` during the clean-clone overlay** copied `AUDIT_NOTES.md` into the clone
   root as well as `docs/implementation/`. Harmless and outside the repo; the stray file
   was deleted before the walkthrough.
3. **No test failures occurred.** `test:server`, `test:client`, `test:docs`, `smoke`,
   `db:rules`, `lint` and `build` were all green on the first full run after the
   environment fix. No schema, contract or product decision was needed.

## 5. Remaining risks / follow-ups

- **No browser was opened.** The login → dashboard click-through and mock-mode rendering
  in a real browser are deferred to OL-029 (no browser automation is available in this
  environment); see §6.
- The clean-clone walkthrough used a *local* clone plus a copy of the three uncommitted
  docs files, because this task must not commit. After the docs are committed, the same
  walkthrough can be repeated verbatim from the remote clone.
- README shell instructions assume Git Bash/WSL on Windows (npm scripts call `bash`), and
  `cp`/`copy` differ per shell — the Windows alternative is noted inline for `.env` only.
- `jq`, `curl` and `psql` must be on `PATH` for `smoke`/`db:reset`; they are prerequisites,
  not vendored. On a machine without them the README is the only pointer.
- `test:docs` asserts documentation content, not prose quality; wording edits still need
  a human read.
- The seed-age and known-limitation risks from `AUDIT_NOTES` (in-memory sessions, sweep
  contention, OL-DEC-02 gap) are documented in the README rather than fixed — unchanged
  decisions, not new work.

## 6. Manual interactive checks

No browser was opened during OL-033 and no claim below is browser-verified. OL-033
introduces **no new app-UI interaction**; the user-visible surfaces it changes are the
documentation a teammate follows. Statuses are one of:
`Automated test coverage` (a test or scripted check asserts it),
`Server-render check only` (only the server/compile level was exercised),
`Deferred to consolidated manual QA` (needs a human in a browser, OL-029).

| Page / route | Exact user action | Expected visible result | Verification status |
|---|---|---|---|
| n/a (repo docs) | Read `README.md` and follow the quick start on a clean clone | Prerequisites, `.env`, `db:reset`, `dev` steps all succeed | Automated test coverage — `npm run test:docs` (10 assertions) plus the executed clean-clone walkthrough in §3 |
| n/a (repo docs) | Run each documented script (`db:reset`, `dev`, `smoke`, `db:rules`, `test:server`, `test:client`, `test:docs`, `lint`, `build`) | The results documented in the README's script table | Automated test coverage — every command executed in §3 with its exit code recorded |
| n/a (repo docs) | Copy `.env.example` → `.env`, uncomment `VITE_DATA_SOURCE=api`, restart | App starts in live mode (flag consumed by Vite at dev-server start) | Automated test coverage — performed in the clean-clone walkthrough; `src/api/client.js` reads `import.meta.env.VITE_DATA_SOURCE === 'api'` |
| n/a (repo docs) | Read `AUDIT_NOTES.md` → "Final status recorded at OL-033" | A recorded outcome row for OL-DEC-01, OL-DEC-02 and OL-DEC-03 (option + date), plus assumption status and open items | Automated test coverage — `npm run test:docs` → "AUDIT_NOTES: every OL-DEC entry has a recorded outcome" |
| `/login` → `/dashboard` (live, per README quick start) | Open `http://localhost:5173`, submit `admin`/`admin` | Redirect to the dashboard showing live DB stats | Deferred to consolidated manual QA — API-level equivalent verified through the Vite proxy (login 200 + cookie, `/api/auth/me` 200, `/api/dashboard` 200); no browser opened |
| `/login` (live) | Submit a wrong password | Card shakes, invalid-credentials error | Deferred to consolidated manual QA — covered by `tests/server/auth.test.js`, not re-run as a browser check by this task |
| any route, mock mode | Start `npm run dev` with the flag unset, open `http://localhost:5173` | App renders mock fixtures with no network calls to `/api/*` | Server-render check only — index and page modules served/compiled (HTTP 200) in the clean-clone mock-mode step; page-level switching not exercised in a browser |
| any route, live mode | Refresh the page while logged in | Session persists (cookie) | Deferred to consolidated manual QA — `/api/auth/me` 200 with the cookie verified; browser refresh not performed |
| README (Windows reader) | Run `copy .env.example .env` instead of `cp` | `.env` created | Deferred to consolidated manual QA — the Git Bash path was executed; the Windows `cmd` variant was not |

## 7. Acceptance criteria (BACKLOG.md OL-033)

| Criterion | State |
|---|---|
| A teammate on a clean clone reaches a logged-in dashboard by following only the README | **Satisfied (API/render level)** — clean-clone walkthrough in §3: `npm ci` → `.env` → `db:reset` → `npm run dev` → `admin`/`admin` → session cookie + `/api/dashboard` 200 + app shell served. The browser click-through itself is deferred to OL-029 (no browser available), per the task's completion rules |
| Every OL-DEC entry has a recorded outcome | **Satisfied** — outcome rows for OL-DEC-01/02/03 (option + 2026-10-04 + implementation site) in `AUDIT_NOTES.md`; asserted by `npm run test:docs` |
| Scope: README prerequisites (Node 20+, Postgres 14+) | **Satisfied** — prerequisites table |
| Scope: `.env` setup | **Satisfied** — quick start + environment-variable table; `.env.example` documents the flag |
| Scope: `db:reset`, `dev`, `smoke`, `db:rules` documented | **Satisfied** — script table + verification loop; all four executed green (§3) |
| Scope: `VITE_DATA_SOURCE` flag documented | **Satisfied** — "Mock mode vs live mode" section + `.env.example` |
| Scope: which pages are live per OL-DEC-03 | **Satisfied** — route table with MUST/STRETCH tags matching `AUDIT_NOTES` OL-DEC-03 |
| Scope: record final decisions and assumptions in `AUDIT_NOTES.md` | **Satisfied** — "Final status recorded at OL-033" section |
| Required tests — DB: n/a, API: n/a | Per backlog; a content test (`npm run test:docs`, 10/10) was added instead and mutation-proven |
| Required tests — UI: a clean-clone walkthrough | **Satisfied** — executed (§3) at the API and server-render level; browser row deferred to OL-029 |
| Mock mode must keep working after every task | **Satisfied** — no frontend code changed; mock-mode dev server boots and compiles (§3); `test:client` 151/151 |
| No commit / no push | **Satisfied** — `git status` shows only the intended modified files and the new `tests/docs/` directory |
