# 3. Database Design Document

**23CSE202 Database Management Systems** | S3 B.Tech CSE
Amrita School of Computing, Amritapuri Campus

**Group No:** A12
**Project Title:** OrganLink — Organ Transplant and Allocation System

| Roll No | Student Name |
|---|---|
| AM.SC.U4CSE25038 | Jayanth Jayaprakash |
| AM.SC.U4CSE25025 | Anand Rodriguez Menon |
| AM.SC.U4CSE25052 | Shraddha Sajeev |

---

## 3.1 Detailed description of the project

> *Written so that entities, attributes, relationships, users and business rules are evident from the description. Entity names appear in **bold**; business rules are numbered **BR-n**.*

A national organ transplant network coordinates the allocation of donated organs across several **regions**. Each region has a code and a name, and each region sets its own **allocation policy**: four numeric weights governing how heavily tissue matching, clinical urgency, geographic distance and time spent waiting count toward a candidate's ranking. Every **hospital** in the network belongs to exactly one region and is recorded with its name, address, telephone number, and latitude and longitude, the last two being used to compute travel distances. A hospital may be active or suspended.

**Donors** are registered at a hospital. Each donor has a name, date of birth, blood group, height and weight. A donor is either living or deceased; **BR-1**: a deceased donor must have a recorded date and cause of death, and a living donor must have neither. A donor's tissue type is recorded as a set of **HLA alleles** drawn from a reference list of alleles, each belonging to one of three loci (A, B, DRB1).

When an organ is surgically recovered from a donor it is registered as an **organ**, with its **organ type** (heart, lung, liver, kidney, pancreas), the hospital that recovered it, and the exact timestamp of recovery. Each organ type carries a maximum viability period in hours, a response window in hours, and a permitted donor-to-recipient weight ratio range. **BR-2**: an organ remains transplantable only until its recovery time plus its type's maximum viability hours; after that it has expired and may no longer be allocated. A single donor may yield several organs. **BR-3**: an organ that cannot be placed is discarded with a recorded discard reason.

**Recipients** are patients registered at a hospital with a name, date of birth, blood group, height, weight, and their own set of HLA alleles. A recipient joins the **waitlist** by creating one waitlist entry per organ type they need. **BR-4**: a recipient may be waitlisted for several organ types simultaneously — a kidney-pancreas candidate is common — and each entry carries its own listing date, urgency and status independently. Urgency is one of three tiers (1A critical, 1B high, 2 stable), each carrying a numeric score.

When an organ becomes available, a coordinator initiates a **match run** against it. The run records the timestamp, the four policy weights in force, and the user who initiated it. It evaluates every active waitlist entry for that organ type and produces one **match result** per recipient. **BR-5**: a candidate is excluded outright — no score can compensate — if the donor's blood group is incompatible with the recipient's according to the **blood compatibility** reference matrix, if the recipient or their waitlist entry is not active, if the donor-to-recipient weight ratio falls outside the organ type's permitted range, if the organ cannot physically reach the recipient before expiry, or if that recipient has already been offered this organ. Each exclusion records an **exclusion reason**. Qualifying candidates receive four component scores — tissue match, urgency, distance and waiting time — combined into an overall match score using the run's weights, and are ranked in descending order. **BR-6**: match runs are permanent and append-only; re-running a match creates a new run rather than altering an earlier one, so that any past allocation decision can be reconstructed.

A coordinator then creates an **organ offer** to the highest-ranked candidate and sends it to that recipient's hospital. **BR-7**: at most one offer per organ may be open at any moment, whether it is merely created or already sent. **BR-8**: an unsent offer left open for more than an hour is cancelled automatically, so that an abandoned offer cannot hold an organ indefinitely. **BR-9**: a sent offer that receives no response within the organ type's response window expires. The hospital may accept the offer, or decline it with a recorded **decline reason**. **BR-10**: a recipient who has declined an organ is never offered that same organ again. If an offer is voided — because the organ expired or the recipient became unavailable — the recipient may be offered the organ again later, since they never declined it.

**BR-11**: acceptance means the receiving hospital has committed to the organ; it does not mean surgery has occurred. On acceptance the organ becomes allocated and a **transport record** is created, giving the origin hospital, the destination hospital, and a status progressing from pending through in-transit to delivered. A transport between two points at the same hospital is recorded as delivered immediately. **BR-12**: acceptance re-verifies organ viability and recipient status at the moment of acceptance, because the response may arrive after circumstances have changed.

Surgery is recorded separately as a **transplant event**, with its timestamp, the performing hospital, and an outcome of success, failure, or organ not used. **BR-13**: a transplant event cannot be recorded until the organ's transport shows delivered. **BR-14**: a successful transplant closes only the waitlist entry for that organ's type, leaving the recipient's other entries active.

Every change to donors, recipients, organs, offers, waitlist entries and transplant events is written to an **audit log** recording the table, the row, the action, the values before and after, the acting user, and the time.

The system serves five classes of **user**, each holding a **role**: transplant coordinators who register donors and recipients, run matching and record offer decisions; hospital and transplant staff who monitor their own patients and respond to offers; medical reviewers who maintain compatibility reference data; network administrators who manage hospitals, regions and policy weights; and auditors who produce historical reports on waiting times, organ utilization, decline reasons and allocation fairness across regions. In the present implementation a single administrative account exercises all functions; role-based access control is modelled in the schema but not enforced.

---

## 3.2 ER Diagram

> *See accompanying diagram files. Two diagrams are provided:*
> - *Diagram A — core operational entities (the allocation workflow)*
> - *Diagram B — reference and lookup data*
>
> *Notation: Chen. Rectangles are entities, double rectangles associative entities, diamonds relationships, ellipses attributes, dashed ellipses derived attributes. Primary keys are underlined. Every edge is labelled with cardinality; double lines denote total participation.*

**Entities:** Region, Hospital, Donor, Recipient, Organ, Organ_Type, Match_Run, Organ_Offer, Transplant_Event, Transport_Record, Blood_Group, HLA_Allele, Urgency, Decline_Reason, Discard_Reason, Exclusion_Reason, Role, App_User, Audit_Log.

**Associative entities:** Waitlist_Entry (resolves Recipient × Organ_Type), Match_Result (resolves Match_Run × Recipient).

**Pure M:N relationships:** Donor–HAS_HLA–HLA_Allele, Recipient–HAS_HLA–HLA_Allele, and the recursive Blood_Group–COMPATIBLE_WITH–Blood_Group.

**Derived attributes (dashed):** Organ.expires_at, Organ_Offer.offer_expires_at, Waitlist_Entry.priority_score. None of these are stored — see §3.4.

**Relationships of note:**

| Relationship | Cardinality | Participation |
|---|---|---|
| Region CONTAINS Hospital | 1:N | Hospital total |
| Donor PROVIDES Organ | 1:N | Organ total, Donor partial |
| Recipient — WAITLIST_ENTRY — Organ_Type | M:N | both partial |
| Organ EVALUATED_BY Match_Run | 1:N | Match_Run total |
| Match_Run — MATCH_RESULT — Recipient | M:N | Match_Run total |
| Organ OFFERED_IN Organ_Offer | 1:N | Offer total (at most one active — BR-7) |
| Organ_Offer RESULTS_IN Transplant_Event | 1:1 | Event total |
| Organ SHIPPED_VIA Transport_Record | 1:1 | Record total |
| Hospital ORIGIN_OF / DESTINATION_OF Transport_Record | 1:N each | two distinct relationships |

---

## 3.3 Relational Schema

Twenty-four relations. Primary keys **bold**, foreign keys *italic*.

**Reference**

```
region(region_id, region_code, region_name, hla_weight,
       urgency_weight, distance_weight, wait_weight)
hospital(hospital_id, name, address, phone, latitude, longitude,
         region_id → region, status)
organ_type(organ_type_id, name, max_viability_hours, response_window_hours,
           priority_weight, min_weight_ratio, max_weight_ratio)
blood_group(blood_group_id, group_name)
blood_compatibility(donor_bg_id → blood_group,
                    recipient_bg_id → blood_group, compatible)
hla_allele(allele_id, locus, allele_name)
urgency(urgency_id, code, description, score_value)
decline_reason(decline_reason_id, code, description)
discard_reason(discard_reason_id, code, description)
exclusion_reason(exclusion_reason_id, code, description)
role(role_id, role_name)
```

**Users**

```
app_user(user_id, username, password_hash, role_id → role, status)
```

**People**

```
donor(donor_id, name, date_of_birth, blood_group_id → blood_group,
      hospital_id → hospital, donor_type, status, height_cm, weight_kg,
      death_date, death_cause)
recipient(recipient_id, name, date_of_birth, blood_group_id → blood_group,
          hospital_id → hospital, status, height_cm, weight_kg)
donor_hla(donor_id → donor, allele_id → hla_allele)
recipient_hla(recipient_id → recipient, allele_id → hla_allele)
```

**Waitlist**

```
waitlist_entry(recipient_id → recipient, organ_type_id → organ_type,
               urgency_id → urgency, listed_date, status)
```

**Allocation**

```
organ(organ_id, donor_id → donor, organ_type_id → organ_type,
      recovering_hospital_id → hospital, recovered_at, status,
      discard_reason_id → discard_reason)
match_run(run_id, organ_id → organ, run_at, hla_weight, urgency_weight,
          distance_weight, wait_weight, run_by → app_user)
match_result(run_id → match_run, recipient_id → recipient, rank,
             match_score, hla_score, urgency_score, distance_score,
             wait_score, distance_km, qualified,
             exclusion_reason_id → exclusion_reason)
organ_offer(offer_id, organ_id → organ, recipient_id → recipient,
            run_id → match_run, status, created_at, sent_at, responded_at,
            decline_reason_id → decline_reason, void_reason, notes,
            created_by → app_user)
transport_record(transport_id, organ_id → organ,
                 origin_hospital_id → hospital,
                 destination_hospital_id → hospital,
                 status, departed_at, arrived_at)
transplant_event(transplant_id, offer_id → organ_offer,
                 hospital_id → hospital, transplant_at, outcome, notes)
```

**Audit**

```
audit_log(audit_id, table_name, row_id, action, old_values,
          new_values, user_id → app_user, changed_at)
```

### Constraints that cannot be expressed as dependencies

Three business rules are conditional and therefore outside the reach of functional dependencies. They are enforced by partial unique indexes:

| Rule | Mechanism |
|---|---|
| BR-7 one active offer per organ | `UNIQUE (organ_id) WHERE status IN ('CREATED','SENT')` |
| BR-10 no re-offer after decline | `UNIQUE (organ_id, recipient_id) WHERE status NOT IN ('VOIDED','CANCELLED')` |
| Rank unique within a run | `UNIQUE (run_id, rank) WHERE qualified` |

---

## 3.4 Normalization and Functional Dependency Analysis

### 3.4.1 The unnormalized starting relation

Before any database existed, a transplant coordinator would maintain a single spreadsheet, one row per recipient, with every fact needed to act visible without switching sheets:

```
WAITLIST_MASTER(
  recipient_id, recipient_name, dob, blood_group, height_cm, weight_kg,
  hla_alleles, hospital_name, hospital_address, hospital_phone,
  hospital_lat, hospital_lng, region_name, region_code,
  hla_weight, urgency_weight, wait_weight, distance_weight,
  organs_needed, listed_date, urgency_status, waitlist_status,
  priority_score, organ_id, organ_type, max_viability_hours,
  recovered_at, expires_at, donor_name, donor_type, donor_blood_group,
  donor_hospital, offer_sent_at, offer_status, response_at,
  decline_reason_code, decline_reason_text, transplant_date,
  transplant_outcome, transport_status )
```

### 3.4.2 First Normal Form

`WAITLIST_MASTER` violates 1NF in three ways:

1. **`organs_needed`** holds multiple values in one cell (`"Kidney, Pancreas"`), because a recipient may need more than one organ.
2. **`hla_alleles`** holds six values in one cell (`"A*01:01, A*02:01, B*07:02, …"`).
3. **The offer columns form a repeating group.** A recipient offered three organs over six months requires either repeated column groups (`offer1_status`, `offer2_status`, …) or duplicated rows.

**Decomposition to 1NF:**
- `organs_needed` → one row per (recipient, organ type) in `WAITLIST_ENTRY`
- `hla_alleles` → one row per (recipient, allele) in `RECIPIENT_HLA`
- repeating offer columns → one row per offer in `ORGAN_OFFER`

### 3.4.3 Anomalies in the unnormalized relation

| Anomaly | Example |
|---|---|
| **Update** | A hospital changes telephone number. The number is repeated on every recipient's row at that hospital; updating forty rows risks partial update and inconsistency. |
| **Insertion** | A new hospital joins the network before it has any recipients. There is nowhere to record it — a hospital can exist only as an attribute of a recipient. |
| **Deletion** | The last recipient in a region is transplanted and their row removed. The region's allocation policy weights are lost with it. |
| **Derived-value decay** | `priority_score` depends on waiting time, which depends on the current date. The value is stale the moment it is written. `expires_at` is likewise `recovered_at` plus the organ type's viability hours. |

### 3.4.4 Functional dependencies

**Geography and policy**

```
F1  hospital_id            → hospital_name, address, phone, lat, lng, region_id, status
F2  region_id              → region_name, region_code
F3  region_code            → region_id
F4  region_id              → hla_weight, urgency_weight, wait_weight, distance_weight
```

*Significance.* F1 and F2 form a chain: the key determines `hospital_id`, which determines `region_id`, which determines the region's name. Region name is therefore **transitively** dependent on the key — the 2NF→3NF violation. F3 establishes `region_code` as a second candidate key of the region relation, which matters when testing BCNF, since BCNF asks whether every determinant is a superkey. F4 shows the policy weights depend on `region_id` alone and therefore belong in the same relation as the region's other attributes; a separate `allocation_policy` relation would be 1:1 with `region` and have no independent key, making the split unjustified.

**Recipients and waitlist**

```
F5  recipient_id                     → name, dob, blood_group_id, hospital_id,
                                       height_cm, weight_kg, status
F6  (recipient_id, organ_type_id)    → listed_date, urgency_id, waitlist_status
F7  organ_type_id                    → name, max_viability_hours,
                                       response_window_hours, priority_weight,
                                       min_weight_ratio, max_weight_ratio
F8  organ_type_name                  → organ_type_id
F9  (recipient_id, allele_id)        → ⊥   (all-key)
```

*Significance.* F5's determinant is a **proper subset** of the waitlist key, making the recipient attributes partially dependent — the 1NF→2NF violation. F6's attributes depend on the full key and correctly remain. F9 is an all-key relation with no non-key attributes, and is therefore trivially in BCNF.

**Donors and organs**

```
F10 donor_id                       → name, dob, blood_group_id, donor_type, status,
                                     hospital_id, height_cm, weight_kg,
                                     death_date, death_cause
F11 (donor_id, allele_id)          → ⊥   (all-key)
F12 organ_id                       → donor_id, organ_type_id, recovered_at,
                                     recovering_hospital_id, status, discard_reason_id
F13 allele_id                      → locus, allele_name
F14 (locus, allele_name)           → allele_id
```

**Offers, matching, outcomes**

```
F15 offer_id                       → organ_id, recipient_id, status, created_at,
                                     sent_at, responded_at, decline_reason_id, void_reason
F16 (organ_id, recipient_id)       → offer_id
F17 run_id                         → organ_id, run_at, hla_weight, urgency_weight,
                                     distance_weight, wait_weight, run_by
F18 (run_id, recipient_id)         → rank, match_score, component scores,
                                     qualified, exclusion_reason_id
F19 (run_id, rank)                 → recipient_id        [over qualified rows only]
F20 transplant_id                  → offer_id, transplant_at, outcome, hospital_id
F21 offer_id                       → transplant_id
F22 transport_id                   → organ_id, origin_hospital_id,
                                     destination_hospital_id, status,
                                     departed_at, arrived_at
F23 organ_id                       → transport_id
```

*Significance.* F16 expresses BR-10 as a dependency and makes `(organ_id, recipient_id)` a second candidate key. F21 and F23 are 1:1 relationships, each making the referenced key a candidate key of its relation.

**Derived attributes — the dependencies that must be eliminated**

```
F24 (recovered_at, organ_type_id)          → expires_at
F25 (listed_date, urgency_id, region_id)   → priority_score     [also depends on now()]
F26 (sent_at, organ_type_id)               → offer_expires_at
```

### 3.4.5 Candidate key by attribute closure

Take `WAITLIST_MASTER` after 1NF flattening; one row is now one (recipient, organ type, organ) combination. Test the proposed key **K = {recipient_id, organ_type_id, organ_id}**.

```
K⁺ = {recipient_id, organ_type_id, organ_id}
  F5  ⇒ + recipient_name, dob, blood_group, height, weight, hospital_id, status
  F1  ⇒ + hospital_name, address, phone, lat, lng, region_id, hospital_status
  F2  ⇒ + region_name, region_code
  F4  ⇒ + hla_weight, urgency_weight, wait_weight, distance_weight
  F6  ⇒ + listed_date, urgency_status, waitlist_status
  F7  ⇒ + organ_type_name, max_viability_hours, response_window_hours
  F12 ⇒ + donor_id, recovered_at, recovering_hospital_id, organ_status
  F10 ⇒ + donor_name, donor_type, donor_blood_group, death_date, death_cause
  F16 ⇒ + offer_id
  F15 ⇒ + offer_status, sent_at, responded_at, decline_reason_id
  F21 ⇒ + transplant_id
  F20 ⇒ + transplant_at, outcome
  F23 ⇒ + transport_id
  F22 ⇒ + origin_hospital_id, destination_hospital_id, transport_status
  F24 ⇒ + expires_at

K⁺ = all attributes of WAITLIST_MASTER  ⇒ K is a superkey.
```

**Minimality test** — remove one attribute at a time:

| Removed | Closure reaches | Superkey? |
|---|---|---|
| `recipient_id` | `{organ_type_id, organ_id}⁺` reaches organ, donor, transport — but F5 never fires, so no recipient attributes | **No** |
| `organ_type_id` | recoverable via F12 (`organ_id → organ_type_id`); closure unchanged | **Yes — extraneous** |
| `organ_id` | `{recipient_id, organ_type_id}⁺` reaches recipient, waitlist, hospital, region — but no organ, offer or outcome attributes | **No** |

Since removing `organ_type_id` leaves a superkey, it is extraneous. The candidate key is:

> **K = {recipient_id, organ_id}**

This result is worth stating explicitly because it is counterintuitive: organ type appears essential to a waitlist row, but is functionally determined by the organ.

### 3.4.6 2NF

With K = {recipient_id, organ_id}, F5 gives `recipient_id → recipient_name, dob, …`. The determinant is a **proper subset** of K and the dependents are non-prime: a partial dependency. The same holds for F12 on `organ_id` alone.

`WAITLIST_MASTER` is therefore in 1NF but **not 2NF**. Removing the partial dependencies extracts `RECIPIENT`, `ORGAN`, and their dependent relations, leaving `WAITLIST_ENTRY` with only attributes dependent on the full key.

### 3.4.7 3NF

After 2NF decomposition, `RECIPIENT` retains `hospital_id`, and F1 gives `hospital_id → region_id`, and F2 gives `region_id → region_name`. Thus:

```
recipient_id → hospital_id → region_id → region_name
```

`region_name` is transitively dependent on `recipient_id` through non-key attributes. This is the **transitive dependency chain Recipient → Hospital → Region → Allocation Policy** that this project set out to demonstrate. Extracting `HOSPITAL` and `REGION` into their own relations removes it, with the policy weights travelling with `REGION` per F4.

### 3.4.8 BCNF — where the stricter form does more work

Three violations survive 3NF or sit exactly on the 3NF/BCNF boundary.

**Violation 1 — `expires_at` in ORGAN.**
After 3NF decomposition:

```
organ(organ_id, donor_id, organ_type_id, recovering_hospital_id,
      recovered_at, status, discard_reason_id, expires_at)
```

Candidate key `{organ_id}`. But F24 gives `(recovered_at, organ_type_id) → expires_at`. Two organs of the same type recovered at the same instant would share this determinant, so **it is not a superkey**. BCNF requires every determinant to be a superkey; this fails.

**Violation 2 — `priority_score` in WAITLIST_ENTRY.**
F25 gives `(listed_date, urgency_id, region_id) → priority_score`, again a non-superkey determinant. This case is the sharper illustration: **3NF permits a dependency whose dependent is a prime attribute, whereas BCNF permits no non-superkey determinant at all.** Were `priority_score` prime — as it would be if the relation were keyed on it for ranking — 3NF would accept the relation and BCNF would reject it. This is precisely where BCNF does work that 3NF does not.

**Violation 3 — `locus` in DONOR_HLA and RECIPIENT_HLA.**
Drafting these relations as `(donor_id, locus, allele_id)` introduces F13: `allele_id → locus`. Here `allele_id` alone is not a superkey of `DONOR_HLA`, so the dependency violates BCNF.

**Resolution.**

For violations 1 and 2, the textbook remedy — decomposing `ORGAN` into `ORGAN` plus `VIABILITY(recovered_at, organ_type_id, expires_at)` — is technically correct and practically absurd. The better resolution is **elimination rather than decomposition**: the attribute is derived, so it is removed from storage entirely and computed on read. The dependency vanishes because the attribute does.

- `expires_at` is computed by the view `v_organ` as `recovered_at + (max_viability_hours × 1 hour)`
- `offer_expires_at` is computed by `v_offer`
- `priority_score` is computed by `v_waitlist_scored`

This also cures the derived-value decay anomaly of §3.4.3: a stored score depending on `now()` is wrong the instant it is written, whereas a computed one is always current.

For violation 3, `locus` is simply dropped from both bridge relations. The key becomes `(donor_id, allele_id)`, and locus is obtained by joining `HLA_ALLELE`.

### 3.4.9 BCNF verification of the final schema

| Relation | Candidate key(s) | Determinants | BCNF |
|---|---|---|---|
| region | {region_id}, {region_code} | F2, F3, F4 | ✔ |
| hospital | {hospital_id} | F1 | ✔ |
| organ_type | {organ_type_id}, {name} | F7, F8 | ✔ |
| blood_group | {blood_group_id}, {group_name} | — | ✔ |
| blood_compatibility | {donor_bg_id, recipient_bg_id} | full key only | ✔ |
| hla_allele | {allele_id}, {locus, allele_name} | F13, F14 | ✔ |
| urgency | {urgency_id}, {code} | — | ✔ |
| decline/discard/exclusion_reason | {id}, {code} | — | ✔ |
| role | {role_id}, {role_name} | — | ✔ |
| app_user | {user_id}, {username} | — | ✔ |
| donor | {donor_id} | F10 | ✔ |
| recipient | {recipient_id} | F5 | ✔ |
| donor_hla | all-key | none | ✔ (trivially) |
| recipient_hla | all-key | none | ✔ (trivially) |
| waitlist_entry | {recipient_id, organ_type_id} | F6 | ✔ |
| organ | {organ_id} | F12 | ✔ (after eliminating `expires_at`) |
| match_run | {run_id} | F17 | ✔ |
| match_result | {run_id, recipient_id}, {run_id, rank}* | F18, F19 | ✔ |
| organ_offer | {offer_id}, {organ_id, recipient_id} | F15, F16 | ✔ |
| transplant_event | {transplant_id}, {offer_id} | F20, F21 | ✔ |
| transport_record | {transport_id}, {organ_id} | F22, F23 | ✔ |
| audit_log | {audit_id} | — | ✔ † |

\* over qualified rows only
† `old_values` / `new_values` are JSONB — see §3.4.10

**All twenty-four relations are in BCNF.**

### 3.4.10 Deliberate departures, and why they are justified

Three design choices store data that could in principle be derived. Each is deliberate, and none violates BCNF, since in every case the determinant within the relation is its key.

**Snapshot attributes in `transport_record`.** `origin_hospital_id` duplicates the organ's recovering hospital and `destination_hospital_id` duplicates the recipient's hospital. BCNF constrains dependencies *within* a relation, not duplication *across* relations, and `organ_id` is a candidate key here (F23), so no violation arises. The justification for storing rather than joining is historical fidelity: a recipient may transfer hospitals after the fact, and the transport record must record where the organ actually went.

**`match_score` and component scores in `match_result`.** Given the weights in `match_run`, the total is a weighted sum of the components. Those weights live in a different relation, so within `match_result` the components do not determine the total and there is no internal dependency. Storage is deliberate: a match run is a permanent record of a past allocation decision (BR-6), and recomputing it later against changed policy weights would falsify the history.

**JSONB in `audit_log`.** `old_values` and `new_values` are not atomic and therefore represent a departure from 1NF. This is accepted knowingly: an audit log must record rows from arbitrary tables, so no fixed column set can serve. Confining the non-atomic attributes to a single append-only log leaves the operational schema fully normalized.

---

*All DDL, constraints, triggers, functions and views described here are implemented in `01_schema.sql` and verified against PostgreSQL 16.*
