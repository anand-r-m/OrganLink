# OrganLink — Data Model

**Group A12** | 23CSE202 Database Management Systems

> Implementation reference. The formal normalization derivation lives in `03_db_design_document.md` §3.4; this document is the working description of what exists and why.

---

## Summary

**24 tables** in one PostgreSQL database, all in `public`. All relations in BCNF.

| Group | Tables |
|---|---|
| Reference | region, hospital, organ_type, blood_group, blood_compatibility, hla_allele, urgency, decline_reason, discard_reason, exclusion_reason |
| Users | role, app_user |
| People | donor, donor_hla, recipient, recipient_hla |
| Waitlist | waitlist_entry |
| Allocation | organ, match_run, match_result, organ_offer, transport_record, transplant_event |
| Audit | audit_log |

---

## 1. Key strategy

**Surrogate keys everywhere**: `BIGINT GENERATED ALWAYS AS IDENTITY`. Natural keys (`region_code`, `organ_type.name`, `hla_allele(locus, allele_name)`, `app_user.username`) are retained as UNIQUE constraints — they remain candidate keys in the formal analysis — but foreign keys point at the surrogate.

The reason: the FD analysis found second candidate keys throughout. If `region_code` were the FK target, a region renaming its code would cascade through hospitals, recipients and every historical record. Surrogates make identity immutable while natural keys stay enforceable.

**Exceptions** — four relations where the natural key *is* the primary key, because there is nothing to surrogate:

```
blood_compatibility(donor_bg_id, recipient_bg_id)
donor_hla(donor_id, allele_id)
recipient_hla(recipient_id, allele_id)
waitlist_entry(recipient_id, organ_type_id)
```

**Display identifiers** (`D-0042`, `R-0118`) are formatted in the application. The integer is the key; the string is presentation.

## 2. Lookup tables versus CHECK constraints

The rule: **a value that carries data or that a user may edit gets a table; a fixed internal state machine gets a CHECK.**

| Lookup table | Why not a CHECK |
|---|---|
| `urgency` | carries `score_value`, used directly by the scoring formula |
| `decline_reason`, `discard_reason` | a coordinator may legitimately need a new one |
| `exclusion_reason` | referenced by FK from `match_result` |
| `organ_type` | carries viability hours, response window, size tolerances |
| `blood_group`, `hla_allele`, `role` | referenced by FK |

| CHECK constraint | Why not a table |
|---|---|
| `organ.status` | AVAILABLE / ALLOCATED / TRANSPLANTED / EXPIRED / DISCARDED |
| `organ_offer.status` | CREATED / SENT / ACCEPTED / DECLINED / EXPIRED / VOIDED / CANCELLED |
| `transport_record.status` | PENDING / IN_TRANSIT / DELIVERED / FAILED |
| `transplant_event.outcome` | SUCCESS / FAILED / ORGAN_NOT_USED |
| `donor.donor_type` | LIVING / DECEASED |

State machine values are part of the code, not the data. Adding a new organ status means changing backend logic, so it is not a data-entry concern. Native Postgres `ENUM` types were rejected: adding a value requires `ALTER TYPE`, they cannot carry attributes, and nothing can foreign-key to them.

## 3. Derived attributes — deliberately absent

Three attributes that a naive design would store do not exist as columns:

| Absent column | Computed by | Reason |
|---|---|---|
| `organ.expires_at` | `v_organ` | `(recovered_at, organ_type_id) → expires_at` — non-superkey determinant, BCNF violation |
| `organ_offer.offer_expires_at` | `v_offer` | same shape |
| `waitlist_entry.priority_score` | `v_waitlist_scored` | depends on `now()`; stale the instant it is written |

Their absence is the central design decision of the schema and should be pointed out rather than left to be noticed.

Likewise **`OFFERED` is not an organ status.** Whether an organ currently has a live offer is derivable from the existence of a CREATED or SENT offer, which is already indexed. Storing it on the organ would put the same fact in two places and let them disagree.

## 4. Referential actions

Default **RESTRICT**. This is medical audit data; nothing should silently vanish.

| Pattern | Action | Examples |
|---|---|---|
| Child is a *component* of the parent | CASCADE | `waitlist_entry.recipient_id`, `donor_hla.donor_id`, `recipient_hla.recipient_id`, `match_result.run_id` |
| Child is a *historical event* | RESTRICT | `organ.donor_id`, `organ_offer.organ_id`, `transplant_event.offer_id` |
| Reference data in use | RESTRICT | all `*_reason_id`, `blood_group_id`, `organ_type_id` |
| Actor may be removed, record must survive | SET NULL | `audit_log.user_id`, `match_run.run_by`, `organ_offer.created_by` |

In practice **deletion is rare**: hospitals are suspended, donors and recipients go inactive, waitlist entries are removed by status. RESTRICT should almost never fire.

## 5. Data types

| Kind | Type | Note |
|---|---|---|
| Timestamps | `TIMESTAMPTZ` | never bare `TIMESTAMP` |
| Scores, weights | `NUMERIC(5,2)` | not float — exact comparison matters when ranking |
| Coordinates | `NUMERIC(9,6)` | |
| Height, weight | `NUMERIC(5,2)` | |
| Distances | `NUMERIC(8,2)` | |
| Text | `TEXT` | no `VARCHAR(n)`; arbitrary limits cause bugs and Postgres gains nothing |
| Audit payloads | `JSONB` | the one 1NF exception, confined to the log |

## 6. Indexes

Ten declared. Three of them are business rules, not optimisations.

```sql
-- Rules
CREATE UNIQUE INDEX ux_offer_active     ON organ_offer(organ_id)
    WHERE status IN ('CREATED','SENT');
CREATE UNIQUE INDEX ux_offer_no_reoffer ON organ_offer(organ_id, recipient_id)
    WHERE status NOT IN ('VOIDED','CANCELLED');
CREATE UNIQUE INDEX ux_match_rank       ON match_result(run_id, rank)
    WHERE qualified;

-- FK join paths (Postgres does not create these automatically)
ix_waitlist_recipient, ix_waitlist_organ_type, ix_organ_donor,
ix_offer_organ, ix_offer_recipient, ix_match_result_run, ix_audit_table_row

-- Hot paths
ix_organ_available  ON organ(status)       WHERE status = 'AVAILABLE'
ix_offer_open       ON organ_offer(status) WHERE status IN ('CREATED','SENT')
```

Postgres indexes the primary key being *referenced*, not the column doing the referencing, so FK columns need explicit indexes.

**Two honest notes.** First, at seed-data volumes Postgres will often sequential-scan anyway, because reading a small table end to end beats bouncing through an index. These are correct design that pays off at scale this project will not reach; claiming measured speedups would be false. A defensible demonstration is to seed one table with 100k rows and compare `EXPLAIN ANALYZE` with and without.

Second, no index exists on `organ(recovered_at)` for the expiry sweep, despite the temptation. The sweep predicate is `recovered_at + (max_viability_hours × interval)`, which varies by organ type and cannot use a plain index on `recovered_at`. An index that the planner cannot use is decoration.

## 7. Scoring

**Two distinct quantities. They must never be conflated.**

### Priority score — organ-independent

```
priority_score = (urgency_score × urgency_weight + wait_score × wait_weight)
                 / (urgency_weight + wait_weight)
```

In `v_waitlist_scored`. Shown on the Recipients page. Uses urgency and waiting time only, because HLA mismatch and distance are undefined until a specific donor organ is named.

### Match score — organ-specific

```
hla_score      = (8 − weighted_mismatches) / 8 × 100      [DRB1 counts double]
urgency_score  = urgency.score_value                       [1A=100, 1B=60, 2=25]
distance_score = 100 × exp(−km / 500)
wait_score     = min(100, 100 × ln(1 + months) / ln(61))

match_score = Σ(component × weight) / Σ(weights)
```

Stored per run in `match_result`. Dividing by the weight sum bounds the result to 0–100 regardless of slider positions.

**Why these curves.** Urgency tiers are non-linear because the escalation from 1B to 1A is far larger than from 2 to 1B. Distance decays exponentially because cold ischemia risk does not scale linearly — 50 km versus 200 km matters far more than 900 versus 1000. Waiting time is logarithmic and saturates at five years, rewarding long waits without letting them override a dying patient.

### Hard exclusions

Scoring does not apply to these. A candidate either passes or is excluded with a reason.

| Code | Condition |
|---|---|
| `ABO_INCOMPATIBLE` | blood compatibility matrix says no |
| `RECIPIENT_INACTIVE` | recipient or waitlist entry not ACTIVE |
| `SIZE_MISMATCH` | donor/recipient weight ratio outside the organ type's range |
| `ALREADY_OFFERED` | a non-voided offer for this organ already exists for this recipient |
| `VIABILITY_UNREACHABLE` | estimated travel time exceeds remaining viability |

## 8. Reference data volumes

| Table | Rows | Note |
|---|---|---|
| `region` | 4 | each with its own four policy weights |
| `blood_group` | 8 | ABO × Rh |
| `blood_compatibility` | 64 | all pairs stored; 27 compatible — the Settings matrix renders an 8×8 grid |
| `organ_type` | 5 | heart, lung, liver, kidney, pancreas |
| `urgency` | 3 | 1A, 1B, 2 |
| `hla_allele` | 18 | 6 per locus across A, B, DRB1 |
| `decline_reason` | 6 | |
| `discard_reason` | 6 | |
| `exclusion_reason` | 5 | codes must match the matching function's CASE expression |
| `role` | 5 | modelled; only ADMIN used |

## 9. Seed data requirements

Demonstration data needs **historical depth**, and this is a real task rather than an afterthought. Waiting-time distribution, allocation trends and fairness metrics all need months of history behind them. Seeding everything with today's date leaves three of the five report charts empty or flat.

Listings should be spread over 18–24 months and completed transplants across the same range.

## 10. Verification

The schema was executed against PostgreSQL 16. Every business rule was tested by attempting to violate it; all guards held. Two defects were found and corrected during verification:

1. **Numeric type errors in `v_waitlist_scored`.** `ln(61)` resolved to double precision, so the two-argument form of `ROUND` did not exist for the expression. Fixed by casting to `NUMERIC`.

2. **`ck_offer_sent` was wrong.** It required `sent_at` to be non-null for every status except CREATED, which meant the sweep could not cancel an abandoned unsent offer — the CANCELLED row would have a NULL `sent_at` and fail the constraint. CANCELLED and VOIDED can both occur before sending, so the constraint now permits those three statuses without `sent_at`.

Both were caught by running the schema rather than by reading it.
