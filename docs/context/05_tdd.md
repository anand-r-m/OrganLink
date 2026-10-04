# OrganLink — Technical Design Document

**Group A12** | 23CSE202 Database Management Systems
**Version 1.0**

---

## 1. Architecture

```
React 18 + Vite + Mantine        ← existing, unchanged
            │  JSON over HTTP
Node 20 + Express + node-postgres ← thin: HTTP, auth, orchestration
            │  parameterized SQL
PostgreSQL 16                     ← schema, constraints, triggers, functions, views
```

**One database.** A single Postgres database named `organlink`, all objects in `public`. No second engine — no Redis, no Mongo. Sessions are held in-process; at this scale that is sufficient and it removes an entire class of deployment problem.

## 2. Stack decisions

### 2.1 No ORM

Prisma, Sequelize and Hibernate all assume the application owns the schema and that a write does exactly what the application said. This design has triggers mutating rows behind the application's back, partial unique indexes, and CHECK constraints that none of these tools can represent. Prisma's migration engine would actively try to reconcile the schema back to what it can model.

The schema is therefore defined by `.sql` files under version control, and `node-postgres` sends parameterized queries directly.

### 2.2 Express over FastAPI or Spring Boot

One language across the stack, one `package.json`, one `npm install`. `pg` returns rows as plain objects that already match the shapes the frontend's mock data files use. Spring Boot would be the poorest fit, since JPA pulls toward ORM-managed schema — backwards for a database-first project.

### 2.3 Schema as files, not migrations

```
db/
  01_schema.sql           -- tables, constraints, indexes, triggers, views
  02_seed_reference.sql   -- lookup data the triggers depend on
  03_seed_demo.sql        -- demonstration data with historical depth
```

`npm run db:reset` drops the database, recreates it, and runs all three. Rebuild takes seconds. Each developer runs their own local Postgres; the database is a rebuildable artifact, not a shared resource. No migration framework, no drift.

## 3. Layer responsibilities

The governing principle: **each rule is enforced in exactly one place.**

| Layer | Owns | Examples |
|---|---|---|
| **Constraints & indexes** | Invariants true regardless of how data arrived | FKs, CHECKs, one-active-offer partial unique index |
| **Triggers** | Guards and same-transaction side effects that must not be bypassable | ABO compatibility, viability, accept cascade, audit |
| **Functions & views** | Computation and derived values | `match_candidates()`, `v_waitlist_scored`, report views |
| **Backend** | HTTP, sessions, orchestration, error translation | routing, transactions, SQLSTATE → HTTP |

**The application never re-checks a rule the database enforces.** It attempts the write, catches the error, and translates it. Checking in both places guarantees eventual drift, and the copy that drifts is always the JavaScript one.

## 4. Database objects

**24 tables**, **10 indexes** (3 enforcing rules, 7 serving joins and hot paths), **8 trigger functions**, **2 helper functions**, **1 matching function**, **1 sweep function**, **8 views**.

### 4.1 Triggers

| Trigger | Timing | Purpose |
|---|---|---|
| `trg_offer_compatibility` | BEFORE INSERT offer | ABO, active waitlist entry, size ratio |
| `trg_offer_viability` | BEFORE INSERT offer | Organ available and not expired |
| `trg_accept_recheck` | BEFORE UPDATE offer→ACCEPTED | Re-verify viability and recipient inside the transaction |
| `trg_offer_accepted` | AFTER UPDATE offer→ACCEPTED | Organ → ALLOCATED, create transport |
| `trg_transplant_requires_delivery` | BEFORE INSERT transplant | Transport must show DELIVERED |
| `trg_transplant_recorded` | AFTER INSERT transplant | Organ → TRANSPLANTED/DISCARDED, close the *matching* waitlist entry |
| `trg_organ_status_transitions` | BEFORE UPDATE organ | Reject illegal state moves |
| `fn_audit` | AFTER I/U/D on 6 tables | Generic audit via `TG_TABLE_NAME` and `to_jsonb` |

### 4.2 User attribution

Triggers run inside Postgres and cannot see who is logged into Express. Without a mechanism, every `audit_log.user_id` would be NULL and the audit trail would be decorative.

Every transaction therefore begins:

```sql
SET LOCAL app.user_id = $1;
```

and triggers read it through `current_app_user()`, which wraps `current_setting('app.user_id', true)`. `SET LOCAL` scopes the value to the transaction, so a pooled connection cannot leak one user's identity into another's work.

### 4.3 The sweep

Nothing in a database expires by itself. `expire_stale_offers()` performs six updates:

1. SENT offers past their response window → EXPIRED
2. CREATED offers older than one hour → CANCELLED *(without this, an abandoned unsent offer holds `ux_offer_active` on its organ permanently)*
3. AVAILABLE organs past viability → EXPIRED
4. Open offers on newly-expired organs → VOIDED
5. Open offers whose recipient went inactive → VOIDED
6. Transports carrying expired organs → FAILED

It is called **before** opening the transaction on any offer-, organ-, matching- or transport-related request. This keeps `status` a real, indexable column, which the partial unique indexes depend on — a computed status would dissolve the one-active-offer guarantee.

*Known trade-off:* this makes GET requests non-idempotent. At this scale it is acceptable; `SELECT … FOR UPDATE SKIP LOCKED` prevents concurrent sweeps from blocking each other.

### 4.4 Matching

`match_candidates(organ_id, hla_w, urgency_w, distance_w, wait_w)` inserts a `match_run`, evaluates every active waitlist entry for that organ type, inserts one `match_result` per candidate (qualified or excluded), and returns the run id. Weights default to the recovering hospital's regional policy.

Scoring, each component normalised to 0–100:

```
hla_score      = (8 − weighted_mismatches) / 8 × 100     [DRB1 mismatches count double]
urgency_score  = urgency.score_value                      [1A=100, 1B=60, 2=25]
distance_score = 100 × exp(−km / 500)
wait_score     = min(100, 100 × ln(1 + months) / ln(61))

match_score = Σ(component × weight) / Σ(weights)
```

Dividing by the weight sum keeps the total on 0–100 however the sliders are set; without it, all-max sliders would produce scores above 100 and break the progress indicator.

Ranking uses `RANK() OVER (ORDER BY match_score DESC, wait_score DESC)`.

**Two distinct scores exist and must never be conflated.** `priority_score` (in `v_waitlist_scored`) is organ-independent, using urgency and waiting time only, because HLA mismatch and distance are undefined until a donor organ is named. `match_score` (in `match_result`) is organ-specific and uses all four components.

### 4.5 Views

| View | Purpose |
|---|---|
| `v_organ` | Organ with computed `expires_at`, `hours_remaining`, `is_expired` |
| `v_offer` | Offer with computed `offer_expires_at` |
| `v_waitlist_scored` | Waitlist with computed `priority_score` |
| `v_waiting_time_distribution` | Bucketed via `width_bucket` |
| `v_organ_utilization` | Transplanted / expired / discarded by region and type |
| `v_decline_reasons` | With percentage via window function |
| `v_allocation_fairness` | Allocation rate, median wait (`PERCENTILE_CONT`), local retention |
| `v_compliance_summary` | Headline placement rate |

## 5. API surface

State changes are POSTs to named sub-paths rather than PATCHes to a status field. `POST /offers/:id/accept` is a business operation with triggers behind it; `PATCH {status:'ACCEPTED'}` would pretend it is a field edit and invite clients to invent illegal transitions.

```
POST   /api/auth/login | logout        GET /api/auth/me

GET    /api/donors              ?status= &type= &hospital=
POST   /api/donors
GET    /api/donors/:id                 → donor + HLA + organs
PATCH  /api/donors/:id
POST   /api/donors/:id/organs          → procure organ

GET    /api/recipients          ?organ= &bloodGroup= &urgency= &status=
POST   /api/recipients
GET    /api/recipients/:id
PATCH  /api/recipients/:id

GET    /api/waitlist                   → v_waitlist_scored
POST   /api/waitlist
PATCH  /api/waitlist/:recipientId/:organTypeId

GET    /api/organs              ?status= &available=true
GET    /api/organs/:id
POST   /api/organs/:id/discard         { discardReasonId }

POST   /api/matching/runs              { organId, weights }
GET    /api/matching/runs/:id
GET    /api/organs/:id/runs

GET    /api/offers              ?status=
POST   /api/offers                     { organId, recipientId, matchRunId }
POST   /api/offers/:id/send
POST   /api/offers/:id/accept
POST   /api/offers/:id/decline         { declineReasonId, notes }
POST   /api/offers/:id/cancel
POST   /api/offers/:id/advance         → next qualifying rank in the same run

POST   /api/transplants                { offerId, transplantAt, outcome }

GET    /api/transport
POST   /api/transport/:id/depart | deliver

GET    /api/reports/waiting-times | utilization | decline-reasons
                  | fairness | compliance | audit.pdf

GET/POST/PATCH  /api/hospitals | regions | organ-types
GET/PATCH       /api/blood-compatibility
GET/POST/DELETE /api/hla-alleles

GET    /api/dashboard
```

### 5.1 Advance-to-next

`POST /offers/:id/advance` must not simply read rank N+1. That candidate may have gone inactive, received another organ, or already declined since the run. The endpoint **walks down the ranks** until one passes the guards, and returns both the created offer and the list of ranks skipped with reasons.

### 5.2 Error mapping

| SQLSTATE | HTTP | Message |
|---|---|---|
| `23505` + `ux_offer_active` | 409 | This organ already has an active offer |
| `23505` + `ux_offer_no_reoffer` | 409 | This recipient has already declined this organ |
| `23503` | 400 | Referenced record does not exist |
| `23514` | 400 | Constraint-specific message |
| `P0001` | 422 | The trigger's message, verbatim |
| `40001` | 409 | Conflicting update, please retry |

## 6. Transactions and concurrency

Every state-changing endpoint follows the same shape:

```js
const client = await pool.connect();
try {
  await client.query('SELECT expire_stale_offers()');   // before the transaction
  await client.query('BEGIN');
  await client.query('SET LOCAL app.user_id = $1', [userId]);
  await client.query('SELECT 1 FROM organ WHERE organ_id = $1 FOR UPDATE', [organId]);
  // … the write
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw translate(e);
} finally {
  client.release();
}
```

**Double allocation is prevented twice over.** `SELECT … FOR UPDATE` on the organ row serialises concurrent allocation attempts, and `ux_offer_active` guarantees the invariant even if the lock were somehow bypassed. The index is the real guarantee; the lock turns a constraint violation into an orderly wait.

## 7. Frontend integration

The existing mock data files define the API contract — whatever shape `mockDonors` has is what `GET /api/donors` returns. Integration is close to mechanical.

The mock layer is **retained, not deleted**. An environment flag switches each data hook between mock and live:

```js
const useLive = import.meta.env.VITE_DATA_SOURCE === 'api';
```

This costs one conditional per hook and means a half-finished endpoint never blocks a page from being demonstrated.

## 8. UI changes required

The design review identified three gaps in the existing UI:

| Change | Page | Size |
|---|---|---|
| "Procure Organ" action + modal | Donor detail drawer | new modal |
| Organs tab (list, countdown, discard action) | Settings or new tab | new table |
| Split donor Type / Status badges | Donor registry + form | field split |
| "Record Accept" no longer records the transplant | Offers | behaviour change |
| "Record Transplant" action + modal with outcome | Offers | new modal |
| Mark In Transit / Mark Delivered | Transport | 2 actions |
| VOIDED and CANCELLED status badges | Offers | 2 badges |
| Run timestamp + "Re-run Match" | Matching console | label change |
| Fourth weight slider (waiting time) | Matching console | 1 slider |
| Region selector | Settings → Policy Weights | 1 dropdown |

## 9. Deployment

Local for development and demonstration. Postgres 16 installed natively on each machine; `npm run dev` runs Vite and Express. No shared server — a server on one developer's laptop makes that person a single point of failure and campus networks generally isolate clients anyway.

Submission comprises the repository, the three SQL files, and a `pg_dump` of a seeded database.

## 10. Verification performed

The schema was executed against PostgreSQL 16 and the following were confirmed by attempting to violate each rule:

| Test | Result |
|---|---|
| Schema and reference seed load cleanly | ✔ 24 tables, 8 views, 48 indexes |
| Blood compatibility matrix | ✔ 27 of 64 pairs compatible (correct for ABO+Rh) |
| Match run ranks correctly, components computed | ✔ |
| ABO-incompatible and size-mismatched candidates excluded with reasons | ✔ |
| ABO guard trigger rejects a direct offer insert | ✔ |
| Second active offer on same organ | ✔ blocked by `ux_offer_active` |
| Re-offer after decline | ✔ blocked by `ux_offer_no_reoffer` |
| Accept → organ ALLOCATED, transport created PENDING | ✔ |
| Transplant before delivery | ✔ blocked by trigger |
| Deliver → transplant → organ TRANSPLANTED, waitlist closed | ✔ |
| Multi-organ recipient: other waitlist entry stays ACTIVE | ✔ |
| Terminal state reversal | ✔ blocked by trigger |
| Sweep expires stale organ, cancels abandoned offer | ✔ |
| Recipient goes inactive → open offer VOIDED with reason | ✔ |
| Re-offer permitted after VOID (not a decline) | ✔ |
| Audit log populated with acting user | ✔ |

**Two defects were found and fixed during verification:**

1. Numeric type errors in `v_waitlist_scored` — `ln(61)` resolved to double precision, breaking two-argument `ROUND`. Fixed by casting to `NUMERIC`.
2. `ck_offer_sent` required `sent_at` for every status except CREATED, so the sweep could not cancel an unsent offer. The constraint was wrong; CANCELLED and VOIDED can both occur before sending. Corrected.
