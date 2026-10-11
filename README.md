# OrganLink

Organ allocation DBMS: a React/Vite/Mantine frontend over a Node/Express API and a
PostgreSQL database. PostgreSQL owns the business invariants (triggers, the matching
function, the expiry sweep); the API is plain `node-postgres` with no ORM, and the
frontend keeps a mock/live switch (`VITE_DATA_SOURCE`).

- Specs: `docs/context/`
- Approved work plan, API contract, audit notes and per-task reports: `docs/implementation/`

---

## Prerequisites

| Requirement | Version | Needed for |
|---|---|---|
| Node.js | 20 or newer (built with 24) | everything (`npm run dev`, tests, build) |
| PostgreSQL | 14 or newer, with `psql` on `PATH` | `db:reset`, `db:rules`, running the app in live mode |
| bash | any (Git Bash on Windows, or WSL/macOS/Linux) | the `db:reset`, `smoke` and `db:rules` npm scripts |
| curl | any | `npm run smoke` |
| jq | 1.6+ (1.7.1 verified) | `npm run smoke` |

Mock mode needs no database at all — only Node and `npm install`.

---

## Quick start (clean clone → logged-in dashboard)

```bash
git clone <repo> OrganLink && cd OrganLink
npm install

# 1. Configure the environment
cp .env.example .env          # Windows: copy .env.example .env
#    then edit .env and set DATABASE_URL to your local database, e.g.
#    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/organlink

# 2. Create and seed the database (dedicated local dev DB `organlink` only)
npm run db:reset              # answers the prompt with y
npm run db:reset -- --yes     # non-interactive (CI, scripts)

# 3. Start the app (Vite on :5173, API on :3001, /api proxied)
npm run dev
```

Open <http://localhost:5173/login> and sign in with **admin / admin** — you land on the
dashboard.

To run the app against the database (live mode) instead of the bundled mock data, add
`VITE_DATA_SOURCE=api` to `.env` (or prefix the command) **before** starting:

```bash
VITE_DATA_SOURCE=api npm run dev      # Git Bash / macOS / Linux
```

```powershell
$env:VITE_DATA_SOURCE="api"; npm run dev   # PowerShell
```

Restart the dev server after changing `.env`; Vite reads the flag when it starts.

---

## Environment variables (`.env`)

`.env` is gitignored. `.env.example` is the template.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes (live mode, `db:reset`, `db:rules`) | local socket / `organlink` | PostgreSQL connection string. `db:reset` refuses any database name other than `organlink` and any non-local host unless `ALLOW_NONLOCAL_RESET=1` |
| `SESSION_SECRET` | recommended | insecure dev default (server warns) | express-session secret for the `connect.sid` cookie |
| `VITE_DATA_SOURCE` | no | unset (mock mode) | `api` = live mode: the frontend calls `/api/*`. Unset = mock mode: the frontend uses `src/data/mock*.js` and needs no backend |
| `PORT` | no | `3001` | API port (Vite proxies `/api` to `http://localhost:3001`, see `vite.config.js`) |

---

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (:5173) **and** the Express API (:3001) together, via `concurrently` |
| `npm run dev:web` / `npm run dev:server` | one of the two processes only |
| `npm run build` / `npm run preview` | production build / preview it |
| `npm run lint` | oxlint (0 errors; a handful of pre-existing warnings) |
| `npm run test:server` | API + DB tests against `DATABASE_URL` — **run on a freshly reset DB** |
| `npm run test:client` | frontend unit tests (no database) |
| `npm run test:docs` | documentation acceptance checks (README / `.env.example` / AUDIT_NOTES content; no database) |
| `npm run db:reset` | drop and recreate the local `organlink` DB, then load `db/01_schema.sql`, `db/02_seed_reference.sql`, `db/03_seed_demo.sql` with `ON_ERROR_STOP=1` |
| `npm run smoke` | OL-019 core-slice smoke test: login → procure → match → offers → transport → transplant, asserting HTTP status and entity state at each step. Needs `curl` + `jq`; starts the API itself if nothing is listening on `BASE_URL` (default `http://localhost:3001`) |
| `npm run db:rules` | OL-032 business-rule demonstration: prints `BR-1 PASS` … `BR-14 PASS` (14 of 14), 0 FAIL. Runs in one transaction and rolls back, so it is safe to re-run |
| `npm run concurrency` | OL-030 concurrency proof: 10 parallel offer creates and 2 parallel accepts → exactly one success each |
| `npm run db:dump` | OL-034 submission dump: reset `organlink`, then `pg_dump` it to `submission/organlink.sql` (pass `-- --no-reset` to dump the current DB) |
| `npm run verify:submission` | OL-034 restore check: load `submission/organlink.sql` into a scratch `organlink_check` DB, assert the invariants, run `smoke` against it, then drop it |
| `npm run demo:rehearsal` | OL-034 repeatable demo: reset, then run steps 1–10 of `docs/implementation/DEMO_SCRIPT.md` through the API and scripts |

Typical verification loop:

```bash
npm run db:reset -- --yes && npm run test:server && npm run test:client && npm run test:docs && npm run smoke
```

**Order matters:** `test:server` and `smoke` both assume a freshly reset seed and both
mutate data (smoke records a transplant). Reset before each of them; reset again before
a demo. Organs expire a few hours after a reset (Heart ≈ 6 h, Liver ≈ 12 h, Kidney ≈ 30 h),
so reset shortly before demoing or running the organ/matching checks.

---

## Upgrading an existing database

The schema is defined by SQL files and there is no migration framework (05_tdd.md §2.3).

- **Fresh install:** `npm run db:reset` loads `db/01_schema.sql`, which already contains every
  change below. Nothing else to run.
- **Existing database you want to keep:** run each upgrade file once, against the database you
  choose, with `psql -v ON_ERROR_STOP=1 -X -d <database> -f db/upgrades/<file>.sql`. Upgrade files
  never change or delete rows, check the existing data before adding a constraint, and are safe
  to re-run. Apply them in the order listed.

| File | Task | Effect |
|---|---|---|
| `db/upgrades/OL-036_OL-037.sql` | OL-036, OL-037 | `match_candidates()` gives tied candidates distinct, deterministic ranks; `fn_audit()` records the real id for `organ_offer` and `transplant_event` |
| `db/upgrades/OL-039.sql` | OL-039 | Adds `UNIQUE (run_id, organ_id)` on `match_run` and replaces the single-column offer→run FK with `FOREIGN KEY (run_id, organ_id) REFERENCES match_run (run_id, organ_id) ON DELETE RESTRICT`. Refuses to run if any offer references another organ's run. After it, a match run that an offer references can no longer be deleted |

---

## Mock mode vs live mode (`VITE_DATA_SOURCE`)

| Mode | How | Needs DB? | Behaviour |
|---|---|---|---|
| **Mock** (default) | flag unset | no | Every page renders the bundled `src/data/mock*.js` fixtures; no network calls to `/api/*` |
| **Live** | `VITE_DATA_SOURCE=api` | yes | Every page reads and writes through `/api/*` (Vite proxy → Express → PostgreSQL), with `src/api/adapters/*` mapping schema-shaped rows to the existing component props (OL-DEC-01, Option B) |

The switch is read once at dev-server start (`src/api/client.js` → `USE_LIVE_API`), so
restart after changing it. Login uses `admin`/`admin` in both modes (live checks it
against `app_user.password_hash`).

### Which pages are live, per OL-DEC-03

OL-DEC-03 (resolved 2026-10-04) set a **mixed** demo bar: the core allocation flow MUST
be live; Settings, Reports, Dashboard and the Audit PDF are STRETCH (they may fall back
to mock behind the flag). As implemented, **all pages have live endpoints** — the
STRETCH rows keep their mock fallback as the safety net.

| Route | OL-DEC-03 tag | Status |
|---|---|---|
| `/login` | MUST | Live (OL-004) |
| `/donors` (registry, drawer, Procure Organ) | MUST | Live (OL-011, OL-012, OL-020) |
| `/recipients` (incl. waitlist + priority score) | MUST | Live (OL-021, OL-022) |
| `/organs` (incl. Discard) | MUST | Live (OL-013, OL-023) |
| `/matching` (run, re-run, create offer) | MUST | Live (OL-014) |
| `/offers` (create, send, accept, decline, advance, Record Transplant) | MUST | Live (OL-015, OL-016, OL-018) |
| `/transport` (depart, deliver) | MUST | Live (OL-017) |
| `/settings` (hospitals, regions/weights, organ types, compatibility, HLA) | STRETCH | Live endpoint implemented (OL-024, OL-025); mock fallback retained |
| `/reports` (charts + audit PDF export) | STRETCH | Live endpoints implemented (OL-026, OL-028); mock fallback retained |
| `/dashboard` | STRETCH | Live endpoint implemented (OL-027); mock fallback retained |
| `/__phase0-smoke` | — | Dev-only badge/grid page; always mock |

---

## Known limitations and assumptions

Recorded in `docs/implementation/AUDIT_NOTES.md` (assumptions A1–A17, decisions
OL-DEC-01/02/03). The ones you will notice:

- **In-transit expiry (OL-DEC-02, Option A).** The sweep only expires `AVAILABLE` organs.
  An organ that is allocated and in transit is never auto-expired, its transport is never
  set to `FAILED`, and a transplant can be recorded once the transport is `DELIVERED`.
  Documented limitation; the schema is unchanged.
- **Sessions are in-memory** (05_tdd.md §1). Restarting the API logs everyone out.
- **The sweep has no `SKIP LOCKED`** (A14). Fine at demo scale; watch for blocking in the
  concurrency script.
- **`smoke` does not clean up** — it leaves one transplanted organ behind. Reset before a
  demo.
- Seed data ages out: `test:server` is green for roughly the first hours after
  `db:reset`, then seed-age tests fail. `npm run db:reset` restores them.
- **Donor/organ validation is deliberately light (OL-038).** Nothing restricts which organ
  types a LIVING donor may provide (a Heart can be procured from a living donor), procurement
  does not check donor status, and the number of organs per donor is not limited. Nothing checks
  that `organ.recovered_at` is on or after a deceased donor's `death_date`, or that `death_date`
  is not in the future. These are domain decisions the project has not taken, not enforced
  rules; the demo data should not be read as clinically validated.
- **BR-1 as implemented.** A DECEASED donor requires `death_date`; `death_cause` is optional.
  A LIVING donor requires both `death_date` and `death_cause` to be NULL
  (`ck_donor_death_fields`).
- **The 24-month history in `db/03_seed_demo.sql` is simulated (OL-031, regenerated in OL-040).**
  It follows the matching and offer rules: candidates are eligible only until their own
  allocation, ranks are 1..N, offers go down the ranking one at a time, and timestamps follow
  the workflow order. It loads with triggers and foreign-key checks disabled (replica mode), so
  `db/history_checks.sql` re-checks every rule afterwards and aborts the load on any violation.
  It is demonstration data, not clinical data.
- **Audit rows written before OL-037 keep `row_id = 'composite'`** for `organ_offer` and
  `transplant_event`. The full row (including `offer_id` / `transplant_id`) is in
  `old_values` / `new_values`. Rows written afterwards carry the real id.

---

## Project layout

```
db/                  schema + reference/demo seeds, business-rule demo (10_rule_demo.sql)
db/upgrades/         in-place upgrade scripts for existing databases
db/history_checks.sql semantic checks run after the historical seed loads (OL-040)
docs/context/        authoritative specs (schema, TDD, PRD, user flow, design brief, …)
docs/implementation/ BACKLOG.md, API_CONTRACT.md, AUDIT_NOTES.md, per-task reports,
                     LESSONS_LEARNED.md, MANUAL_QA_CHECKLIST.md
scripts/             db-reset.sh, smoke-flow.sh, concurrency.mjs
server/              Express API (routes/, middleware/, db.js pool, errors.js)
src/                 React app: pages/, components/, api/ (client + modules + adapters),
                     data/ (mock fixtures), context/, utils/
tests/server/        API + DB test suite (needs a fresh `db:reset`)
tests/client/        frontend unit tests
```

Docs worth reading before changing anything: `docs/implementation/BACKLOG.md` (what is
approved), `docs/implementation/API_CONTRACT.md` (shapes and error codes),
`docs/implementation/AUDIT_NOTES.md` (decisions and assumptions).
