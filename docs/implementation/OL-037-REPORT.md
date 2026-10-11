# OL-037 — Audit log: correct `row_id` for organ_offer and transplant_event — Report

Status: **complete** (database level). Nothing committed or pushed. The live QA database was
not touched and no existing audit row was modified.

## 1. Defect

`fn_audit()` took the row id from the column `<table_name>_id`. `organ_offer` has `offer_id` and
`transplant_event` has `transplant_id`, so their audit rows stored `row_id = 'composite'`. The
full row was always in `old_values` / `new_values`, so history was complete, but `row_id` and
`ix_audit_table_row` were useless for those two tables. `waitlist_entry` legitimately uses
`'composite'` (composite key).

## 2. Fix (`db/01_schema.sql` only)

`fn_audit()` reads the key column from an optional trigger argument
(`COALESCE(TG_ARGV[0], TG_TABLE_NAME || '_id')`). `trg_audit_offer` passes `'offer_id'` and
`trg_audit_transplant` passes `'transplant_id'`. The other four audit triggers are unchanged, so
`donor`, `recipient` and `organ` keep their ids and `waitlist_entry` keeps `'composite'`.

## 3. Evidence (disposable cluster, port 5433)

- Test against the unfixed schema: `actual: ['composite'], expected: ['31']`.
- After the fix, `tests/server/audit-row-id.test.js` (rolled-back transaction) passes. It checks
  `row_id` for donor, recipient, organ, organ_offer (all 3 rows of one offer's history),
  transplant_event, that waitlist_entry stays `'composite'`, and that no other table falls back
  to `'composite'` for new rows.
- Upgrade test: on a database built from the previous schema with one committed pre-upgrade
  offer, the checksum of all 57 `audit_log` rows and the row counts were identical before and
  after the upgrade. The first post-upgrade offer update was audited as `row_id = '31'`; the
  earlier insert keeps `'composite'`.

## 4. Install paths

- **Fresh install:** `npm run db:reset`.
- **Existing install:** `db/upgrades/OL-036_OL-037.sql`. It replaces the function and two
  triggers only. Existing audit rows are **not** backfilled; to find old offer or transplant
  history use `new_values ->> 'offer_id'` / `new_values ->> 'transplant_id'`.

## 5. Limits

Rows written before the upgrade keep `'composite'`. This is intended (the live database is not
rewritten).
