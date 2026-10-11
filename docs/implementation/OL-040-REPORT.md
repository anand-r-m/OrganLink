# OL-040 — Historical seed: coherent match results and offer chains — Report

Status: **complete** on the disposable cluster (localhost:5433, marker
`ORGANLINK-DISPOSABLE-5433`, API test port 3098). The live QA database was not touched
(read-only check afterwards: unchanged counts, no OL-039 constraints). Nothing committed or pushed.
No browser was used.

## 1. Problem

The OL-031 history contained offers to blood-group-incompatible recipients and to recipients absent
from their own run, takers counted as eligible in runs after their own transplant, qualified ranks
with gaps, takers ranked below candidates who were never offered the organ, transports departing
before acceptance, overlapping open offers, an EXPIRED offer and a viability void before their
deadlines, and a NO_SUITABLE_RECIPIENT discard with nine qualified candidates.

## 2. Files

| File | Change |
|---|---|
| `db/03_seed_demo.sql` | Historical block only: match results and offer chains regenerated; transport/transplant timestamps derived from acceptance; ALL_DECLINED discard rule; `ORDER BY n` / `ORDER BY org` on historical inserts; post-load validation. Present-day block (lines 1–181) byte-identical to HEAD. |
| `db/history_checks.sql` | New. Defines the session view `ol040_history_checks` (27 named checks). Used by the seed after loading and by the test suite. |
| `tests/server/seed-history.test.js` | One assertion replaced (see §6); two tests added. |

## 3. Generator design

Unchanged inputs: the 25-row timeline, people, waitlists, organs and final statuses, takers, transplant
outcomes, transport destinations.

- **Eligibility at run time.** A timeline recipient is ACTIVE up to and including their own run.
  After an accepted chain (allocation) they are excluded from later runs. A timeline recipient whose
  chain did not end in acceptance keeps their current status afterwards. Everyone else uses their
  current status.
- **Ranks.** `ROW_NUMBER()` over qualified rows only, ordered `match_score DESC, wait_score DESC,
  listed_date ASC, recipient_id ASC` (OL-036), so qualified ranks are 1..N.
- **Chains** (derived from the ranking):

  | Chain type | Timeline outcome | Offers |
  |---|---|---|
  | ACCEPT | SUCCESS, FAILED, NOT_USED, DISCARD_TF | ranks 1..k−1 per cycle, then the taker (rank k) ACCEPTED |
  | VOID_VIABILITY | DISCARD_VE with a recipient | prior ranks, then that recipient's offer VOIDED at viability end |
  | TAKER_LOST | EXPIRED with a recipient | prior ranks, then VOIDED "Recipient no longer active" if inactive today, else CANCELLED |
  | ALL_DECLINED | DISCARD_NSR with ≥ 1 qualified | every qualified candidate DECLINED; discard reason ALL_DECLINED |
  | NONE | no qualified candidate | no offers |

- **Prior-offer cycle** (over prior offers ordered by `n DESC, rank`): DECLINED RECIPIENT_UNFIT,
  DECLINED ORGAN_QUALITY, EXPIRED, DECLINED LOGISTICS, DECLINED SIZE_MISMATCH, CANCELLED,
  DECLINED RECIPIENT_REFUSED, DECLINED OTHER. ALL_DECLINED chains cycle the six decline codes.
- **Timing.** First offer 5 min after the run; each next offer 5 min after the previous closes.
  DECLINED/ACCEPTED: sent +5 min, answered +20 min. EXPIRED: answered exactly at sent + response
  window. CANCELLED: withdrawn before sending (no cancel time is recorded, as in the live system).
  Same-hospital transport delivered at acceptance (as `trg_offer_accepted`); otherwise departs
  15 min after acceptance and arrives 2 h later. Transplant 30 min after arrival.
- **EXPIRED budget rule.** An EXPIRED step is kept only if the chain, plus 3 h for transport and
  transplant, ends before both the viability deadline and the load time; otherwise it becomes a
  LOGISTICS decline. It fired once (month 0, recovered 8 h before load). Without it, the first load
  produced 3 future timestamps; the post-load validation rejected that load (exit 3).
- **Loading.** The block still runs with `session_replication_role = replica`, because the workflow
  triggers reason about `now()` and would reject or rewrite historical rows, and audit rows must not
  describe history. Replica mode skips triggers **and foreign-key checks**, so after `COMMIT` the
  seed runs `db/history_checks.sql` with both active again and aborts on any violation.

## 4. Before/after manifest (fresh reset each; business keys, not ids)

**Unchanged** (verified identical): donors, donor death-to-recovery offsets, recipients and HLA,
donor HLA, waitlist entries, historical organs and final statuses, present-day organs, takers,
transplant recipients/hospitals/outcomes, transport origins/destinations/statuses, reference data,
utilization view, compliance summary, fairness waitlist size / transplants / allocation rate /
retention, waiting-time distribution, 12-month trend, and the named present-day matching scenario
(match on the three present-day organs, 47 result rows).

**Intentionally changed:**

| Value | Before | After |
|---|---|---|
| Historical offers | 30 | 60 |
| ACCEPTED / DECLINED / EXPIRED / CANCELLED / VOIDED | 20 / 6 / 1 / 1 / 2 | 20 / 31 / 3 / 4 / 2 |
| Declines LOGISTICS / ORGAN_QUALITY / OTHER / RECIPIENT_REFUSED / RECIPIENT_UNFIT / SIZE_MISMATCH | 1 each (16.67%) | 7 / 6 / 4 / 4 / 6 / 4 (22.58 / 19.35 / 12.90 / 12.90 / 19.35 / 12.90%) |
| Discard NO_SUITABLE_RECIPIENT → ALL_DECLINED | 1 / 0 | 0 / 1 (month 20, 9 qualified) |
| Qualified/excluded per run | e.g. month 0: 19/1 | e.g. month 0: 13/7 (rank gaps and post-allocation candidates removed) |
| Transport and transplant timestamps | fixed +1 h / +3 h / +5 h | derived from acceptance (transplant +1 h 15 min … +12 h 50 min) |
| Dashboard recent offers (top 5) | mixed months | month-0 chain (1 accepted, 4 declined) |

**Time-sensitive (do not compare literally):** fairness median wait days moved by ≤ 0.2 day because
transplant timestamps changed (Eastern 259.6 → 259.5, Northern 304.6 → 304.4, Southern 531.6 →
531.6, Western 761.6 → 761.8); waiting-time buckets, priority scores, trend months and the
month-0 times are all relative to the reset.

**Determinism:** two independent fresh resets produced identical output in all 28 exported
sections (60 offers, 228 results, all KEEP/REPORT sections, the present-day match).

## 5. Validation (disposable cluster; each suite on its own fresh reset)

| Command | Result |
|---|---|
| `db/history_checks.sql` (27 checks) | 0 violations each (also enforced at every reset) |
| `node --test tests/server/seed-history.test.js tests/server/seed-demo.test.js tests/server/offer-run-organ.test.js` | 24/24, exit 0 |
| `npm run test:server` | **199/199**, exit 0 |
| `npm run db:rules` | 14/14 PASS, exit 0 |
| `npm run smoke` (BASE_URL :3098) | 20 PASS, `SMOKE OK`, exit 0 |
| `npm run concurrency` (BASE_URL :3098) | 1 success / 9 conflicts / 1 accept / 1 transport, exit 0 |
| `npm run test:client` / `test:docs` / `lint` | 169/169, 10/10, exit 0 (0 errors) |
| OL-039 upgrade: HEAD install → OL-036_037 → OL-039 (+ re-run) | exit 0; data manifest unchanged; schema identical to a fresh install |
| HEAD schema upgraded, then the new seed loaded | exit 0; post-load validation passed; 0 provenance mismatches; schema identical to fresh |
| `tests/09_verification_fixed.sql` (schema + reference only) | sections 1–10 pass (5 PASS notices); exit 3 at the known, pre-existing section-11 setup failure; output identical to the OL-039 run (the script does not use the demo seed) |

## 6. Expected-output change in an existing test

`seed-history.test.js` asserted that every historical run had a qualified candidate. Under the
corrected eligibility rule, month 14 (a Heart that expired unallocated) has none: the recipients the
old seed qualified there had already been allocated. The assertion is replaced by a stricter one:
a run without a qualified candidate must have no offers and its organ must end EXPIRED or
NO_SUITABLE_RECIPIENT; excluded candidates must still exist in history.

## 7. Remaining limitations

- Present-day recipients appear in historical decline chains (approved). This does not change their
  present-day eligibility (verified: identical present-day matching output).
- Historical eligibility uses today's status for people who are not timeline recipients (the seed
  has no status history). For example Tara Menon (waitlist REMOVED today) would be read as
  inactive in every run; in the generated history she appears in two runs (months 2 and 7) and is
  excluded ABO_INCOMPATIBLE in both.
- Rule 1 is applied as approved to every accepted chain, including the NOT_USED (Srinivasan Rajan)
  and transport-failure (Sarita Mahajan) chains, although both are still ACTIVE on the waitlist today.
- The 2-hour transport time and the 20-minute response for decline/accept are fixed modelling
  values, not derived from distance or clinical data.
- The historical block is time-relative; reports and screenshots must record when they were taken.
- `submission/organlink.sql` still holds the pre-OL-036 schema and the old history.
