# OL-003 Report: Transaction helper and error translation

## Files changed
- `server/db.js`: added `withTx(userId, fn, { sweep })`.
- `server/errors.js` (new): `ApiError`, `translatePgError(e)`, `errorHandler` middleware.
- `server/index.js`: mounts `errorHandler` after the routes.
- `tests/server/tx-errors.test.js` (new): DB and API tests.
- `docs/implementation/LESSONS_LEARNED.md` (new), this report.

No change to `API_CONTRACT.md`, `BACKLOG.md`, or the specs.

## Behavior implemented
- `withTx`: optional `SELECT expire_stale_offers()` on the pool before the transaction; `BEGIN`; `SELECT set_config('app.user_id', $1::text, true)` (A1); `fn(client)`; `COMMIT`, or `ROLLBACK` on error (a failed rollback is logged and does not mask the original error); the client is always released.
- `translatePgError` implements the API_CONTRACT error table: 22P02/23502 -> 400 `VALIDATION_ERROR`; 23503 -> 400 `REFERENCE_NOT_FOUND` (or 409 `REFERENCE_IN_USE` when the message says "is still referenced", i.e. DELETE); 23514 -> 400 `CONSTRAINT_VIOLATION` with the per-constraint message table; 23505 -> `ACTIVE_OFFER_EXISTS` / `RECIPIENT_ALREADY_DECLINED` / `TRANSPLANT_ALREADY_RECORDED` / `DUPLICATE`; 40001/40P01 -> 409 `CONFLICT_RETRY`; P0001 -> 422 `RULE_VIOLATION` (message verbatim); anything else -> 500 `INTERNAL` ("Unexpected server error"). `ApiError` instances pass through untouched, so later route code can throw 404 / `INVALID_STATE_TRANSITION` directly.
- `errorHandler` emits `{error:{code,message,details}}`; the stack for 500s goes to the server log only. Malformed JSON bodies become 400 `VALIDATION_ERROR` (small addition so `express.json()` failures use the envelope).
- No test route ships in `server/index.js`. The `/api/__test/*` routes live in the test file's own Express app, so there is nothing to delete.

## Tests and validations
Environment: throwaway PostgreSQL 18.6 on `localhost:5433` (nothing on 5432), `DATABASE_URL=postgresql://postgres@localhost:5433/organlink`, loaded with `npm run db:reset -- --yes` (dedicated local DB). `.env` was not changed.

`npm run test:server`: 17 tests, 17 pass, 0 fail (run twice; fixtures are cleaned up, row counts return to 0).
- 409 `ACTIVE_OFFER_EXISTS` on a second CREATED offer: full envelope asserted.
- 422 `RULE_VIOLATION` for an ABO-incompatible offer: message equals `Blood group incompatible for offer on organ <id>` exactly.
- `SELECT user_id FROM audit_log ORDER BY audit_id DESC LIMIT 1` = 1 after a write through `withTx(1, …)`.
- 500 `INTERNAL` for an unknown error; the response body contains no stack or message text.
- Rollback after a failed transaction, `app.user_id` not leaking between transactions, client release on error, the `sweep` flag (the sweep runs exactly once across a swept and an unswept call), 22P02 -> 400, bad JSON -> 400, and a table-driven check of every `translatePgError` mapping.
- `npx oxlint server tests`: no warnings. The real server starts, `/api/health` returns 200, and a malformed JSON body returns 400.

## Failures encountered
- The throwaway Postgres failed to start (missing locale). Fixed with `LC_ALL`; see `LESSONS_LEARNED.md`. No test failures.

## Remaining risks / follow-ups
- Constraint-specific `details` beyond `constraint` (e.g. `details.fields` for 23502) rely on pg's `column`, which is set for NOT NULL violations only.
- `REFERENCE_IN_USE` is Proposed in the contract and is detected by pg's message text ("is still referenced"); this assumes an English-locale server.
- `CONFLICT_RETRY` is mapped but not exercised against a real deadlock (OL-030 concurrency test).
- The 404 handler for unknown `/api/*` routes is not part of this task.

## Acceptance criteria
- Second CREATED offer on the same organ returns 409 `ACTIVE_OFFER_EXISTS`: **satisfied**
- ABO-incompatible offer returns 422 `RULE_VIOLATION` with the trigger message verbatim: **satisfied**
- Newest `audit_log` row has `user_id = 1` after a write through `withTx(1, …)`: **satisfied**
- Unknown errors return 500 `INTERNAL` with no stack trace in the response: **satisfied**
