-- =====================================================================
-- OrganLink — semantic checks for the historical seed block (OL-040)
-- Defines the session-local view ol040_history_checks(check_name,
-- violations). Every row must report 0 violations.
--
-- Used twice:
--   * db/03_seed_demo.sql includes it after the historical block commits
--     (triggers and FK checks active again) and aborts the load on any
--     violation. The block itself loads with session_replication_role =
--     replica, which skips triggers AND foreign-key checks, so these
--     checks are the proof that the loaded history is valid.
--   * tests/server/seed-history.test.js runs it and reports each check.
--
-- Scope: "history" = organs recovered more than 3 hours before now (the
-- present-day organs are recovered 0.5-2 h before a reset).
-- =====================================================================
CREATE OR REPLACE TEMP VIEW ol040_history_checks AS
WITH
hist_organ AS (
    SELECT o.*, d.weight_kg AS donor_weight, d.blood_group_id AS donor_bg,
           ot.min_weight_ratio, ot.max_weight_ratio,
           ot.response_window_hours * INTERVAL '1 hour' AS response_window,
           o.recovered_at + ot.max_viability_hours * INTERVAL '1 hour' AS expires_at
    FROM organ o
    JOIN donor d       ON d.donor_id = o.donor_id
    JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
    WHERE o.recovered_at < now() - INTERVAL '3 hours'
),
hist_run AS (
    SELECT r.* FROM match_run r JOIN hist_organ ho ON ho.organ_id = r.organ_id
),
hist_offer AS (
    SELECT f.*, ho.expires_at, ho.response_window, ho.organ_type_id, ho.recovered_at,
           ho.donor_weight, ho.donor_bg, ho.min_weight_ratio, ho.max_weight_ratio,
           r.run_at, m.rank AS run_rank, m.qualified AS run_qualified,
           lag(f.status)       OVER w AS prev_status,
           lag(f.responded_at) OVER w AS prev_responded_at,
           lag(m.rank)         OVER w AS prev_rank,
           row_number()        OVER w AS seq
    FROM organ_offer f
    JOIN hist_organ ho       ON ho.organ_id = f.organ_id
    LEFT JOIN match_run r    ON r.run_id = f.run_id
    LEFT JOIN match_result m ON m.run_id = f.run_id AND m.recipient_id = f.recipient_id
    WINDOW w AS (PARTITION BY f.organ_id ORDER BY f.created_at, f.offer_id)
),
accepted AS (
    SELECT f.organ_id, f.recipient_id, f.responded_at, f.run_at, f.expires_at, f.organ_type_id
    FROM hist_offer f WHERE f.status = 'ACCEPTED'
),
run_ranks AS (
    SELECT m.run_id, count(*) AS n, min(m.rank) AS lo, max(m.rank) AS hi, count(DISTINCT m.rank) AS distinct_ranks
    FROM match_result m JOIN hist_run r USING (run_id)
    WHERE m.qualified GROUP BY m.run_id
),
qualified_count AS (
    SELECT r.organ_id, count(*) FILTER (WHERE m.qualified) AS n
    FROM hist_run r LEFT JOIN match_result m USING (run_id) GROUP BY r.organ_id
)
-- 1. Every historical offer is a valid offer from its own run.
SELECT '1a offer recipient not qualified in its own run' AS check_name,
       count(*) FILTER (WHERE run_qualified IS NOT TRUE) AS violations FROM hist_offer
UNION ALL
SELECT '1b historical offer without a match run', count(*) FILTER (WHERE run_id IS NULL) FROM hist_offer
UNION ALL
SELECT '1c offer recipient blood-group incompatible', count(*)
FROM hist_offer f JOIN recipient rc ON rc.recipient_id = f.recipient_id
LEFT JOIN blood_compatibility bc ON bc.donor_bg_id = f.donor_bg AND bc.recipient_bg_id = rc.blood_group_id
WHERE bc.compatible IS NOT TRUE
UNION ALL
SELECT '1d offer recipient outside the weight-ratio band', count(*)
FROM hist_offer f JOIN recipient rc ON rc.recipient_id = f.recipient_id
WHERE f.donor_weight / rc.weight_kg NOT BETWEEN f.min_weight_ratio AND f.max_weight_ratio
UNION ALL
SELECT '1e offer recipient not waitlisted for the organ type by the run date', count(*)
FROM hist_offer f
WHERE NOT EXISTS (SELECT 1 FROM waitlist_entry w
                   WHERE w.recipient_id = f.recipient_id AND w.organ_type_id = f.organ_type_id
                     AND w.listed_date <= f.run_at::date)
UNION ALL
SELECT '1f offer run belongs to another organ (OL-039, all offers)', count(*)
FROM organ_offer f JOIN match_run r ON r.run_id = f.run_id WHERE f.organ_id <> r.organ_id
UNION ALL
-- 2. Rankings.
SELECT '2a qualified ranks not contiguous 1..N', count(*)
FROM run_ranks WHERE lo <> 1 OR hi <> n OR distinct_ranks <> n
UNION ALL
SELECT '2b qualified after an earlier allocation of the same organ type', count(*)
FROM match_result m JOIN hist_run r USING (run_id) JOIN organ o ON o.organ_id = r.organ_id
WHERE m.qualified AND EXISTS (SELECT 1 FROM accepted a
                               WHERE a.recipient_id = m.recipient_id AND a.organ_type_id = o.organ_type_id
                                 AND a.run_at < r.run_at)
UNION ALL
-- 3. Offer chains.
SELECT '3a chain does not follow rank order 1..k', count(*)
FROM hist_offer f WHERE f.run_rank IS DISTINCT FROM f.seq
UNION ALL
SELECT '3b accepted offer is not the last offer of its organ', count(*)
FROM hist_offer f JOIN accepted a ON a.organ_id = f.organ_id
WHERE f.status <> 'ACCEPTED' AND f.created_at > a.responded_at
UNION ALL
SELECT '3c two offers open at the same time', count(*)
FROM hist_offer f
WHERE f.seq > 1
  AND ((f.prev_responded_at IS NULL AND f.prev_status <> 'CANCELLED')
       OR f.prev_responded_at > f.created_at)
UNION ALL
SELECT '3d recipient re-offered an organ after declining it', count(*)
FROM hist_offer a JOIN hist_offer b ON a.organ_id = b.organ_id AND a.recipient_id = b.recipient_id
WHERE a.offer_id <> b.offer_id AND a.status = 'DECLINED' AND b.created_at > a.created_at
UNION ALL
-- 4. Chronology.
SELECT '4a offer created before its run, or created > sent > responded', count(*)
FROM hist_offer
WHERE created_at < run_at OR sent_at < created_at OR responded_at < coalesce(sent_at, created_at)
UNION ALL
SELECT '4b EXPIRED offer not at sent_at + response window', count(*)
FROM hist_offer WHERE status = 'EXPIRED' AND responded_at IS DISTINCT FROM sent_at + response_window
UNION ALL
SELECT '4c viability VOID before viability end', count(*)
FROM hist_offer WHERE status = 'VOIDED' AND void_reason = 'Organ viability window elapsed'
                  AND responded_at < expires_at
UNION ALL
SELECT '4d offer created or answered after viability end (except a viability void)', count(*)
FROM hist_offer
WHERE created_at >= expires_at
   OR (responded_at > expires_at)
UNION ALL
SELECT '4e SENT offer outlived its response window without EXPIRED', count(*)
FROM hist_offer WHERE status IN ('DECLINED', 'ACCEPTED', 'VOIDED') AND responded_at > sent_at + response_window
UNION ALL
SELECT '4f transport departs before acceptance, or arrives before departure', count(*)
FROM transport_record t JOIN accepted a ON a.organ_id = t.organ_id
WHERE t.departed_at < a.responded_at OR t.arrived_at < t.departed_at
UNION ALL
SELECT '4g transplant before delivery or after viability end', count(*)
FROM transplant_event te JOIN organ_offer f ON f.offer_id = te.offer_id
JOIN hist_organ ho ON ho.organ_id = f.organ_id
JOIN transport_record t ON t.organ_id = f.organ_id
WHERE t.arrived_at IS NULL OR te.transplant_at < t.arrived_at OR te.transplant_at > ho.expires_at
UNION ALL
SELECT '4h historical timestamp in the future', count(*)
FROM hist_offer WHERE greatest(created_at, sent_at, responded_at) > now()
UNION ALL
-- 5. Coverage.
SELECT '5a decline-reason codes missing from history', 6 - count(DISTINCT dr.code)
FROM hist_offer f JOIN decline_reason dr ON dr.decline_reason_id = f.decline_reason_id
UNION ALL
SELECT '5b terminal offer statuses missing from history', 5 - count(DISTINCT status)
FROM hist_offer WHERE status IN ('ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED')
UNION ALL
-- 6. Discard reasons.
SELECT '6a NO_SUITABLE_RECIPIENT although candidates qualified', count(*)
FROM hist_organ ho JOIN discard_reason dr USING (discard_reason_id) JOIN qualified_count q USING (organ_id)
WHERE dr.code = 'NO_SUITABLE_RECIPIENT' AND q.n > 0
UNION ALL
SELECT '6b ALL_DECLINED without every qualified candidate declining', count(*)
FROM hist_organ ho JOIN discard_reason dr USING (discard_reason_id) JOIN qualified_count q USING (organ_id)
WHERE dr.code = 'ALL_DECLINED'
  AND (q.n = 0
       OR q.n <> (SELECT count(*) FROM hist_offer f WHERE f.organ_id = ho.organ_id AND f.status = 'DECLINED')
       OR EXISTS (SELECT 1 FROM hist_offer f WHERE f.organ_id = ho.organ_id AND f.status <> 'DECLINED'))
UNION ALL
SELECT '6c VIABILITY_ELAPSED discard without a viability void', count(*)
FROM hist_organ ho JOIN discard_reason dr USING (discard_reason_id)
WHERE dr.code = 'VIABILITY_ELAPSED'
  AND NOT EXISTS (SELECT 1 FROM hist_offer f WHERE f.organ_id = ho.organ_id AND f.status = 'VOIDED'
                    AND f.void_reason = 'Organ viability window elapsed')
UNION ALL
SELECT '6d discarded/expired organ with an accepted offer, except transplant/transport failure', count(*)
FROM hist_organ ho LEFT JOIN discard_reason dr USING (discard_reason_id)
WHERE (ho.status = 'EXPIRED' OR dr.code IN ('NO_SUITABLE_RECIPIENT', 'ALL_DECLINED', 'VIABILITY_ELAPSED'))
  AND EXISTS (SELECT 1 FROM accepted a WHERE a.organ_id = ho.organ_id)
UNION ALL
SELECT '6e TRANSPLANTED organ without ACCEPTED offer, DELIVERED transport and SUCCESS transplant', count(*)
FROM hist_organ ho
WHERE ho.status = 'TRANSPLANTED'
  AND NOT EXISTS (SELECT 1 FROM organ_offer f
                   JOIN transport_record t ON t.organ_id = f.organ_id AND t.status = 'DELIVERED'
                   JOIN transplant_event te ON te.offer_id = f.offer_id AND te.outcome = 'SUCCESS'
                  WHERE f.organ_id = ho.organ_id AND f.status = 'ACCEPTED');
