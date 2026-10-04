# OrganLink — User Flow

**Group A12** | 23CSE202 Database Management Systems

---

## The primary flow: organ to transplant

```
Login → Procure organ → Run match → Create offer → Send → Response
      → Accept → Transport → Deliver → Record transplant → Outcome
```

Seven stages. Each is described below with its failure branches, because the failure paths are where the system's rules actually live.

---

### Stage 1 — Authentication

Coordinator enters username and password. On success, redirect to the dashboard. On failure, the card shakes and shows an error.

Every subsequent request carries the session, and every transaction sets `app.user_id` so that the audit log and `match_run.run_by` record who acted.

---

### Stage 2 — Organ procurement

An organ enters the system from the **donor detail drawer**, not from a registration form. The coordinator opens the donor, clicks Procure Organ, and supplies organ type, recovering hospital, and **the exact recovery timestamp**.

That timestamp starts the viability clock and is read by every downstream guard. Registering organs at donor-registration time would be wrong: a living donor may be registered months before any procurement.

The organ is created with status AVAILABLE.

**Living vs deceased makes no difference here.** Viability is a property of the organ, not the donor — the clock starts when the organ leaves the body either way. The two donor types differ only on the donor record itself, where a deceased donor carries a death date and cause.

---

### Stage 3 — Matching

The Matching Console dropdown lists organs where status is AVAILABLE and viability has not elapsed. Expired organs still appear, greyed out — hiding them would make data look as though it had vanished, and an organ that expired unallocated is a reportable event.

The coordinator sets four weights (defaulting to the recovering hospital's regional policy) and runs the match. The system:

1. Evaluates every active waitlist entry for that organ type
2. Applies five hard exclusion filters
3. Scores and ranks the survivors
4. **Persists the run permanently**

The result panel shows the ranked candidates and, in a collapsible section, the excluded ones with reasons.

**Why runs are persisted.** A saved run is the only durable record of *why* a recipient was selected. Re-running live would mean rankings shift between when a coordinator looks and when they act, and nothing would record that the earlier ranking ever existed. Runs are append-only: Re-run Match creates a new run rather than overwriting. The run timestamp is shown prominently so a stale list is visible as stale.

---

### Stage 4 — Offer creation and sending

An offer is created to the top-ranked candidate, then sent to their hospital.

**One open offer per organ.** If an organ already has a CREATED or SENT offer, Create Offer is disabled with a tooltip. This is enforced by a partial unique index, not by the UI — the UI merely reflects it.

**Unsent offers expire.** A CREATED offer left for more than an hour is cancelled automatically. Without this, a coordinator who created an offer and got distracted would hold that organ hostage permanently, since the only exits from CREATED would be send, accept or decline.

**Sent offers expire** after the organ type's response window — one hour for a heart, six for a kidney.

---

### Stage 5 — Response

**Decline.** The hospital declines with a coded reason. The coordinator clicks Advance to Next.

Advance does not simply take rank N+1. That candidate may have gone inactive, received another organ, or already declined since the run. The system **walks down the ranks** until one passes every guard, and reports which were skipped and why.

A declined recipient is never re-offered that organ. Without this rule, Advance could loop.

**Accept.** The offer becomes ACCEPTED, the organ becomes ALLOCATED, and a transport record is created automatically with origin and destination already known.

Acceptance **re-verifies viability and recipient status inside the transaction**. The response may arrive after the clock ran out, and the UI the hospital was looking at may have been stale. If the organ has expired, acceptance fails with a clear error.

---

### Stage 6 — Transport

Status advances PENDING → IN_TRANSIT → DELIVERED, recorded manually at each stage.

If origin and destination are the same hospital, the record is created already DELIVERED. Requiring someone to click Depart and Deliver for a journey across a corridor would be absurd and would block the transplant.

**The countdown on the Transport page is not a second clock.** It is the same organ viability window, displayed against the journey. There is no separate transport timer.

If viability elapses while in transit, the sweep sets the transport to FAILED and the organ to EXPIRED, and no transplant can then be recorded.

---

### Stage 7 — Transplant

**Recording a transplant is a separate action from accepting an offer.** Acceptance means the hospital has committed; surgery happens hours later, after the organ arrives, and it can fail.

The transplant carries a timestamp, the performing hospital, and an outcome: Success, Failed, or Organ Not Used. It cannot be recorded until transport shows DELIVERED.

On success the organ becomes TRANSPLANTED. On any other outcome it is DISCARDED with a reason.

**Only the waitlist entry for that organ's type is closed.** A kidney-pancreas candidate who received a kidney remains listed for a pancreas. Closing both would silently drop a patient from a list they still need.

A failed transplant does not re-list the recipient — re-listing is a clinical decision and is out of scope.

---

## Failure paths

Four ways the flow ends without a transplant. All four are reachable in the UI.

### The candidate chain runs out

Every ranked candidate declines, or there were few to begin with. The coordinator discards the organ from the Organs tab with a reason — typically "all ranked candidates declined" or "no compatible recipient identified".

Unplaced organs are the metric that matters most in a real network, and this is where that data comes from.

### The organ expires with an offer outstanding

The sweep handles it in one pass: organ → EXPIRED, open offer → VOIDED with a reason, transport → FAILED.

### The recipient becomes unavailable mid-offer

They received a different organ, deteriorated, or died. The sweep voids the offer with the reason "recipient no longer active", freeing the organ for the next candidate.

Without this, the organ would deadlock: no new offer possible because of the one-active-offer rule, and no way to resolve the old one, since the only exits would be accept and decline and neither applies.

**A voided offer is not a decline.** If the recipient becomes available again they may be offered that organ once more, which is why the no-re-offer index excludes VOIDED and CANCELLED.

### The organ is found unsuitable at surgery

Recorded as a transplant with outcome Organ Not Used. The organ is discarded; the waitlist entry is removed rather than marked transplanted.

---

## Secondary flows

**Donor registration.** Demographics, blood group, HLA alleles, height and weight. Type is Living or Deceased; death date and cause appear only for deceased. Type and status are separate fields — a deceased donor may still be active or inactive.

**Recipient registration and waitlisting.** Recipient created, then one waitlist entry per organ type needed, each with its own urgency and listing date. The priority score shown on the Recipients page uses **urgency and waiting time only** — HLA and distance are undefined without a specific donor organ, and the tooltip breaks down only those two components.

**Settings.** Hospitals, regions with their four policy weights (selected per region), organ types with viability and size tolerances, the 8×8 blood compatibility matrix, and HLA allele reference data.

**Reports.** Waiting-time distribution, utilization by region, decline reasons, allocation fairness (allocation rate, median wait, local retention), and a compliance summary. Audit report exports as PDF.
