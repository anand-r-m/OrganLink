-- =====================================================================
-- OrganLink — Minimal Demo Seed (v1)
-- Run after 01_schema.sql and 02_seed_reference.sql.
-- Present-day data for the Phase 2 slice. All rows go through the
-- triggers (no replica mode in this file version). All people are
-- fictional.
--   8 hospitals | 10 donors | 20 recipients | 23 waitlist entries
--   3 AVAILABLE organs (Heart, Liver, Kidney) recovered 0.5-2 h ago
-- Times are relative to the moment the seed runs, so organs are fresh
-- right after `npm run db:reset` (the Heart expires 6 h later).
-- =====================================================================

-- --- Hospitals (mock names/coordinates, mapped onto SR/WR/NR/ER; A9) ---
INSERT INTO hospital(name, address, phone, latitude, longitude, region_id, status)
SELECT v.name, v.address, v.phone, v.lat, v.lng, r.region_id, v.status
FROM (SELECT x.*, row_number() OVER () AS n FROM (VALUES
    ('AIIMS New Delhi',    'Ansari Nagar, New Delhi',                    '+91-11-0000-0001', 28.5672, 77.2100, 'NR', 'ACTIVE'),
    ('Apollo Chennai',     'Greams Lane, Off Greams Road, Chennai',      '+91-44-0000-0002', 13.0604, 80.2496, 'SR', 'ACTIVE'),
    ('CMC Vellore',        'Ida Scudder Road, Vellore',                  '+91-416-000-0003', 12.9249, 79.1369, 'SR', 'ACTIVE'),
    ('KEM Mumbai',         'Acharya Donde Marg, Parel, Mumbai',          '+91-22-0000-0004', 19.0002, 72.8422, 'WR', 'ACTIVE'),
    ('PGIMER Chandigarh',  'Sector 12, Chandigarh',                      '+91-172-000-0005', 30.7641, 76.7761, 'NR', 'ACTIVE'),
    ('Narayana Bangalore', 'Bommasandra Industrial Area, Bangalore',     '+91-80-0000-0006', 12.9061, 77.5980, 'SR', 'ACTIVE'),
    ('KGMU Lucknow',       'Shah Mina Road, Chowk, Lucknow',             '+91-522-000-0007', 26.8580, 80.9425, 'ER', 'SUSPENDED'),
    ('SCB Cuttack',        'Mangalabag, Cuttack',                        '+91-671-000-0008', 20.4734, 85.8830, 'ER', 'ACTIVE')
) AS x(name, address, phone, lat, lng, region_code, status)) AS v
JOIN region r ON r.region_code = v.region_code
ORDER BY v.n;

-- --- Donors (6 deceased, 4 living) ---------------------------------------
-- Deceased donors 1-3 are the sources of the three available organs.
INSERT INTO donor(name, date_of_birth, blood_group_id, hospital_id, donor_type,
                  status, height_cm, weight_kg, death_date, death_cause)
SELECT v.name, v.dob, bg.blood_group_id, h.hospital_id, v.dtype, 'ACTIVE',
       v.height, v.weight,
       CASE WHEN v.dtype = 'DECEASED' THEN now() - v.died_ago END,
       v.cause
FROM (SELECT x.*, row_number() OVER () AS n FROM (VALUES
    ('Anil Kapoor',     DATE '1984-03-12', 'O+',  'AIIMS New Delhi',    'DECEASED', 176, 72, INTERVAL '4 hours',  'Traumatic brain injury'),
    ('Rekha Deshmukh',  DATE '1979-07-30', 'O-',  'KEM Mumbai',         'DECEASED', 165, 75, INTERVAL '5 hours',  'Intracranial haemorrhage'),
    ('Mohan Krishnan',  DATE '1990-11-02', 'B+',  'Apollo Chennai',     'DECEASED', 172, 70, INTERVAL '3 hours',  'Road traffic accident'),
    ('Sanjay Malhotra', DATE '1975-01-19', 'A+',  'PGIMER Chandigarh',  'DECEASED', 178, 80, INTERVAL '3 days',   'Cerebral anoxia'),
    ('Pooja Hegde',     DATE '1988-09-05', 'AB+', 'Narayana Bangalore', 'DECEASED', 160, 58, INTERVAL '6 days',   'Stroke'),
    ('Biswajit Sahoo',  DATE '1969-12-24', 'O+',  'SCB Cuttack',        'DECEASED', 170, 68, INTERVAL '9 days',   'Traumatic brain injury'),
    ('Kavita Reddy',    DATE '1992-05-17', 'A+',  'CMC Vellore',        'LIVING',   162, 60, NULL,                NULL),
    ('Nikhil Bhatt',    DATE '1986-02-08', 'B+',  'KEM Mumbai',         'LIVING',   180, 82, NULL,                NULL),
    ('Shalini Gupta',   DATE '1994-10-29', 'O+',  'AIIMS New Delhi',    'LIVING',   158, 52, NULL,                NULL),
    ('Aditya Pandey',   DATE '1981-06-14', 'A-',  'KGMU Lucknow',       'LIVING',   174, 77, NULL,                NULL)
) AS x(name, dob, bg, hospital, dtype, height, weight, died_ago, cause)) AS v
JOIN blood_group bg ON bg.group_name = v.bg
JOIN hospital h     ON h.name        = v.hospital
ORDER BY v.n;

-- Donor HLA: 6 alleles each (2 x A, 2 x B, 2 x DRB1).
INSERT INTO donor_hla(donor_id, allele_id)
SELECT d.donor_id, ha.allele_id
FROM (VALUES
    ('Anil Kapoor',     ARRAY['A*02:01','A*11:01','B*07:02','B*35:01','DRB1*04:01','DRB1*15:01']),
    ('Rekha Deshmukh',  ARRAY['A*01:01','A*03:01','B*08:01','B*44:02','DRB1*03:01','DRB1*07:01']),
    ('Mohan Krishnan',  ARRAY['A*02:01','A*24:02','B*15:01','B*51:01','DRB1*11:01','DRB1*15:01']),
    ('Sanjay Malhotra', ARRAY['A*01:01','A*68:01','B*07:02','B*08:01','DRB1*01:01','DRB1*04:01']),
    ('Pooja Hegde',     ARRAY['A*03:01','A*11:01','B*35:01','B*44:02','DRB1*07:01','DRB1*11:01']),
    ('Biswajit Sahoo',  ARRAY['A*02:01','A*24:02','B*51:01','B*15:01','DRB1*03:01','DRB1*15:01']),
    ('Kavita Reddy',    ARRAY['A*01:01','A*02:01','B*08:01','B*35:01','DRB1*01:01','DRB1*07:01']),
    ('Nikhil Bhatt',    ARRAY['A*11:01','A*68:01','B*07:02','B*44:02','DRB1*04:01','DRB1*11:01']),
    ('Shalini Gupta',   ARRAY['A*03:01','A*24:02','B*15:01','B*51:01','DRB1*03:01','DRB1*04:01']),
    ('Aditya Pandey',   ARRAY['A*01:01','A*11:01','B*08:01','B*35:01','DRB1*15:01','DRB1*07:01'])
) AS v(name, alleles)
JOIN donor d ON d.name = v.name
CROSS JOIN LATERAL unnest(v.alleles) AS a(allele_name)
JOIN hla_allele ha ON ha.allele_name = a.allele_name;

-- --- Recipients (20) --------------------------------------------------------
-- Some are deliberately unsuitable for the seeded organs so that every
-- match run shows at least one excluded candidate (ABO, size, inactive).
INSERT INTO recipient(name, date_of_birth, blood_group_id, hospital_id,
                      status, height_cm, weight_kg)
SELECT v.name, v.dob, bg.blood_group_id, h.hospital_id, 'ACTIVE', v.height, v.weight
FROM (SELECT x.*, row_number() OVER () AS n FROM (VALUES
    ('Arjun Mehta',    DATE '1971-04-03', 'B+',  'AIIMS New Delhi',    175, 72),
    ('Priya Nair',     DATE '1985-08-21', 'A+',  'Apollo Chennai',     160, 58),
    ('Rahul Verma',    DATE '1968-12-11', 'O+',  'AIIMS New Delhi',    178, 80),
    ('Sunita Rao',     DATE '1979-02-27', 'B+',  'Narayana Bangalore', 158, 62),
    ('Karthik Iyer',   DATE '1990-06-09', 'AB+', 'Apollo Chennai',     172, 74),
    ('Meera Kulkarni', DATE '1976-10-15', 'B+',  'KEM Mumbai',         165, 66),
    ('Vikram Singh',   DATE '1964-03-30', 'O-',  'PGIMER Chandigarh',  180, 85),
    ('Ananya Das',     DATE '1982-09-18', 'A-',  'SCB Cuttack',        162, 55),
    ('Imran Sheikh',   DATE '1973-01-25', 'B-',  'KEM Mumbai',         170, 70),
    ('Deepa Menon',    DATE '1988-11-07', 'AB+', 'CMC Vellore',        155, 60),
    ('Suresh Kumar',   DATE '1966-05-22', 'A+',  'KGMU Lucknow',       176, 78),
    ('Lakshmi Pillai', DATE '1959-07-13', 'O+',  'CMC Vellore',        150, 45),
    ('Rohan Joshi',    DATE '1995-03-04', 'B+',  'KEM Mumbai',         182, 90),
    ('Farah Khan',     DATE '1998-12-19', 'A+',  'AIIMS New Delhi',    150, 38),
    ('Gopal Reddy',    DATE '1974-08-08', 'O+',  'Narayana Bangalore', 168, 68),
    ('Nisha Bansal',   DATE '1983-04-16', 'AB-', 'PGIMER Chandigarh',  160, 57),
    ('Tarun Ghosh',    DATE '1970-10-02', 'A+',  'SCB Cuttack',        174, 76),
    ('Divya Shetty',   DATE '1992-01-31', 'B+',  'Narayana Bangalore', 161, 59),
    ('Harish Patel',   DATE '1961-09-26', 'O+',  'KEM Mumbai',         177, 82),
    ('Zoya Ali',       DATE '1987-06-20', 'A+',  'KGMU Lucknow',       158, 54)
) AS x(name, dob, bg, hospital, height, weight)) AS v
JOIN blood_group bg ON bg.group_name = v.bg
JOIN hospital h     ON h.name        = v.hospital
ORDER BY v.n;

-- Recipient HLA: 6 alleles each.
INSERT INTO recipient_hla(recipient_id, allele_id)
SELECT r.recipient_id, ha.allele_id
FROM (VALUES
    ('Arjun Mehta',    ARRAY['A*02:01','A*03:01','B*07:02','B*51:01','DRB1*04:01','DRB1*11:01']),
    ('Priya Nair',     ARRAY['A*02:01','A*11:01','B*07:02','B*44:02','DRB1*04:01','DRB1*15:01']),
    ('Rahul Verma',    ARRAY['A*02:01','A*24:02','B*35:01','B*08:01','DRB1*15:01','DRB1*03:01']),
    ('Sunita Rao',     ARRAY['A*24:02','A*68:01','B*15:01','B*51:01','DRB1*11:01','DRB1*15:01']),
    ('Karthik Iyer',   ARRAY['A*02:01','A*24:02','B*15:01','B*35:01','DRB1*11:01','DRB1*07:01']),
    ('Meera Kulkarni', ARRAY['A*01:01','A*02:01','B*51:01','B*15:01','DRB1*15:01','DRB1*11:01']),
    ('Vikram Singh',   ARRAY['A*01:01','A*03:01','B*08:01','B*44:02','DRB1*03:01','DRB1*07:01']),
    ('Ananya Das',     ARRAY['A*01:01','A*11:01','B*08:01','B*07:02','DRB1*03:01','DRB1*01:01']),
    ('Imran Sheikh',   ARRAY['A*03:01','A*68:01','B*35:01','B*44:02','DRB1*07:01','DRB1*04:01']),
    ('Deepa Menon',    ARRAY['A*03:01','A*24:02','B*44:02','B*51:01','DRB1*07:01','DRB1*03:01']),
    ('Suresh Kumar',   ARRAY['A*02:01','A*11:01','B*07:02','B*35:01','DRB1*04:01','DRB1*01:01']),
    ('Lakshmi Pillai', ARRAY['A*11:01','A*68:01','B*15:01','B*07:02','DRB1*15:01','DRB1*11:01']),
    ('Rohan Joshi',    ARRAY['A*02:01','A*24:02','B*15:01','B*51:01','DRB1*11:01','DRB1*04:01']),
    ('Farah Khan',     ARRAY['A*01:01','A*02:01','B*07:02','B*08:01','DRB1*04:01','DRB1*03:01']),
    ('Gopal Reddy',    ARRAY['A*02:01','A*03:01','B*08:01','B*35:01','DRB1*03:01','DRB1*15:01']),
    ('Nisha Bansal',   ARRAY['A*11:01','A*24:02','B*44:02','B*51:01','DRB1*07:01','DRB1*11:01']),
    ('Tarun Ghosh',    ARRAY['A*01:01','A*68:01','B*35:01','B*08:01','DRB1*01:01','DRB1*04:01']),
    ('Divya Shetty',   ARRAY['A*24:02','A*02:01','B*15:01','B*51:01','DRB1*15:01','DRB1*11:01']),
    ('Harish Patel',   ARRAY['A*03:01','A*11:01','B*07:02','B*44:02','DRB1*03:01','DRB1*07:01']),
    ('Zoya Ali',       ARRAY['A*02:01','A*11:01','B*35:01','B*07:02','DRB1*04:01','DRB1*15:01'])
) AS v(name, alleles)
JOIN recipient r ON r.name = v.name
CROSS JOIN LATERAL unnest(v.alleles) AS a(allele_name)
JOIN hla_allele ha ON ha.allele_name = a.allele_name;

-- --- Waitlist entries (23), listed 1-24 months ago ----------------------------
-- Karthik Iyer and Rohan Joshi are kidney+pancreas candidates (2 ACTIVE entries each).
INSERT INTO waitlist_entry(recipient_id, organ_type_id, urgency_id, listed_date, status)
SELECT r.recipient_id, ot.organ_type_id, u.urgency_id,
       (CURRENT_DATE - (v.months_ago * INTERVAL '1 month'))::DATE, v.status
FROM (VALUES
    ('Arjun Mehta',    'Kidney',   '1B', 14, 'ACTIVE'),
    ('Priya Nair',     'Heart',    '1A',  3, 'ACTIVE'),
    ('Rahul Verma',    'Heart',    '1B',  8, 'ACTIVE'),
    ('Sunita Rao',     'Kidney',   '2',  20, 'ACTIVE'),
    ('Karthik Iyer',   'Kidney',   '1B',  6, 'ACTIVE'),
    ('Karthik Iyer',   'Pancreas', '1B',  6, 'ACTIVE'),
    ('Meera Kulkarni', 'Kidney',   '1A', 11, 'ACTIVE'),
    ('Vikram Singh',   'Liver',    '1B',  5, 'ACTIVE'),
    ('Ananya Das',     'Liver',    '2',   9, 'ACTIVE'),
    ('Imran Sheikh',   'Heart',    '2',   4, 'ACTIVE'),
    ('Deepa Menon',    'Liver',    '1A',  2, 'ACTIVE'),
    ('Suresh Kumar',   'Heart',    '1B', 12, 'ACTIVE'),
    ('Lakshmi Pillai', 'Kidney',   '2',  24, 'ACTIVE'),
    ('Rohan Joshi',    'Kidney',   '1B',  3, 'ACTIVE'),
    ('Rohan Joshi',    'Pancreas', '2',   3, 'ACTIVE'),
    ('Farah Khan',     'Heart',    '1A',  1, 'ACTIVE'),
    ('Gopal Reddy',    'Liver',    '1B',  7, 'ACTIVE'),
    ('Nisha Bansal',   'Liver',    '2',  15, 'SUSPENDED'),
    ('Tarun Ghosh',    'Kidney',   '1B', 18, 'SUSPENDED'),
    ('Divya Shetty',   'Kidney',   '2',  10, 'ACTIVE'),
    ('Harish Patel',   'Liver',    '1A',  1, 'ACTIVE'),
    ('Zoya Ali',       'Heart',    '2',  22, 'ACTIVE'),
    ('Zoya Ali',       'Kidney',   '2',  16, 'ACTIVE')
) AS v(name, organ, urgency, months_ago, status)
JOIN recipient  r  ON r.name  = v.name
JOIN organ_type ot ON ot.name = v.organ
JOIN urgency    u  ON u.code  = v.urgency;

-- --- Available organs (recovered 0.5-2 h ago) -----------------------------------
-- Heart  : O+ donor  -> qualified A+/O+ recipients; B- (ABO) and 38 kg (size) excluded.
-- Liver  : O- donor  -> universal ABO; the suspended entry is excluded.
-- Kidney : B+ donor  -> B+/AB+ recipients; O+ and A+ (ABO) excluded.
INSERT INTO organ(donor_id, organ_type_id, recovering_hospital_id, recovered_at, status)
SELECT d.donor_id, ot.organ_type_id, d.hospital_id, now() - v.ago, 'AVAILABLE'
FROM (SELECT x.*, row_number() OVER () AS n FROM (VALUES
    ('Anil Kapoor',    'Heart',  INTERVAL '60 minutes'),
    ('Rekha Deshmukh', 'Liver',  INTERVAL '90 minutes'),
    ('Mohan Krishnan', 'Kidney', INTERVAL '30 minutes')
) AS x(donor, organ, ago)) AS v
JOIN donor      d  ON d.name  = v.donor
JOIN organ_type ot ON ot.name = v.organ
ORDER BY v.n;

-- =====================================================================
-- HISTORICAL BLOCK (OL-031) — 24 months of retrospective activity
-- =====================================================================
-- Everything below is history: organs recovered 0-24 months ago that have
-- already reached a terminal state, together with the offers, transports,
-- transplants, match runs and waitlist movement that explain them.
-- Reports and the dashboard trend read these rows, which is why they
-- exist — the present-day block above alone gives every report one bar.
--
-- Two properties keep this block inert once the server starts:
--
--   1. session_replication_role = replica for the whole block, so the
--      workflow and audit triggers (which all reason about "now") do not
--      fire. Retrospective rows are facts, not events, and audit_log
--      therefore continues to describe only the live present-day flow.
--      CHECK, NOT NULL and unique-index constraints still apply, so this
--      is not a constraint bypass — only trigger bypass.
--
--   2. No historical row is left in a state the sweeps can rewrite: no
--      AVAILABLE organ, no CREATED/SENT offer, no PENDING/IN_TRANSIT
--      transport. expire_stale_offers() is therefore a no-op here.
--
-- Realism choices worth knowing when editing this block:
--   * Match results reuse the scoring expression of the live
--     match_candidates() function, evaluated at the historical run time
--     rather than now(). Calling the function itself would mark every
--     historical candidate VIABILITY_UNREACHABLE, because it tests
--     viability from the current clock.
--   * A timeline recipient ("taker") was active when the run happened and
--     may be TRANSPLANTED/INACTIVE now; status is therefore read as
--     ACTIVE for that one row of each run, and from the row itself for
--     every other candidate.
--   * Donor and taker blood groups are paired by (n % 5) so every
--     accepted offer is genuinely ABO/Rh compatible, and weights are
--     paired to keep donor/recipient ratios inside the organ type's
--     min_weight_ratio..max_weight_ratio band.
--   * HLA is drawn from six shared allele sets, so mismatch counts (and
--     therefore match scores) differ between candidates.
-- =====================================================================

BEGIN;
SET LOCAL session_replication_role = replica;

-- --- Six shared HLA sets (2 x A, 2 x B, 2 x DRB1 each) --------------------
CREATE TEMP TABLE hist_hla_set ON COMMIT DROP AS
SELECT s.set_no, ha.allele_id
FROM (VALUES
    (1, ARRAY['A*01:01','A*03:01','B*08:01','B*44:02','DRB1*01:01','DRB1*03:01']),
    (2, ARRAY['A*02:01','A*11:01','B*07:02','B*35:01','DRB1*04:01','DRB1*07:01']),
    (3, ARRAY['A*03:01','A*24:02','B*15:01','B*51:01','DRB1*03:01','DRB1*11:01']),
    (4, ARRAY['A*01:01','A*68:01','B*08:01','B*35:01','DRB1*01:01','DRB1*15:01']),
    (5, ARRAY['A*11:01','A*24:02','B*07:02','B*44:02','DRB1*04:01','DRB1*11:01']),
    (6, ARRAY['A*02:01','A*03:01','B*15:01','B*51:01','DRB1*07:01','DRB1*15:01'])
) AS s(set_no, alleles)
CROSS JOIN LATERAL unnest(s.alleles) AS a(allele_name)
JOIN hla_allele ha ON ha.allele_name = a.allele_name;

-- --- The organ timeline: one row per historical recovery ------------------
-- n         months back (0 = this month, anchored to the 9th at 09:00)
-- outcome   SUCCESS | FAILED | NOT_USED | EXPIRED | DISCARD_VE | DISCARD_NSR
--           | DISCARD_TF
-- taker     recipient the recovery was allocated to, NULL when nobody was
CREATE TEMP TABLE hist_timeline ON COMMIT DROP AS
SELECT v.n, v.donor, v.organ, v.hospital, v.outcome, v.taker,
       v.cause, v.donor_w, v.bg,
       CASE WHEN v.n = 0 THEN now() - INTERVAL '8 hours'
            ELSE date_trunc('month', now())
                 - make_interval(months => v.n) + INTERVAL '9 hours'
       END AS recovered_at
FROM (VALUES
    ( 0, 'Nandini Deshpande',  'Kidney',   'KEM Mumbai',         'SUCCESS',      'Vikram Sethi',       'Intracranial haemorrhage',         70, 'O-' ),
    ( 1, 'Gangadhar Panicker', 'Heart',    'AIIMS New Delhi',    'SUCCESS',      'Anjali Kulkarni',    'Road traffic accident',            72, 'O+' ),
    ( 2, 'Sudarshan Mahapatra','Liver',    'SCB Cuttack',        'SUCCESS',      'Rukmini Rao',        'Chronic liver failure',            68, 'A+' ),
    ( 3, 'Ilavarasan Muthu',   'Kidney',   'Apollo Chennai',     'SUCCESS',      'Shobana Iyer',       'Post-operative complication',     75, 'B+' ),
    ( 4, 'Deepak Chavan',      'Lung',     'Narayana Bangalore', 'SUCCESS',      'Kalyani Menon',      'Pulmonary fibrosis',               62, 'AB-'),
    ( 5, 'Ramnarayan Bhide',   'Kidney',   'CMC Vellore',        'SUCCESS',      'Naveen Shetty',      'Cerebral anoxia',                  80, 'O-' ),
    ( 6, 'Hariram Sawant',     'Heart',    'KEM Mumbai',         'SUCCESS',      'Meenakshi Rao',      'Cardiomyopathy',                   70, 'O+' ),
    ( 7, 'Balaji Venkatesan',   'Liver',    'Apollo Chennai',     'SUCCESS',      'Sridhar Iyer',       'Acute-on-chronic liver failure',   74, 'A+' ),
    ( 8, 'Yamini Gokhale',      'Kidney',   'AIIMS New Delhi',    'SUCCESS',      'Tarun Jain',         'Road traffic accident',            66, 'B+' ),
    ( 9, 'Suresh Rathi',        'Pancreas', 'SCB Cuttack',        'SUCCESS',      'Lakshmi Narayan',    'Chronic pancreatitis',             72, 'AB-'),
    (10, 'Ashok Wagh',          'Heart',    'Narayana Bangalore', 'FAILED',       'Pradeep Kumar',      'Intracranial haemorrhage',         78, 'O-' ),
    (11, 'Lalita Bhinge',       'Liver',    'CMC Vellore',        'SUCCESS',      'Gayathri Rao',       'Alcoholic hepatitis',              70, 'O+' ),
    (12, 'Vinod Kharat',        'Kidney',   'KEM Mumbai',         'SUCCESS',      'Harish Babu',        'Cerebral anoxia',                  84, 'A+' ),
    (13, 'Nirmala Bhosale',     'Lung',     'SCB Cuttack',        'SUCCESS',      'Padmavathi Devi',    'Idiopathic pulmonary fibrosis',   64, 'B+' ),
    (14, 'Ratanlal Parmar',     'Heart',    'SCB Cuttack',        'EXPIRED',      NULL,                'Post-surgical complication',      68, 'AB-'),
    (15, 'Shrikant Dhotre',     'Kidney',   'Apollo Chennai',     'DISCARD_VE',   'Rekha Sharma',       'Road traffic accident',            76, 'O-' ),
    (16, 'Bhaskar Naik',        'Liver',    'KGMU Lucknow',       'SUCCESS',      'Kavitha Raman',      'Acute liver failure',              66, 'O+' ),
    (17, 'Mohanlal Sisodia',    'Kidney',   'Narayana Bangalore', 'NOT_USED',     'Srinivasan Rajan',   'Cerebral anoxia',                  58, 'A+' ),
    (18, 'Girja Prasad',        'Heart',    'PGIMER Chandigarh',  'SUCCESS',      'Ashok Verma',        'Road traffic accident',            74, 'B+' ),
    (19, 'Kamalakar Sen',       'Lung',     'AIIMS New Delhi',    'SUCCESS',      'Chitra Ranganathan', 'Bronchiectasis',                   60, 'AB-'),
    (20, 'Pravin Sathe',        'Kidney',   'SCB Cuttack',        'DISCARD_NSR',  NULL,                'Road traffic accident',            70, 'O-' ),
    (21, 'Anilbhai Vaghela',     'Heart',    'CMC Vellore',        'EXPIRED',      'Geetha Krishnan',    'Cardiomyopathy',                   72, 'O+' ),
    (22, 'Rajendra Saliya',     'Liver',    'PGIMER Chandigarh',  'EXPIRED',      'Mohan Das',          'Acute liver failure',              64, 'A+' ),
    (23, 'Om Prakash Dhaka',    'Pancreas', 'KEM Mumbai',         'DISCARD_TF',   'Sarita Mahajan',     'Chronic pancreatitis',             68, 'B+' ),
    (24, 'Bhagwan Kadam',       'Kidney',   'Narayana Bangalore', 'SUCCESS',      'Indira Prasad',      'Cerebral anoxia',                  66, 'AB-')
) AS v(n, donor, organ, hospital, outcome, taker, cause, donor_w, bg);

-- --- Historical recipients and their waitlist state -----------------------
-- org  : waitlist entry ordinal, also the HLA set selector ((org-1) % 6) + 1
-- bg   : ABO/Rh compatible with the timeline donor paired via (n % 5)
-- mths : months on the list before the allocation (takers) or today
CREATE TEMP TABLE hist_people ON COMMIT DROP AS
SELECT v.org, v.pname, v.bg, v.hospital, v.h, v.w,
       v.rstatus, v.organ, v.urgency, v.mths, v.wstatus
FROM (VALUES
    ( 1, 'Vikram Sethi',       'A+',  'AIIMS New Delhi',    168,  62, 'TRANSPLANTED', 'Kidney',   '1B', 14, 'TRANSPLANTED'),
    ( 2, 'Anjali Kulkarni',    'B+',  'AIIMS New Delhi',    160,  64, 'TRANSPLANTED', 'Heart',    '1A',  2, 'TRANSPLANTED'),
    ( 3, 'Rukmini Rao',        'A+',  'KGMU Lucknow',       162,  60, 'TRANSPLANTED', 'Liver',    '1B',  9, 'TRANSPLANTED'),
    ( 4, 'Shobana Iyer',       'AB+', 'CMC Vellore',        157,  66, 'TRANSPLANTED', 'Kidney',   '2',  19, 'TRANSPLANTED'),
    ( 5, 'Kalyani Menon',      'AB-', 'AIIMS New Delhi',    165,  56, 'TRANSPLANTED', 'Lung',     '1A',  6, 'TRANSPLANTED'),
    ( 6, 'Naveen Shetty',      'A+',  'KEM Mumbai',         172,  70, 'TRANSPLANTED', 'Kidney',   '1B', 22, 'TRANSPLANTED'),
    ( 7, 'Meenakshi Rao',      'B+',  'SCB Cuttack',        155,  62, 'TRANSPLANTED', 'Heart',    '1A', 11, 'TRANSPLANTED'),
    ( 8, 'Sridhar Iyer',       'A+',  'Apollo Chennai',     166,  64, 'TRANSPLANTED', 'Liver',    '2',  16, 'TRANSPLANTED'),
    ( 9, 'Tarun Jain',         'AB+', 'PGIMER Chandigarh',  170,  58, 'TRANSPLANTED', 'Kidney',   '1B', 25, 'TRANSPLANTED'),
    (10, 'Lakshmi Narayan',    'AB-', 'SCB Cuttack',        158,  64, 'TRANSPLANTED', 'Pancreas', '1A',  8, 'TRANSPLANTED'),
    (11, 'Pradeep Kumar',      'A+',  'KGMU Lucknow',       169,  68, 'DECEASED',     'Heart',    '1A',  3, 'TRANSPLANTED'),
    (12, 'Gayathri Rao',       'B+',  'CMC Vellore',        161,  62, 'TRANSPLANTED', 'Liver',    '1B', 13, 'TRANSPLANTED'),
    (13, 'Harish Babu',        'A+',  'KEM Mumbai',         174,  72, 'TRANSPLANTED', 'Kidney',   '2',  28, 'TRANSPLANTED'),
    (14, 'Padmavathi Devi',    'AB+', 'SCB Cuttack',        156,  58, 'TRANSPLANTED', 'Lung',     '1B',  7, 'TRANSPLANTED'),
    (15, 'Rekha Sharma',       'A+',  'KEM Mumbai',         163,  66, 'ACTIVE',       'Kidney',   '1A', 20, 'ACTIVE'),
    (16, 'Kavitha Raman',      'B+',  'PGIMER Chandigarh',  158,  58, 'TRANSPLANTED', 'Liver',    '1B', 20, 'TRANSPLANTED'),
    (17, 'Srinivasan Rajan',   'A+',  'Narayana Bangalore', 167,  52, 'ACTIVE',       'Kidney',   '1B',  5, 'ACTIVE'),
    (18, 'Ashok Verma',        'AB+', 'PGIMER Chandigarh',  171,  64, 'TRANSPLANTED', 'Heart',    '1B',  4, 'TRANSPLANTED'),
    (19, 'Chitra Ranganathan', 'AB-', 'AIIMS New Delhi',    159,  54, 'TRANSPLANTED', 'Lung',     '1A', 10, 'TRANSPLANTED'),
    (20, 'Geetha Krishnan',    'B+',  'CMC Vellore',        160,  62, 'INACTIVE',     'Heart',    '1A', 12, 'SUSPENDED'),
    (21, 'Mohan Das',          'A+',  'PGIMER Chandigarh',  166,  56, 'ACTIVE',       'Liver',    '2',  15, 'ACTIVE'),
    (22, 'Sarita Mahajan',     'AB+', 'SCB Cuttack',        157,  62, 'ACTIVE',       'Pancreas', '1B',  9, 'ACTIVE'),
    (23, 'Indira Prasad',      'AB-', 'Narayana Bangalore', 154,  58, 'TRANSPLANTED', 'Kidney',   '1B', 26, 'TRANSPLANTED'),
    (24, 'Rahul Bhattacharya', 'B+',  'KEM Mumbai',         170,  72, 'ACTIVE',       'Heart',    '1B',  3, 'ACTIVE'),
    (25, 'Omar Farooqui',      'O+',  'SCB Cuttack',        164,  60, 'ACTIVE',       'Lung',     '1B',  5, 'ACTIVE'),
    (26, 'Sameer Joshi',       'O-',  'Apollo Chennai',     172,  68, 'ACTIVE',       'Kidney',   '2',  12, 'ACTIVE'),
    (27, 'Amit Kothari',       'A+',  'PGIMER Chandigarh',  176,  74, 'ACTIVE',       'Pancreas', '1A', 14, 'ACTIVE'),
    (28, 'Pooja Ramesh',       'O+',  'AIIMS New Delhi',    158,  54, 'ACTIVE',       'Lung',     '2',  2, 'ACTIVE'),
    (29, 'Tara Menon',         'B-',  'CMC Vellore',        161,  59, 'ACTIVE',       'Liver',    '1A',  9, 'REMOVED'),
    (30, 'Sanjay Patil',       'A+',  'Narayana Bangalore', 170,  70, 'ACTIVE',       'Heart',    '2',   6, 'ACTIVE'),
    (31, 'Bhavna Tambe',       'O+',  'Apollo Chennai',     163,  60, 'ACTIVE',       'Kidney',   '1A', 26, 'ACTIVE'),
    (32, 'Sanjay Kulkarni',    'A-',  'SCB Cuttack',        171,  70, 'ACTIVE',       'Liver',    '1B', 28, 'ACTIVE'),
    (33, 'Kavya Nair',         'B+',  'Narayana Bangalore', 156,  52, 'ACTIVE',       'Heart',    '1A', 25, 'ACTIVE'),
    (34, 'Rakesh Yadav',       'O-',  'AIIMS New Delhi',    175,  76, 'ACTIVE',       'Lung',     '2',  30, 'ACTIVE'),
    (35, 'Meera Deshpande',    'A+',  'CMC Vellore',        160,  58, 'ACTIVE',       'Pancreas', '1B', 27, 'ACTIVE'),
    (36, 'Vinod Gaikwad',      'B-',  'KGMU Lucknow',       168,  66, 'ACTIVE',       'Kidney',   '2',  29, 'ACTIVE')
) AS v(org, pname, bg, hospital, h, w, rstatus, organ, urgency, mths, wstatus);

-- --- Historical donors (deceased, one per timeline row) -------------------
INSERT INTO donor(name, date_of_birth, blood_group_id, hospital_id, donor_type,
                  status, height_cm, weight_kg, death_date, death_cause)
SELECT t.donor,
       (CURRENT_DATE - ((16000 + t.n * 365) * INTERVAL '1 day'))::date,
       bg.blood_group_id, h.hospital_id, 'DECEASED', 'ACTIVE',
       160 + (t.n * 7) % 22, t.donor_w,
       t.recovered_at - INTERVAL '2 hours',
       t.cause
FROM hist_timeline t
JOIN blood_group bg ON bg.group_name = t.bg
JOIN hospital h     ON h.name        = t.hospital;

INSERT INTO donor_hla(donor_id, allele_id)
SELECT d.donor_id, s.allele_id
FROM hist_timeline t
JOIN donor d         ON d.name = t.donor
JOIN hist_hla_set s  ON s.set_no = ((t.n % 6) + 1);

-- --- Recipients, their HLA, and their waitlist entries --------------------
INSERT INTO recipient(name, date_of_birth, blood_group_id, hospital_id,
                      status, height_cm, weight_kg)
SELECT p.pname,
       (CURRENT_DATE - ((9000 + p.org * 380) * INTERVAL '1 day'))::date,
       bg.blood_group_id, h.hospital_id, p.rstatus, p.h, p.w
FROM hist_people p
JOIN blood_group bg ON bg.group_name = p.bg
JOIN hospital h     ON h.name        = p.hospital;

INSERT INTO recipient_hla(recipient_id, allele_id)
SELECT r.recipient_id, s.allele_id
FROM hist_people p
JOIN recipient r      ON r.name = p.pname
JOIN hist_hla_set s   ON s.set_no = ((p.org % 6) + 1);

-- Takers were listed before their allocation, so their listed_date is
-- anchored to the recovery; everyone else is dated relative to today.
INSERT INTO waitlist_entry(recipient_id, organ_type_id, urgency_id, listed_date, status)
SELECT r.recipient_id, ot.organ_type_id, u.urgency_id,
       CASE WHEN t.taker IS NOT NULL
            THEN (t.recovered_at::date - (p.mths * INTERVAL '1 month'))::date
            ELSE (CURRENT_DATE - (p.mths * INTERVAL '1 month'))::date
       END,
       p.wstatus
FROM hist_people p
JOIN recipient r        ON r.name = p.pname
JOIN organ_type ot      ON ot.name = p.organ
JOIN urgency u          ON u.code = p.urgency
LEFT JOIN hist_timeline t ON t.taker = p.pname;

-- --- Historical organs (all terminal states) ------------------------------
INSERT INTO organ(donor_id, organ_type_id, recovering_hospital_id, recovered_at,
                  status, discard_reason_id)
SELECT d.donor_id, ot.organ_type_id, h.hospital_id, t.recovered_at,
       CASE t.outcome
           WHEN 'SUCCESS'     THEN 'TRANSPLANTED'
           WHEN 'EXPIRED'     THEN 'EXPIRED'
           ELSE 'DISCARDED'
       END,
       dr.discard_reason_id
FROM hist_timeline t
JOIN donor d               ON d.name = t.donor
JOIN hospital h            ON h.name = t.hospital
JOIN organ_type ot         ON ot.name = t.organ
LEFT JOIN discard_reason dr ON dr.code = CASE t.outcome
           WHEN 'FAILED'     THEN 'TRANSPLANT_FAILED'
           WHEN 'NOT_USED'   THEN 'TRANSPLANT_FAILED'
           WHEN 'DISCARD_TF' THEN 'TRANSPORT_FAILURE'
           WHEN 'DISCARD_NSR' THEN 'NO_SUITABLE_RECIPIENT'
           WHEN 'DISCARD_VE'  THEN 'VIABILITY_ELAPSED'
       END;

-- --- One match run per recovery, weighted by the origin region's policy ---
INSERT INTO match_run(organ_id, run_at, hla_weight, urgency_weight,
                      distance_weight, wait_weight, run_by)
SELECT o.organ_id, t.recovered_at + INTERVAL '20 minutes',
       reg.hla_weight::NUMERIC(5,2),      reg.urgency_weight::NUMERIC(5,2),
       reg.distance_weight::NUMERIC(5,2), reg.wait_weight::NUMERIC(5,2),
       1
FROM hist_timeline t
JOIN donor d          ON d.name = t.donor
JOIN organ o          ON o.donor_id = d.donor_id AND o.recovered_at = t.recovered_at
JOIN hospital h       ON h.hospital_id = o.recovering_hospital_id
JOIN region reg       ON reg.region_id = h.region_id;

-- --- Match results --------------------------------------------------------
-- Mirrors match_candidates() but evaluates viability and waiting time at
-- the run timestamp instead of now(). Present-day organs (recovered
-- within 3 h) are excluded so this can never touch the live flow.
INSERT INTO match_result(run_id, recipient_id, rank, match_score,
                         hla_score, urgency_score, distance_score, wait_score,
                         distance_km, qualified, exclusion_reason_id)
WITH base AS (
    SELECT mr.run_id, mr.run_at,
           mr.hla_weight, mr.urgency_weight, mr.distance_weight, mr.wait_weight,
           ws.recipient_id,
           u.score_value::NUMERIC(5,2) AS urgency_score,
           -- The taker was active at run time; their row now reads
           -- TRANSPLANTED/SUSPENDED, which must not retro-exclude them.
           CASE WHEN t.taker IS NULL THEN ws.status ELSE 'ACTIVE' END AS waitlist_status,
           CASE WHEN t.taker IS NULL THEN r.status  ELSE 'ACTIVE' END AS recipient_status,
           haversine_km(oh.latitude, oh.longitude, rh.latitude, rh.longitude) AS km,
           COALESCE(bc.compatible, FALSE) AS abo_ok,
           d.weight_kg / NULLIF(r.weight_kg, 0) AS size_ratio,
           ot.min_weight_ratio, ot.max_weight_ratio,
           o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour') AS expires_at,
           LEAST(100, 100 * ln(1 + (EXTRACT(EPOCH FROM (mr.run_at - ws.listed_date::TIMESTAMPTZ))
                                    / (30.44*86400))::NUMERIC)
                 / ln(61::NUMERIC))::NUMERIC(5,2) AS wait_score,
           COALESCE((
               SELECT SUM(CASE WHEN ha.locus = 'DRB1' THEN 2 ELSE 1 END)
                 FROM donor_hla dh
                 JOIN hla_allele ha ON ha.allele_id = dh.allele_id
                WHERE dh.donor_id = o.donor_id
                  AND NOT EXISTS (SELECT 1 FROM recipient_hla rh
                                   WHERE rh.recipient_id = ws.recipient_id
                                     AND rh.allele_id    = dh.allele_id)
           ), 0) AS weighted_mm
    FROM match_run mr
    JOIN organ o           ON o.organ_id = mr.organ_id
    JOIN donor d           ON d.donor_id = o.donor_id
    JOIN hospital oh       ON oh.hospital_id = o.recovering_hospital_id
    JOIN organ_type ot     ON ot.organ_type_id = o.organ_type_id
    JOIN waitlist_entry ws ON ws.organ_type_id = o.organ_type_id
                          AND ws.listed_date <= mr.run_at::DATE
    JOIN recipient r       ON r.recipient_id = ws.recipient_id
    JOIN hospital rh       ON rh.hospital_id = r.hospital_id
    JOIN urgency u         ON u.urgency_id = ws.urgency_id
    LEFT JOIN blood_compatibility bc
           ON bc.donor_bg_id     = d.blood_group_id
          AND bc.recipient_bg_id = r.blood_group_id
    LEFT JOIN hist_timeline t ON t.taker = r.name
    WHERE o.recovered_at < now() - INTERVAL '3 hours'
),
evaluated AS (
    SELECT b.*,
           GREATEST(0, (8 - b.weighted_mm) / 8.0 * 100)::NUMERIC(5,2) AS hla_score,
           (100 * exp(-b.km / 500))::NUMERIC(5,2) AS distance_score,
           CASE
               WHEN NOT b.abo_ok                   THEN 'ABO_INCOMPATIBLE'
               WHEN b.recipient_status <> 'ACTIVE' THEN 'RECIPIENT_INACTIVE'
               WHEN b.waitlist_status  <> 'ACTIVE' THEN 'RECIPIENT_INACTIVE'
               WHEN b.size_ratio < b.min_weight_ratio
                 OR b.size_ratio > b.max_weight_ratio THEN 'SIZE_MISMATCH'
               WHEN b.run_at + (b.km / 500 * INTERVAL '1 hour') > b.expires_at
                                                   THEN 'VIABILITY_UNREACHABLE'
               ELSE NULL
           END AS exclusion_code
    FROM base b
),
scored AS (
    SELECT e.*,
           ROUND((e.hla_score      * e.hla_weight
                + e.urgency_score  * e.urgency_weight
                + e.distance_score * e.distance_weight
                + e.wait_score     * e.wait_weight)
               / NULLIF(e.hla_weight + e.urgency_weight
                        + e.distance_weight + e.wait_weight, 0), 2) AS match_score
    FROM evaluated e
)
SELECT s.run_id, s.recipient_id,
       CASE WHEN s.exclusion_code IS NULL
            THEN RANK() OVER (PARTITION BY (s.exclusion_code IS NULL)
                              ORDER BY s.match_score DESC, s.wait_score DESC)
       END,
       CASE WHEN s.exclusion_code IS NULL THEN s.match_score END,
       s.hla_score, s.urgency_score, s.distance_score, s.wait_score, s.km,
       s.exclusion_code IS NULL,
       er.exclusion_reason_id
  FROM scored s
  LEFT JOIN exclusion_reason er ON er.code = s.exclusion_code;

-- --- Offers ---------------------------------------------------------------
-- Every status is terminal on purpose: SENT and CREATED are exactly the
-- states expire_stale_offers() rewrites, so history never uses them.
CREATE TEMP TABLE hist_offers ON COMMIT DROP AS
SELECT v.n, v.who, v.status, v.decline_code, v.void_reason, v.notes
FROM (VALUES
    ( 0, 'Vikram Sethi',       'ACCEPTED',  NULL,                  NULL, NULL),
    ( 1, 'Rahul Bhattacharya', 'DECLINED',  'RECIPIENT_REFUSED',   NULL, 'Family declined after counselling'),
    ( 1, 'Anjali Kulkarni',    'ACCEPTED',  NULL,                  NULL, NULL),
    ( 2, 'Rukmini Rao',        'ACCEPTED',  NULL,                  NULL, NULL),
    ( 3, 'Shobana Iyer',       'ACCEPTED',  NULL,                  NULL, NULL),
    ( 4, 'Omar Farooqui',      'DECLINED',  'ORGAN_QUALITY',       NULL, 'Echocardiography on review'),
    ( 4, 'Kalyani Menon',      'ACCEPTED',  NULL,                  NULL, NULL),
    ( 5, 'Naveen Shetty',      'ACCEPTED',  NULL,                  NULL, NULL),
    ( 6, 'Meenakshi Rao',      'ACCEPTED',  NULL,                  NULL, NULL),
    ( 7, 'Sridhar Iyer',       'ACCEPTED',  NULL,                  NULL, NULL),
    ( 8, 'Sameer Joshi',       'DECLINED',  'LOGISTICS',           NULL, 'Theatre slot could not be secured in time'),
    ( 8, 'Tarun Jain',         'ACCEPTED',  NULL,                  NULL, NULL),
    ( 9, 'Amit Kothari',       'EXPIRED',   NULL,                  NULL, 'No response inside the response window'),
    ( 9, 'Lakshmi Narayan',    'ACCEPTED',  NULL,                  NULL, NULL),
    (10, 'Pradeep Kumar',      'ACCEPTED',  NULL,                  NULL, NULL),
    (11, 'Gayathri Rao',       'ACCEPTED',  NULL,                  NULL, NULL),
    (12, 'Harish Babu',        'ACCEPTED',  NULL,                  NULL, NULL),
    (13, 'Pooja Ramesh',       'DECLINED',  'SIZE_MISMATCH',       NULL, 'Size mismatch identified on review'),
    (13, 'Padmavathi Devi',    'ACCEPTED',  NULL,                  NULL, NULL),
    (15, 'Rekha Sharma',       'VOIDED',    NULL, 'Organ viability window elapsed', NULL),
    (16, 'Tara Menon',         'DECLINED',  'RECIPIENT_UNFIT',     NULL, 'Recipient deteriorated before theatre'),
    (16, 'Kavitha Raman',      'ACCEPTED',  NULL,                  NULL, NULL),
    (17, 'Srinivasan Rajan',   'ACCEPTED',  NULL,                  NULL, NULL),
    (18, 'Sanjay Patil',       'DECLINED',  'OTHER',               NULL, 'Transplant centre requested an alternative organ'),
    (18, 'Ashok Verma',        'ACCEPTED',  NULL,                  NULL, NULL),
    (19, 'Chitra Ranganathan', 'ACCEPTED',  NULL,                  NULL, NULL),
    (21, 'Geetha Krishnan',    'VOIDED',    NULL, 'Recipient no longer active',   NULL),
    (22, 'Mohan Das',          'CANCELLED', NULL,                  NULL, 'Offer withdrawn; candidate unreachable'),
    (23, 'Sarita Mahajan',     'ACCEPTED',  NULL,                  NULL, NULL),
    (24, 'Indira Prasad',      'ACCEPTED',  NULL,                  NULL, NULL)
) AS v(n, who, status, decline_code, void_reason, notes);

INSERT INTO organ_offer(organ_id, recipient_id, run_id, status, created_at, sent_at,
                        responded_at, decline_reason_id, void_reason, notes, created_by)
SELECT o.organ_id, r.recipient_id, mr.run_id, ho.status,
       t.recovered_at + INTERVAL '20 minutes',
       CASE WHEN ho.status = 'CANCELLED' THEN NULL
            ELSE t.recovered_at + INTERVAL '40 minutes' END,
       CASE ho.status
           WHEN 'ACCEPTED' THEN t.recovered_at + INTERVAL '2 hours'
           WHEN 'DECLINED' THEN t.recovered_at + INTERVAL '3 hours'
           WHEN 'EXPIRED'  THEN t.recovered_at + ((ot.response_window_hours + 0.5)
                                                  * INTERVAL '1 hour')
           WHEN 'VOIDED'   THEN t.recovered_at + INTERVAL '4 hours'
       END,
       dr.decline_reason_id, ho.void_reason, ho.notes, 1
FROM hist_offers ho
JOIN hist_timeline t  ON t.n = ho.n
JOIN donor d          ON d.name = t.donor
JOIN organ o          ON o.donor_id = d.donor_id AND o.recovered_at = t.recovered_at
JOIN organ_type ot    ON ot.organ_type_id = o.organ_type_id
JOIN match_run mr     ON mr.organ_id = o.organ_id
JOIN recipient r      ON r.name = ho.who
LEFT JOIN decline_reason dr ON dr.code = ho.decline_code;

-- --- Transport (DELIVERED for every accepted offer, FAILED once) ----------
INSERT INTO transport_record(organ_id, origin_hospital_id, destination_hospital_id,
                             status, departed_at, arrived_at)
SELECT o.organ_id, o.recovering_hospital_id, r.hospital_id,
       CASE WHEN t.outcome = 'DISCARD_TF' THEN 'FAILED' ELSE 'DELIVERED' END,
       t.recovered_at + INTERVAL '1 hour',
       CASE WHEN t.outcome = 'DISCARD_TF' THEN NULL
            WHEN o.recovering_hospital_id = r.hospital_id
                 THEN t.recovered_at + INTERVAL '1 hour'
            ELSE t.recovered_at + INTERVAL '3 hours'
       END
FROM hist_timeline t
JOIN donor d      ON d.name = t.donor
JOIN organ o      ON o.donor_id = d.donor_id AND o.recovered_at = t.recovered_at
JOIN organ_offer f ON f.organ_id = o.organ_id AND f.status = 'ACCEPTED'
JOIN recipient r   ON r.recipient_id = f.recipient_id
WHERE t.outcome IN ('SUCCESS', 'FAILED', 'NOT_USED', 'DISCARD_TF');

-- --- Transplant events ----------------------------------------------------
INSERT INTO transplant_event(offer_id, hospital_id, transplant_at, outcome, notes)
SELECT f.offer_id, r.hospital_id, t.recovered_at + INTERVAL '5 hours',
       CASE t.outcome
           WHEN 'FAILED'   THEN 'FAILED'
           WHEN 'NOT_USED' THEN 'ORGAN_NOT_USED'
           ELSE 'SUCCESS'
       END,
       CASE t.outcome
           WHEN 'FAILED'   THEN 'Recipient did not survive the procedure'
           WHEN 'NOT_USED' THEN 'Organ assessed unsuitable on receipt; not implanted'
           ELSE 'Uneventful recovery'
       END
FROM hist_timeline t
JOIN donor d      ON d.name = t.donor
JOIN organ o      ON o.donor_id = d.donor_id AND o.recovered_at = t.recovered_at
JOIN organ_offer f ON f.organ_id = o.organ_id AND f.status = 'ACCEPTED'
JOIN recipient r   ON r.recipient_id = f.recipient_id
WHERE t.outcome IN ('SUCCESS', 'FAILED', 'NOT_USED');

COMMIT;
