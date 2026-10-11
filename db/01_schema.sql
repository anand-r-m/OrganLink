-- =====================================================================
-- OrganLink — Organ Transplant and Allocation System
-- PostgreSQL Schema (BCNF)
-- 23CSE202 Database Management Systems | Group A12
-- =====================================================================
-- Run order: this file, then 02_seed_reference.sql, then 03_seed_demo.sql
-- Requires PostgreSQL 14+
-- =====================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- =====================================================================
-- SECTION 1 — REFERENCE DATA
-- =====================================================================

-- Region carries the allocation policy weights directly.
-- FD: region_id -> weights. The determinant is the key, so the weights
-- belong in this relation; a separate allocation_policy table would be
-- unjustified decomposition (1:1 with no independent key).
CREATE TABLE region (
    region_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    region_code      TEXT    NOT NULL UNIQUE,
    region_name      TEXT    NOT NULL,
    hla_weight       NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (hla_weight      >= 0),
    urgency_weight   NUMERIC(5,2) NOT NULL DEFAULT 35 CHECK (urgency_weight  >= 0),
    distance_weight  NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (distance_weight >= 0),
    wait_weight      NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (wait_weight     >= 0),
    CONSTRAINT ck_region_weights_nonzero
        CHECK (hla_weight + urgency_weight + distance_weight + wait_weight > 0)
);

CREATE TABLE hospital (
    hospital_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         TEXT NOT NULL,
    address      TEXT,
    phone        TEXT,
    latitude     NUMERIC(9,6) NOT NULL CHECK (latitude  BETWEEN  -90 AND  90),
    longitude    NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    region_id    BIGINT NOT NULL REFERENCES region(region_id) ON DELETE RESTRICT,
    status       TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE','SUSPENDED'))
);

CREATE TABLE organ_type (
    organ_type_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                  TEXT NOT NULL UNIQUE,
    max_viability_hours   INTEGER NOT NULL CHECK (max_viability_hours  > 0),
    response_window_hours INTEGER NOT NULL CHECK (response_window_hours > 0),
    priority_weight       NUMERIC(5,2) NOT NULL DEFAULT 1,
    min_weight_ratio      NUMERIC(4,2) NOT NULL CHECK (min_weight_ratio > 0),
    max_weight_ratio      NUMERIC(4,2) NOT NULL,
    CONSTRAINT ck_organ_type_ratio_order CHECK (max_weight_ratio > min_weight_ratio)
);

CREATE TABLE blood_group (
    blood_group_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_name     TEXT NOT NULL UNIQUE
);

-- All-key relation plus one attribute determined by the full key.
-- FD: (donor_bg_id, recipient_bg_id) -> compatible. BCNF.
-- All 64 pairs are stored (not only compatible ones) because the
-- Settings compatibility matrix renders an 8x8 grid of toggles.
CREATE TABLE blood_compatibility (
    donor_bg_id     BIGINT NOT NULL REFERENCES blood_group(blood_group_id) ON DELETE RESTRICT,
    recipient_bg_id BIGINT NOT NULL REFERENCES blood_group(blood_group_id) ON DELETE RESTRICT,
    compatible      BOOLEAN NOT NULL,
    PRIMARY KEY (donor_bg_id, recipient_bg_id)
);

CREATE TABLE hla_allele (
    allele_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    locus       TEXT NOT NULL CHECK (locus IN ('A','B','DRB1')),
    allele_name TEXT NOT NULL,
    CONSTRAINT ux_hla_allele_natural UNIQUE (locus, allele_name)
);

-- Urgency is a lookup rather than a CHECK because it carries score_value.
-- Keeping the score as data means the scoring formula has no magic numbers.
CREATE TABLE urgency (
    urgency_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    score_value NUMERIC(5,2) NOT NULL CHECK (score_value BETWEEN 0 AND 100)
);

CREATE TABLE decline_reason (
    decline_reason_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE,
    description       TEXT NOT NULL
);

CREATE TABLE discard_reason (
    discard_reason_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE,
    description       TEXT NOT NULL
);

CREATE TABLE exclusion_reason (
    exclusion_reason_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code                TEXT NOT NULL UNIQUE,
    description         TEXT NOT NULL
);

CREATE TABLE role (
    role_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name TEXT NOT NULL UNIQUE
);

-- =====================================================================
-- SECTION 2 — USERS
-- =====================================================================
-- Roles are modelled but not enforced in this phase: a single
-- administrative account holds full access. Access control by role is
-- documented as future work.

CREATE TABLE app_user (
    user_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role_id       BIGINT NOT NULL REFERENCES role(role_id) ON DELETE RESTRICT,
    status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','INACTIVE'))
);

-- =====================================================================
-- SECTION 3 — DONORS AND RECIPIENTS
-- =====================================================================

CREATE TABLE donor (
    donor_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           TEXT NOT NULL,
    date_of_birth  DATE NOT NULL,
    blood_group_id BIGINT NOT NULL REFERENCES blood_group(blood_group_id) ON DELETE RESTRICT,
    hospital_id    BIGINT NOT NULL REFERENCES hospital(hospital_id)       ON DELETE RESTRICT,
    donor_type     TEXT NOT NULL CHECK (donor_type IN ('LIVING','DECEASED')),
    status         TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INACTIVE')),
    height_cm      NUMERIC(5,2) NOT NULL CHECK (height_cm BETWEEN 30 AND 260),
    weight_kg      NUMERIC(5,2) NOT NULL CHECK (weight_kg BETWEEN  1 AND 400),
    death_date     TIMESTAMPTZ,
    death_cause    TEXT,
    -- donor_type constrains nullability, not value: this is a CHECK,
    -- not a functional dependency.
    CONSTRAINT ck_donor_death_fields CHECK (
        (donor_type = 'DECEASED' AND death_date IS NOT NULL)
     OR (donor_type = 'LIVING'   AND death_date IS NULL AND death_cause IS NULL)
    ),
    CONSTRAINT ck_donor_death_after_birth
        CHECK (death_date IS NULL OR death_date > date_of_birth)
);

CREATE TABLE recipient (
    recipient_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           TEXT NOT NULL,
    date_of_birth  DATE NOT NULL,
    blood_group_id BIGINT NOT NULL REFERENCES blood_group(blood_group_id) ON DELETE RESTRICT,
    hospital_id    BIGINT NOT NULL REFERENCES hospital(hospital_id)       ON DELETE RESTRICT,
    status         TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE','INACTIVE','TRANSPLANTED','DECEASED')),
    height_cm      NUMERIC(5,2) NOT NULL CHECK (height_cm BETWEEN 30 AND 260),
    weight_kg      NUMERIC(5,2) NOT NULL CHECK (weight_kg BETWEEN  1 AND 400)
);

-- All-key relations. `locus` is deliberately absent: FD allele_id -> locus
-- would otherwise have a non-superkey determinant, violating BCNF.
-- Locus is obtained by joining hla_allele.
CREATE TABLE donor_hla (
    donor_id  BIGINT NOT NULL REFERENCES donor(donor_id)       ON DELETE CASCADE,
    allele_id BIGINT NOT NULL REFERENCES hla_allele(allele_id) ON DELETE RESTRICT,
    PRIMARY KEY (donor_id, allele_id)
);

CREATE TABLE recipient_hla (
    recipient_id BIGINT NOT NULL REFERENCES recipient(recipient_id) ON DELETE CASCADE,
    allele_id    BIGINT NOT NULL REFERENCES hla_allele(allele_id)   ON DELETE RESTRICT,
    PRIMARY KEY (recipient_id, allele_id)
);

-- =====================================================================
-- SECTION 4 — WAITLIST
-- =====================================================================
-- A recipient may be waitlisted for several organ types simultaneously
-- (e.g. kidney-pancreas), each with independent urgency and listing date.
-- No priority_score column: it depends on now() and is computed by
-- v_waitlist_scored.

CREATE TABLE waitlist_entry (
    recipient_id  BIGINT NOT NULL REFERENCES recipient(recipient_id)   ON DELETE CASCADE,
    organ_type_id BIGINT NOT NULL REFERENCES organ_type(organ_type_id) ON DELETE RESTRICT,
    urgency_id    BIGINT NOT NULL REFERENCES urgency(urgency_id)       ON DELETE RESTRICT,
    listed_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','TRANSPLANTED','REMOVED')),
    PRIMARY KEY (recipient_id, organ_type_id),
    CONSTRAINT ck_waitlist_not_future CHECK (listed_date <= CURRENT_DATE)
);

-- =====================================================================
-- SECTION 5 — ORGANS
-- =====================================================================
-- No expires_at column. FD (recovered_at, organ_type_id) -> expires_at
-- has a non-superkey determinant and violates BCNF. The attribute is
-- eliminated rather than decomposed; v_organ computes it.

CREATE TABLE organ (
    organ_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    donor_id               BIGINT NOT NULL REFERENCES donor(donor_id)             ON DELETE RESTRICT,
    organ_type_id          BIGINT NOT NULL REFERENCES organ_type(organ_type_id)   ON DELETE RESTRICT,
    recovering_hospital_id BIGINT NOT NULL REFERENCES hospital(hospital_id)       ON DELETE RESTRICT,
    recovered_at           TIMESTAMPTZ NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'AVAILABLE'
                           CHECK (status IN ('AVAILABLE','ALLOCATED','TRANSPLANTED','EXPIRED','DISCARDED')),
    discard_reason_id      BIGINT REFERENCES discard_reason(discard_reason_id) ON DELETE RESTRICT,
    CONSTRAINT ck_organ_discard_reason CHECK (
        (status = 'DISCARDED' AND discard_reason_id IS NOT NULL)
     OR (status <> 'DISCARDED' AND discard_reason_id IS NULL)
    ),
    CONSTRAINT ck_organ_not_future CHECK (recovered_at <= now())
);

-- =====================================================================
-- SECTION 6 — MATCHING
-- =====================================================================
-- Match runs are persisted and append-only. This is the only durable
-- record of *why* a recipient was selected, and it backs the fairness
-- and decline-reason reports.

CREATE TABLE match_run (
    run_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organ_id        BIGINT NOT NULL REFERENCES organ(organ_id) ON DELETE RESTRICT,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    hla_weight      NUMERIC(5,2) NOT NULL CHECK (hla_weight      >= 0),
    urgency_weight  NUMERIC(5,2) NOT NULL CHECK (urgency_weight  >= 0),
    distance_weight NUMERIC(5,2) NOT NULL CHECK (distance_weight >= 0),
    wait_weight     NUMERIC(5,2) NOT NULL CHECK (wait_weight     >= 0),
    run_by          BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    -- Redundant with the primary key; it exists only as the target of
    -- organ_offer's composite provenance FK (OL-039).
    CONSTRAINT ux_match_run_run_organ UNIQUE (run_id, organ_id)
);

CREATE TABLE match_result (
    run_id              BIGINT NOT NULL REFERENCES match_run(run_id)       ON DELETE CASCADE,
    recipient_id        BIGINT NOT NULL REFERENCES recipient(recipient_id) ON DELETE RESTRICT,
    rank                INTEGER,
    match_score         NUMERIC(5,2),
    hla_score           NUMERIC(5,2),
    urgency_score       NUMERIC(5,2),
    distance_score      NUMERIC(5,2),
    wait_score          NUMERIC(5,2),
    distance_km         NUMERIC(8,2),
    qualified           BOOLEAN NOT NULL,
    exclusion_reason_id BIGINT REFERENCES exclusion_reason(exclusion_reason_id) ON DELETE RESTRICT,
    PRIMARY KEY (run_id, recipient_id),
    -- Qualified candidates are ranked and scored; excluded ones carry a reason.
    CONSTRAINT ck_match_result_shape CHECK (
        (qualified     AND rank IS NOT NULL AND match_score IS NOT NULL
                       AND exclusion_reason_id IS NULL)
     OR (NOT qualified AND rank IS NULL     AND exclusion_reason_id IS NOT NULL)
    )
);

-- =====================================================================
-- SECTION 7 — OFFERS, TRANSPLANTS, TRANSPORT
-- =====================================================================
-- No offer_expires_at column: derived from sent_at and the organ type's
-- response window. created_at exists so that abandoned CREATED offers can
-- be swept; without it an unsent offer would hold the active-offer lock
-- on its organ permanently.

CREATE TABLE organ_offer (
    offer_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organ_id          BIGINT NOT NULL REFERENCES organ(organ_id)         ON DELETE RESTRICT,
    recipient_id      BIGINT NOT NULL REFERENCES recipient(recipient_id) ON DELETE RESTRICT,
    run_id            BIGINT,
    status            TEXT NOT NULL DEFAULT 'CREATED'
                      CHECK (status IN ('CREATED','SENT','ACCEPTED','DECLINED',
                                        'EXPIRED','VOIDED','CANCELLED')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    decline_reason_id BIGINT REFERENCES decline_reason(decline_reason_id) ON DELETE RESTRICT,
    void_reason       TEXT,
    notes             TEXT,
    created_by        BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    -- sent_at is required only for statuses that imply the offer was sent.
    -- CANCELLED and VOIDED can both occur before sending.
    CONSTRAINT ck_offer_sent      CHECK (
        status IN ('CREATED','CANCELLED','VOIDED') OR sent_at IS NOT NULL),
    CONSTRAINT ck_offer_decline   CHECK (
        (status = 'DECLINED' AND decline_reason_id IS NOT NULL)
     OR (status <> 'DECLINED' AND decline_reason_id IS NULL)),
    CONSTRAINT ck_offer_void      CHECK (
        (status = 'VOIDED' AND void_reason IS NOT NULL)
     OR (status <> 'VOIDED' AND void_reason IS NULL)),
    CONSTRAINT ck_offer_time_order CHECK (
        sent_at IS NULL OR sent_at >= created_at),
    -- An offer made from a match run must be for that run's organ (OL-039).
    -- MATCH SIMPLE (the default): an offer without a run (run_id NULL) is not
    -- checked. RESTRICT: a run that an offer references cannot be deleted
    -- (match runs are permanent, BR-6).
    CONSTRAINT fk_offer_run_same_organ FOREIGN KEY (run_id, organ_id)
        REFERENCES match_run (run_id, organ_id) ON DELETE RESTRICT
);

CREATE TABLE transport_record (
    transport_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organ_id                BIGINT NOT NULL UNIQUE REFERENCES organ(organ_id) ON DELETE RESTRICT,
    origin_hospital_id      BIGINT NOT NULL REFERENCES hospital(hospital_id)  ON DELETE RESTRICT,
    destination_hospital_id BIGINT NOT NULL REFERENCES hospital(hospital_id)  ON DELETE RESTRICT,
    status                  TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','IN_TRANSIT','DELIVERED','FAILED')),
    departed_at             TIMESTAMPTZ,
    arrived_at              TIMESTAMPTZ,
    CONSTRAINT ck_transport_time_order CHECK (
        arrived_at IS NULL OR departed_at IS NULL OR arrived_at >= departed_at)
);

CREATE TABLE transplant_event (
    transplant_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    offer_id      BIGINT NOT NULL UNIQUE REFERENCES organ_offer(offer_id) ON DELETE RESTRICT,
    hospital_id   BIGINT NOT NULL REFERENCES hospital(hospital_id)        ON DELETE RESTRICT,
    transplant_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome       TEXT NOT NULL CHECK (outcome IN ('SUCCESS','FAILED','ORGAN_NOT_USED')),
    notes         TEXT
);

-- =====================================================================
-- SECTION 8 — AUDIT
-- =====================================================================
-- old_values/new_values are JSONB. This is a deliberate 1NF exception:
-- an audit log must record rows from arbitrary tables, so a fixed
-- column set is impossible.

CREATE TABLE audit_log (
    audit_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id     TEXT NOT NULL,
    action     TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    old_values JSONB,
    new_values JSONB,
    user_id    BIGINT REFERENCES app_user(user_id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- SECTION 9 — INDEXES
-- =====================================================================

-- --- Rule enforcement (these ARE the business rules) ---

-- At most one active offer per organ. This constraint cannot be expressed
-- as a functional dependency because it is conditional on status.
CREATE UNIQUE INDEX ux_offer_active
    ON organ_offer(organ_id)
    WHERE status IN ('CREATED','SENT');

-- A recipient who declined an organ is never re-offered it. Voided and
-- cancelled offers are excluded: those recipients never actually declined.
CREATE UNIQUE INDEX ux_offer_no_reoffer
    ON organ_offer(organ_id, recipient_id)
    WHERE status NOT IN ('VOIDED','CANCELLED');

-- Rank is unique within a run, over qualified candidates only.
CREATE UNIQUE INDEX ux_match_rank
    ON match_result(run_id, rank)
    WHERE qualified;

-- --- Foreign key join paths (Postgres does not create these) ---

CREATE INDEX ix_waitlist_recipient  ON waitlist_entry(recipient_id);
CREATE INDEX ix_waitlist_organ_type ON waitlist_entry(organ_type_id);
CREATE INDEX ix_organ_donor         ON organ(donor_id);
CREATE INDEX ix_offer_organ         ON organ_offer(organ_id);
CREATE INDEX ix_offer_recipient     ON organ_offer(recipient_id);
CREATE INDEX ix_match_result_run    ON match_result(run_id);
CREATE INDEX ix_audit_table_row     ON audit_log(table_name, row_id);

-- --- Hot query paths ---

CREATE INDEX ix_organ_available ON organ(status) WHERE status = 'AVAILABLE';
CREATE INDEX ix_offer_open      ON organ_offer(status) WHERE status IN ('CREATED','SENT');

-- Note: no index on organ(recovered_at) for the expiry sweep. The sweep
-- predicate is recovered_at + (max_viability_hours * interval), which
-- varies by organ type and cannot use a plain index on recovered_at.

-- =====================================================================
-- SECTION 10 — HELPER FUNCTIONS
-- =====================================================================

-- Great-circle distance in km.
CREATE OR REPLACE FUNCTION haversine_km(
    lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    r CONSTANT NUMERIC := 6371;
    dlat NUMERIC := radians(lat2 - lat1);
    dlon NUMERIC := radians(lon2 - lon1);
    a NUMERIC;
BEGIN
    a := sin(dlat/2)^2
       + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)^2;
    RETURN ROUND((r * 2 * atan2(sqrt(a), sqrt(1-a)))::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Current application user, set per-transaction by the API layer via
--   SET LOCAL app.user_id = <id>
-- Triggers run inside Postgres and have no other way to know the actor.
CREATE OR REPLACE FUNCTION current_app_user() RETURNS BIGINT AS $$
BEGIN
    RETURN NULLIF(current_setting('app.user_id', true), '')::BIGINT;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================================
-- SECTION 11 — DERIVED VIEWS
-- =====================================================================

-- Organ with its computed viability window.
CREATE VIEW v_organ AS
SELECT o.*,
       ot.name AS organ_type_name,
       ot.max_viability_hours,
       o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour') AS expires_at,
       GREATEST(0, EXTRACT(EPOCH FROM
           (o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour')) - now()
       ) / 3600)::NUMERIC(8,2) AS hours_remaining,
       (now() > o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour')) AS is_expired
FROM organ o
JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id;

-- Offer with its computed response deadline.
CREATE VIEW v_offer AS
SELECT f.*,
       ot.response_window_hours,
       f.sent_at + (ot.response_window_hours * INTERVAL '1 hour') AS offer_expires_at
FROM organ_offer f
JOIN organ      o  ON o.organ_id      = f.organ_id
JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id;

-- Waitlist priority score: organ-INDEPENDENT.
-- Uses only urgency and waiting time, because HLA mismatch and distance
-- are undefined until a specific donor organ is named. This is a
-- different quantity from match_score and is named differently.
CREATE VIEW v_waitlist_scored AS
WITH base AS (
    SELECT w.recipient_id,
           w.organ_type_id,
           w.urgency_id,
           w.listed_date,
           w.status,
           r.hospital_id,
           h.region_id,
           u.code        AS urgency_code,
           u.score_value AS urgency_score,
           reg.urgency_weight,
           reg.wait_weight,
           (EXTRACT(EPOCH FROM age(now(), w.listed_date)) / (30.44*86400))::NUMERIC AS wait_months
    FROM waitlist_entry w
    JOIN recipient  r   ON r.recipient_id = w.recipient_id
    JOIN hospital   h   ON h.hospital_id  = r.hospital_id
    JOIN region     reg ON reg.region_id  = h.region_id
    JOIN urgency    u   ON u.urgency_id   = w.urgency_id
)
SELECT b.*,
       LEAST(100, 100 * ln(1 + b.wait_months) / ln(61::NUMERIC))::NUMERIC(5,2) AS wait_score,
       ROUND(
           ((b.urgency_score * b.urgency_weight
          + LEAST(100, 100 * ln(1 + b.wait_months) / ln(61::NUMERIC)) * b.wait_weight)
         / NULLIF(b.urgency_weight + b.wait_weight, 0))::NUMERIC
       , 2) AS priority_score
FROM base b;

-- =====================================================================
-- SECTION 12 — TRIGGERS
-- =====================================================================

-- --- 12.1 Generic audit trigger ---------------------------------------
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

CREATE TRIGGER trg_audit_donor       AFTER INSERT OR UPDATE OR DELETE ON donor
    FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_recipient   AFTER INSERT OR UPDATE OR DELETE ON recipient
    FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_organ       AFTER INSERT OR UPDATE OR DELETE ON organ
    FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_offer       AFTER INSERT OR UPDATE OR DELETE ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_audit('offer_id');
CREATE TRIGGER trg_audit_transplant  AFTER INSERT OR UPDATE OR DELETE ON transplant_event
    FOR EACH ROW EXECUTE FUNCTION fn_audit('transplant_id');
CREATE TRIGGER trg_audit_waitlist    AFTER INSERT OR UPDATE OR DELETE ON waitlist_entry
    FOR EACH ROW EXECUTE FUNCTION fn_audit();

-- --- 12.2 Offer compatibility guard -----------------------------------
-- Enforces ABO compatibility, active waitlist entry, and size ratio.
-- These are hard medical constraints; no score compensates for them.
CREATE OR REPLACE FUNCTION fn_offer_compatibility() RETURNS TRIGGER AS $$
DECLARE
    v_donor_bg BIGINT; v_recip_bg BIGINT;
    v_compatible BOOLEAN;
    v_organ_type BIGINT;
    v_wl_status TEXT;
    v_ratio NUMERIC; v_min NUMERIC; v_max NUMERIC;
    v_recip_status TEXT;
BEGIN
    SELECT d.blood_group_id, o.organ_type_id, d.weight_kg
      INTO v_donor_bg, v_organ_type, v_ratio
      FROM organ o JOIN donor d ON d.donor_id = o.donor_id
     WHERE o.organ_id = NEW.organ_id;

    SELECT blood_group_id, status INTO v_recip_bg, v_recip_status
      FROM recipient WHERE recipient_id = NEW.recipient_id;

    IF v_recip_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Recipient % is not active', NEW.recipient_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT compatible INTO v_compatible
      FROM blood_compatibility
     WHERE donor_bg_id = v_donor_bg AND recipient_bg_id = v_recip_bg;

    IF NOT COALESCE(v_compatible, FALSE) THEN
        RAISE EXCEPTION 'Blood group incompatible for offer on organ %', NEW.organ_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT status INTO v_wl_status
      FROM waitlist_entry
     WHERE recipient_id = NEW.recipient_id AND organ_type_id = v_organ_type;

    IF v_wl_status IS NULL OR v_wl_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Recipient % has no active waitlist entry for this organ type',
            NEW.recipient_id USING ERRCODE = 'P0001';
    END IF;

    SELECT v_ratio / r.weight_kg, ot.min_weight_ratio, ot.max_weight_ratio
      INTO v_ratio, v_min, v_max
      FROM recipient r
      JOIN organ_type ot ON ot.organ_type_id = v_organ_type
     WHERE r.recipient_id = NEW.recipient_id;

    IF v_ratio < v_min OR v_ratio > v_max THEN
        RAISE EXCEPTION 'Donor/recipient size ratio %.2f outside permitted range %.2f-%.2f',
            v_ratio, v_min, v_max USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_compatibility
    BEFORE INSERT ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_offer_compatibility();

-- --- 12.3 Offer viability guard ---------------------------------------
CREATE OR REPLACE FUNCTION fn_offer_viability() RETURNS TRIGGER AS $$
DECLARE
    v_expired BOOLEAN; v_status TEXT;
BEGIN
    SELECT is_expired, status INTO v_expired, v_status
      FROM v_organ WHERE organ_id = NEW.organ_id;

    IF v_status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Organ % is not available (status %)', NEW.organ_id, v_status
            USING ERRCODE = 'P0001';
    END IF;

    IF v_expired THEN
        RAISE EXCEPTION 'Organ % has exceeded its viability window', NEW.organ_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_viability
    BEFORE INSERT ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_offer_viability();

-- --- 12.4 Accept re-check (race condition guard) ----------------------
-- The UI may have been showing stale data. Acceptance re-verifies
-- viability and recipient status INSIDE the transaction.
CREATE OR REPLACE FUNCTION fn_accept_recheck() RETURNS TRIGGER AS $$
DECLARE
    v_expired BOOLEAN; v_recip_status TEXT;
BEGIN
    IF NEW.status = 'ACCEPTED' AND OLD.status <> 'ACCEPTED' THEN
        SELECT is_expired INTO v_expired FROM v_organ WHERE organ_id = NEW.organ_id;
        IF v_expired THEN
            RAISE EXCEPTION 'Cannot accept: organ % expired before acceptance', NEW.organ_id
                USING ERRCODE = 'P0001';
        END IF;

        SELECT status INTO v_recip_status FROM recipient WHERE recipient_id = NEW.recipient_id;
        IF v_recip_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Cannot accept: recipient % is no longer active', NEW.recipient_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accept_recheck
    BEFORE UPDATE ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_accept_recheck();

-- --- 12.5 Offer accepted cascade --------------------------------------
-- Acceptance means "we will take it", not "surgery happened". The organ
-- becomes ALLOCATED and transport is created; the transplant is a
-- separate later event with its own outcome.
CREATE OR REPLACE FUNCTION fn_offer_accepted() RETURNS TRIGGER AS $$
DECLARE
    v_origin BIGINT; v_dest BIGINT;
BEGIN
    IF NEW.status = 'ACCEPTED' AND OLD.status <> 'ACCEPTED' THEN
        UPDATE organ SET status = 'ALLOCATED' WHERE organ_id = NEW.organ_id;

        SELECT o.recovering_hospital_id, r.hospital_id INTO v_origin, v_dest
          FROM organ o, recipient r
         WHERE o.organ_id = NEW.organ_id AND r.recipient_id = NEW.recipient_id;

        -- Same-hospital transplants need no journey.
        INSERT INTO transport_record(organ_id, origin_hospital_id,
                                     destination_hospital_id, status,
                                     departed_at, arrived_at)
        VALUES (NEW.organ_id, v_origin, v_dest,
                CASE WHEN v_origin = v_dest THEN 'DELIVERED' ELSE 'PENDING' END,
                CASE WHEN v_origin = v_dest THEN now() END,
                CASE WHEN v_origin = v_dest THEN now() END)
        ON CONFLICT (organ_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_accepted
    AFTER UPDATE ON organ_offer
    FOR EACH ROW EXECUTE FUNCTION fn_offer_accepted();

-- --- 12.6 Transplant requires delivery --------------------------------
CREATE OR REPLACE FUNCTION fn_transplant_requires_delivery() RETURNS TRIGGER AS $$
DECLARE
    v_organ BIGINT; v_transport_status TEXT; v_offer_status TEXT;
BEGIN
    SELECT organ_id, status INTO v_organ, v_offer_status
      FROM organ_offer WHERE offer_id = NEW.offer_id;

    IF v_offer_status <> 'ACCEPTED' THEN
        RAISE EXCEPTION 'Cannot record transplant: offer % is not accepted', NEW.offer_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT status INTO v_transport_status
      FROM transport_record WHERE organ_id = v_organ;

    IF COALESCE(v_transport_status, 'NONE') <> 'DELIVERED' THEN
        RAISE EXCEPTION 'Cannot record transplant: organ % has not been delivered', v_organ
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transplant_requires_delivery
    BEFORE INSERT ON transplant_event
    FOR EACH ROW EXECUTE FUNCTION fn_transplant_requires_delivery();

-- --- 12.7 Transplant recorded cascade ---------------------------------
-- Closes ONLY the waitlist entry for this organ's type. A kidney-pancreas
-- candidate who received a kidney remains listed for a pancreas.
CREATE OR REPLACE FUNCTION fn_transplant_recorded() RETURNS TRIGGER AS $$
DECLARE
    v_organ BIGINT; v_recipient BIGINT; v_organ_type BIGINT;
BEGIN
    SELECT f.organ_id, f.recipient_id, o.organ_type_id
      INTO v_organ, v_recipient, v_organ_type
      FROM organ_offer f JOIN organ o ON o.organ_id = f.organ_id
     WHERE f.offer_id = NEW.offer_id;

    IF NEW.outcome = 'SUCCESS' THEN
        UPDATE organ SET status = 'TRANSPLANTED' WHERE organ_id = v_organ;
        UPDATE waitlist_entry SET status = 'TRANSPLANTED'
         WHERE recipient_id = v_recipient AND organ_type_id = v_organ_type;
    ELSE
        UPDATE organ
           SET status = 'DISCARDED',
               discard_reason_id = (SELECT discard_reason_id FROM discard_reason
                                     WHERE code = 'TRANSPLANT_FAILED')
         WHERE organ_id = v_organ;
        UPDATE waitlist_entry SET status = 'REMOVED'
         WHERE recipient_id = v_recipient AND organ_type_id = v_organ_type;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transplant_recorded
    AFTER INSERT ON transplant_event
    FOR EACH ROW EXECUTE FUNCTION fn_transplant_recorded();

-- --- 12.8 Organ status transition guard -------------------------------
CREATE OR REPLACE FUNCTION fn_organ_status_transitions() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;

    IF OLD.status IN ('TRANSPLANTED','DISCARDED') THEN
        RAISE EXCEPTION 'Organ % is in terminal state %; cannot change to %',
            OLD.organ_id, OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status = 'EXPIRED' AND NEW.status NOT IN ('DISCARDED') THEN
        RAISE EXCEPTION 'Expired organ % may only be discarded', OLD.organ_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organ_status_transitions
    BEFORE UPDATE ON organ
    FOR EACH ROW EXECUTE FUNCTION fn_organ_status_transitions();

-- =====================================================================
-- SECTION 13 — SWEEP FUNCTION
-- =====================================================================
-- Nothing in a database expires by itself. This function is called by the
-- API at the start of any offer-, organ-, matching-, or transport-related
-- request. It keeps `status` a real, indexable column rather than a
-- computed value, which the partial unique indexes above depend on.

CREATE OR REPLACE FUNCTION expire_stale_offers() RETURNS VOID AS $$
BEGIN
    -- 1. SENT offers past their response window
    UPDATE organ_offer f
       SET status = 'EXPIRED', responded_at = now()
      FROM organ o JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
     WHERE f.organ_id = o.organ_id
       AND f.status = 'SENT'
       AND now() > f.sent_at + (ot.response_window_hours * INTERVAL '1 hour');

    -- 2. CREATED offers abandoned for more than one hour. Without this,
    --    an unsent offer holds ux_offer_active on its organ forever.
    UPDATE organ_offer
       SET status = 'CANCELLED'
     WHERE status = 'CREATED'
       AND now() > created_at + INTERVAL '1 hour';

    -- 3. Organs past their viability window
    UPDATE organ o
       SET status = 'EXPIRED'
      FROM organ_type ot
     WHERE ot.organ_type_id = o.organ_type_id
       AND o.status = 'AVAILABLE'
       AND now() > o.recovered_at + (ot.max_viability_hours * INTERVAL '1 hour');

    -- 4. Void open offers on organs that just expired
    UPDATE organ_offer f
       SET status = 'VOIDED', void_reason = 'Organ viability window elapsed',
           responded_at = now()
      FROM organ o
     WHERE f.organ_id = o.organ_id
       AND f.status IN ('CREATED','SENT')
       AND o.status = 'EXPIRED';

    -- 5. Void open offers whose recipient is no longer active
    UPDATE organ_offer f
       SET status = 'VOIDED', void_reason = 'Recipient no longer active',
           responded_at = now()
      FROM recipient r
     WHERE f.recipient_id = r.recipient_id
       AND f.status IN ('CREATED','SENT')
       AND r.status <> 'ACTIVE';

    -- 6. Fail transports carrying expired organs
    UPDATE transport_record t
       SET status = 'FAILED'
      FROM organ o
     WHERE t.organ_id = o.organ_id
       AND t.status IN ('PENDING','IN_TRANSIT')
       AND o.status = 'EXPIRED';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- SECTION 14 — MATCHING ENGINE
-- =====================================================================
-- Evaluates every waitlisted recipient for a given organ, persists the
-- run and all results (qualified and excluded), and returns the run id.
--
-- Scoring (each component normalised to 0-100):
--   hla_score      = (8 - weighted_mismatches) / 8 * 100   [DRB1 counts double]
--   urgency_score  = urgency.score_value
--   distance_score = 100 * exp(-km / 500)
--   wait_score     = min(100, 100 * ln(1 + months) / ln(61))
--   match_score    = SUM(component * weight) / SUM(weights)
--
-- Dividing by the weight sum keeps the total on 0-100 regardless of how
-- the policy sliders are set.

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

-- =====================================================================
-- SECTION 15 — REPORTING VIEWS
-- =====================================================================

-- Waiting time distribution, bucketed. Backs the Reports bar chart.
CREATE VIEW v_waiting_time_distribution AS
SELECT ot.name AS organ_type,
       width_bucket(
           EXTRACT(EPOCH FROM age(now(), w.listed_date)) / (30.44*86400),
           0, 60, 12) AS bucket,
       COUNT(*) AS recipients
FROM waitlist_entry w
JOIN organ_type ot ON ot.organ_type_id = w.organ_type_id
WHERE w.status = 'ACTIVE'
GROUP BY ot.name, bucket;

-- Organ utilization by region. Backs the donut chart.
CREATE VIEW v_organ_utilization AS
SELECT reg.region_name,
       ot.name AS organ_type,
       COUNT(*) FILTER (WHERE o.status = 'TRANSPLANTED') AS transplanted,
       COUNT(*) FILTER (WHERE o.status = 'EXPIRED')      AS expired,
       COUNT(*) FILTER (WHERE o.status = 'DISCARDED')    AS discarded,
       COUNT(*)                                          AS total_recovered,
       ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'TRANSPLANTED')
             / NULLIF(COUNT(*),0), 2) AS utilization_pct
FROM organ o
JOIN hospital h   ON h.hospital_id = o.recovering_hospital_id
JOIN region   reg ON reg.region_id = h.region_id
JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
GROUP BY reg.region_name, ot.name;

-- Decline reasons. Backs the horizontal bar chart.
CREATE VIEW v_decline_reasons AS
SELECT dr.code, dr.description, COUNT(*) AS occurrences,
       ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (),0), 2) AS pct
FROM organ_offer f
JOIN decline_reason dr ON dr.decline_reason_id = f.decline_reason_id
WHERE f.status = 'DECLINED'
GROUP BY dr.code, dr.description;

-- Allocation fairness: three distinct metrics per region, not one number.
--   allocation_rate  — transplants relative to waitlist burden
--   median_wait_days — how long recipients waited before receiving
--   retention_pct    — organs recovered locally that stayed local
CREATE VIEW v_allocation_fairness AS
WITH waitlist_size AS (
    SELECT h.region_id, COUNT(*) AS listed
    FROM waitlist_entry w
    JOIN recipient r ON r.recipient_id = w.recipient_id
    JOIN hospital  h ON h.hospital_id  = r.hospital_id
    GROUP BY h.region_id
),
transplants AS (
    SELECT h.region_id,
           COUNT(*) AS completed,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (te.transplant_at - w.listed_date)) / 86400
           ) AS median_wait_days
    FROM transplant_event te
    JOIN organ_offer f ON f.offer_id = te.offer_id
    JOIN organ o       ON o.organ_id = f.organ_id
    JOIN recipient r   ON r.recipient_id = f.recipient_id
    JOIN hospital h    ON h.hospital_id = r.hospital_id
    JOIN waitlist_entry w ON w.recipient_id = r.recipient_id
                         AND w.organ_type_id = o.organ_type_id
    WHERE te.outcome = 'SUCCESS'
    GROUP BY h.region_id
),
retention AS (
    SELECT oh.region_id,
           COUNT(*) AS recovered,
           COUNT(*) FILTER (WHERE oh.region_id = rh.region_id) AS stayed_local
    FROM transplant_event te
    JOIN organ_offer f ON f.offer_id = te.offer_id
    JOIN organ o       ON o.organ_id = f.organ_id
    JOIN hospital oh   ON oh.hospital_id = o.recovering_hospital_id
    JOIN recipient r   ON r.recipient_id = f.recipient_id
    JOIN hospital rh   ON rh.hospital_id = r.hospital_id
    WHERE te.outcome = 'SUCCESS'
    GROUP BY oh.region_id
)
SELECT reg.region_name,
       COALESCE(ws.listed, 0)        AS waitlist_size,
       COALESCE(t.completed, 0)      AS transplants_completed,
       ROUND(100.0 * COALESCE(t.completed,0) / NULLIF(ws.listed,0), 2)
                                     AS allocation_rate_pct,
       ROUND(t.median_wait_days::NUMERIC, 1) AS median_wait_days,
       ROUND(100.0 * COALESCE(ret.stayed_local,0)
             / NULLIF(ret.recovered,0), 2)   AS retention_pct
FROM region reg
LEFT JOIN waitlist_size ws ON ws.region_id = reg.region_id
LEFT JOIN transplants   t  ON t.region_id  = reg.region_id
LEFT JOIN retention     ret ON ret.region_id = reg.region_id;

-- Compliance summary. Backs the 94.2%-style headline metric.
CREATE VIEW v_compliance_summary AS
SELECT
    COUNT(*) FILTER (WHERE o.status = 'TRANSPLANTED')                 AS transplanted,
    COUNT(*) FILTER (WHERE o.status = 'EXPIRED')                      AS expired_unallocated,
    COUNT(*) FILTER (WHERE o.status = 'DISCARDED')                    AS discarded,
    COUNT(*)                                                          AS total_organs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE o.status = 'TRANSPLANTED')
          / NULLIF(COUNT(*),0), 2)                                    AS placement_rate_pct
FROM organ o;

-- =====================================================================
-- END OF SCHEMA
-- 24 tables | 10 indexes | 8 trigger functions | 2 helper functions
-- 1 matching function | 1 sweep function | 10 views
-- =====================================================================
