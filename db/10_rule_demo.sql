-- =====================================================================
-- OrganLink — Business-rule demonstration script (OL-032)
--
-- For each business rule BR-1 .. BR-14 (docs/context/04_prd.md section 4)
-- this script attempts a real violation and records PASS or FAIL. It
-- extends the pattern in docs/context/09_verification_tests.sql.
--
-- Design
--   * One transaction, rolled back at the end: the script leaves no rows
--     behind, so it is safe to run repeatedly on any database (freshly
--     reset or already seeded).
--   * Each rule is one DO block. Every violation attempt runs inside a
--     nested BEGIN/EXCEPTION, so a rejected statement cannot abort the
--     block; the block then asserts the expected outcome and writes
--     exactly one row into the temporary table br_results.
--   * psql variables are deliberately NOT used inside dollar-quoted
--     bodies (psql does not substitute :vars inside $$ ... $$). Ids are
--     resolved with plain SQL, and fixtures shared between blocks are
--     handed over through the temporary table br_state.
--   * PASS/FAIL lines are printed once, at the end, sorted by rule
--     number, so they always read BR-1 .. BR-14 no matter what order the
--     blocks had to run in.
--   * The final gate raises an exception unless exactly 14 result rows
--     exist and none of them failed. With ON_ERROR_STOP that makes psql
--     exit non-zero, which the wrapper db/10_rule_demo.sql.test asserts.
--
-- Usage:  npm run db:rules
--    or:  psql -v ON_ERROR_STOP=1 -d "$DATABASE_URL" -f db/10_rule_demo.sql
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL app.user_id = 1;

CREATE TEMP TABLE br_results (
    rule_no INTEGER PRIMARY KEY,
    ok      BOOLEAN NOT NULL,
    detail  TEXT    NOT NULL
);

CREATE TEMP TABLE br_state (
    k TEXT   PRIMARY KEY,
    v BIGINT NOT NULL
);

-- ---------------------------------------------------------------------
-- Fixtures. Everything is prefixed OL32 so nothing can collide with
-- existing data, and all of it disappears with the final ROLLBACK.
-- Three hospitals: A is the recovering site, B is a normal distant site
-- (8 761 km, reachable inside the 30 h kidney window), C is almost
-- exactly antipodal (19 904 km, unreachable in 30 h).
-- ---------------------------------------------------------------------
INSERT INTO hospital(name,address,phone,latitude,longitude,region_id,status) VALUES
 ('OL32 Hosp A','OL32 demo site A','555-0101',  0.000000,   0.000000,
  (SELECT region_id FROM region WHERE region_code='SR'),'ACTIVE'),
 ('OL32 Hosp B','OL32 demo site B','555-0102', 28.613900,  77.209000,
  (SELECT region_id FROM region WHERE region_code='NR'),'ACTIVE'),
 ('OL32 Hosp C','OL32 demo site C','555-0103',  0.000000, 179.000000,
  (SELECT region_id FROM region WHERE region_code='ER'),'ACTIVE');

INSERT INTO donor(name,date_of_birth,blood_group_id,hospital_id,donor_type,
                  status,height_cm,weight_kg,death_date,death_cause)
VALUES ('OL32 Donor','1985-06-01',
        (SELECT blood_group_id FROM blood_group WHERE group_name='A+'),
        (SELECT hospital_id    FROM hospital   WHERE name='OL32 Hosp A'),
        'DECEASED','ACTIVE',175,70, now() - INTERVAL '1 hour','RTA');

INSERT INTO donor_hla(donor_id, allele_id)
SELECT d.donor_id, a.allele_id
  FROM donor d
  JOIN hla_allele a
    ON a.allele_name IN ('A*01:01','A*02:01','B*07:02','B*08:01','DRB1*03:01','DRB1*15:01')
 WHERE d.name = 'OL32 Donor';

INSERT INTO recipient(name,date_of_birth,blood_group_id,hospital_id,status,height_cm,weight_kg)
SELECT v.name, DATE '1990-01-01',
       (SELECT blood_group_id FROM blood_group WHERE group_name = v.bg),
       (SELECT hospital_id    FROM hospital   WHERE name       = v.hosp),
       v.st, v.ht, v.wt
FROM (VALUES
  ('OL32 R1',       'A+', 'OL32 Hosp A', 'ACTIVE',   170,  70),
  ('OL32 R2',       'A+', 'OL32 Hosp B', 'ACTIVE',   170,  70),
  ('OL32 R3 abo',   'B-', 'OL32 Hosp A', 'ACTIVE',   170,  70),
  ('OL32 R4 size',  'A+', 'OL32 Hosp A', 'ACTIVE',   130,  20),
  ('OL32 R5 inact', 'A+', 'OL32 Hosp A', 'INACTIVE', 170,  70),
  ('OL32 R6 far',   'A+', 'OL32 Hosp C', 'ACTIVE',   170,  70),
  ('OL32 R7 multi', 'A+', 'OL32 Hosp A', 'ACTIVE',   170,  70),
  ('OL32 R8 accept','A+', 'OL32 Hosp B', 'ACTIVE',   170,  70)
) AS v(name,bg,hosp,st,ht,wt);

-- Kidney for everyone; R7 also carries a pancreas entry (BR-14).
INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
SELECT r.recipient_id,
       (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
       (SELECT urgency_id    FROM urgency    WHERE code = '2'),
       CURRENT_DATE - v.days, 'ACTIVE'
FROM (VALUES
  ('OL32 R1',180),('OL32 R2',150),('OL32 R3 abo',120),('OL32 R4 size',90),
  ('OL32 R5 inact',60),('OL32 R6 far',30),('OL32 R7 multi',20),('OL32 R8 accept',10)
) AS v(nm,days)
JOIN recipient r ON r.name = v.nm;

INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
SELECT r.recipient_id,
       (SELECT organ_type_id FROM organ_type WHERE name = 'Pancreas'),
       (SELECT urgency_id    FROM urgency    WHERE code = '2'),
       CURRENT_DATE - 45, 'ACTIVE'
  FROM recipient r WHERE r.name = 'OL32 R7 multi';

INSERT INTO recipient_hla(recipient_id, allele_id)
SELECT r.recipient_id, a.allele_id
  FROM recipient r
  JOIN hla_allele a
    ON a.allele_name IN ('A*01:01','A*02:01','B*07:02','B*08:01','DRB1*03:01','DRB1*15:01')
 WHERE r.name IN ('OL32 R1','OL32 R2');

\echo '== OL-032 business-rule demonstration (fixtures loaded, all rows roll back) =='

-- =====================================================================
-- BR-1 — a deceased donor carries a death date, a living donor does not.
-- Enforcement: CHECK ck_donor_death_fields on donor.
-- =====================================================================
DO $br1$
DECLARE
    v_bg   BIGINT;
    v_hosp BIGINT;
    v_ok1  BOOLEAN := FALSE;
    v_ok2  BOOLEAN := FALSE;
BEGIN
    SELECT blood_group_id INTO v_bg   FROM blood_group WHERE group_name = 'O+';
    SELECT hospital_id    INTO v_hosp FROM hospital    WHERE name = 'OL32 Hosp A';

    -- LIVING donor that claims a death date
    BEGIN
        INSERT INTO donor(name,date_of_birth,blood_group_id,hospital_id,donor_type,
                          status,height_cm,weight_kg,death_date)
        VALUES ('OL32 bad living donor','1990-01-01',v_bg,v_hosp,'LIVING','ACTIVE',170,70, now());
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM LIKE '%ck_donor_death_fields%' THEN v_ok1 := TRUE; END IF;
    END;

    -- DECEASED donor with no death date
    BEGIN
        INSERT INTO donor(name,date_of_birth,blood_group_id,hospital_id,donor_type,
                          status,height_cm,weight_kg,death_date,death_cause)
        VALUES ('OL32 bad deceased donor','1990-01-01',v_bg,v_hosp,'DECEASED','ACTIVE',170,70, NULL,'RTA');
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM LIKE '%ck_donor_death_fields%' THEN v_ok2 := TRUE; END IF;
    END;

    IF NOT (v_ok1 AND v_ok2) THEN
        RAISE EXCEPTION 'death-field check accepted one of them: living-with-death-date rejected=%, deceased-without-death-date rejected=%',
            v_ok1, v_ok2;
    END IF;

    INSERT INTO br_results VALUES (1, TRUE,
        'ck_donor_death_fields rejected a LIVING donor with a death_date and a DECEASED donor without one');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (1, FALSE, SQLERRM);
END $br1$;

-- =====================================================================
-- BR-2 — an organ is only usable inside its viability window. Scope per
-- OL-DEC-02: the sweep expires AVAILABLE organs only; it never claims an
-- organ that is already ALLOCATED or in transit.
-- Enforcement: v_organ.is_expired, trg_offer_viability, sweep step 3.
-- Also prepares the stale offers that BR-8 and BR-9 assert later.
-- =====================================================================
DO $br2$
DECLARE
    v_hospA  BIGINT;
    v_kidney BIGINT;
    v_r1     BIGINT;
    v_r2     BIGINT;
    v_o2     BIGINT;   -- AVAILABLE, 40 h old -> past the 30 h window
    v_o2b    BIGINT;   -- ALLOCATED, 40 h old -> out of scope for the sweep
    v_oc     BIGINT;   -- fresh organ holding the abandoned CREATED offer
    v_os     BIGINT;   -- fresh organ holding the unanswered SENT offer
    v_off_c  BIGINT;
    v_off_s  BIGINT;
    v_exp    BOOLEAN;
    v_ok     BOOLEAN := FALSE;
    v_st     TEXT;
    v_st_b   TEXT;
BEGIN
    SELECT hospital_id    INTO v_hospA  FROM hospital    WHERE name = 'OL32 Hosp A';
    SELECT organ_type_id  INTO v_kidney FROM organ_type  WHERE name = 'Kidney';
    SELECT recipient_id   INTO v_r1     FROM recipient   WHERE name = 'OL32 R1';
    SELECT recipient_id   INTO v_r2     FROM recipient   WHERE name = 'OL32 R2';

    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, v_kidney, v_hospA, now() - INTERVAL '40 hours', 'AVAILABLE'
      FROM donor d WHERE d.name = 'OL32 Donor'
    RETURNING organ_id INTO v_o2;

    SELECT is_expired INTO v_exp FROM v_organ WHERE organ_id = v_o2;
    IF NOT COALESCE(v_exp, FALSE) THEN
        RAISE EXCEPTION 'v_organ.is_expired is FALSE for a kidney recovered 40 h ago';
    END IF;

    -- an offer on that organ must be refused
    BEGIN
        INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o2, v_r1, 'CREATED');
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%viability window%' THEN v_ok := TRUE; END IF;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'an offer on an expired-but-AVAILABLE organ was not refused by the viability guard';
    END IF;

    -- sweep fixture 1: CREATED offer abandoned for two hours (BR-8)
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, v_kidney, v_hospA, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d WHERE d.name = 'OL32 Donor'
    RETURNING organ_id INTO v_oc;

    INSERT INTO organ_offer(organ_id,recipient_id,status,created_at)
    VALUES (v_oc, v_r1, 'CREATED', now() - INTERVAL '2 hours')
    RETURNING offer_id INTO v_off_c;

    -- sweep fixture 2: SENT offer that has outlived the 6 h window (BR-9)
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, v_kidney, v_hospA, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d WHERE d.name = 'OL32 Donor'
    RETURNING organ_id INTO v_os;

    INSERT INTO organ_offer(organ_id,recipient_id,status,created_at)
    VALUES (v_os, v_r2, 'CREATED', now() - INTERVAL '8 hours')
    RETURNING offer_id INTO v_off_s;

    UPDATE organ_offer
       SET status = 'SENT', sent_at = now() - INTERVAL '7 hours'
     WHERE offer_id = v_off_s;

    -- OL-DEC-02 scope check: an ALLOCATED organ past its window stays put
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, v_kidney, v_hospA, now() - INTERVAL '40 hours', 'ALLOCATED'
      FROM donor d WHERE d.name = 'OL32 Donor'
    RETURNING organ_id INTO v_o2b;

    PERFORM expire_stale_offers();

    SELECT status INTO v_st   FROM organ WHERE organ_id = v_o2;
    SELECT status INTO v_st_b FROM organ WHERE organ_id = v_o2b;
    IF v_st <> 'EXPIRED' THEN
        RAISE EXCEPTION 'sweep left the past-window AVAILABLE organ as %', v_st;
    END IF;
    IF v_st_b <> 'ALLOCATED' THEN
        RAISE EXCEPTION 'sweep claimed an ALLOCATED organ, which OL-DEC-02 puts out of scope (status %)', v_st_b;
    END IF;

    INSERT INTO br_state(k,v) VALUES
        ('offer_br8', v_off_c),
        ('offer_br9', v_off_s);

    INSERT INTO br_results VALUES (2, TRUE,
        'v_organ.is_expired read TRUE at 40 h, the offer was refused, the sweep expired the AVAILABLE organ and left the ALLOCATED one alone (OL-DEC-02)');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (2, FALSE, SQLERRM);
END $br2$;

-- =====================================================================
-- BR-3 — an organ is DISCARDED only with a discard reason, and only a
-- DISCARDED organ may carry one.
-- Enforcement: CHECK ck_organ_discard_reason on organ.
-- =====================================================================
DO $br3$
DECLARE
    v_o      BIGINT;
    v_reason BIGINT;
    v_ok1    BOOLEAN := FALSE;
    v_ok2    BOOLEAN := FALSE;
    v_st     TEXT;
    v_rid    BIGINT;
BEGIN
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o;

    SELECT discard_reason_id INTO v_reason FROM discard_reason WHERE code = 'VIABILITY_ELAPSED';

    BEGIN
        UPDATE organ SET status = 'DISCARDED' WHERE organ_id = v_o;
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM LIKE '%ck_organ_discard_reason%' THEN v_ok1 := TRUE; END IF;
    END;

    BEGIN
        UPDATE organ SET discard_reason_id = v_reason WHERE organ_id = v_o;
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM LIKE '%ck_organ_discard_reason%' THEN v_ok2 := TRUE; END IF;
    END;

    IF NOT (v_ok1 AND v_ok2) THEN
        RAISE EXCEPTION 'discard check accepted one of them: discard-without-reason rejected=%, reason-without-discard rejected=%',
            v_ok1, v_ok2;
    END IF;

    UPDATE organ SET status = 'DISCARDED', discard_reason_id = v_reason WHERE organ_id = v_o;
    SELECT status, discard_reason_id INTO v_st, v_rid FROM organ WHERE organ_id = v_o;
    IF v_st <> 'DISCARDED' OR v_rid IS DISTINCT FROM v_reason THEN
        RAISE EXCEPTION 'a valid discard was refused (status %, reason %)', v_st, v_rid;
    END IF;

    INSERT INTO br_results VALUES (3, TRUE,
        'ck_organ_discard_reason required a reason for DISCARDED and refused a reason on any other status');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (3, FALSE, SQLERRM);
END $br3$;

-- =====================================================================
-- BR-4 — one waitlist entry per recipient per organ type; other organ
-- types for the same recipient are allowed.
-- Enforcement: composite PRIMARY KEY (recipient_id, organ_type_id).
-- =====================================================================
DO $br4$
DECLARE
    v_r1     BIGINT;
    v_kidney BIGINT;
    v_liver  BIGINT;
    v_ok     BOOLEAN := FALSE;
    v_n      INT;
BEGIN
    SELECT recipient_id  INTO v_r1     FROM recipient   WHERE name = 'OL32 R1';
    SELECT organ_type_id INTO v_kidney FROM organ_type  WHERE name = 'Kidney';
    SELECT organ_type_id INTO v_liver  FROM organ_type  WHERE name = 'Liver';

    BEGIN
        INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
        SELECT v_r1, v_kidney, urgency_id, CURRENT_DATE, 'ACTIVE'
          FROM urgency WHERE code = '2';
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM LIKE '%waitlist_entry_pkey%' THEN v_ok := TRUE; END IF;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'a second ACTIVE Kidney entry for the same recipient was accepted';
    END IF;

    INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
    SELECT v_r1, v_liver, urgency_id, CURRENT_DATE, 'ACTIVE'
      FROM urgency WHERE code = '2';

    SELECT count(*) INTO v_n FROM waitlist_entry WHERE recipient_id = v_r1;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'expected Kidney + Liver rows for R1 after the duplicate was refused, found %', v_n;
    END IF;

    INSERT INTO br_results VALUES (4, TRUE,
        'composite PK refused a duplicate Kidney entry while a second organ type (Liver) for the same recipient stayed allowed');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (4, FALSE, SQLERRM);
END $br4$;

-- =====================================================================
-- BR-5 — the matching engine excludes every ineligible candidate with a
-- reason, and still qualifies a reachable compatible one.
-- Enforcement: match_candidates() exclusion ladder.
-- =====================================================================
DO $br5$
DECLARE
    v_o    BIGINT;
    v_r1   BIGINT;
    v_run  BIGINT;
    v_code TEXT;
    v_qual BOOLEAN;
BEGIN
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o;

    -- an active offer already exists for R1 on this organ
    SELECT recipient_id INTO v_r1 FROM recipient WHERE name = 'OL32 R1';
    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r1, 'CREATED');

    SELECT match_candidates(v_o) INTO v_run;

    SELECT er.code INTO v_code
      FROM match_result mr
      JOIN exclusion_reason er ON er.exclusion_reason_id = mr.exclusion_reason_id
     WHERE mr.run_id = v_run
       AND mr.recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R3 abo');
    IF v_code IS DISTINCT FROM 'ABO_INCOMPATIBLE' THEN
        RAISE EXCEPTION 'R3 expected ABO_INCOMPATIBLE, got %', COALESCE(v_code,'no exclusion');
    END IF;

    SELECT er.code INTO v_code
      FROM match_result mr
      JOIN exclusion_reason er ON er.exclusion_reason_id = mr.exclusion_reason_id
     WHERE mr.run_id = v_run
       AND mr.recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R4 size');
    IF v_code IS DISTINCT FROM 'SIZE_MISMATCH' THEN
        RAISE EXCEPTION 'R4 expected SIZE_MISMATCH, got %', COALESCE(v_code,'no exclusion');
    END IF;

    SELECT er.code INTO v_code
      FROM match_result mr
      JOIN exclusion_reason er ON er.exclusion_reason_id = mr.exclusion_reason_id
     WHERE mr.run_id = v_run
       AND mr.recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R5 inact');
    IF v_code IS DISTINCT FROM 'RECIPIENT_INACTIVE' THEN
        RAISE EXCEPTION 'R5 expected RECIPIENT_INACTIVE, got %', COALESCE(v_code,'no exclusion');
    END IF;

    SELECT er.code INTO v_code
      FROM match_result mr
      JOIN exclusion_reason er ON er.exclusion_reason_id = mr.exclusion_reason_id
     WHERE mr.run_id = v_run
       AND mr.recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R6 far');
    IF v_code IS DISTINCT FROM 'VIABILITY_UNREACHABLE' THEN
        RAISE EXCEPTION 'R6 expected VIABILITY_UNREACHABLE, got %', COALESCE(v_code,'no exclusion');
    END IF;

    SELECT er.code INTO v_code
      FROM match_result mr
      JOIN exclusion_reason er ON er.exclusion_reason_id = mr.exclusion_reason_id
     WHERE mr.run_id = v_run
       AND mr.recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R1');
    IF v_code IS DISTINCT FROM 'ALREADY_OFFERED' THEN
        RAISE EXCEPTION 'R1 expected ALREADY_OFFERED, got %', COALESCE(v_code,'no exclusion');
    END IF;

    SELECT qualified INTO v_qual
      FROM match_result
     WHERE run_id = v_run
       AND recipient_id = (SELECT recipient_id FROM recipient WHERE name = 'OL32 R2');
    IF COALESCE(v_qual, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'R2 (compatible, reachable at 8 761 km) did not qualify';
    END IF;

    INSERT INTO br_state(k,v) VALUES ('organ_br5', v_o), ('run_br5', v_run);

    INSERT INTO br_results VALUES (5, TRUE,
        'match run excluded ABO_INCOMPATIBLE, SIZE_MISMATCH, RECIPIENT_INACTIVE, VIABILITY_UNREACHABLE and ALREADY_OFFERED with one reason each, and qualified the reachable candidate');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (5, FALSE, SQLERRM);
END $br5$;

-- =====================================================================
-- BR-6 — match runs are append-only: the run id is generated by the
-- database, and re-running matching adds a run instead of rewriting the
-- old one. The API exposes POST /api/matching/runs and GET only; there
-- is no update or delete route (server/routes/matching.js).
-- Enforcement: match_run.run_id GENERATED ALWAYS AS IDENTITY.
-- =====================================================================
DO $br6$
DECLARE
    v_o      BIGINT;
    v_run1   BIGINT;
    v_run2   BIGINT;
    v_before INT;
    v_after  INT;
    v_n2     INT;
    v_runs   INT;
    v_ok_id  BOOLEAN := FALSE;
BEGIN
    SELECT v INTO v_o    FROM br_state WHERE k = 'organ_br5';
    SELECT v INTO v_run1 FROM br_state WHERE k = 'run_br5';
    IF v_o IS NULL OR v_run1 IS NULL THEN
        RAISE EXCEPTION 'depends on the BR-5 fixtures, which are missing';
    END IF;

    BEGIN
        INSERT INTO match_run(run_id, organ_id, hla_weight, urgency_weight,
                              distance_weight, wait_weight, run_by)
        VALUES (999999, v_o, 25, 35, 20, 20, NULL);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = '428C9' AND SQLERRM LIKE '%run_id%' THEN
            v_ok_id := TRUE;
        ELSE
            RAISE EXCEPTION 'unexpected error for an explicit run_id: [%] %', SQLSTATE, SQLERRM;
        END IF;
    END;
    IF NOT v_ok_id THEN
        RAISE EXCEPTION 'match_run accepted an explicitly supplied run_id';
    END IF;

    SELECT count(*) INTO v_before FROM match_result WHERE run_id = v_run1;
    SELECT match_candidates(v_o) INTO v_run2;
    SELECT count(*) INTO v_after FROM match_result WHERE run_id = v_run1;
    SELECT count(*) INTO v_n2    FROM match_result WHERE run_id = v_run2;
    SELECT count(*) INTO v_runs  FROM match_run    WHERE organ_id = v_o;

    IF v_before = 0 THEN
        RAISE EXCEPTION 'the first match run has no results';
    END IF;
    IF v_after <> v_before THEN
        RAISE EXCEPTION 'a re-run rewrote the first run (rows % then %)', v_before, v_after;
    END IF;
    IF v_run2 = v_run1 THEN
        RAISE EXCEPTION 'a re-run reused run_id %', v_run1;
    END IF;
    IF v_n2 = 0 THEN
        RAISE EXCEPTION 'the re-run wrote no results';
    END IF;
    IF v_runs <> 2 THEN
        RAISE EXCEPTION 'expected 2 match runs for the organ, found %', v_runs;
    END IF;

    INSERT INTO br_results VALUES (6, TRUE,
        'match_run refused an explicit run_id (428C9) and a re-run appended a second run while the first stayed intact');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (6, FALSE, SQLERRM);
END $br6$;

-- =====================================================================
-- BR-7 — at most one active (CREATED or SENT) offer per organ.
-- Enforcement: partial unique index ux_offer_active.
-- =====================================================================
DO $br7$
DECLARE
    v_o   BIGINT;
    v_r1  BIGINT;
    v_r2  BIGINT;
    v_ok  BOOLEAN := FALSE;
    v_n   INT;
BEGIN
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o;

    SELECT recipient_id INTO v_r1 FROM recipient WHERE name = 'OL32 R1';
    SELECT recipient_id INTO v_r2 FROM recipient WHERE name = 'OL32 R2';

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r1, 'CREATED');

    BEGIN
        INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r2, 'CREATED');
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM LIKE '%ux_offer_active%' THEN v_ok := TRUE; END IF;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'a second active offer on the same organ was accepted';
    END IF;

    SELECT count(*) INTO v_n
      FROM organ_offer
     WHERE organ_id = v_o AND status IN ('CREATED','SENT');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 active offer on the organ, found %', v_n;
    END IF;

    INSERT INTO br_results VALUES (7, TRUE,
        'ux_offer_active refused a second CREATED offer on the same organ; exactly one active offer remains');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (7, FALSE, SQLERRM);
END $br7$;

-- =====================================================================
-- BR-8 — a CREATED offer nobody sent within an hour is cancelled by the
-- sweep, otherwise it would hold ux_offer_active forever.
-- Enforcement: expire_stale_offers() step 2 (fixture built in BR-2).
-- =====================================================================
DO $br8$
DECLARE
    v_off BIGINT;
    v_st  TEXT;
    v_cat TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT v INTO v_off FROM br_state WHERE k = 'offer_br8';
    IF v_off IS NULL THEN
        RAISE EXCEPTION 'the stale CREATED offer fixture from BR-2 is missing';
    END IF;

    SELECT status, created_at INTO v_st, v_cat
      FROM organ_offer WHERE offer_id = v_off;

    IF now() <= v_cat + INTERVAL '1 hour' THEN
        RAISE EXCEPTION 'fixture is not older than the one-hour window';
    END IF;
    IF v_st <> 'CANCELLED' THEN
        RAISE EXCEPTION 'expected CANCELLED after the sweep, found %', v_st;
    END IF;

    INSERT INTO br_results VALUES (8, TRUE,
        'expire_stale_offers step 2 cancelled a CREATED offer abandoned for two hours');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (8, FALSE, SQLERRM);
END $br8$;

-- =====================================================================
-- BR-9 — a SENT offer that outlives the organ type response window
-- (6 h for Kidney) expires automatically.
-- Enforcement: expire_stale_offers() step 1 (fixture built in BR-2).
-- =====================================================================
DO $br9$
DECLARE
    v_off BIGINT;
    v_st  TEXT;
    v_sent TIMESTAMP WITH TIME ZONE;
    v_resp TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT v INTO v_off FROM br_state WHERE k = 'offer_br9';
    IF v_off IS NULL THEN
        RAISE EXCEPTION 'the stale SENT offer fixture from BR-2 is missing';
    END IF;

    SELECT status, sent_at, responded_at INTO v_st, v_sent, v_resp
      FROM organ_offer WHERE offer_id = v_off;

    IF v_sent IS NULL OR now() <= v_sent + INTERVAL '6 hours' THEN
        RAISE EXCEPTION 'fixture has not outlived the six-hour response window';
    END IF;
    IF v_st <> 'EXPIRED' THEN
        RAISE EXCEPTION 'expected EXPIRED after the sweep, found %', v_st;
    END IF;
    IF v_resp IS NULL THEN
        RAISE EXCEPTION 'expired offer carries no responded_at timestamp';
    END IF;

    INSERT INTO br_results VALUES (9, TRUE,
        'expire_stale_offers step 1 expired a SENT offer past the 6 h Kidney response window and stamped responded_at');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (9, FALSE, SQLERRM);
END $br9$;

-- =====================================================================
-- BR-10 — a recipient who declined an organ is never offered it again,
-- while the organ may still be advanced to the next candidate.
-- Enforcement: partial unique index ux_offer_no_reoffer.
-- =====================================================================
DO $br10$
DECLARE
    v_o    BIGINT;
    v_r1   BIGINT;
    v_r2   BIGINT;
    v_off  BIGINT;
    v_ok   BOOLEAN := FALSE;
    v_n    INT;
BEGIN
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o;

    SELECT recipient_id INTO v_r1 FROM recipient WHERE name = 'OL32 R1';
    SELECT recipient_id INTO v_r2 FROM recipient WHERE name = 'OL32 R2';

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r1, 'CREATED')
    RETURNING offer_id INTO v_off;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off;
    UPDATE organ_offer
       SET status = 'DECLINED', responded_at = now(),
           decline_reason_id = (SELECT decline_reason_id FROM decline_reason WHERE code = 'ORGAN_QUALITY')
     WHERE offer_id = v_off;

    BEGIN
        INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r1, 'CREATED');
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM LIKE '%ux_offer_no_reoffer%' THEN v_ok := TRUE; END IF;
    END;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'the organ was re-offered to the recipient who declined it';
    END IF;

    -- the same organ may still move on to the next candidate
    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r2, 'CREATED');
    SELECT count(*) INTO v_n FROM organ_offer WHERE organ_id = v_o;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'expected the declined offer plus one offer to the next candidate, found %', v_n;
    END IF;

    INSERT INTO br_results VALUES (10, TRUE,
        'ux_offer_no_reoffer refused a second offer to the decliner while the organ could still advance to the next candidate');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (10, FALSE, SQLERRM);
END $br10$;

-- =====================================================================
-- BR-11 — accepting an offer allocates the organ and creates the
-- transport record; it does not record a transplant.
-- Enforcement: trg_offer_accepted cascade (fn_offer_accepted).
-- =====================================================================
DO $br11$
DECLARE
    v_o   BIGINT;
    v_r2  BIGINT;
    v_off BIGINT;
    v_org TEXT;
    v_tr  TEXT;
    v_n   INT;
BEGIN
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o;

    SELECT recipient_id INTO v_r2 FROM recipient WHERE name = 'OL32 R2';

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r2, 'CREATED')
    RETURNING offer_id INTO v_off;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off;
    UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = v_off;

    SELECT status INTO v_org FROM organ WHERE organ_id = v_o;
    IF v_org <> 'ALLOCATED' THEN
        RAISE EXCEPTION 'accepted offer left the organ in %', v_org;
    END IF;

    SELECT status INTO v_tr FROM transport_record WHERE organ_id = v_o;
    IF v_tr IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'expected a PENDING cross-hospital transport, found %', COALESCE(v_tr,'no record');
    END IF;

    SELECT count(*) INTO v_n FROM transplant_event WHERE offer_id = v_off;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'acceptance recorded a transplant event on its own';
    END IF;

    INSERT INTO br_results VALUES (11, TRUE,
        'acceptance moved the organ to ALLOCATED and created a PENDING transport record, with no transplant event');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (11, FALSE, SQLERRM);
END $br11$;

-- =====================================================================
-- BR-12 — acceptance re-verifies viability and recipient status inside
-- the transaction, because the accepting hospital may be looking at a
-- stale screen.
-- Enforcement: trg_accept_recheck (fn_accept_recheck).
-- =====================================================================
DO $br12$
DECLARE
    v_o1   BIGINT;
    v_o2   BIGINT;
    v_off1 BIGINT;
    v_off2 BIGINT;
    v_r1   BIGINT;
    v_r8   BIGINT;
    v_ok1  BOOLEAN := FALSE;
    v_ok2  BOOLEAN := FALSE;
    v_n    INT;
    v_t    INT;
BEGIN
    SELECT recipient_id INTO v_r1 FROM recipient WHERE name = 'OL32 R1';
    SELECT recipient_id INTO v_r8 FROM recipient WHERE name = 'OL32 R8 accept';

    -- (a) the organ ages past its window between offer and acceptance
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o1;

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o1, v_r1, 'CREATED')
    RETURNING offer_id INTO v_off1;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off1;
    UPDATE organ SET recovered_at = now() - INTERVAL '40 hours' WHERE organ_id = v_o1;

    BEGIN
        UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = v_off1;
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%expired before acceptance%' THEN v_ok1 := TRUE; END IF;
    END;

    -- (b) the recipient is deactivated between offer and acceptance
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o2;

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o2, v_r8, 'CREATED')
    RETURNING offer_id INTO v_off2;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off2;
    UPDATE recipient SET status = 'INACTIVE' WHERE recipient_id = v_r8;

    BEGIN
        UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = v_off2;
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%no longer active%' THEN v_ok2 := TRUE; END IF;
    END;

    IF NOT (v_ok1 AND v_ok2) THEN
        RAISE EXCEPTION 're-check accepted one of them: expired-organ rejected=%, inactive-recipient rejected=%',
            v_ok1, v_ok2;
    END IF;

    SELECT count(*) INTO v_n FROM organ_offer WHERE offer_id IN (v_off1, v_off2) AND status = 'ACCEPTED';
    IF v_n <> 0 THEN
        RAISE EXCEPTION '% of the re-checked offers reached ACCEPTED anyway', v_n;
    END IF;
    SELECT count(*) INTO v_t FROM transport_record WHERE organ_id IN (v_o1, v_o2);
    IF v_t <> 0 THEN
        RAISE EXCEPTION 'acceptance cascade fired despite the re-check (% transport records)', v_t;
    END IF;

    INSERT INTO br_results VALUES (12, TRUE,
        'fn_accept_recheck refused an expired organ and a deactivated recipient at acceptance, and neither cascade fired');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (12, FALSE, SQLERRM);
END $br12$;

-- =====================================================================
-- BR-13 — a transplant may only be recorded once the organ has been
-- delivered, and only for an accepted offer. Scope per OL-DEC-02: the
-- gate is the DELIVERED state of the transport record.
-- Enforcement: trg_transplant_requires_delivery.
-- =====================================================================
DO $br13$
DECLARE
    v_o1   BIGINT;
    v_o2   BIGINT;
    v_off1 BIGINT;
    v_off2 BIGINT;
    v_r1   BIGINT;
    v_r2   BIGINT;
    v_hosp BIGINT;
    v_ok1  BOOLEAN := FALSE;
    v_ok2  BOOLEAN := FALSE;
    v_tr   TEXT;
    v_n    INT;
BEGIN
    SELECT hospital_id  INTO v_hosp FROM hospital  WHERE name = 'OL32 Hosp A';
    SELECT recipient_id INTO v_r1   FROM recipient WHERE name = 'OL32 R1';
    SELECT recipient_id INTO v_r2   FROM recipient WHERE name = 'OL32 R2';

    -- (a) accepted, but the transport has not arrived
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o1;

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o1, v_r2, 'CREATED')
    RETURNING offer_id INTO v_off1;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off1;
    UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = v_off1;

    SELECT status INTO v_tr FROM transport_record WHERE organ_id = v_o1;
    IF v_tr IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'expected PENDING transport before the gate test, found %', COALESCE(v_tr,'none');
    END IF;

    BEGIN
        INSERT INTO transplant_event(offer_id,hospital_id,outcome) VALUES (v_off1, v_hosp, 'SUCCESS');
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%has not been delivered%' THEN v_ok1 := TRUE; END IF;
    END;

    -- (b) the organ never left the theatre: the offer is not accepted
    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, ot.organ_type_id, h.hospital_id, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d, organ_type ot, hospital h
     WHERE d.name='OL32 Donor' AND ot.name='Kidney' AND h.name='OL32 Hosp A'
    RETURNING organ_id INTO v_o2;

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o2, v_r1, 'CREATED')
    RETURNING offer_id INTO v_off2;

    BEGIN
        INSERT INTO transplant_event(offer_id,hospital_id,outcome) VALUES (v_off2, v_hosp, 'SUCCESS');
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%is not accepted%' THEN v_ok2 := TRUE; END IF;
    END;

    IF NOT (v_ok1 AND v_ok2) THEN
        RAISE EXCEPTION 'gate accepted one of them: undelivered rejected=%, unaccepted-offer rejected=%',
            v_ok1, v_ok2;
    END IF;

    SELECT count(*) INTO v_n FROM transplant_event WHERE offer_id IN (v_off1, v_off2);
    IF v_n <> 0 THEN
        RAISE EXCEPTION '% transplant events were recorded anyway', v_n;
    END IF;

    INSERT INTO br_results VALUES (13, TRUE,
        'transplant was refused while the transport was PENDING (OL-DEC-02: delivery gate) and while the offer was not accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (13, FALSE, SQLERRM);
END $br13$;

-- =====================================================================
-- BR-14 — a successful transplant closes only the waitlist entry for
-- that organ type; other entries of a multi-organ candidate stay listed.
-- Enforcement: trg_transplant_recorded (fn_transplant_recorded).
-- =====================================================================
DO $br14$
DECLARE
    v_o       BIGINT;
    v_off     BIGINT;
    v_r7      BIGINT;
    v_r1      BIGINT;
    v_hosp    BIGINT;
    v_kidney  BIGINT;
    v_pancreas BIGINT;
    v_org     TEXT;
    v_tr      TEXT;
    v_wl_k    TEXT;
    v_wl_p    TEXT;
    v_wl_r1   TEXT;
BEGIN
    SELECT hospital_id   INTO v_hosp    FROM hospital   WHERE name = 'OL32 Hosp A';
    SELECT recipient_id  INTO v_r7      FROM recipient  WHERE name = 'OL32 R7 multi';
    SELECT recipient_id  INTO v_r1      FROM recipient  WHERE name = 'OL32 R1';
    SELECT organ_type_id INTO v_kidney  FROM organ_type WHERE name = 'Kidney';
    SELECT organ_type_id INTO v_pancreas FROM organ_type WHERE name = 'Pancreas';

    INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
    SELECT d.donor_id, v_kidney, v_hosp, now() - INTERVAL '10 minutes', 'AVAILABLE'
      FROM donor d WHERE d.name = 'OL32 Donor'
    RETURNING organ_id INTO v_o;

    INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o, v_r7, 'CREATED')
    RETURNING offer_id INTO v_off;
    UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = v_off;
    UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = v_off;

    -- same hospital: the cascade marks the transport delivered at once
    SELECT status INTO v_tr FROM transport_record WHERE organ_id = v_o;
    IF v_tr IS DISTINCT FROM 'DELIVERED' THEN
        RAISE EXCEPTION 'expected an immediately DELIVERED same-hospital transport, found %', COALESCE(v_tr,'none');
    END IF;

    INSERT INTO transplant_event(offer_id,hospital_id,outcome) VALUES (v_off, v_hosp, 'SUCCESS');

    SELECT status INTO v_org FROM organ WHERE organ_id = v_o;
    IF v_org <> 'TRANSPLANTED' THEN
        RAISE EXCEPTION 'organ ended as %, expected TRANSPLANTED', v_org;
    END IF;

    SELECT w.status INTO v_wl_k FROM waitlist_entry w
     WHERE w.recipient_id = v_r7 AND w.organ_type_id = v_kidney;
    IF v_wl_k <> 'TRANSPLANTED' THEN
        RAISE EXCEPTION 'kidney waitlist entry ended as %, expected TRANSPLANTED', v_wl_k;
    END IF;

    SELECT w.status INTO v_wl_p FROM waitlist_entry w
     WHERE w.recipient_id = v_r7 AND w.organ_type_id = v_pancreas;
    IF v_wl_p IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'the unrelated pancreas entry was closed too (status %)', v_wl_p;
    END IF;

    SELECT w.status INTO v_wl_r1 FROM waitlist_entry w
     WHERE w.recipient_id = v_r1 AND w.organ_type_id = v_kidney;
    IF v_wl_r1 IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'another recipients kidney entry changed to %', v_wl_r1;
    END IF;

    INSERT INTO br_results VALUES (14, TRUE,
        'success closed only the transplanted kidney entry; the same recipients pancreas entry and every other kidney entry stayed ACTIVE');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO br_results VALUES (14, FALSE, SQLERRM);
END $br14$;

-- =====================================================================
-- Report and gate
-- =====================================================================
DO $report$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT rule_no, ok, detail FROM br_results ORDER BY rule_no LOOP
        IF r.ok THEN
            RAISE NOTICE 'BR-% PASS: %', r.rule_no, r.detail;
        ELSE
            RAISE NOTICE 'BR-% FAIL: %', r.rule_no, r.detail;
        END IF;
    END LOOP;
END $report$;

DO $gate$
DECLARE
    v_total  INT;
    v_bad    INT;
    v_bad_ids TEXT;
    v_missing TEXT;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO v_total, v_bad FROM br_results;

    IF v_total <> 14 THEN
        SELECT string_agg('BR-' || n::TEXT, ', ' ORDER BY n) INTO v_missing
          FROM generate_series(1,14) n
         WHERE NOT EXISTS (SELECT 1 FROM br_results r WHERE r.rule_no = n);
        RAISE EXCEPTION 'rule demo incomplete: expected 14 results, got % (missing %)',
            v_total, COALESCE(v_missing,'none');
    END IF;

    IF v_bad > 0 THEN
        SELECT string_agg('BR-' || rule_no::TEXT, ', ' ORDER BY rule_no) INTO v_bad_ids
          FROM br_results WHERE NOT ok;
        RAISE EXCEPTION 'rule demo failed: % of 14 rules failed (%)', v_bad, v_bad_ids;
    END IF;

    RAISE NOTICE 'OL-032 result: 14 of 14 business rules passed';
END $gate$;

ROLLBACK;

\echo 'db/10_rule_demo.sql: transaction rolled back, no rows persisted'
