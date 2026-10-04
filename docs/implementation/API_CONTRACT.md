# OrganLink — API Contract

This document is the single source of truth for every endpoint the frontend calls. Endpoints come from `docs/context/05_tdd.md` §5. Anything added beyond §5 is marked **Proposed — needs approval**.

> **✅ OL-DEC-01 APPROVED (2026-10-04): Option B.** Every shape below is schema-shaped camelCase JSON, with frontend adapters mapping it to the existing component props. See `AUDIT_NOTES.md` → OL-DEC-01.
>
> **✅ OL-DEC-02 RESOLVED (2026-10-04): accepted limitation.** The sweep only expires `AVAILABLE` organs, so an `ALLOCATED` organ in transit never expires, its transport is never auto-failed, and a transplant can still be recorded once the transport is `DELIVERED`. The schema is not changed. See `AUDIT_NOTES.md` → OL-DEC-02.

---

## Global conventions

**Base URL and auth**
- All endpoints live under `/api`. In development, Vite proxies `/api` to Express on `:3001`, so the browser sees one origin.
- Sessions use `express-session` with the in-memory store (05 §1). Cookie: `connect.sid`, `HttpOnly`, `SameSite=Lax`. The frontend sends `credentials: 'include'`.
- Every endpoint except `POST /api/auth/login` and `GET /api/health` needs a session. Without one, the response is `401 UNAUTHENTICATED`.
- Role-based access control is not enforced (04_prd.md §6). The single user has role `ADMIN`.

**IDs**
- All IDs are JSON integers, taken from the `BIGINT` identity columns.
- Display strings (`D-0042`, `R-0118`, `O-0007`, `OF-0012`, `T-0003`, `MR-0042`) are generated in the frontend only (08 §1; A11).
- The waitlist has a composite key, so it is addressed as `/:recipientId/:organTypeId`.

**Naming and enums**
- JSON keys are camelCase. The server converts from snake_case.
- Enum values are sent exactly as stored in the DB, in UPPER_SNAKE: `AVAILABLE`, `IN_TRANSIT`, `ORGAN_NOT_USED`, … The frontend formats labels.
- Reference codes (`ABO_INCOMPATIBLE`, `ORGAN_QUALITY`, …) are returned alongside the numeric FK, plus a description where one is useful.

**Numbers**
- `NUMERIC` columns (scores, weights, ratios, heights, weights in kg, distances, coordinates) are JSON numbers, never strings (A12).
- Scores and weights have at most 2 decimals. Coordinates have up to 6.

**Timestamps and dates**
- `TIMESTAMPTZ` values are ISO 8601 strings in UTC, e.g. `"2026-10-04T09:00:00.000Z"`. The frontend displays them in local time (IST).
- Inputs accept any ISO 8601 string with an offset, e.g. `"2026-10-04T14:30:00+05:30"`.
- `DATE` columns (`dateOfBirth`, `listedDate`) are `"YYYY-MM-DD"`.

**Collections**
- List endpoints return a plain JSON array. There is no pagination at this scale.
- Filters are query-string parameters. A filter that takes a natural key (`bloodGroup=A%2B`, `urgency=1A`) expects the code; all other filters take integer IDs.

**Sweep and transactions** (05 §4.3, §6)
- Each endpoint below lists **Sweep: yes/no**. "Yes" means `SELECT expire_stale_offers()` runs **before** the transaction or query, so the endpoint never returns stale statuses.
- Every write runs in one transaction that starts with `SELECT set_config('app.user_id', <sessionUserId>, true)` (A1). Writes that involve offers lock the organ row with `SELECT … FOR UPDATE`.
- The API never re-checks a rule the DB enforces (05 §3). It attempts the write and translates the error.

**State transitions** (A2)
- State changes are `POST` calls to named sub-paths, never PATCHes to `status` (05 §5).
- Each transition is a conditional `UPDATE … WHERE status = <required>`. If 0 rows change, the response is `409 INVALID_STATE_TRANSITION` with `details: {currentStatus, requiredStatus}`.

### Standard error envelope

```json
{
  "error": {
    "code": "ACTIVE_OFFER_EXISTS",
    "message": "This organ already has an active offer",
    "details": {}
  }
}
```

`details` is always an object. It may be empty.

### Error codes

| HTTP | `code` | Source | `message` |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body or query fails shape checks; also SQLSTATE `22P02` (bad input syntax) and `23502` (not null) | What is wrong; `details.fields` lists the offending fields |
| 400 | `REFERENCE_NOT_FOUND` | `23503` on INSERT/UPDATE | "Referenced record does not exist" (05 §5.2); `details.constraint` |
| 400 | `CONSTRAINT_VIOLATION` | `23514` | A constraint-specific message (table below); `details.constraint` |
| 401 | `UNAUTHENTICATED` | No or expired session | "Login required" |
| 401 | `INVALID_CREDENTIALS` | Login failed | "Username or password is incorrect" |
| 404 | `<RESOURCE>_NOT_FOUND` | Unknown ID: `DONOR_`, `RECIPIENT_`, `WAITLIST_ENTRY_`, `ORGAN_`, `MATCH_RUN_`, `OFFER_`, `TRANSPORT_`, `HOSPITAL_`, `REGION_`, `ORGAN_TYPE_`, `HLA_ALLELE_` | "<Resource> <id> not found" |
| 409 | `ACTIVE_OFFER_EXISTS` | `23505` on `ux_offer_active`; also discard with an open offer (A17) | "This organ already has an active offer" |
| 409 | `RECIPIENT_ALREADY_DECLINED` | `23505` on `ux_offer_no_reoffer` | "This recipient has already declined this organ" |
| 409 | `TRANSPLANT_ALREADY_RECORDED` | `23505` on `transplant_event_offer_id_key` | "A transplant is already recorded for this offer" |
| 409 | `DUPLICATE` | Any other `23505` | "A record with these values already exists"; `details.constraint` |
| 409 | `REFERENCE_IN_USE` | `23503` on DELETE — **Proposed** | "This record is referenced by other data and cannot be deleted" |
| 409 | `INVALID_STATE_TRANSITION` | Conditional update matched 0 rows (A2) | e.g. "Offer 12 is VOIDED; this action requires SENT" |
| 409 | `CONFLICT_RETRY` | `40001`, `40P01` | "Conflicting update, please retry" (05 §5.2) |
| 422 | `RULE_VIOLATION` | `P0001` raised by a trigger or function | **The trigger's message, verbatim** (05 §5.2) |
| 422 | `NO_ELIGIBLE_CANDIDATE` | Advance found no candidate that passes the guards (A4) | "No remaining ranked candidate could be offered"; `details.skipped` |
| 500 | `INTERNAL` | Anything else | "Unexpected server error". The stack trace is logged on the server and never returned |

**Messages for named CHECK constraints (`23514`):**

| Constraint | Message |
|---|---|
| `ck_donor_death_fields` | "Deceased donors need a death date; living donors must not have death details" |
| `ck_donor_death_after_birth` | "Death date must be after date of birth" |
| `ck_organ_not_future` | "Recovery time cannot be in the future" |
| `ck_organ_discard_reason` | "A discard reason is required to discard an organ" |
| `ck_waitlist_not_future` | "Listing date cannot be in the future" |
| `ck_region_weights_nonzero` | "At least one policy weight must be greater than zero" |
| `ck_organ_type_ratio_order` | "Maximum weight ratio must exceed the minimum" |
| `ck_transport_time_order` | "Arrival cannot precede departure" |
| any other | "Value violates constraint <name>" |

### Assumptions in this contract (from AUDIT_NOTES.md)

| ID | Assumption | Where it applies |
|---|---|---|
| A1 | `set_config('app.user_id', …, true)` replaces `SET LOCAL … = $1` | every write |
| A2 | Conditional-update transitions return 409 `INVALID_STATE_TRANSITION` | offers, transport |
| A3 | `hospitalId` is optional on transplants and defaults to the transport destination | `POST /api/transplants` |
| A4 | Advance is allowed only from DECLINED, EXPIRED, VOIDED, or CANCELLED with a `matchRunId`; it uses SAVEPOINT walking and returns 422 when exhausted | `POST /api/offers/:id/advance` |
| A5 | `GET /api/lookups` is **Proposed** | lookups |
| A6 | The audit PDF stays client-side; `audit.pdf` is deferred | reports |
| A11 | Display IDs are frontend-only | all |
| A12 | NUMERIC and INT8 are sent as JSON numbers; timestamps are UTC ISO | all |
| A17 | Discard requires no open offer and status AVAILABLE or EXPIRED | `POST /api/organs/:id/discard` |

---

## Resource shapes

These shapes are referenced by the endpoints below. The fields correspond to `01_schema.sql` columns and views. Fields marked *(derived)* are computed in SQL at read time and never stored.

**User**
```json
{ "id": 1, "username": "admin", "role": "ADMIN" }
```

**Hospital**
```json
{ "id": 2, "name": "Apollo Chennai", "address": "Greams Lane, Chennai", "phone": "044-0000",
  "latitude": 13.0604, "longitude": 80.2496,
  "regionId": 1, "regionCode": "SR", "regionName": "Southern Region", "status": "ACTIVE" }
```

**Region**
```json
{ "id": 1, "code": "SR", "name": "Southern Region",
  "weights": { "hla": 25, "urgency": 35, "distance": 20, "wait": 20 },
  "hospitalCount": 3 }
```

**OrganType**
```json
{ "id": 4, "name": "Kidney", "maxViabilityHours": 30, "responseWindowHours": 6,
  "priorityWeight": 1.0, "minWeightRatio": 0.5, "maxWeightRatio": 3.0 }
```

**HlaAllele**
```json
{ "id": 2, "locus": "A", "alleleName": "A*02:01" }
```

**Donor** (list items omit `organs` and include `organCount`)
```json
{ "id": 42, "name": "Rajesh Kumar", "dateOfBirth": "1984-03-11",
  "bloodGroupId": 4, "bloodGroup": "A+",
  "hospitalId": 1, "hospitalName": "AIIMS New Delhi", "regionCode": "NR",
  "donorType": "DECEASED", "status": "ACTIVE",
  "heightCm": 175, "weightKg": 72,
  "deathDate": "2026-10-04T03:10:00.000Z", "deathCause": "Road traffic accident",
  "hla": [ { "id": 2, "locus": "A", "alleleName": "A*02:01" } ],
  "organs": [ "OrganSummary…" ] }
```

**Recipient** (list items omit `waitlist` and include `waitlistCount`)
```json
{ "id": 118, "name": "Priya Sharma", "dateOfBirth": "1990-06-02",
  "bloodGroupId": 4, "bloodGroup": "A+",
  "hospitalId": 2, "hospitalName": "Apollo Chennai", "regionCode": "SR",
  "status": "ACTIVE", "heightCm": 162, "weightKg": 58,
  "hla": [ "HlaAllele…" ],
  "hasOpenOffer": false,
  "waitlist": [ "WaitlistEntry…" ] }
```
Note: `recipient.status` is never changed by a trigger. A recipient who receives a transplant stays `ACTIVE` until a coordinator changes them. Only the matching waitlist entry closes (BR-14).

**WaitlistEntry** (from `v_waitlist_scored` joined with names)
```json
{ "recipientId": 118, "recipientName": "Priya Sharma", "bloodGroup": "A+",
  "hospitalId": 2, "hospitalName": "Apollo Chennai", "regionId": 1,
  "organTypeId": 4, "organType": "Kidney",
  "urgencyId": 1, "urgencyCode": "1A",
  "listedDate": "2025-08-01", "status": "ACTIVE",
  "waitMonths": 14.1, "urgencyScore": 100, "waitScore": 66.08, "priorityScore": 84.32 }
```
`priorityScore` depends only on urgency and waiting time (08 §7). It is a different quantity from `matchScore`.

**Organ** (from `v_organ`; `OrganSummary` is the same object without `defaultWeights`)
```json
{ "id": 7, "donorId": 42, "donorName": "Rajesh Kumar", "donorBloodGroup": "A+",
  "organTypeId": 1, "organType": "Heart",
  "recoveringHospitalId": 1, "recoveringHospitalName": "AIIMS New Delhi", "regionCode": "NR",
  "recoveredAt": "2026-10-04T08:00:00.000Z",
  "maxViabilityHours": 6,
  "expiresAt": "2026-10-04T14:00:00.000Z",
  "hoursRemaining": 4.5, "isExpired": false,
  "status": "AVAILABLE",
  "discardReasonId": null, "discardReasonCode": null,
  "hasActiveOffer": false, "activeOfferId": null,
  "defaultWeights": { "hla": 20, "urgency": 40, "distance": 25, "wait": 15 } }
```

**MatchRun**
```json
{ "id": 42, "organId": 7, "runAt": "2026-10-04T09:12:00.000Z",
  "runBy": { "id": 1, "username": "admin" },
  "weights": { "hla": 25, "urgency": 35, "distance": 20, "wait": 20 },
  "qualified": [
    { "recipientId": 118, "recipientName": "Priya Sharma", "bloodGroup": "A+",
      "hospitalName": "Apollo Chennai", "rank": 1, "matchScore": 81.25,
      "hlaScore": 87.5, "urgencyScore": 100, "distanceScore": 62.1, "waitScore": 66.08,
      "distanceKm": 238.4, "offerStatus": null }
  ],
  "excluded": [
    { "recipientId": 120, "recipientName": "R. Iyer", "bloodGroup": "B+",
      "hospitalName": "CMC Vellore", "distanceKm": 110.2,
      "exclusionCode": "ABO_INCOMPATIBLE",
      "exclusionDescription": "Blood group incompatible with donor" }
  ] }
```
`offerStatus` is the status of the latest offer for this organ and recipient, or `null` if none exists. The UI uses it to label candidates that already received an offer.

**Offer** (from `v_offer` joined with names)
```json
{ "id": 12, "organId": 7, "organType": "Heart", "donorId": 42,
  "recipientId": 118, "recipientName": "Priya Sharma", "recipientHospitalName": "Apollo Chennai",
  "matchRunId": 42, "rank": 1,
  "status": "SENT",
  "createdAt": "2026-10-04T09:15:00.000Z", "sentAt": "2026-10-04T09:16:00.000Z",
  "respondedAt": null,
  "responseWindowHours": 1, "offerExpiresAt": "2026-10-04T10:16:00.000Z",
  "declineReasonId": null, "declineReasonCode": null,
  "voidReason": null, "notes": null, "createdBy": 1,
  "transport": null,
  "transplant": null }
```
- `transport` is `{ "id": 3, "status": "PENDING" }` once the offer is accepted.
- `transplant` is a Transplant object once one is recorded.
- `rank` is looked up from `match_result` and is `null` when there is no run.

**Transport**
```json
{ "id": 3, "organId": 7, "organType": "Heart", "offerId": 12,
  "recipientId": 118, "recipientName": "Priya Sharma",
  "origin": { "id": 1, "name": "AIIMS New Delhi", "latitude": 28.5672, "longitude": 77.21 },
  "destination": { "id": 2, "name": "Apollo Chennai", "latitude": 13.0604, "longitude": 80.2496 },
  "status": "PENDING", "departedAt": null, "arrivedAt": null,
  "organExpiresAt": "2026-10-04T14:00:00.000Z", "organHoursRemaining": 4.5 }
```
The countdown comes from the organ's viability window. There is no separate transport clock (06 Stage 6).

**Transplant**
```json
{ "id": 5, "offerId": 12, "hospitalId": 2, "hospitalName": "Apollo Chennai",
  "transplantAt": "2026-10-04T13:00:00.000Z", "outcome": "SUCCESS", "notes": null }
```

---

## Endpoint index

| # | Method & path | Status | Sweep | Backlog |
|---|---|---|---|---|
| 1 | `POST /api/auth/login` | Spec | no | OL-004 |
| 2 | `POST /api/auth/logout` | Spec | no | OL-004 |
| 3 | `GET /api/auth/me` | Spec | no | OL-004 |
| 4 | `GET /api/health` | **Proposed** (infra) | no | OL-002 |
| 5 | `GET /api/lookups` | **Proposed** | no | OL-005 |
| 6 | `GET /api/donors` | Spec | no | OL-011 |
| 7 | `POST /api/donors` | Spec | no | OL-020 |
| 8 | `GET /api/donors/:id` | Spec | yes | OL-011 |
| 9 | `PATCH /api/donors/:id` | Spec | no | OL-020 |
| 10 | `POST /api/donors/:id/organs` | Spec | yes | OL-012 |
| 11 | `GET /api/recipients` | Spec | no | OL-021 |
| 12 | `POST /api/recipients` | Spec | no | OL-021 |
| 13 | `GET /api/recipients/:id` | Spec | no | OL-021 |
| 14 | `PATCH /api/recipients/:id` | Spec | no | OL-021 |
| 15 | `GET /api/waitlist` | Spec | no | OL-022 |
| 16 | `POST /api/waitlist` | Spec | no | OL-022 |
| 17 | `PATCH /api/waitlist/:recipientId/:organTypeId` | Spec | no | OL-022 |
| 18 | `GET /api/organs` | Spec | yes | OL-013 |
| 19 | `GET /api/organs/:id` | Spec | yes | OL-013 |
| 20 | `POST /api/organs/:id/discard` | Spec | yes | OL-023 |
| 21 | `GET /api/organs/:id/runs` | Spec | yes | OL-014 |
| 22 | `POST /api/matching/runs` | Spec | yes | OL-014 |
| 23 | `GET /api/matching/runs/:id` | Spec | yes | OL-014 |
| 24 | `GET /api/offers` | Spec | yes | OL-015 |
| 25 | `GET /api/offers/:id` | **Proposed** | yes | OL-015 |
| 26 | `POST /api/offers` | Spec | yes | OL-015 |
| 27 | `POST /api/offers/:id/send` | Spec | yes | OL-015 |
| 28 | `POST /api/offers/:id/accept` | Spec | yes | OL-016 |
| 29 | `POST /api/offers/:id/decline` | Spec | yes | OL-016 |
| 30 | `POST /api/offers/:id/cancel` | Spec | yes | OL-015 |
| 31 | `POST /api/offers/:id/advance` | Spec | yes | OL-016 |
| 32 | `POST /api/transplants` | Spec | yes | OL-018 |
| 33 | `GET /api/transport` | Spec | yes | OL-017 |
| 34 | `POST /api/transport/:id/depart` | Spec | yes | OL-017 |
| 35 | `POST /api/transport/:id/deliver` | Spec | yes | OL-017 |
| 36 | `GET /api/reports/waiting-times` | Spec | no | OL-026 |
| 37 | `GET /api/reports/utilization` | Spec | yes | OL-026 |
| 38 | `GET /api/reports/decline-reasons` | Spec | no | OL-026 |
| 39 | `GET /api/reports/fairness` | Spec | no | OL-026 |
| 40 | `GET /api/reports/compliance` | Spec | yes | OL-026 |
| 41 | `GET /api/reports/audit.pdf` | Spec — **deferred (A6)** | yes | OL-028 |
| 42 | `GET/POST/PATCH /api/hospitals` | Spec | no | OL-005, OL-024 |
| 43 | `GET/POST/PATCH /api/regions` | Spec | no | OL-024 |
| 44 | `GET/POST/PATCH /api/organ-types` | Spec | no | OL-024 |
| 45 | `GET/PATCH /api/blood-compatibility` | Spec | no | OL-025 |
| 46 | `GET/POST/DELETE /api/hla-alleles` | Spec | no | OL-025 |
| 47 | `GET /api/dashboard` | Spec (shape **Proposed**) | yes | OL-027 |

---

## Endpoints

### Auth

#### POST /api/auth/login
- Purpose: Authenticate a user and start a session (FR-1).
- Request body:
  ```json
  { "username": "admin", "password": "admin" }
  ```
- Success response (200):
  ```json
  { "user": { "id": 1, "username": "admin", "role": "ADMIN" } }
  ```
- Error responses:
  - 400 `VALIDATION_ERROR`: username or password missing.
  - 401:
    ```json
    { "error": { "code": "INVALID_CREDENTIALS", "message": "Username or password is incorrect", "details": {} } }
    ```
    Also returned for a user whose `status` is `INACTIVE`.
- Session/auth expectations: on success, the server sets the `connect.sid` cookie. It stores `userId` in the session, and every later transaction uses it for `app.user_id`.

#### POST /api/auth/logout
- Purpose: Destroy the session.
- Request body: none.
- Success response: 204, no body. The cookie is cleared.
- Error responses: 401 `UNAUTHENTICATED`.

#### GET /api/auth/me
- Purpose: Restore login state after a page refresh.
- Success response (200): `{ "user": User }`.
- Error responses: 401 `UNAUTHENTICATED`.

### Infrastructure and lookups

#### GET /api/health — Proposed (infra)
- Purpose: Liveness and DB connectivity check. No auth required.
- Success response (200): `{ "status": "ok", "db": "ok" }`.
- Error responses: 503 `{ "error": { "code": "DB_UNAVAILABLE", "message": "Database unreachable", "details": {} } }`.

#### GET /api/lookups — Proposed — needs approval (A5)
- Purpose: Reference lists for dropdowns that have no other endpoint. Fetched once per session.
- Success response (200):
  ```json
  {
    "bloodGroups":     [ { "id": 1, "name": "O-" } ],
    "urgencies":       [ { "id": 1, "code": "1A", "description": "Critical — …", "scoreValue": 100 } ],
    "declineReasons":  [ { "id": 2, "code": "ORGAN_QUALITY", "description": "Organ quality assessed as unsuitable" } ],
    "discardReasons":  [ { "id": 3, "code": "VIABILITY_ELAPSED", "description": "…" } ],
    "exclusionReasons":[ { "id": 1, "code": "ABO_INCOMPATIBLE", "description": "…" } ],
    "organTypes":      [ "OrganType…" ],
    "hlaAlleles":      [ "HlaAllele…" ]
  }
  ```
- Error responses: 401.
- Fallback if rejected: the frontend hardcodes these values from `02_seed_reference.sql`.

### Donors

#### GET /api/donors
- Purpose: Donor registry table (FR-3).
- Query: `status` = `ACTIVE`|`INACTIVE`; `type` = `LIVING`|`DECEASED`; `hospital` = hospitalId. All optional.
- Success response (200): `Donor[]`, without `organs` and with `organCount`.
- Error responses: 400 `VALIDATION_ERROR` for a bad enum value.

#### POST /api/donors
- Purpose: Register a donor with HLA typing (FR-3).
- Request body:
  ```json
  { "name": "Anita Desai", "dateOfBirth": "1988-02-14", "bloodGroupId": 1, "hospitalId": 4,
    "donorType": "DECEASED", "status": "ACTIVE", "heightCm": 162, "weightKg": 58,
    "deathDate": "2026-10-04T02:00:00+05:30", "deathCause": "Cerebral haemorrhage",
    "hlaAlleleIds": [1, 2, 7, 8, 14, 18] }
  ```
  `status` defaults to `ACTIVE`. `deathDate` and `deathCause` must be omitted or null for `LIVING` donors. The UI limits HLA to 2 alleles per locus; the API does not enforce this (no DB rule).
- Success response (201): `Donor`.
- Error responses:
  - 400 `CONSTRAINT_VIOLATION`: `ck_donor_death_fields`, `ck_donor_death_after_birth`, or the height/weight range checks.
  - 400 `REFERENCE_NOT_FOUND`: bad `bloodGroupId`, `hospitalId`, or allele ID.
  - 400 `VALIDATION_ERROR`.

#### GET /api/donors/:id
- Purpose: Donor detail drawer, including HLA and organs (05 §5).
- Success response (200): `Donor` with `organs: OrganSummary[]`.
- Error responses: 404 `DONOR_NOT_FOUND`.
- Sweep: yes, so that the organ statuses are current.

#### PATCH /api/donors/:id
- Purpose: Edit or deactivate a donor.
- Request body: any subset of the POST fields. If `hlaAlleleIds` is present it **replaces** the whole HLA set, in the same transaction.
- Success response (200): `Donor`.
- Error responses: 404 `DONOR_NOT_FOUND`; the same 400 codes as POST.

#### POST /api/donors/:id/organs
- Purpose: Procure an organ. This starts the viability clock (FR-4; 06 Stage 2).
- Request body:
  ```json
  { "organTypeId": 1, "recoveringHospitalId": 1, "recoveredAt": "2026-10-04T13:30:00+05:30" }
  ```
- Success response (201): `Organ` with `status: "AVAILABLE"`.
- Error responses:
  - 404 `DONOR_NOT_FOUND`.
  - 400 `CONSTRAINT_VIOLATION` (`ck_organ_not_future`).
  - 400 `REFERENCE_NOT_FOUND`.
- Notes: Runs in a transaction, so audit attribution applies. No rule blocks procurement from an INACTIVE donor.

### Recipients and waitlist

#### GET /api/recipients
- Purpose: Recipient table (FR-6).
- Query: `organ` = organTypeId (recipients with any waitlist entry for that type); `bloodGroup` = name such as `A%2B`; `urgency` = `1A`|`1B`|`2` (any entry with that urgency); `status` = `ACTIVE`|`INACTIVE`|`TRANSPLANTED`|`DECEASED`.
- Success response (200): `Recipient[]`, without `waitlist` and with `waitlistCount` and `hasOpenOffer`.

#### POST /api/recipients
- Purpose: Register a recipient, optionally with initial waitlist entries.
- Request body:
  ```json
  { "name": "Neha Kulkarni", "dateOfBirth": "1979-09-30", "bloodGroupId": 1, "hospitalId": 4,
    "heightCm": 158, "weightKg": 55, "hlaAlleleIds": [1, 3, 7, 9, 13, 16],
    "waitlist": [ { "organTypeId": 3, "urgencyId": 1, "listedDate": "2026-01-10" } ] }
  ```
  `status` defaults to `ACTIVE`. `waitlist` is optional and is inserted in the same transaction.
- Success response (201): `Recipient`, with `waitlist`.
- Error responses: 400 `CONSTRAINT_VIOLATION` (height/weight ranges, `ck_waitlist_not_future`); 400 `REFERENCE_NOT_FOUND`; 400 `VALIDATION_ERROR`.

#### GET /api/recipients/:id
- Success response (200): `Recipient` with `hla` and `waitlist: WaitlistEntry[]`.
- Error responses: 404 `RECIPIENT_NOT_FOUND`.

#### PATCH /api/recipients/:id
- Purpose: Edit a recipient or change their status.
- Request body: any subset of the POST fields except `waitlist`. `hlaAlleleIds` replaces the HLA set.
- Success response (200): `Recipient`.
- Error responses: 404; 400 as for POST.
- Notes: setting `status` to anything other than `ACTIVE` causes the next sweep to void any open offer with "Recipient no longer active" (01 §13 step 5).

#### GET /api/waitlist
- Purpose: Waitlist rows with priority scores (FR-7; `v_waitlist_scored`).
- Query: `organ` (organTypeId), `bloodGroup`, `urgency`, `status` (`ACTIVE`|`SUSPENDED`|`TRANSPLANTED`|`REMOVED`).
- Success response (200): `WaitlistEntry[]`, sorted by `priorityScore` descending.

#### POST /api/waitlist
- Purpose: Add an organ-type listing for an existing recipient (BR-4).
- Request body:
  ```json
  { "recipientId": 118, "organTypeId": 5, "urgencyId": 2, "listedDate": "2026-10-04" }
  ```
  `listedDate` defaults to today.
- Success response (201): `WaitlistEntry`.
- Error responses:
  - 409 `DUPLICATE`: the entry already exists (PK on recipient and organ type).
  - 400 `CONSTRAINT_VIOLATION` (`ck_waitlist_not_future`).
  - 400 `REFERENCE_NOT_FOUND`.

#### PATCH /api/waitlist/:recipientId/:organTypeId
- Purpose: Change urgency, status, or listing date.
- Request body: `{ "urgencyId"?: 1, "status"?: "SUSPENDED", "listedDate"?: "2025-12-01" }`. Allowed `status` values are `ACTIVE`, `SUSPENDED`, and `REMOVED`. `TRANSPLANTED` is set only by the transplant trigger; sending it returns 400 `VALIDATION_ERROR`.
- Success response (200): `WaitlistEntry`.
- Error responses: 404 `WAITLIST_ENTRY_NOT_FOUND`; 400 as above.

### Organs

#### GET /api/organs
- Purpose: Organs page and the Matching Console dropdown (FR-5).
- Query: `status` (`AVAILABLE`|`ALLOCATED`|`TRANSPLANTED`|`EXPIRED`|`DISCARDED`); `available=true` (status `AVAILABLE` and not expired); `organTypeId`.
- Success response (200): `OrganSummary[]`, newest `recoveredAt` first.
- Sweep: yes.

#### GET /api/organs/:id
- Success response (200): `Organ`, including `defaultWeights` from the recovering hospital's region.
- Error responses: 404 `ORGAN_NOT_FOUND`.
- Sweep: yes.

#### POST /api/organs/:id/discard
- Purpose: Discard an unplaceable organ with a reason (BR-3).
- Request body: `{ "discardReasonId": 2 }`.
- Success response (200): `Organ`, with `status: "DISCARDED"`.
- Error responses:
  - 404 `ORGAN_NOT_FOUND`.
  - 409 `ACTIVE_OFFER_EXISTS`: a CREATED or SENT offer is open; cancel it first (A17).
  - 409 `INVALID_STATE_TRANSITION`: status is not `AVAILABLE` or `EXPIRED` (A17).
  - 422 `RULE_VIOLATION`: backstop from `trg_organ_status_transitions`.
  - 400 `REFERENCE_NOT_FOUND`.
- Notes: The organ row is locked `FOR UPDATE`. Sweep: yes.

#### GET /api/organs/:id/runs
- Purpose: The saved match runs for an organ, newest first (BR-6). The console uses this to load the latest run and show how stale it is.
- Success response (200):
  ```json
  [ { "id": 42, "runAt": "2026-10-04T09:12:00.000Z", "runBy": { "id": 1, "username": "admin" },
      "weights": { "hla": 25, "urgency": 35, "distance": 20, "wait": 20 },
      "qualifiedCount": 6, "excludedCount": 3 } ]
  ```
- Error responses: 404 `ORGAN_NOT_FOUND`.

### Matching

#### POST /api/matching/runs
- Purpose: Run and persist a match for an organ (FR-8; `match_candidates`).
- Request body:
  ```json
  { "organId": 7, "weights": { "hla": 25, "urgency": 35, "distance": 20, "wait": 20 } }
  ```
  `weights` is optional, and so is each key inside it. A missing key falls back to the recovering hospital's regional policy (05 §4.4). Each weight must be ≥ 0.
- Success response (201): the full `MatchRun`.
- Error responses:
  - 404 `ORGAN_NOT_FOUND`. The function raises P0001 "Organ % not found", which the API maps to 404.
  - 400 `VALIDATION_ERROR`: a negative weight. All-zero weights also return 400 `VALIDATION_ERROR` "At least one weight must be greater than zero", because the function would divide by `NULLIF(0)` and every score would be null.
- Notes:
  - Runs in a transaction, so `match_run.run_by` is the session user.
  - Running against an expired or non-available organ is not rejected by the DB. The result is a run with every candidate `VIABILITY_UNREACHABLE`, or ranked candidates whose offers the triggers will later reject. The UI disables non-available organs.
  - Sweep: yes.

#### GET /api/matching/runs/:id
- Purpose: Reload a saved run.
- Success response (200): `MatchRun`.
- Error responses: 404 `MATCH_RUN_NOT_FOUND`.

### Offers

#### GET /api/offers
- Purpose: Offer Workflow page (FR-9).
- Query: `status` (any offer status; a comma-separated list is allowed, e.g. `CREATED,SENT`); `organId` (optional).
- Success response (200): `Offer[]`, newest `createdAt` first.
- Sweep: yes.

#### GET /api/offers/:id — Proposed
- Success response (200): `Offer`.
- Error responses: 404 `OFFER_NOT_FOUND`.

#### POST /api/offers
- Purpose: Create an offer for a ranked candidate (06 Stage 4).
- Request body:
  ```json
  { "organId": 7, "recipientId": 118, "matchRunId": 42 }
  ```
  `matchRunId` is recommended. Without it, Advance can't be used afterwards.
- Success response (201): `Offer` with `status: "CREATED"`.
- Error responses:
  - 409 `ACTIVE_OFFER_EXISTS` (`ux_offer_active`, BR-7).
  - 409 `RECIPIENT_ALREADY_DECLINED` (`ux_offer_no_reoffer`, BR-10).
  - 422 `RULE_VIOLATION`, with the trigger text verbatim. Possible messages: "Recipient % is not active", "Blood group incompatible …", "… no active waitlist entry …", "… size ratio …", "Organ % is not available …", "Organ % has exceeded its viability window".
  - 400 `REFERENCE_NOT_FOUND`.
- Notes: The organ is locked `FOR UPDATE` before the insert (05 §6). `created_by` is the session user.

#### POST /api/offers/:id/send
- Purpose: Mark the offer as sent to the recipient's hospital. This starts the response window (BR-9).
- Request body: none.
- Success response (200): `Offer` with `status: "SENT"`, plus `sentAt` and `offerExpiresAt`.
- Error responses: 404 `OFFER_NOT_FOUND`; 409 `INVALID_STATE_TRANSITION` (requires `CREATED`).

#### POST /api/offers/:id/accept
- Purpose: Record that the hospital accepted the offer (BR-11, BR-12). This does **not** record surgery.
- Request body: `{ "notes"?: "string" }`.
- Success response (200): `Offer` with `status: "ACCEPTED"`, `respondedAt`, and `transport: { id, status }`. The transport status is `PENDING`, or `DELIVERED` for a same-hospital transfer.
- Error responses:
  - 404 `OFFER_NOT_FOUND`.
  - 409 `INVALID_STATE_TRANSITION` (requires `SENT`). This is the usual outcome when the offer expired or was voided before acceptance, because the sweep runs first. `details.currentStatus` and `details.voidReason` explain why.
  - 422 `RULE_VIOLATION`: the race backstop from `trg_accept_recheck`, e.g. "Cannot accept: organ % expired before acceptance".
- Notes: The organ is locked `FOR UPDATE`. The triggers set the organ to `ALLOCATED` and insert `transport_record` in the same transaction.

#### POST /api/offers/:id/decline
- Purpose: Record a coded decline (FR-9). The recipient is then never re-offered this organ (BR-10).
- Request body:
  ```json
  { "declineReasonId": 2, "notes": "Biopsy showed fibrosis" }
  ```
- Success response (200): `Offer` with `status: "DECLINED"`, `declineReasonId`, `declineReasonCode`, and `respondedAt`.
- Error responses: 404; 409 `INVALID_STATE_TRANSITION` (requires `SENT`); 400 `VALIDATION_ERROR` (missing reason); 400 `REFERENCE_NOT_FOUND`.

#### POST /api/offers/:id/cancel
- Purpose: Withdraw an offer without a decision. This does **not** block a future re-offer (U9).
- Request body: none.
- Success response (200): `Offer` with `status: "CANCELLED"`.
- Error responses: 404; 409 `INVALID_STATE_TRANSITION` (requires `CREATED` or `SENT`).

#### POST /api/offers/:id/advance
- Purpose: Offer the organ to the next eligible ranked candidate in the **same run** (05 §5.1; U1).
- Request body: none.
- Preconditions (A4): the source offer's status is `DECLINED`, `EXPIRED`, `VOIDED`, or `CANCELLED`, and its `matchRunId` is not null.
- Behaviour:
  1. Lock the organ `FOR UPDATE`.
  2. Iterate the run's qualified results in rank order, starting after the source recipient's rank.
  3. For each candidate: `SAVEPOINT`, then `INSERT` the offer. If it fails with P0001 or 23505, roll back to the savepoint, record the skip, and continue.
  4. Stop at the first success.
  5. The new offer is **CREATED**, not sent (06 Stage 4).
- Success response (201):
  ```json
  { "offer": { "…": "Offer, status CREATED" },
    "skipped": [ { "rank": 2, "recipientId": 131, "recipientName": "A. Rao",
                   "reasonCode": "RECIPIENT_ALREADY_DECLINED",
                   "reason": "This recipient has already declined this organ" },
                 { "rank": 3, "recipientId": 140, "recipientName": "M. Das",
                   "reasonCode": "RULE_VIOLATION",
                   "reason": "Recipient 140 is not active" } ] }
  ```
- Error responses:
  - 404 `OFFER_NOT_FOUND`.
  - 409 `INVALID_STATE_TRANSITION`: the source offer is still `CREATED` or `SENT` (or `ACCEPTED`), or it has no run.
  - 409 `ACTIVE_OFFER_EXISTS`: another offer on this organ is already open.
  - 422 `NO_ELIGIBLE_CANDIDATE`, with `details.skipped` as above.
  - 422 `RULE_VIOLATION`: the organ is no longer available or has expired (raised by the first insert attempt for an organ-level reason; the API doesn't keep walking for organ-level failures).

### Transplants

#### POST /api/transplants
- Purpose: Record surgery and its outcome, separately from acceptance (FR-10; BR-11, BR-13).
- Request body:
  ```json
  { "offerId": 12, "outcome": "SUCCESS", "transplantAt": "2026-10-04T18:30:00+05:30",
    "hospitalId": 2, "notes": "Uneventful" }
  ```
  - `outcome` is one of `SUCCESS`, `FAILED`, `ORGAN_NOT_USED`.
  - `transplantAt` defaults to now.
  - `hospitalId` is optional and defaults to the transport's destination hospital (A3; TBD — requires human approval).
- Success response (201): `Transplant`. Side effects come from `trg_transplant_recorded`:
  - On `SUCCESS`, the organ becomes `TRANSPLANTED` and the waitlist entry for **this organ type only** becomes `TRANSPLANTED` (BR-14).
  - On any other outcome, the organ becomes `DISCARDED` with `TRANSPLANT_FAILED` and the entry becomes `REMOVED`.
- Error responses:
  - 404 `OFFER_NOT_FOUND`.
  - 422 `RULE_VIOLATION`: "Cannot record transplant: offer % is not accepted", or "… organ % has not been delivered" (BR-13).
  - 409 `TRANSPLANT_ALREADY_RECORDED`.
  - 400 `VALIDATION_ERROR`: bad outcome.
  - *Known limitation (OL-DEC-02):* no viability check. An organ that expired while in transit is not rejected here.

### Transport

#### GET /api/transport
- Purpose: Transport page and map (FR-11).
- Query: `status` (optional; comma-separated list allowed).
- Success response (200): `Transport[]`, active ones (`PENDING`, `IN_TRANSIT`) first.
- Sweep: yes.

#### POST /api/transport/:id/depart
- Purpose: Mark In Transit.
- Request body: none.
- Success response (200): `Transport` with `status: "IN_TRANSIT"` and `departedAt`.
- Error responses: 404 `TRANSPORT_NOT_FOUND`; 409 `INVALID_STATE_TRANSITION` (requires `PENDING`).

#### POST /api/transport/:id/deliver
- Purpose: Mark Delivered. This unlocks Record Transplant.
- Request body: none.
- Success response (200): `Transport` with `status: "DELIVERED"` and `arrivedAt`.
- Error responses:
  - 404.
  - 409 `INVALID_STATE_TRANSITION` (requires `IN_TRANSIT`).
  - *Known limitation (OL-DEC-02):* no expiry check. An allocated organ that passes its viability window in transit is not expired by the sweep and the transport is not set to `FAILED`.

### Reports

All report endpoints are read-only. Each maps 1:1 to its view, with keys converted to camelCase.

#### GET /api/reports/waiting-times
- Source: `v_waiting_time_distribution`.
- Success response (200):
  ```json
  [ { "organType": "Kidney", "bucket": 3, "recipients": 14 } ]
  ```
  `bucket` b covers months [(b−1)×5, b×5); bucket 13 means 60 months or more. The frontend renders the labels.

#### GET /api/reports/utilization
- Source: `v_organ_utilization`. Sweep: yes.
- Success response (200):
  ```json
  [ { "regionName": "Southern Region", "organType": "Kidney", "transplanted": 12, "expired": 2,
      "discarded": 1, "totalRecovered": 16, "utilizationPct": 75.0 } ]
  ```

#### GET /api/reports/decline-reasons
- Source: `v_decline_reasons`.
- Success response (200): `[ { "code": "ORGAN_QUALITY", "description": "…", "occurrences": 31, "pct": 33.7 } ]`

#### GET /api/reports/fairness
- Source: `v_allocation_fairness`.
- Success response (200):
  ```json
  [ { "regionName": "Northern Region", "waitlistSize": 40, "transplantsCompleted": 11,
      "allocationRatePct": 27.5, "medianWaitDays": 212.5, "retentionPct": 81.82 } ]
  ```
  Nullable fields: `medianWaitDays` and `retentionPct` are `null` for a region with no transplants.

#### GET /api/reports/compliance
- Source: `v_compliance_summary`. Sweep: yes.
- Success response (200), a single object:
  ```json
  { "transplanted": 98, "expiredUnallocated": 4, "discarded": 2, "totalOrgans": 104, "placementRatePct": 94.23 }
  ```

#### GET /api/reports/audit.pdf — Spec, deferred (A6; TBD — requires human approval)
- Purpose (05 §5): Server-rendered audit PDF.
- Current plan: not implemented in this phase. The existing client-side generator (`src/pages/reportsAuditPdf.js`) builds the PDF from `GET /api/offers` plus the report endpoints above. If the team requires the server endpoint, it returns `200 application/pdf` with `Content-Disposition: attachment; filename="organlink-audit-<date>.pdf"`. Query: `from`, `to` (dates).

### Settings

#### GET /api/hospitals · POST /api/hospitals · PATCH /api/hospitals/:id
- Purpose: Hospital management (FR-13).
- GET query: `regionId`, `status`. GET returns `Hospital[]`.
- POST body:
  ```json
  { "name": "KEM Mumbai", "address": "Parel, Mumbai", "phone": "022-0000",
    "latitude": 19.0002, "longitude": 72.8422, "regionId": 2, "status": "ACTIVE" }
  ```
  Success: 201 `Hospital`.
- PATCH body: any subset of the POST fields. Suspend with `{ "status": "SUSPENDED" }`. Success: 200 `Hospital`.
- Errors: 404 `HOSPITAL_NOT_FOUND`; 400 `CONSTRAINT_VIOLATION` (lat/long range); 400 `REFERENCE_NOT_FOUND`.
- There is no DELETE (05 §5; 08 §4: "hospitals are suspended").

#### GET /api/regions · POST /api/regions · PATCH /api/regions/:id
- Purpose: Regions and their per-region policy weights (FR-13; 07 §7 region selector).
- GET returns `Region[]`.
- POST body:
  ```json
  { "code": "CR", "name": "Central Region", "weights": { "hla": 25, "urgency": 35, "distance": 20, "wait": 20 } }
  ```
  `weights` is optional and defaults to the schema defaults. Success: 201 `Region`.
- PATCH body: `{ "name"?, "code"?, "weights"?: { "hla"?, "urgency"?, "distance"?, "wait"? } }`. Success: 200 `Region`.
- Errors: 404 `REGION_NOT_FOUND`; 400 `CONSTRAINT_VIOLATION` (`ck_region_weights_nonzero`, negative weight); 409 `DUPLICATE` (code).

#### GET /api/organ-types · POST /api/organ-types · PATCH /api/organ-types/:id
- Purpose: Organ types, with viability, response window, and size tolerances.
- GET returns `OrganType[]`.
- POST body: `{ "name", "maxViabilityHours", "responseWindowHours", "priorityWeight"?, "minWeightRatio", "maxWeightRatio" }`. Success: 201 `OrganType`.
- PATCH body: any subset of the POST fields. Success: 200 `OrganType`.
- Errors: 404 `ORGAN_TYPE_NOT_FOUND`; 400 `CONSTRAINT_VIOLATION` (positive checks, `ck_organ_type_ratio_order`); 409 `DUPLICATE` (name).
- Note: changing `maxViabilityHours` immediately changes `expiresAt` for every existing organ of that type, because it is derived (08 §3).

#### GET /api/blood-compatibility · PATCH /api/blood-compatibility
- Purpose: The 8×8 compatibility matrix (FR-13).
- GET success (200):
  ```json
  { "bloodGroups": [ { "id": 1, "name": "O-" } ],
    "pairs": [ { "donorBloodGroupId": 1, "donorGroup": "O-",
                 "recipientBloodGroupId": 4, "recipientGroup": "A+", "compatible": true } ] }
  ```
  `pairs` always has 64 entries.
- PATCH body (one pair per call):
  ```json
  { "donorBloodGroupId": 1, "recipientBloodGroupId": 4, "compatible": false }
  ```
  Success: 200 with the updated pair.
- Errors: 404 if the pair doesn't exist; 400 `VALIDATION_ERROR`.

#### GET /api/hla-alleles · POST /api/hla-alleles · DELETE /api/hla-alleles/:id
- Purpose: HLA allele reference data.
- GET query: `locus` = `A`|`B`|`DRB1`. GET returns `HlaAllele[]`.
- POST body: `{ "locus": "B", "alleleName": "B*27:05" }`. Success: 201 `HlaAllele`.
- DELETE success: 204.
- Errors:
  - 400 `CONSTRAINT_VIOLATION` (locus not one of A, B, DRB1).
  - 409 `DUPLICATE` (`ux_hla_allele_natural`).
  - 409 `REFERENCE_IN_USE` (**Proposed** mapping of `23503` on DELETE; the allele is referenced by a donor or recipient).
  - 404 `HLA_ALLELE_NOT_FOUND`.

### Dashboard

#### GET /api/dashboard — path from spec; response shape Proposed — needs approval
- Purpose: Dashboard summary (FR-2). Sweep: yes.
- Success response (200):
  ```json
  {
    "stats": { "availableOrgans": 3, "activeWaitlist": 22, "pendingOffers": 1, "transplantsThisMonth": 4 },
    "criticalAlerts": [
      { "type": "ORGAN_EXPIRING", "severity": "danger", "organId": 7, "hoursRemaining": 1.6 },
      { "type": "OFFER_AWAITING_RESPONSE", "severity": "warning", "offerId": 12,
        "hoursRemaining": 0.4 }
    ],
    "allocationTrend": [ { "month": "2025-11", "transplants": 6 } ],
    "recentOffers": [ "Offer… (5 most recent)" ]
  }
  ```
  - `pendingOffers` counts offers with status `CREATED` or `SENT`.
  - `criticalAlerts` lists AVAILABLE organs with `hoursRemaining` < 2, and SENT offers within 1 h of `offerExpiresAt`.
  - `allocationTrend` has 12 months, zero-filled, counting `SUCCESS` transplants.
  - Alerts carry structured fields only. The frontend builds the alert text, including display IDs (A11).
