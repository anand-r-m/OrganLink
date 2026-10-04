-- =====================================================================
-- OrganLink — Reference Data Seed
-- Run after 01_schema.sql
-- These values are depended on by triggers and the matching function;
-- the schema is not functional without them.
-- =====================================================================

-- --- Roles (modelled; only ADMIN is used in this phase) ---------------
INSERT INTO role(role_name) VALUES
    ('ADMIN'),
    ('TRANSPLANT_COORDINATOR'),
    ('HOSPITAL_STAFF'),
    ('MEDICAL_REVIEWER'),
    ('AUDITOR');

INSERT INTO app_user(username, password_hash, role_id, status)
VALUES ('admin',
        -- bcrypt hash of 'admin'
        '$2b$10$NMptt9TIflZAmJHIiv0ObOpfP9kHnzqg55nci/G6lXH8OubGHmz9W',
        (SELECT role_id FROM role WHERE role_name = 'ADMIN'),
        'ACTIVE');

-- --- Blood groups -----------------------------------------------------
INSERT INTO blood_group(group_name) VALUES
    ('O-'), ('O+'), ('A-'), ('A+'), ('B-'), ('B+'), ('AB-'), ('AB+');

-- --- Blood compatibility: all 64 pairs --------------------------------
-- Donor -> Recipient. Standard ABO/Rh rules:
--   ABO: O gives to all; A->A,AB; B->B,AB; AB->AB only
--   Rh:  negative gives to both; positive gives to positive only
INSERT INTO blood_compatibility(donor_bg_id, recipient_bg_id, compatible)
SELECT d.blood_group_id, r.blood_group_id,
       (
         -- ABO component
         CASE
           WHEN rtrim(d.group_name, '+-') = 'O'  THEN TRUE
           WHEN rtrim(d.group_name, '+-') = 'A'  THEN rtrim(r.group_name,'+-') IN ('A','AB')
           WHEN rtrim(d.group_name, '+-') = 'B'  THEN rtrim(r.group_name,'+-') IN ('B','AB')
           WHEN rtrim(d.group_name, '+-') = 'AB' THEN rtrim(r.group_name,'+-') = 'AB'
         END
         AND
         -- Rh component
         CASE
           WHEN right(d.group_name,1) = '-' THEN TRUE
           ELSE right(r.group_name,1) = '+'
         END
       )
FROM blood_group d CROSS JOIN blood_group r;

-- --- Organ types ------------------------------------------------------
-- max_viability_hours: cold ischemia limits
-- response_window_hours: how long a hospital has to answer an offer
-- weight ratios: donor/recipient tolerance; kidneys are barely
--   size-dependent, hearts and lungs are strict
INSERT INTO organ_type(name, max_viability_hours, response_window_hours,
                       priority_weight, min_weight_ratio, max_weight_ratio) VALUES
    ('Heart',    6,  1, 1.50, 0.80, 1.50),
    ('Lung',     8,  2, 1.40, 0.80, 1.30),
    ('Liver',   12,  3, 1.30, 0.70, 2.00),
    ('Kidney',  30,  6, 1.00, 0.50, 3.00),
    ('Pancreas',18,  4, 1.10, 0.70, 2.00);

-- --- Urgency tiers ----------------------------------------------------
-- Non-linear by design: the escalation from 1B to 1A is far larger than
-- from 2 to 1B, reflecting how clinical urgency actually behaves.
INSERT INTO urgency(code, description, score_value) VALUES
    ('1A', 'Critical — days of expected survival without transplant', 100.00),
    ('1B', 'High priority — hospitalised or rapidly deteriorating',    60.00),
    ('2',  'Stable — routine waitlist status',                         25.00);

-- --- HLA alleles (simplified reference set) ---------------------------
INSERT INTO hla_allele(locus, allele_name) VALUES
    ('A','A*01:01'), ('A','A*02:01'), ('A','A*03:01'),
    ('A','A*11:01'), ('A','A*24:02'), ('A','A*68:01'),
    ('B','B*07:02'), ('B','B*08:01'), ('B','B*15:01'),
    ('B','B*35:01'), ('B','B*44:02'), ('B','B*51:01'),
    ('DRB1','DRB1*01:01'), ('DRB1','DRB1*03:01'), ('DRB1','DRB1*04:01'),
    ('DRB1','DRB1*07:01'), ('DRB1','DRB1*11:01'), ('DRB1','DRB1*15:01');

-- --- Decline reasons --------------------------------------------------
INSERT INTO decline_reason(code, description) VALUES
    ('RECIPIENT_UNFIT',    'Recipient medically unfit at time of offer'),
    ('ORGAN_QUALITY',      'Organ quality assessed as unsuitable'),
    ('SIZE_MISMATCH',      'Size mismatch identified on review'),
    ('LOGISTICS',          'Transport or theatre logistics not feasible'),
    ('RECIPIENT_REFUSED',  'Recipient or family declined'),
    ('OTHER',              'Other — see notes');

-- --- Discard reasons --------------------------------------------------
INSERT INTO discard_reason(code, description) VALUES
    ('NO_SUITABLE_RECIPIENT', 'No compatible recipient identified'),
    ('ALL_DECLINED',          'All ranked candidates declined the offer'),
    ('VIABILITY_ELAPSED',     'Viability window elapsed before placement'),
    ('QUALITY_ASSESSMENT',    'Failed quality assessment on inspection'),
    ('TRANSPLANT_FAILED',     'Organ not used or transplant unsuccessful'),
    ('TRANSPORT_FAILURE',     'Lost or damaged in transport');

-- --- Exclusion reasons (used by match_candidates) ---------------------
-- Codes must match the CASE expression in match_candidates().
INSERT INTO exclusion_reason(code, description) VALUES
    ('ABO_INCOMPATIBLE',      'Blood group incompatible with donor'),
    ('RECIPIENT_INACTIVE',    'Recipient or waitlist entry not active'),
    ('ALREADY_OFFERED',       'This organ has already been offered to this recipient'),
    ('SIZE_MISMATCH',         'Donor/recipient size ratio outside permitted range'),
    ('VIABILITY_UNREACHABLE', 'Organ cannot reach recipient within viability window');

-- --- Regions (with allocation policy weights) -------------------------
INSERT INTO region(region_code, region_name,
                   hla_weight, urgency_weight, distance_weight, wait_weight) VALUES
    ('SR', 'Southern Region',  25, 35, 20, 20),
    ('WR', 'Western Region',   30, 30, 20, 20),
    ('NR', 'Northern Region',  20, 40, 25, 15),
    ('ER', 'Eastern Region',   25, 30, 25, 20);
