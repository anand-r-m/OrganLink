BEGIN;
SET LOCAL app.user_id = 1;

INSERT INTO hospital(name,address,phone,latitude,longitude,region_id,status) VALUES
 ('Amrita Kochi','Kochi','111',9.9312,76.2673,(SELECT region_id FROM region WHERE region_code='SR'),'ACTIVE'),
 ('Apollo Chennai','Chennai','222',13.0827,80.2707,(SELECT region_id FROM region WHERE region_code='SR'),'ACTIVE'),
 ('Fortis Delhi','Delhi','333',28.6139,77.2090,(SELECT region_id FROM region WHERE region_code='NR'),'ACTIVE');

INSERT INTO donor(name,date_of_birth,blood_group_id,hospital_id,donor_type,status,height_cm,weight_kg,death_date,death_cause)
VALUES ('Donor One','1980-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='A-'),
        1,'DECEASED','ACTIVE',175,70, now()-interval '2 hours','RTA')
RETURNING donor_id AS did \gset
INSERT INTO donor_hla(donor_id,allele_id)
SELECT :did,allele_id FROM hla_allele WHERE allele_name IN ('A*01:01','A*02:01','B*07:02','B*08:01','DRB1*03:01','DRB1*15:01');

INSERT INTO recipient(name,date_of_birth,blood_group_id,hospital_id,status,height_cm,weight_kg) VALUES
 ('R1 good HLA near','1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='A+'),1,'ACTIVE',170,68),
 ('R2 urgent far',   '1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='AB+'),3,'ACTIVE',172,72),
 ('R3 ABO incompat', '1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='B+'),2,'ACTIVE',170,70),
 ('R4 size mismatch','1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='A+'),2,'ACTIVE',150,25),
 ('R5 backup',       '1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='A+'),2,'ACTIVE',168,66);

SELECT recipient_id AS r1 FROM recipient WHERE name='R1 good HLA near' \gset
SELECT recipient_id AS r2 FROM recipient WHERE name='R2 urgent far' \gset
SELECT recipient_id AS r3 FROM recipient WHERE name='R3 ABO incompat' \gset
SELECT recipient_id AS r5 FROM recipient WHERE name='R5 backup' \gset

INSERT INTO recipient_hla(recipient_id,allele_id)
SELECT :r1,allele_id FROM hla_allele WHERE allele_name IN ('A*01:01','A*02:01','B*07:02','B*08:01','DRB1*03:01');
INSERT INTO recipient_hla(recipient_id,allele_id)
SELECT :r2,allele_id FROM hla_allele WHERE allele_name IN ('A*11:01','A*24:02','B*35:01');

INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
SELECT r.recipient_id, 1, (SELECT urgency_id FROM urgency WHERE code=v.u), CURRENT_DATE - v.d, 'ACTIVE'
FROM (VALUES ('R1 good HLA near','2',400),('R2 urgent far','1A',30),('R3 ABO incompat','1A',200),
             ('R4 size mismatch','1B',100),('R5 backup','2',150)) AS v(nm,u,d)
JOIN recipient r ON r.name = v.nm;
INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
VALUES (:r1,4,(SELECT urgency_id FROM urgency WHERE code='2'),CURRENT_DATE-300,'ACTIVE');

INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
VALUES (:did,1,1, now()-interval '30 minutes','AVAILABLE') RETURNING organ_id AS oid \gset

\echo ''
\echo '=== 1. MATCH RUN ==='
SELECT match_candidates(:oid) AS run_id \gset
SELECT mr.rank, r.name, mr.match_score, mr.hla_score, mr.urgency_score, mr.distance_score, ROUND(mr.distance_km) km
FROM match_result mr JOIN recipient r USING (recipient_id) WHERE mr.qualified ORDER BY mr.rank;

\echo '=== 2. EXCLUSIONS ==='
SELECT r.name, er.code FROM match_result mr JOIN recipient r USING (recipient_id)
JOIN exclusion_reason er USING (exclusion_reason_id) WHERE NOT mr.qualified ORDER BY r.name;

\echo '=== 3. ABO GUARD TRIGGER ==='
SAVEPOINT s3;
DO $$ DECLARE v_o BIGINT; v_r BIGINT; BEGIN
  SELECT organ_id INTO v_o FROM organ ORDER BY organ_id LIMIT 1;
  SELECT recipient_id INTO v_r FROM recipient WHERE name='R3 ABO incompat';
  INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o,v_r,'CREATED');
  RAISE NOTICE 'FAIL: ABO-incompatible offer allowed';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS: %', SQLERRM;
END $$;
ROLLBACK TO SAVEPOINT s3;

\echo '=== 4. ONE-ACTIVE-OFFER ==='
INSERT INTO organ_offer(organ_id,recipient_id,run_id,status)
VALUES (:oid,:r1,:run_id,'CREATED') RETURNING offer_id AS off1 \gset
SAVEPOINT s4;
DO $$ DECLARE v_o BIGINT; v_r BIGINT; BEGIN
  SELECT organ_id INTO v_o FROM organ ORDER BY organ_id LIMIT 1;
  SELECT recipient_id INTO v_r FROM recipient WHERE name='R5 backup';
  INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o,v_r,'CREATED');
  RAISE NOTICE 'FAIL: second active offer allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: ux_offer_active blocked it';
END $$;
ROLLBACK TO SAVEPOINT s4;

\echo '=== 5. DECLINE THEN NO RE-OFFER ==='
UPDATE organ_offer SET status='SENT', sent_at=now() WHERE offer_id=:off1;
UPDATE organ_offer SET status='DECLINED', responded_at=now(),
  decline_reason_id=(SELECT decline_reason_id FROM decline_reason WHERE code='ORGAN_QUALITY') WHERE offer_id=:off1;
SAVEPOINT s5;
DO $$ DECLARE v_o BIGINT; v_r BIGINT; BEGIN
  SELECT organ_id INTO v_o FROM organ ORDER BY organ_id LIMIT 1;
  SELECT recipient_id INTO v_r FROM recipient WHERE name='R1 good HLA near';
  INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES (v_o,v_r,'CREATED');
  RAISE NOTICE 'FAIL: re-offer to decliner allowed';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: ux_offer_no_reoffer blocked it';
END $$;
ROLLBACK TO SAVEPOINT s5;

\echo '=== 6. ADVANCE TO RANK 2, ACCEPT ==='
INSERT INTO organ_offer(organ_id,recipient_id,run_id,status,sent_at)
VALUES (:oid,:r2,:run_id,'SENT',now()) RETURNING offer_id AS off2 \gset
UPDATE organ_offer SET status='ACCEPTED', responded_at=now() WHERE offer_id=:off2;
SELECT (SELECT status FROM organ WHERE organ_id=:oid) organ,
       (SELECT status FROM transport_record WHERE organ_id=:oid) transport;

\echo '=== 7. TRANSPLANT BEFORE DELIVERY ==='
SAVEPOINT s7;
DO $$ DECLARE v_f BIGINT; BEGIN
  SELECT offer_id INTO v_f FROM organ_offer WHERE status='ACCEPTED' LIMIT 1;
  INSERT INTO transplant_event(offer_id,hospital_id,outcome) VALUES (v_f,3,'SUCCESS');
  RAISE NOTICE 'FAIL: transplant before delivery allowed';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS: %', SQLERRM;
END $$;
ROLLBACK TO SAVEPOINT s7;

\echo '=== 8. DELIVER, TRANSPLANT, CASCADE ==='
UPDATE transport_record SET status='IN_TRANSIT', departed_at=now() WHERE organ_id=:oid;
UPDATE transport_record SET status='DELIVERED', arrived_at=now() WHERE organ_id=:oid;
INSERT INTO transplant_event(offer_id,hospital_id,outcome) VALUES (:off2,3,'SUCCESS');
SELECT (SELECT status FROM organ WHERE organ_id=:oid) organ,
       (SELECT status FROM waitlist_entry WHERE recipient_id=:r2 AND organ_type_id=1) heart_wl;

\echo '=== 9. MULTI-ORGAN WAITLIST PRESERVED (R1: heart declined, kidney still active) ==='
SELECT ot.name, w.status FROM waitlist_entry w JOIN organ_type ot USING (organ_type_id)
WHERE w.recipient_id=:r1 ORDER BY ot.name;

\echo '=== 10. TERMINAL STATE GUARD ==='
SAVEPOINT s10;
DO $$ DECLARE v_o BIGINT; BEGIN
  SELECT organ_id INTO v_o FROM organ WHERE status='TRANSPLANTED' LIMIT 1;
  UPDATE organ SET status='AVAILABLE' WHERE organ_id=v_o;
  RAISE NOTICE 'FAIL: terminal state reversed';
EXCEPTION WHEN raise_exception THEN RAISE NOTICE 'PASS: %', SQLERRM;
END $$;
ROLLBACK TO SAVEPOINT s10;

\echo '=== 11. SWEEP ==='
INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
VALUES (:did,3,1, now()-interval '20 hours','AVAILABLE') RETURNING organ_id AS oid2 \gset
INSERT INTO organ_offer(organ_id,recipient_id,status,created_at)
VALUES (:oid2,:r5,'CREATED',now()-interval '3 hours') RETURNING offer_id AS off3 \gset
SELECT expire_stale_offers();
SELECT :oid2 AS expired_organ, (SELECT status FROM organ WHERE organ_id=:oid2) organ_status,
       (SELECT status FROM organ_offer WHERE offer_id=:off3) abandoned_offer_status;

\echo '=== 12. AUDIT ==='
SELECT table_name, action, count(*) FROM audit_log GROUP BY 1,2 ORDER BY 1,2;
\echo '=== 13. REPORTS ==='
SELECT * FROM v_compliance_summary;
SELECT region_name, waitlist_size, transplants_completed, median_wait_days, retention_pct
FROM v_allocation_fairness ORDER BY region_name;
COMMIT;
