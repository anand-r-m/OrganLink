# OrganLink — Product Requirements Document

**Group A12** | 23CSE202 Database Management Systems
**Version 1.0**

---

## 1. Problem

Deceased-donor organs are perishable on a scale of hours. A heart is transplantable for roughly six hours after recovery; a kidney for about thirty. Within that window a coordinator must identify every medically compatible recipient across a multi-hospital network, rank them fairly, offer the organ, and arrange transport — and must do so without ever making an unsafe match.

Allocation cannot run first-come-first-served. It depends on blood group and tissue compatibility, body size, clinical urgency, time already spent waiting, and the physical distance between hospitals. Done by hand across spreadsheets and phone calls, the process misses viability windows, and a missed window is a wasted organ.

OrganLink is a centralized, rule-enforcing allocation system where the medical constraints are enforced by the database itself rather than by whoever happens to be on shift.

## 2. Users

Five classes are modelled in the schema. **In this phase a single administrative account exercises all functions**; role-based access control is modelled but not enforced (see §6).

| Role | Needs |
|---|---|
| Transplant coordinator | Register donors and recipients, procure organs, run matching, create and track offers |
| Hospital / transplant staff | View their own recipients' waitlist status, respond to offers |
| Medical reviewer | Maintain compatibility reference data — blood group matrix, HLA alleles, size tolerances |
| Network administrator | Manage hospitals, regions, organ types and allocation policy weights |
| Auditor / analyst | Produce historical reports on waiting times, utilization, decline reasons and fairness |

## 3. Functional requirements

**FR-1 Authentication.** Username and password login. Session required for all other functions.

**FR-2 Dashboard.** Summary statistics, critical alerts (organs nearing expiry, offers awaiting response), allocation trend chart, recent offers table.

**FR-3 Donor management.** Register donors with demographics, blood group, HLA alleles, height and weight. A donor is **living or deceased**; deceased donors carry a death date and cause. Donor *type* and donor *status* are separate: a deceased donor may still be active or inactive.

**FR-4 Organ procurement.** From a donor's record, register an organ with its type, recovering hospital, and **exact recovery timestamp**. This timestamp starts the viability clock and is the single most consequential value in the system.

**FR-5 Organ registry.** List every organ with its donor, type, remaining viability, and status. Discard an unplaceable organ with a recorded reason.

**FR-6 Recipient management.** Register recipients with demographics, blood group, HLA alleles, height and weight.

**FR-7 Waitlist.** A recipient may hold **one waitlist entry per organ type simultaneously**, each with independent urgency (1A / 1B / 2), listing date and status. Filterable by organ, blood group, urgency and status. Each entry displays a **priority score** computed from urgency and waiting time only.

**FR-8 Matching.** Given an available organ and four policy weights, produce a ranked list of qualifying candidates and a separate list of excluded candidates with reasons. Every run is **persisted permanently and is append-only**; re-running creates a new run.

**FR-9 Offers.** Create, send, accept, decline (with reason) and advance to the next ranked candidate. At most one offer per organ may be open. Declined recipients are never re-offered the same organ. Unsent offers are cancelled automatically after one hour; sent offers expire after the organ type's response window.

**FR-10 Transplant recording.** Recording a transplant is **separate from accepting an offer**. A transplant carries a timestamp and an outcome of success, failure, or organ not used, and cannot be recorded until transport shows delivered.

**FR-11 Transport.** Auto-created on acceptance with origin and destination. Status advances pending → in transit → delivered. Map view with hospital markers and routes. Viability countdown displayed against the journey.

**FR-12 Reports.** Waiting-time distribution, organ utilization by region, decline reasons, allocation fairness, compliance summary. Audit report exportable as PDF.

**FR-13 Settings.** Manage hospitals, regions (including the four allocation policy weights, **selectable per region**), organ types, the blood compatibility matrix, and HLA allele reference data.

**FR-14 Audit trail.** Every change to donors, recipients, organs, offers, waitlist entries and transplant events is logged with the acting user and timestamp.

## 4. Business rules

These are enforced by the database, not the application layer.

| ID | Rule |
|---|---|
| BR-1 | Deceased donors must have a death date; living donors must not |
| BR-2 | An organ is transplantable only within `recovered_at + max_viability_hours` |
| BR-3 | An unplaceable organ is discarded with a recorded reason |
| BR-4 | A recipient may be waitlisted for several organ types independently |
| BR-5 | Hard exclusions (no score compensates): ABO incompatibility, inactive recipient, size ratio out of range, viability unreachable, already offered |
| BR-6 | Match runs are permanent and append-only |
| BR-7 | At most one open offer per organ |
| BR-8 | Unsent offers are cancelled after one hour |
| BR-9 | Sent offers expire after the organ type's response window |
| BR-10 | A recipient who declined an organ is never re-offered it; a voided offer does not count as a decline |
| BR-11 | Acceptance commits to the organ; it does not record surgery |
| BR-12 | Acceptance re-verifies viability and recipient status at the moment of acceptance |
| BR-13 | A transplant cannot be recorded before transport shows delivered |
| BR-14 | A transplant closes only the waitlist entry for that organ's type |

## 5. Non-functional requirements

- Modular React component architecture with reusable primitives
- Consistent neumorphic design system — typography, spacing, colour palette
- Desktop-first, optimized for 1280×1024 and above
- Responsive charts, tables and maps
- Descriptive labels and screen-reader-friendly elements where applicable
- Animations, notifications and status badges for visual feedback
- Mock data organized independently of components, with a switchable data source
- All medical constraints enforced at the database layer so they cannot be bypassed

## 6. Out of scope

Stated deliberately. Each was considered and excluded for a reason.

| Excluded | Why |
|---|---|
| **Role-based access enforcement** | Roles are modelled in the schema and recorded in the audit log, but a single admin account holds full access. Per-hospital row filtering is substantial work with no bearing on the database design being assessed. |
| **Push or email notification** | Offer state is recorded in the system; coordinators communicate out-of-band. Notification delivery is an infrastructure concern, not a data-modelling one. |
| **External hospital system integration** | No HL7 / FHIR interfaces. All data is entered through this system. |
| **Full HLA serotyping** | A simplified three-locus, two-allele model is used. Real typing involves far more loci and cross-match testing that cannot be modelled meaningfully at this scale. |
| **GPS transport tracking** | Transport status is recorded manually at each stage. Live tracking requires hardware integration. |
| **Mobile layout** | Desktop-first by design; coordinators work at workstations. |
| **Consent and legal document management** | Donor consent is assumed recorded elsewhere. Document storage is a separate problem domain. |
| **Re-listing after transplant failure** | A failed transplant records its outcome and closes the waitlist entry. Whether a patient is re-listed is a clinical decision with its own criteria. |
| **Living-donor directed donation** | Living donors are modelled, but donor-recipient pairing outside the matching algorithm is not supported. |

## 7. Success criteria

- All fourteen business rules demonstrably enforced at the database layer, verifiable by attempting to violate each one
- Schema in BCNF with a documented derivation from an unnormalized relation
- Every UI screen backed by real queries against seeded data
- Reports render meaningfully against data with genuine historical depth
- Concurrent allocation of the same organ provably impossible
