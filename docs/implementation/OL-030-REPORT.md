# OL-030 — Concurrency proof (no double allocation) — Report

## Summary

`scripts/concurrency.mjs` fires 10 parallel `POST /api/offers` for one organ to 10 distinct eligible recipients, then 2 parallel accepts on the single `SENT` offer. Result: **1 success, 9 conflicts, 1 accept, 1 transport row**. A14 was observed and measured.

## Files changed

| File | Change |
|---|---|
| `scripts/concurrency.mjs` | new — standalone concurrency harness (ESM, `node scripts/concurrency.mjs`) |
| `tests/server/concurrency.test.js` | new — `node:test` regression test for the same invariants |
| `package.json` | added `"concurrency": "node scripts/concurrency.mjs"` |
| `docs/implementation/LESSONS_LEARNED.md` | appended the OL-030 section |
| `docs/implementation/OL-030-REPORT.md` | new — this report |

Untouched: `API_CONTRACT.md`, `BACKLOG.md`, `docs/context/`, `server/`, `db/`, all frontend files.

## How the proof works

**Fixtures.** OL-030 needs 10 distinct *eligible* recipients. The seed tops out at **8** for any donor/organ-type pair, so the harness reuses the eligible seeded recipients and creates only the shortfall (2 here) via `POST /api/recipients`. Organ type is Kidney — widest ratio band (0.50–3.00), 30 h viability, 6 h response window, so the sweep cannot expire fixtures mid-run. Recipients get the donor's own blood group (all 8 self-pairs are compatible) and the donor's weight (ratio exactly 1.0).

**Phase A — 10 parallel creates.** Each request locks the organ `FOR UPDATE`, then inserts. The 9 losers queue behind the winner, and `ux_offer_active` turns each of them into `409 ACTIVE_OFFER_EXISTS`.

**Phase B — 2 parallel accepts.** `fn_offer_accepted` allocates the organ and inserts one `transport_record`, so the loser matches no `SENT` row and gets `409 INVALID_STATE_TRANSITION`.

The script auto-starts `server/index.js` when nothing answers `BASE_URL` (default `http://localhost:3001`), and deletes its fixtures in FK-safe order on exit unless `--keep` / `KEEP_FIXTURES=1` is passed.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Exactly 1 of 10 creates returns 201, rest 409 `ACTIVE_OFFER_EXISTS` | **PASS** | `PASS phase-a-result (1 success, 9 conflicts)`; the 9 conflicts each asserted on `error.code`, not just the status |
| Exactly 1 accept succeeds, the other returns 409 | **PASS** | `PASS phase-b-accepts` — 1×200 `ACCEPTED`, 1×409 |
| Exactly one `transport_record` row exists for the organ | **PASS** | `PASS phase-b-db-single-transport` (`count(*) = 1`), organ `ALLOCATED` |
| DB test: `count(*) FROM organ_offer WHERE organ_id = X AND status IN ('CREATED','SENT','ACCEPTED')` = 1 | **PASS** | `PASS phase-a-db-single-offer` |
| Note the sweep's lack of `SKIP LOCKED` (A14) | **PASS** | measured and printed, see below |
| UI checks: n/a | **n/a** | no frontend change |

## A14 — sweep contention, observed

`withTx(..., { sweep: true })` runs `SELECT expire_stale_offers()` on the pool **before** the transaction opens, and that function has no `SKIP LOCKED`, so each parallel request sweeps in its own connection first.

```
A14 sweep contention (expire_stale_offers has no SKIP LOCKED):
  creates x10: wall 201ms, per-request min 26ms / median 176ms / max 200ms
  accepts x2: wall 27ms, per-request min 26ms / median 27ms / max 27ms
A14 observed: losers queued behind FOR UPDATE / the sweeping UPDATEs. No deadlock, no timeout.
```

The ~8× spread between fastest and slowest create is the lock queue behaving as designed. Correctness is unaffected: one 201, nine 409, one transport row, no deadlock, no timeout. Note that `05 §4.3` claims the sweep uses `SKIP LOCKED`; it does not. Per A14 this is accepted at demo scale — no change was made to `server/db.js` or the sweep.

## Tests run

| Command | Result |
|---|---|
| `bash scripts/db-reset.sh --yes` | `db:reset complete` (fresh DB before every run) |
| `node scripts/concurrency.mjs` | all `PASS`, exit 0 |
| `node --test tests/server/concurrency.test.js` | 3 pass, 0 fail |
| `node --test --test-concurrency=1 tests/server/*.test.js` | **169 pass, 0 fail** |
| `node --test tests/client/*.test.js` | 151 pass, 0 fail |
| `oxlint scripts/concurrency.mjs tests/server/concurrency.test.js` | clean |
| `vite build` | built in 1m 17s (only the pre-existing >500 kB chunk-size advisory) |

The new test also leaves no residue: `recipient`/`organ`/`organ_offer`/`transport_record` rows matching the fixtures return 0 after both the script and the test run.

## Failures hit and fixed

1. **`task()` unavailable** — `Model not found: openai/gpt-6-luna` on both attempts. Not a prompt problem; implemented directly instead of retrying further. Logged.
2. **`login.res` undefined** — the first draft read `login.res.headers`, but `call()` returns `{ status, body }`. Added `headers` to the return value and read the cookie from it.
3. **Stray `bun.lock`** — `bun install` wrote it while the repo tracks `package-lock.json`. Removed, so the diff is only the four intended files.

## Risks and limits

- **Sweep serialization** (A14) is real and will grow with table size and write concurrency. The sweep runs six `UPDATE`s without `SKIP LOCKED`, so concurrent writers contend on the same rows. At demo scale it costs ~200 ms for 10 requests. If this becomes a production concern the fix is `SKIP LOCKED` plus narrowing the sweep to affected rows — deliberately out of scope for OL-030.
- **Fixture strategy assumes the seed.** The harness needs an ACTIVE `O-` donor, the Kidney organ type, at least one urgency, and the `blood_compatibility` self-pair. It picks the donor rather than hardcoding an id, but a future seed without an `O-` donor would fail with a clear message.
- **Cleanup is best-effort.** A failed cleanup warns and does not mask assertion results. `KEEP_FIXTURES=1` exists for inspecting state after a failure.
- **Not covered:** more than 2 accepts, more than 2 distinct organ types racing, or deadlock detection beyond "no timeout within this run".

## Manual interactive checks

No browser was opened. OL-030 touches no frontend file, so there is nothing user-visible to click through. The human-facing surface is the script's own terminal output:

| Check | Status |
|---|---|
| `node scripts/concurrency.mjs` prints `1 success, 9 conflicts` (backlog demo step) | verified — `PASS phase-a-result (1 success, 9 conflicts)` |
| `CONCURRENCY OK` summary line with donor, organ type and totals | verified |
| `PASS <step>` per step, exit 1 on first mismatch | verified — code path present; the failure branch was exercised during development by the two bugs fixed above |
| A14 contention line with min/median/max and an observed/not-observed verdict | verified — observed branch printed |
| Auto-start of `server/index.js` when `BASE_URL` is down | verified — ran with nothing listening on the port |
| Fixture cleanup leaves the DB as found | verified — 0 residual rows for recipient, organ, organ_offer, transport_record |
| Frontend UI unchanged | verified — no file under `src/` modified; `vite build` passes |