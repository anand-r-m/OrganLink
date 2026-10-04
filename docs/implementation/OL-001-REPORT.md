# OL-001 Report: Database bootstrap and reset script

## What was added
- `db/01_schema.sql`: byte-identical copy of `docs/context/01_schema.sql`.
- `db/02_seed_reference.sql`: copy of `docs/context/02_seed_reference.sql`; only the admin bcrypt hash differs (AUDIT_NOTES A8).
- `scripts/db-reset.sh` + `npm run db:reset`: drops/recreates `organlink`, then loads `db/01_schema.sql`, `db/02_seed_reference.sql` and `db/03_seed_demo.sql` (if present) with `ON_ERROR_STOP=1`.
- `.env.example` (`DATABASE_URL`), `bcryptjs` devDependency (hash check).

`DATABASE_URL` (env, or `.env` in the repo root) is used when set; the maintenance connection is the same URL with database `postgres`. When unset, the local socket and default user are used.

## Admin hash (A8)
The hash in the spec seed (`$2b$10$N9qo8uLOick...hy`) does NOT match `admin`:

    node -e "const b=require('bcryptjs');console.log(b.compareSync('admin','$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'))"
    -> false

Regenerated with `bcryptjs.hashSync('admin',10)` and replaced in `db/02_seed_reference.sql` only:
`$2b$10$NMptt9TIflZAmJHIiv0ObOpfP9kHnzqg55nci/G6lXH8OubGHmz9W` (`compareSync` -> `true`).
**Follow-up:** add this note to AUDIT_NOTES A8 (not done here; out of scope for this task's edits).

## Commands run and results
Run against a throwaway PostgreSQL 18.6 cluster on `localhost:5433`
(`DATABASE_URL=postgresql://postgres@localhost:5433/organlink`).

    npm run db:reset                      -> exit 0, ~0.9 s wall time
    tables (BASE TABLE, public)           -> 24
    views (public)                        -> 8
    SELECT count(*) FROM blood_compatibility WHERE compatible  -> 27
    psql "$DATABASE_URL" -f docs/context/09_verification_tests.sql
        -> PASS for sections 3, 4, 5, 7, 10; `grep -c FAIL` = 0
    npm run db:reset (again)              -> exit 0; 24 tables, 8 views, clean DB

## Known issue in 09_verification_tests.sql (spec file, untouched)
Section 11 (sweep) errors: `Recipient 5 has no active waitlist entry for this organ type`
(line 134). The test offers a type-3 organ to R5, who is only waitlisted for type 1, so the
trigger correctly rejects it; sections 11-13 then fail with "transaction is aborted"
(and a psql `:off3` syntax error). This is a test-script defect, not a schema defect, and
no `FAIL` line is printed. Sections 1, 2, 6, 8, 9 print results but have no PASS/FAIL line.

## How to verify
    export DATABASE_URL=postgresql://localhost:5432/organlink   # optional
    npm run db:reset
    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"   # 24
    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='VIEW'"         # 8
    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM blood_compatibility WHERE compatible"   # 27
    psql "$DATABASE_URL" -f docs/context/09_verification_tests.sql | grep -E "PASS|FAIL"
    npm run db:reset    # test rows are COMMITted, so always reset afterwards (A13)
    node -e "const b=require('bcryptjs');console.log(b.compareSync('admin','<hash in db/02_seed_reference.sql>'))"   # true
