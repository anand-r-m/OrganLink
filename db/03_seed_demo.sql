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
