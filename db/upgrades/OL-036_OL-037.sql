-- =====================================================================
-- OrganLink upgrade: OL-036 + OL-037
-- Existing installs only. A fresh install needs nothing from this file:
-- db/01_schema.sql already contains these changes.
--
--   OL-036  match_candidates(): ROW_NUMBER() with a deterministic tie-break
--           (match_score DESC, wait_score DESC, listed_date ASC, recipient_id ASC)
--           instead of RANK(), so tied candidates cannot violate ux_match_rank.
--   OL-037  fn_audit(): the key column can be passed as a trigger argument;
--           trg_audit_offer -> 'offer_id', trg_audit_transplant -> 'transplant_id'.
--
-- What it does NOT do: it changes no table, no index, no constraint and no row.
-- audit_log rows written before the upgrade keep row_id = 'composite' for
-- organ_offer / transplant_event (their full row is still in old_values /
-- new_values). Only rows written after the upgrade get the real id.
--
-- Safe to re-run (CREATE OR REPLACE, DROP TRIGGER IF EXISTS), one transaction.
-- Usage (choose the target database explicitly):
--   psql -v ON_ERROR_STOP=1 -X -d <database> -f db/upgrades/OL-036_OL-037.sql
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- --- OL-037 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit() RETURNS TRIGGER AS $$
DECLARE
    v_row_id TEXT;
BEGIN
    v_row_id := CASE TG_OP WHEN 'DELETE'
                THEN to_jsonb(OLD)::TEXT ELSE to_jsonb(NEW)::TEXT END;

    INSERT INTO audit_log(table_name, row_id, action, old_values, new_values, user_id)
    VALUES (
        TG_TABLE_NAME,
        -- Key column: optional trigger argument (organ_offer -> offer_id,
        -- transplant_event -> transplant_id), else <table>_id. waitlist_entry has
        -- a composite key, so it falls back to 'composite'.
        COALESCE(
            (to_jsonb(COALESCE(NEW, OLD)) ->> COALESCE(TG_ARGV[0], TG_TABLE_NAME || '_id')),
            'composite'),
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
        current_app_user()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_offer ON organ_offer;
CREATE TRIGGER trg_audit_offer       AFTER INSERT OR UPDATE OR DELETE ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_audit('offer_id');

DROP TRIGGER IF EXISTS trg_audit_transplant ON transplant_event;
CREATE TRIGGER trg_audit_transplant  AFTER INSERT OR UPDATE OR DELETE ON transplant_event
    FOR EACH ROW EXECUTE FUNCTION fn_audit('transplant_id');

-- --- OL-036 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION match_candidates(
    p_organ_id     BIGINT,
    p_hla_w        NUMERIC DEFAULT NULL,
    p_urgency_w    NUMERIC DEFAULT NULL,
    p_distance_w   NUMERIC DEFAULT NULL,
    p_wait_w       NUMERIC DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_run_id BIGINT;
    v_donor BIGINT; v_donor_bg BIGINT; v_donor_wt NUMERIC;
    v_organ_type BIGINT; v_org_hosp BIGINT;
    v_lat NUMERIC; v_lng NUMERIC;
    v_min_ratio NUMERIC; v_max_ratio NUMERIC;
    v_expires TIMESTAMPTZ;
    w_hla NUMERIC; w_urg NUMERIC; w_dist NUMERIC; w_wait NUMERIC;
BEGIN
    SELECT o.donor_id, d.blood_group_id, d.weight_kg, o.organ_type_id,
           o.recovering_hospital_id, h.latitude, h.longitude,
           ot.min_weight_ratio, ot.max_weight_ratio,
           o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour')
      INTO v_donor, v_donor_bg, v_donor_wt, v_organ_type,
           v_org_hosp, v_lat, v_lng, v_min_ratio, v_max_ratio, v_expires
      FROM organ o
      JOIN donor      d  ON d.donor_id       = o.donor_id
      JOIN hospital   h  ON h.hospital_id    = o.recovering_hospital_id
      JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
     WHERE o.organ_id = p_organ_id;

    IF v_donor IS NULL THEN
        RAISE EXCEPTION 'Organ % not found', p_organ_id USING ERRCODE = 'P0001';
    END IF;

    -- Weights default to the recovering hospital's regional policy.
    SELECT COALESCE(p_hla_w,      reg.hla_weight),
           COALESCE(p_urgency_w,  reg.urgency_weight),
           COALESCE(p_distance_w, reg.distance_weight),
           COALESCE(p_wait_w,     reg.wait_weight)
      INTO w_hla, w_urg, w_dist, w_wait
      FROM hospital h JOIN region reg ON reg.region_id = h.region_id
     WHERE h.hospital_id = v_org_hosp;

    INSERT INTO match_run(organ_id, hla_weight, urgency_weight,
                          distance_weight, wait_weight, run_by)
    VALUES (p_organ_id, w_hla, w_urg, w_dist, w_wait, current_app_user())
    RETURNING run_id INTO v_run_id;

    WITH candidate AS (
        SELECT ws.recipient_id,
               ws.listed_date,
               ws.urgency_score,
               ws.wait_score,
               r.blood_group_id,
               r.weight_kg,
               r.status AS recipient_status,
               ws.status AS waitlist_status,
               haversine_km(v_lat, v_lng, h.latitude, h.longitude) AS km,
               COALESCE(bc.compatible, FALSE) AS abo_ok,
               v_donor_wt / NULLIF(r.weight_kg,0) AS size_ratio,
               -- HLA mismatch: donor antigens absent in the recipient,
               -- with DRB1 weighted double.
               COALESCE((
                   SELECT SUM(CASE WHEN ha.locus = 'DRB1' THEN 2 ELSE 1 END)
                     FROM donor_hla dh
                     JOIN hla_allele ha ON ha.allele_id = dh.allele_id
                    WHERE dh.donor_id = v_donor
                      AND NOT EXISTS (
                          SELECT 1 FROM recipient_hla rh
                           WHERE rh.recipient_id = ws.recipient_id
                             AND rh.allele_id    = dh.allele_id)
               ), 0) AS weighted_mm,
               EXISTS (SELECT 1 FROM organ_offer f
                        WHERE f.organ_id = p_organ_id
                          AND f.recipient_id = ws.recipient_id
                          AND f.status NOT IN ('VOIDED','CANCELLED')) AS already_offered
        FROM v_waitlist_scored ws
        JOIN recipient r ON r.recipient_id = ws.recipient_id
        JOIN hospital  h ON h.hospital_id  = r.hospital_id
        LEFT JOIN blood_compatibility bc
               ON bc.donor_bg_id     = v_donor_bg
              AND bc.recipient_bg_id = r.blood_group_id
        WHERE ws.organ_type_id = v_organ_type
    ),
    evaluated AS (
        SELECT c.*,
               GREATEST(0, (8 - c.weighted_mm) / 8.0 * 100)::NUMERIC(5,2) AS hla_score,
               (100 * exp(-c.km / 500))::NUMERIC(5,2) AS distance_score,
               CASE
                   WHEN NOT c.abo_ok                       THEN 'ABO_INCOMPATIBLE'
                   WHEN c.recipient_status <> 'ACTIVE'     THEN 'RECIPIENT_INACTIVE'
                   WHEN c.waitlist_status  <> 'ACTIVE'     THEN 'RECIPIENT_INACTIVE'
                   WHEN c.already_offered                  THEN 'ALREADY_OFFERED'
                   WHEN c.size_ratio < v_min_ratio
                     OR c.size_ratio > v_max_ratio         THEN 'SIZE_MISMATCH'
                   WHEN now() + (c.km / 500 * INTERVAL '1 hour') > v_expires
                                                           THEN 'VIABILITY_UNREACHABLE'
                   ELSE NULL
               END AS exclusion_code
        FROM candidate c
    ),
    scored AS (
        SELECT e.*,
               ROUND((e.hla_score      * w_hla
                    + e.urgency_score  * w_urg
                    + e.distance_score * w_dist
                    + e.wait_score     * w_wait)
                    / NULLIF(w_hla + w_urg + w_dist + w_wait, 0), 2) AS match_score
        FROM evaluated e
    )
    INSERT INTO match_result(run_id, recipient_id, rank, match_score,
                             hla_score, urgency_score, distance_score,
                             wait_score, distance_km, qualified, exclusion_reason_id)
    SELECT v_run_id,
           s.recipient_id,
           -- ROW_NUMBER, not RANK: ties must still get distinct ranks or ux_match_rank
           -- rejects the whole run. The trailing keys make the order reproducible
           -- (earlier listing first, then lowest recipient_id); recipient_id is a
           -- reproducibility tie-break only, not a clinical fairness claim.
           CASE WHEN s.exclusion_code IS NULL
                THEN ROW_NUMBER() OVER (PARTITION BY (s.exclusion_code IS NULL)
                                        ORDER BY s.match_score DESC, s.wait_score DESC,
                                                 s.listed_date ASC, s.recipient_id ASC)
           END,
           CASE WHEN s.exclusion_code IS NULL THEN s.match_score END,
           s.hla_score, s.urgency_score, s.distance_score, s.wait_score,
           s.km,
           s.exclusion_code IS NULL,
           er.exclusion_reason_id
      FROM scored s
      LEFT JOIN exclusion_reason er ON er.code = s.exclusion_code;

    RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
