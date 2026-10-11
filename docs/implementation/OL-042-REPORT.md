# OL-042 — Organs: discard an ALLOCATED organ whose viability elapsed before departure — Report

Status: **complete** (uncommitted). Server tests ran on a disposable cluster (127.0.0.1:5434,
database `organlink_ol042`, fresh schema and seeds). The live QA database was not reset, migrated
or written to: only read-only queries were made against it. No schema, sweep, trigger or seed change.

## 1. Defect

`expire_stale_offers()` step 3 expires only `AVAILABLE` organs (OL-DEC-02). An `ALLOCATED` organ
whose viability window elapses before its transport departs stays `ALLOCATED`, and its transport
stays `PENDING`. The Organs page offered no action for it, and `POST /api/transport/:id/depart`
still accepted it. Live example: organ 31 (Liver), transport 23.

Classification: a missing API rule and UI action. The schema already allows the transition
(`trg_organ_status_transitions` permits `ALLOCATED → DISCARDED`; `transport_record` has `FAILED`;
`VIABILITY_ELAPSED` is a seeded discard reason).

## 2. Rule (contract changes approved by the user)

- `POST /api/organs/:id/discard` also accepts `ALLOCATED` when `v_organ.is_expired` is true and
  the transport is `PENDING`. In the same transaction it sets the transport `PENDING → FAILED`, as
  sweep step 6 does for `EXPIRED` organs. Nothing is deleted; the accepted offer stays `ACCEPTED`;
  `departed_at`/`arrived_at` stay NULL. Request and response shapes are unchanged.
- Any other `ALLOCATED` case (still viable, or transport `IN_TRANSIT`/`DELIVERED`) is
  409 `INVALID_STATE_TRANSITION` with the updated message.
- `POST /api/transport/:id/depart` on a `PENDING` transport whose organ has expired is
  409 `INVALID_STATE_TRANSITION`: "Organ N viability window has elapsed; it cannot be dispatched".
- Organ shape: nullable `transportStatus`.
- Unchanged: an organ already `IN_TRANSIT` when its viability elapses can still be delivered
  (OL-DEC-02). Transplant recording still requires `DELIVERED`, so a failed transport blocks it.

## 3. UI

Organs page, existing Discard button and FormModal:
- expired `ALLOCATED` + `PENDING` transport → Discard enabled, `VIABILITY_ELAPSED` pre-selected;
- expired `ALLOCATED` + `IN_TRANSIT` → Discard shown disabled, with a tooltip ("Already in
  transit; it can still be delivered, so it cannot be discarded"), same Tooltip/disabled pattern
  as the active-offer case;
- viable `ALLOCATED` → no Discard (as before).

After the discard, the transport is `FAILED` and, with OL-041, no longer listed on the Transport page.

## 4. Files

- `server/routes/organs.js`: discard rule and transport fail.
- `server/routes/transport.js`: optional per-action guard; depart viability check.
- `server/util/organSql.js`: `transport_status` column.
- `src/api/adapters/organs.js`: `transportStatus`, `canDiscard`, `showsDiscard`, `discardBlockedTooltip`, default reason.
- `src/api/organs.js`: mock error message aligned with the server.
- `src/pages/OrgansPage.jsx`: Actions cell uses the new helpers.
- `docs/implementation/API_CONTRACT.md`, `docs/implementation/BACKLOG.md` (OL-041, OL-042).
- Tests: `tests/server/organs-discard-allocated.test.js` (new), `tests/server/organs-read.test.js`
  (shape list gains `transportStatus`), `tests/client/organs-discard.test.js` (new cases; wiring
  assertions renamed to the new helpers).

## 5. Tests (disposable DB for server tests)

| Command | Result |
|---|---|
| `organs-discard-allocated.test.js` (new) | 4/4 pass, exit 0 |
| `organs-discard`, `transport`, `organs-read`, `donors-read`, `donors-procure`, `transplants`, `offers`, `dashboard` | 8+6+9+8+9+8+6+7 pass, 0 fail, exit 0 |
| `npm run test:client` | 174/174 pass, exit 0 |
| `tests/docs` | 10/10 pass |

Not run: the full `test:server`, `smoke`, `concurrency`, `db:rules` or any reset against the live QA DB.

## 6. Limitations

- The sweep still does not expire `ALLOCATED` organs; discarding one is a manual action.
- An organ that expires while `IN_TRANSIT` can still be delivered and transplanted (OL-DEC-02).
- The recipient's waitlist entry is not changed by the discard; no re-listing or notification.
