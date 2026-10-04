# OL-002 Report: Express server skeleton and DB pool

## Files changed
- `server/index.js`: Express 4 app, `GET /api/health` (`SELECT 1`; 200 `{status,db}` / 503 `DB_UNAVAILABLE` envelope). Listens on `PORT` (default 3001) only when run directly, so tests can import `app`.
- `server/db.js`: `pg` Pool from `DATABASE_URL` (loaded via `dotenv`), INT8 (20) and NUMERIC (1700) parsers returning JS numbers (A12), idle-client error handler, `query()` helper returning camelCased rows.
- `server/util/case.js`: `toCamel(row)`, `toCamelRows`, `toCamelKey` (top-level keys only).
- `vite.config.js`: `server.proxy['/api'] -> http://localhost:3001`.
- `package.json` / `package-lock.json`: `dev` now runs Vite + Express via `concurrently` (`dev:web`, `dev:server` = `node --watch server/index.js`); `test:server` script; deps `express@4`, `pg`, `dotenv`; devDep `concurrently`.
- `tests/server/case.test.js`, `tests/server/health.test.js`: `node:test` tests.

No change to `API_CONTRACT.md` or any shared contract. The health shape follows API_CONTRACT #4 / BACKLOG (`{"status":"ok","db":"ok"}`), which is a superset of the `{status:"ok"}` example in the task prompt.

## Behavior implemented
- `npm run dev` starts both processes; `/api/*` on :5173 is proxied to :3001.
- `/api/health` returns 200 `{"status":"ok","db":"ok"}` when Postgres is reachable, 503 standard error envelope otherwise.
- Pool returns `bigint`/`numeric` as numbers.

## Tests run and results
Postgres: throwaway PostgreSQL 18.6 cluster on `localhost:5433` (no 5432 server was running); `DATABASE_URL=postgresql://postgres@localhost:5433/organlink`, DB loaded with `npm run db:reset -- --yes`.

    npm run test:server
      ✔ toCamelKey converts snake_case
      ✔ toCamel maps top-level keys and keeps values
      ✔ toCamel passes through null
      ✔ pool returns INT8 and NUMERIC as JS numbers      (SELECT 1::bigint, 1.50::numeric -> 1, 1.5)
      ✔ GET /api/health returns 200 {status, db} when DB is up
      ✔ GET /api/health returns 503 error envelope when DB is down   (pool.query stubbed to throw)
      tests 6, pass 6, fail 0

Manual, with `npm run dev` running:

    curl -i localhost:3001/api/health      -> 200 {"status":"ok","db":"ok"}
    curl -i localhost:5173/api/health      -> 200 {"status":"ok","db":"ok"}   (through Vite proxy)
    curl -o /dev/null -w "%{http_code}" localhost:5173/dashboard   -> 200 (SPA served)
    (Postgres stopped)
    curl -i localhost:5173/api/health      -> 503 {"error":{"code":"DB_UNAVAILABLE","message":"Database unreachable","details":{}}}

Browser test: with `npm run dev` running, open `http://localhost:5173/api/health`.
Not done: a visual check that the app renders in mock mode in a browser (only confirmed that :5173/dashboard returns 200). `npm run lint` shows only pre-existing warnings.

## Risks / blockers / follow-ups
- `DATABASE_URL` unset: the pool falls back to libpq defaults (`PG*` env / local socket), and `/api/health` then returns 503 if that fails. Copy `.env.example` to `.env`.
- A local Postgres can fail to start with "postmaster became multithreaded" when `LC_ALL` is not a valid locale (local env issue only, unrelated to the code).
- `server/index.js` has no error middleware, session, or auth yet; those are OL-003/OL-004.
- `npm install` reported audit advisories (not investigated).

## Acceptance criteria
- `npm run dev` starts both Vite and the server without errors: satisfied.
- `curl localhost:5173/api/health` returns `{"status":"ok","db":"ok"}`: satisfied.
- Postgres stopped -> 503 with standard error envelope: satisfied.
- `SELECT 1::bigint, 1.50::numeric` returns JS numbers: satisfied.
- Existing app still loads in mock mode on :5173: partially verified (HTTP 200 only; no browser check).
