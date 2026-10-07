--
-- PostgreSQL database dump
--

\restrict DAfF1l3ULKkhoazBcDEUdpmxGN651Ief3rkEWfHh9AAhEn0Udon8mbiEGka54q3

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: current_app_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.current_app_user() RETURNS bigint
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN NULLIF(current_setting('app.user_id', true), '')::BIGINT;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


ALTER FUNCTION public.current_app_user() OWNER TO postgres;

--
-- Name: expire_stale_offers(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expire_stale_offers() RETURNS void
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.expire_stale_offers() OWNER TO postgres;

--
-- Name: fn_accept_recheck(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_accept_recheck() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_accept_recheck() OWNER TO postgres;

--
-- Name: fn_audit(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_audit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_row_id TEXT;
BEGIN
    v_row_id := CASE TG_OP WHEN 'DELETE'
                THEN to_jsonb(OLD)::TEXT ELSE to_jsonb(NEW)::TEXT END;

    INSERT INTO audit_log(table_name, row_id, action, old_values, new_values, user_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(
            (to_jsonb(COALESCE(NEW, OLD)) ->> (TG_TABLE_NAME || '_id')),
            'composite'),
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
        current_app_user()
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.fn_audit() OWNER TO postgres;

--
-- Name: fn_offer_accepted(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_offer_accepted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_offer_accepted() OWNER TO postgres;

--
-- Name: fn_offer_compatibility(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_offer_compatibility() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_offer_compatibility() OWNER TO postgres;

--
-- Name: fn_offer_viability(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_offer_viability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_offer_viability() OWNER TO postgres;

--
-- Name: fn_organ_status_transitions(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_organ_status_transitions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_organ_status_transitions() OWNER TO postgres;

--
-- Name: fn_transplant_recorded(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_transplant_recorded() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_transplant_recorded() OWNER TO postgres;

--
-- Name: fn_transplant_requires_delivery(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_transplant_requires_delivery() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.fn_transplant_requires_delivery() OWNER TO postgres;

--
-- Name: haversine_km(numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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
$$;


ALTER FUNCTION public.haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) OWNER TO postgres;

--
-- Name: match_candidates(bigint, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.match_candidates(p_organ_id bigint, p_hla_w numeric DEFAULT NULL::numeric, p_urgency_w numeric DEFAULT NULL::numeric, p_distance_w numeric DEFAULT NULL::numeric, p_wait_w numeric DEFAULT NULL::numeric) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
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
           CASE WHEN s.exclusion_code IS NULL
                THEN RANK() OVER (PARTITION BY (s.exclusion_code IS NULL)
                                  ORDER BY s.match_score DESC, s.wait_score DESC)
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
$$;


ALTER FUNCTION public.match_candidates(p_organ_id bigint, p_hla_w numeric, p_urgency_w numeric, p_distance_w numeric, p_wait_w numeric) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_user (
    user_id bigint NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    role_id bigint NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    CONSTRAINT app_user_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])))
);


ALTER TABLE public.app_user OWNER TO postgres;

--
-- Name: app_user_user_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.app_user ALTER COLUMN user_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_user_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    audit_id bigint NOT NULL,
    table_name text NOT NULL,
    row_id text NOT NULL,
    action text NOT NULL,
    old_values jsonb,
    new_values jsonb,
    user_id bigint,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.audit_log ALTER COLUMN audit_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_log_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: blood_compatibility; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.blood_compatibility (
    donor_bg_id bigint NOT NULL,
    recipient_bg_id bigint NOT NULL,
    compatible boolean NOT NULL
);


ALTER TABLE public.blood_compatibility OWNER TO postgres;

--
-- Name: blood_group; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.blood_group (
    blood_group_id bigint NOT NULL,
    group_name text NOT NULL
);


ALTER TABLE public.blood_group OWNER TO postgres;

--
-- Name: blood_group_blood_group_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.blood_group ALTER COLUMN blood_group_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.blood_group_blood_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: decline_reason; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.decline_reason (
    decline_reason_id bigint NOT NULL,
    code text NOT NULL,
    description text NOT NULL
);


ALTER TABLE public.decline_reason OWNER TO postgres;

--
-- Name: decline_reason_decline_reason_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.decline_reason ALTER COLUMN decline_reason_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.decline_reason_decline_reason_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: discard_reason; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.discard_reason (
    discard_reason_id bigint NOT NULL,
    code text NOT NULL,
    description text NOT NULL
);


ALTER TABLE public.discard_reason OWNER TO postgres;

--
-- Name: discard_reason_discard_reason_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.discard_reason ALTER COLUMN discard_reason_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.discard_reason_discard_reason_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: donor; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.donor (
    donor_id bigint NOT NULL,
    name text NOT NULL,
    date_of_birth date NOT NULL,
    blood_group_id bigint NOT NULL,
    hospital_id bigint NOT NULL,
    donor_type text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    height_cm numeric(5,2) NOT NULL,
    weight_kg numeric(5,2) NOT NULL,
    death_date timestamp with time zone,
    death_cause text,
    CONSTRAINT ck_donor_death_after_birth CHECK (((death_date IS NULL) OR (death_date > date_of_birth))),
    CONSTRAINT ck_donor_death_fields CHECK ((((donor_type = 'DECEASED'::text) AND (death_date IS NOT NULL)) OR ((donor_type = 'LIVING'::text) AND (death_date IS NULL) AND (death_cause IS NULL)))),
    CONSTRAINT donor_donor_type_check CHECK ((donor_type = ANY (ARRAY['LIVING'::text, 'DECEASED'::text]))),
    CONSTRAINT donor_height_cm_check CHECK (((height_cm >= (30)::numeric) AND (height_cm <= (260)::numeric))),
    CONSTRAINT donor_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text]))),
    CONSTRAINT donor_weight_kg_check CHECK (((weight_kg >= (1)::numeric) AND (weight_kg <= (400)::numeric)))
);


ALTER TABLE public.donor OWNER TO postgres;

--
-- Name: donor_donor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.donor ALTER COLUMN donor_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.donor_donor_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: donor_hla; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.donor_hla (
    donor_id bigint NOT NULL,
    allele_id bigint NOT NULL
);


ALTER TABLE public.donor_hla OWNER TO postgres;

--
-- Name: exclusion_reason; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exclusion_reason (
    exclusion_reason_id bigint NOT NULL,
    code text NOT NULL,
    description text NOT NULL
);


ALTER TABLE public.exclusion_reason OWNER TO postgres;

--
-- Name: exclusion_reason_exclusion_reason_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.exclusion_reason ALTER COLUMN exclusion_reason_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exclusion_reason_exclusion_reason_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hla_allele; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hla_allele (
    allele_id bigint NOT NULL,
    locus text NOT NULL,
    allele_name text NOT NULL,
    CONSTRAINT hla_allele_locus_check CHECK ((locus = ANY (ARRAY['A'::text, 'B'::text, 'DRB1'::text])))
);


ALTER TABLE public.hla_allele OWNER TO postgres;

--
-- Name: hla_allele_allele_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.hla_allele ALTER COLUMN allele_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.hla_allele_allele_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hospital; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hospital (
    hospital_id bigint NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    region_id bigint NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    CONSTRAINT hospital_latitude_check CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT hospital_longitude_check CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
    CONSTRAINT hospital_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))
);


ALTER TABLE public.hospital OWNER TO postgres;

--
-- Name: hospital_hospital_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.hospital ALTER COLUMN hospital_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.hospital_hospital_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: match_result; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.match_result (
    run_id bigint NOT NULL,
    recipient_id bigint NOT NULL,
    rank integer,
    match_score numeric(5,2),
    hla_score numeric(5,2),
    urgency_score numeric(5,2),
    distance_score numeric(5,2),
    wait_score numeric(5,2),
    distance_km numeric(8,2),
    qualified boolean NOT NULL,
    exclusion_reason_id bigint,
    CONSTRAINT ck_match_result_shape CHECK (((qualified AND (rank IS NOT NULL) AND (match_score IS NOT NULL) AND (exclusion_reason_id IS NULL)) OR ((NOT qualified) AND (rank IS NULL) AND (exclusion_reason_id IS NOT NULL))))
);


ALTER TABLE public.match_result OWNER TO postgres;

--
-- Name: match_run; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.match_run (
    run_id bigint NOT NULL,
    organ_id bigint NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    hla_weight numeric(5,2) NOT NULL,
    urgency_weight numeric(5,2) NOT NULL,
    distance_weight numeric(5,2) NOT NULL,
    wait_weight numeric(5,2) NOT NULL,
    run_by bigint,
    CONSTRAINT match_run_distance_weight_check CHECK ((distance_weight >= (0)::numeric)),
    CONSTRAINT match_run_hla_weight_check CHECK ((hla_weight >= (0)::numeric)),
    CONSTRAINT match_run_urgency_weight_check CHECK ((urgency_weight >= (0)::numeric)),
    CONSTRAINT match_run_wait_weight_check CHECK ((wait_weight >= (0)::numeric))
);


ALTER TABLE public.match_run OWNER TO postgres;

--
-- Name: match_run_run_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.match_run ALTER COLUMN run_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.match_run_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: organ; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organ (
    organ_id bigint NOT NULL,
    donor_id bigint NOT NULL,
    organ_type_id bigint NOT NULL,
    recovering_hospital_id bigint NOT NULL,
    recovered_at timestamp with time zone NOT NULL,
    status text DEFAULT 'AVAILABLE'::text NOT NULL,
    discard_reason_id bigint,
    CONSTRAINT ck_organ_discard_reason CHECK ((((status = 'DISCARDED'::text) AND (discard_reason_id IS NOT NULL)) OR ((status <> 'DISCARDED'::text) AND (discard_reason_id IS NULL)))),
    CONSTRAINT ck_organ_not_future CHECK ((recovered_at <= now())),
    CONSTRAINT organ_status_check CHECK ((status = ANY (ARRAY['AVAILABLE'::text, 'ALLOCATED'::text, 'TRANSPLANTED'::text, 'EXPIRED'::text, 'DISCARDED'::text])))
);


ALTER TABLE public.organ OWNER TO postgres;

--
-- Name: organ_offer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organ_offer (
    offer_id bigint NOT NULL,
    organ_id bigint NOT NULL,
    recipient_id bigint NOT NULL,
    run_id bigint,
    status text DEFAULT 'CREATED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    responded_at timestamp with time zone,
    decline_reason_id bigint,
    void_reason text,
    notes text,
    created_by bigint,
    CONSTRAINT ck_offer_decline CHECK ((((status = 'DECLINED'::text) AND (decline_reason_id IS NOT NULL)) OR ((status <> 'DECLINED'::text) AND (decline_reason_id IS NULL)))),
    CONSTRAINT ck_offer_sent CHECK (((status = ANY (ARRAY['CREATED'::text, 'CANCELLED'::text, 'VOIDED'::text])) OR (sent_at IS NOT NULL))),
    CONSTRAINT ck_offer_time_order CHECK (((sent_at IS NULL) OR (sent_at >= created_at))),
    CONSTRAINT ck_offer_void CHECK ((((status = 'VOIDED'::text) AND (void_reason IS NOT NULL)) OR ((status <> 'VOIDED'::text) AND (void_reason IS NULL)))),
    CONSTRAINT organ_offer_status_check CHECK ((status = ANY (ARRAY['CREATED'::text, 'SENT'::text, 'ACCEPTED'::text, 'DECLINED'::text, 'EXPIRED'::text, 'VOIDED'::text, 'CANCELLED'::text])))
);


ALTER TABLE public.organ_offer OWNER TO postgres;

--
-- Name: organ_offer_offer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.organ_offer ALTER COLUMN offer_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organ_offer_offer_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: organ_organ_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.organ ALTER COLUMN organ_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organ_organ_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: organ_type; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organ_type (
    organ_type_id bigint NOT NULL,
    name text NOT NULL,
    max_viability_hours integer NOT NULL,
    response_window_hours integer NOT NULL,
    priority_weight numeric(5,2) DEFAULT 1 NOT NULL,
    min_weight_ratio numeric(4,2) NOT NULL,
    max_weight_ratio numeric(4,2) NOT NULL,
    CONSTRAINT ck_organ_type_ratio_order CHECK ((max_weight_ratio > min_weight_ratio)),
    CONSTRAINT organ_type_max_viability_hours_check CHECK ((max_viability_hours > 0)),
    CONSTRAINT organ_type_min_weight_ratio_check CHECK ((min_weight_ratio > (0)::numeric)),
    CONSTRAINT organ_type_response_window_hours_check CHECK ((response_window_hours > 0))
);


ALTER TABLE public.organ_type OWNER TO postgres;

--
-- Name: organ_type_organ_type_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.organ_type ALTER COLUMN organ_type_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.organ_type_organ_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: recipient; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipient (
    recipient_id bigint NOT NULL,
    name text NOT NULL,
    date_of_birth date NOT NULL,
    blood_group_id bigint NOT NULL,
    hospital_id bigint NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    height_cm numeric(5,2) NOT NULL,
    weight_kg numeric(5,2) NOT NULL,
    CONSTRAINT recipient_height_cm_check CHECK (((height_cm >= (30)::numeric) AND (height_cm <= (260)::numeric))),
    CONSTRAINT recipient_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'TRANSPLANTED'::text, 'DECEASED'::text]))),
    CONSTRAINT recipient_weight_kg_check CHECK (((weight_kg >= (1)::numeric) AND (weight_kg <= (400)::numeric)))
);


ALTER TABLE public.recipient OWNER TO postgres;

--
-- Name: recipient_hla; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipient_hla (
    recipient_id bigint NOT NULL,
    allele_id bigint NOT NULL
);


ALTER TABLE public.recipient_hla OWNER TO postgres;

--
-- Name: recipient_recipient_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.recipient ALTER COLUMN recipient_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recipient_recipient_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: region; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.region (
    region_id bigint NOT NULL,
    region_code text NOT NULL,
    region_name text NOT NULL,
    hla_weight numeric(5,2) DEFAULT 25 NOT NULL,
    urgency_weight numeric(5,2) DEFAULT 35 NOT NULL,
    distance_weight numeric(5,2) DEFAULT 20 NOT NULL,
    wait_weight numeric(5,2) DEFAULT 20 NOT NULL,
    CONSTRAINT ck_region_weights_nonzero CHECK (((((hla_weight + urgency_weight) + distance_weight) + wait_weight) > (0)::numeric)),
    CONSTRAINT region_distance_weight_check CHECK ((distance_weight >= (0)::numeric)),
    CONSTRAINT region_hla_weight_check CHECK ((hla_weight >= (0)::numeric)),
    CONSTRAINT region_urgency_weight_check CHECK ((urgency_weight >= (0)::numeric)),
    CONSTRAINT region_wait_weight_check CHECK ((wait_weight >= (0)::numeric))
);


ALTER TABLE public.region OWNER TO postgres;

--
-- Name: region_region_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.region ALTER COLUMN region_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.region_region_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: role; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role (
    role_id bigint NOT NULL,
    role_name text NOT NULL
);


ALTER TABLE public.role OWNER TO postgres;

--
-- Name: role_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.role ALTER COLUMN role_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.role_role_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: transplant_event; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transplant_event (
    transplant_id bigint NOT NULL,
    offer_id bigint NOT NULL,
    hospital_id bigint NOT NULL,
    transplant_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome text NOT NULL,
    notes text,
    CONSTRAINT transplant_event_outcome_check CHECK ((outcome = ANY (ARRAY['SUCCESS'::text, 'FAILED'::text, 'ORGAN_NOT_USED'::text])))
);


ALTER TABLE public.transplant_event OWNER TO postgres;

--
-- Name: transplant_event_transplant_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.transplant_event ALTER COLUMN transplant_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transplant_event_transplant_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: transport_record; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transport_record (
    transport_id bigint NOT NULL,
    organ_id bigint NOT NULL,
    origin_hospital_id bigint NOT NULL,
    destination_hospital_id bigint NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    departed_at timestamp with time zone,
    arrived_at timestamp with time zone,
    CONSTRAINT ck_transport_time_order CHECK (((arrived_at IS NULL) OR (departed_at IS NULL) OR (arrived_at >= departed_at))),
    CONSTRAINT transport_record_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'IN_TRANSIT'::text, 'DELIVERED'::text, 'FAILED'::text])))
);


ALTER TABLE public.transport_record OWNER TO postgres;

--
-- Name: transport_record_transport_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.transport_record ALTER COLUMN transport_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.transport_record_transport_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: urgency; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.urgency (
    urgency_id bigint NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    score_value numeric(5,2) NOT NULL,
    CONSTRAINT urgency_score_value_check CHECK (((score_value >= (0)::numeric) AND (score_value <= (100)::numeric)))
);


ALTER TABLE public.urgency OWNER TO postgres;

--
-- Name: urgency_urgency_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.urgency ALTER COLUMN urgency_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.urgency_urgency_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: waitlist_entry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.waitlist_entry (
    recipient_id bigint NOT NULL,
    organ_type_id bigint NOT NULL,
    urgency_id bigint NOT NULL,
    listed_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    CONSTRAINT ck_waitlist_not_future CHECK ((listed_date <= CURRENT_DATE)),
    CONSTRAINT waitlist_entry_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'TRANSPLANTED'::text, 'REMOVED'::text])))
);


ALTER TABLE public.waitlist_entry OWNER TO postgres;

--
-- Name: v_allocation_fairness; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_allocation_fairness AS
 WITH waitlist_size AS (
         SELECT h.region_id,
            count(*) AS listed
           FROM ((public.waitlist_entry w
             JOIN public.recipient r ON ((r.recipient_id = w.recipient_id)))
             JOIN public.hospital h ON ((h.hospital_id = r.hospital_id)))
          GROUP BY h.region_id
        ), transplants AS (
         SELECT h.region_id,
            count(*) AS completed,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY (((EXTRACT(epoch FROM (te.transplant_at - (w.listed_date)::timestamp with time zone)) / (86400)::numeric))::double precision)) AS median_wait_days
           FROM (((((public.transplant_event te
             JOIN public.organ_offer f ON ((f.offer_id = te.offer_id)))
             JOIN public.organ o ON ((o.organ_id = f.organ_id)))
             JOIN public.recipient r ON ((r.recipient_id = f.recipient_id)))
             JOIN public.hospital h ON ((h.hospital_id = r.hospital_id)))
             JOIN public.waitlist_entry w ON (((w.recipient_id = r.recipient_id) AND (w.organ_type_id = o.organ_type_id))))
          WHERE (te.outcome = 'SUCCESS'::text)
          GROUP BY h.region_id
        ), retention AS (
         SELECT oh.region_id,
            count(*) AS recovered,
            count(*) FILTER (WHERE (oh.region_id = rh.region_id)) AS stayed_local
           FROM (((((public.transplant_event te
             JOIN public.organ_offer f ON ((f.offer_id = te.offer_id)))
             JOIN public.organ o ON ((o.organ_id = f.organ_id)))
             JOIN public.hospital oh ON ((oh.hospital_id = o.recovering_hospital_id)))
             JOIN public.recipient r ON ((r.recipient_id = f.recipient_id)))
             JOIN public.hospital rh ON ((rh.hospital_id = r.hospital_id)))
          WHERE (te.outcome = 'SUCCESS'::text)
          GROUP BY oh.region_id
        )
 SELECT reg.region_name,
    COALESCE(ws.listed, (0)::bigint) AS waitlist_size,
    COALESCE(t.completed, (0)::bigint) AS transplants_completed,
    round(((100.0 * (COALESCE(t.completed, (0)::bigint))::numeric) / (NULLIF(ws.listed, 0))::numeric), 2) AS allocation_rate_pct,
    round((t.median_wait_days)::numeric, 1) AS median_wait_days,
    round(((100.0 * (COALESCE(ret.stayed_local, (0)::bigint))::numeric) / (NULLIF(ret.recovered, 0))::numeric), 2) AS retention_pct
   FROM (((public.region reg
     LEFT JOIN waitlist_size ws ON ((ws.region_id = reg.region_id)))
     LEFT JOIN transplants t ON ((t.region_id = reg.region_id)))
     LEFT JOIN retention ret ON ((ret.region_id = reg.region_id)));


ALTER VIEW public.v_allocation_fairness OWNER TO postgres;

--
-- Name: v_compliance_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_compliance_summary AS
 SELECT count(*) FILTER (WHERE (status = 'TRANSPLANTED'::text)) AS transplanted,
    count(*) FILTER (WHERE (status = 'EXPIRED'::text)) AS expired_unallocated,
    count(*) FILTER (WHERE (status = 'DISCARDED'::text)) AS discarded,
    count(*) AS total_organs,
    round(((100.0 * (count(*) FILTER (WHERE (status = 'TRANSPLANTED'::text)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS placement_rate_pct
   FROM public.organ o;


ALTER VIEW public.v_compliance_summary OWNER TO postgres;

--
-- Name: v_decline_reasons; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_decline_reasons AS
 SELECT dr.code,
    dr.description,
    count(*) AS occurrences,
    round(((100.0 * (count(*))::numeric) / NULLIF(sum(count(*)) OVER (), (0)::numeric)), 2) AS pct
   FROM (public.organ_offer f
     JOIN public.decline_reason dr ON ((dr.decline_reason_id = f.decline_reason_id)))
  WHERE (f.status = 'DECLINED'::text)
  GROUP BY dr.code, dr.description;


ALTER VIEW public.v_decline_reasons OWNER TO postgres;

--
-- Name: v_offer; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_offer AS
 SELECT f.offer_id,
    f.organ_id,
    f.recipient_id,
    f.run_id,
    f.status,
    f.created_at,
    f.sent_at,
    f.responded_at,
    f.decline_reason_id,
    f.void_reason,
    f.notes,
    f.created_by,
    ot.response_window_hours,
    (f.sent_at + ((ot.response_window_hours)::double precision * '01:00:00'::interval)) AS offer_expires_at
   FROM ((public.organ_offer f
     JOIN public.organ o ON ((o.organ_id = f.organ_id)))
     JOIN public.organ_type ot ON ((ot.organ_type_id = o.organ_type_id)));


ALTER VIEW public.v_offer OWNER TO postgres;

--
-- Name: v_organ; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_organ AS
 SELECT o.organ_id,
    o.donor_id,
    o.organ_type_id,
    o.recovering_hospital_id,
    o.recovered_at,
    o.status,
    o.discard_reason_id,
    ot.name AS organ_type_name,
    ot.max_viability_hours,
    (o.recovered_at + ((ot.max_viability_hours)::double precision * '01:00:00'::interval)) AS expires_at,
    (GREATEST((0)::numeric, (EXTRACT(epoch FROM ((o.recovered_at + ((ot.max_viability_hours)::double precision * '01:00:00'::interval)) - now())) / (3600)::numeric)))::numeric(8,2) AS hours_remaining,
    (now() > (o.recovered_at + ((ot.max_viability_hours)::double precision * '01:00:00'::interval))) AS is_expired
   FROM (public.organ o
     JOIN public.organ_type ot ON ((ot.organ_type_id = o.organ_type_id)));


ALTER VIEW public.v_organ OWNER TO postgres;

--
-- Name: v_organ_utilization; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_organ_utilization AS
 SELECT reg.region_name,
    ot.name AS organ_type,
    count(*) FILTER (WHERE (o.status = 'TRANSPLANTED'::text)) AS transplanted,
    count(*) FILTER (WHERE (o.status = 'EXPIRED'::text)) AS expired,
    count(*) FILTER (WHERE (o.status = 'DISCARDED'::text)) AS discarded,
    count(*) AS total_recovered,
    round(((100.0 * (count(*) FILTER (WHERE (o.status = 'TRANSPLANTED'::text)))::numeric) / (NULLIF(count(*), 0))::numeric), 2) AS utilization_pct
   FROM (((public.organ o
     JOIN public.hospital h ON ((h.hospital_id = o.recovering_hospital_id)))
     JOIN public.region reg ON ((reg.region_id = h.region_id)))
     JOIN public.organ_type ot ON ((ot.organ_type_id = o.organ_type_id)))
  GROUP BY reg.region_name, ot.name;


ALTER VIEW public.v_organ_utilization OWNER TO postgres;

--
-- Name: v_waiting_time_distribution; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_waiting_time_distribution AS
 SELECT ot.name AS organ_type,
    width_bucket((EXTRACT(epoch FROM age(now(), (w.listed_date)::timestamp with time zone)) / (30.44 * (86400)::numeric)), (0)::numeric, (60)::numeric, 12) AS bucket,
    count(*) AS recipients
   FROM (public.waitlist_entry w
     JOIN public.organ_type ot ON ((ot.organ_type_id = w.organ_type_id)))
  WHERE (w.status = 'ACTIVE'::text)
  GROUP BY ot.name, (width_bucket((EXTRACT(epoch FROM age(now(), (w.listed_date)::timestamp with time zone)) / (30.44 * (86400)::numeric)), (0)::numeric, (60)::numeric, 12));


ALTER VIEW public.v_waiting_time_distribution OWNER TO postgres;

--
-- Name: v_waitlist_scored; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_waitlist_scored AS
 WITH base AS (
         SELECT w.recipient_id,
            w.organ_type_id,
            w.urgency_id,
            w.listed_date,
            w.status,
            r.hospital_id,
            h.region_id,
            u.code AS urgency_code,
            u.score_value AS urgency_score,
            reg.urgency_weight,
            reg.wait_weight,
            (EXTRACT(epoch FROM age(now(), (w.listed_date)::timestamp with time zone)) / (30.44 * (86400)::numeric)) AS wait_months
           FROM ((((public.waitlist_entry w
             JOIN public.recipient r ON ((r.recipient_id = w.recipient_id)))
             JOIN public.hospital h ON ((h.hospital_id = r.hospital_id)))
             JOIN public.region reg ON ((reg.region_id = h.region_id)))
             JOIN public.urgency u ON ((u.urgency_id = w.urgency_id)))
        )
 SELECT recipient_id,
    organ_type_id,
    urgency_id,
    listed_date,
    status,
    hospital_id,
    region_id,
    urgency_code,
    urgency_score,
    urgency_weight,
    wait_weight,
    wait_months,
    (LEAST((100)::numeric, (((100)::numeric * ln(((1)::numeric + wait_months))) / ln((61)::numeric))))::numeric(5,2) AS wait_score,
    round((((urgency_score * urgency_weight) + (LEAST((100)::numeric, (((100)::numeric * ln(((1)::numeric + wait_months))) / ln((61)::numeric))) * wait_weight)) / NULLIF((urgency_weight + wait_weight), (0)::numeric)), 2) AS priority_score
   FROM base b;


ALTER VIEW public.v_waitlist_scored OWNER TO postgres;

--
-- Data for Name: app_user; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_user (user_id, username, password_hash, role_id, status) FROM stdin;
1	admin	$2b$10$NMptt9TIflZAmJHIiv0ObOpfP9kHnzqg55nci/G6lXH8OubGHmz9W	1	ACTIVE
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (audit_id, table_name, row_id, action, old_values, new_values, user_id, changed_at) FROM stdin;
1	donor	1	INSERT	\N	{"name": "Anil Kapoor", "status": "ACTIVE", "donor_id": 1, "height_cm": 176.00, "weight_kg": 72.00, "death_date": "2026-10-07T03:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Traumatic brain injury", "hospital_id": 1, "date_of_birth": "1984-03-12", "blood_group_id": 2}	\N	2026-10-07 07:50:50.538795+05:30
2	donor	2	INSERT	\N	{"name": "Rekha Deshmukh", "status": "ACTIVE", "donor_id": 2, "height_cm": 165.00, "weight_kg": 75.00, "death_date": "2026-10-07T02:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Intracranial haemorrhage", "hospital_id": 4, "date_of_birth": "1979-07-30", "blood_group_id": 1}	\N	2026-10-07 07:50:50.538795+05:30
3	donor	3	INSERT	\N	{"name": "Mohan Krishnan", "status": "ACTIVE", "donor_id": 3, "height_cm": 172.00, "weight_kg": 70.00, "death_date": "2026-10-07T04:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Road traffic accident", "hospital_id": 2, "date_of_birth": "1990-11-02", "blood_group_id": 6}	\N	2026-10-07 07:50:50.538795+05:30
4	donor	4	INSERT	\N	{"name": "Sanjay Malhotra", "status": "ACTIVE", "donor_id": 4, "height_cm": 178.00, "weight_kg": 80.00, "death_date": "2026-10-04T07:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Cerebral anoxia", "hospital_id": 5, "date_of_birth": "1975-01-19", "blood_group_id": 4}	\N	2026-10-07 07:50:50.538795+05:30
5	donor	5	INSERT	\N	{"name": "Pooja Hegde", "status": "ACTIVE", "donor_id": 5, "height_cm": 160.00, "weight_kg": 58.00, "death_date": "2026-10-01T07:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Stroke", "hospital_id": 6, "date_of_birth": "1988-09-05", "blood_group_id": 8}	\N	2026-10-07 07:50:50.538795+05:30
6	donor	6	INSERT	\N	{"name": "Biswajit Sahoo", "status": "ACTIVE", "donor_id": 6, "height_cm": 170.00, "weight_kg": 68.00, "death_date": "2026-09-28T07:50:50.538795+05:30", "donor_type": "DECEASED", "death_cause": "Traumatic brain injury", "hospital_id": 8, "date_of_birth": "1969-12-24", "blood_group_id": 2}	\N	2026-10-07 07:50:50.538795+05:30
7	donor	7	INSERT	\N	{"name": "Kavita Reddy", "status": "ACTIVE", "donor_id": 7, "height_cm": 162.00, "weight_kg": 60.00, "death_date": null, "donor_type": "LIVING", "death_cause": null, "hospital_id": 3, "date_of_birth": "1992-05-17", "blood_group_id": 4}	\N	2026-10-07 07:50:50.538795+05:30
8	donor	8	INSERT	\N	{"name": "Nikhil Bhatt", "status": "ACTIVE", "donor_id": 8, "height_cm": 180.00, "weight_kg": 82.00, "death_date": null, "donor_type": "LIVING", "death_cause": null, "hospital_id": 4, "date_of_birth": "1986-02-08", "blood_group_id": 6}	\N	2026-10-07 07:50:50.538795+05:30
9	donor	9	INSERT	\N	{"name": "Shalini Gupta", "status": "ACTIVE", "donor_id": 9, "height_cm": 158.00, "weight_kg": 52.00, "death_date": null, "donor_type": "LIVING", "death_cause": null, "hospital_id": 1, "date_of_birth": "1994-10-29", "blood_group_id": 2}	\N	2026-10-07 07:50:50.538795+05:30
10	donor	10	INSERT	\N	{"name": "Aditya Pandey", "status": "ACTIVE", "donor_id": 10, "height_cm": 174.00, "weight_kg": 77.00, "death_date": null, "donor_type": "LIVING", "death_cause": null, "hospital_id": 7, "date_of_birth": "1981-06-14", "blood_group_id": 3}	\N	2026-10-07 07:50:50.538795+05:30
11	recipient	1	INSERT	\N	{"name": "Arjun Mehta", "status": "ACTIVE", "height_cm": 175.00, "weight_kg": 72.00, "hospital_id": 1, "recipient_id": 1, "date_of_birth": "1971-04-03", "blood_group_id": 6}	\N	2026-10-07 07:50:50.556174+05:30
12	recipient	2	INSERT	\N	{"name": "Priya Nair", "status": "ACTIVE", "height_cm": 160.00, "weight_kg": 58.00, "hospital_id": 2, "recipient_id": 2, "date_of_birth": "1985-08-21", "blood_group_id": 4}	\N	2026-10-07 07:50:50.556174+05:30
13	recipient	3	INSERT	\N	{"name": "Rahul Verma", "status": "ACTIVE", "height_cm": 178.00, "weight_kg": 80.00, "hospital_id": 1, "recipient_id": 3, "date_of_birth": "1968-12-11", "blood_group_id": 2}	\N	2026-10-07 07:50:50.556174+05:30
14	recipient	4	INSERT	\N	{"name": "Sunita Rao", "status": "ACTIVE", "height_cm": 158.00, "weight_kg": 62.00, "hospital_id": 6, "recipient_id": 4, "date_of_birth": "1979-02-27", "blood_group_id": 6}	\N	2026-10-07 07:50:50.556174+05:30
15	recipient	5	INSERT	\N	{"name": "Karthik Iyer", "status": "ACTIVE", "height_cm": 172.00, "weight_kg": 74.00, "hospital_id": 2, "recipient_id": 5, "date_of_birth": "1990-06-09", "blood_group_id": 8}	\N	2026-10-07 07:50:50.556174+05:30
16	recipient	6	INSERT	\N	{"name": "Meera Kulkarni", "status": "ACTIVE", "height_cm": 165.00, "weight_kg": 66.00, "hospital_id": 4, "recipient_id": 6, "date_of_birth": "1976-10-15", "blood_group_id": 6}	\N	2026-10-07 07:50:50.556174+05:30
17	recipient	7	INSERT	\N	{"name": "Vikram Singh", "status": "ACTIVE", "height_cm": 180.00, "weight_kg": 85.00, "hospital_id": 5, "recipient_id": 7, "date_of_birth": "1964-03-30", "blood_group_id": 1}	\N	2026-10-07 07:50:50.556174+05:30
18	recipient	8	INSERT	\N	{"name": "Ananya Das", "status": "ACTIVE", "height_cm": 162.00, "weight_kg": 55.00, "hospital_id": 8, "recipient_id": 8, "date_of_birth": "1982-09-18", "blood_group_id": 3}	\N	2026-10-07 07:50:50.556174+05:30
19	recipient	9	INSERT	\N	{"name": "Imran Sheikh", "status": "ACTIVE", "height_cm": 170.00, "weight_kg": 70.00, "hospital_id": 4, "recipient_id": 9, "date_of_birth": "1973-01-25", "blood_group_id": 5}	\N	2026-10-07 07:50:50.556174+05:30
20	recipient	10	INSERT	\N	{"name": "Deepa Menon", "status": "ACTIVE", "height_cm": 155.00, "weight_kg": 60.00, "hospital_id": 3, "recipient_id": 10, "date_of_birth": "1988-11-07", "blood_group_id": 8}	\N	2026-10-07 07:50:50.556174+05:30
21	recipient	11	INSERT	\N	{"name": "Suresh Kumar", "status": "ACTIVE", "height_cm": 176.00, "weight_kg": 78.00, "hospital_id": 7, "recipient_id": 11, "date_of_birth": "1966-05-22", "blood_group_id": 4}	\N	2026-10-07 07:50:50.556174+05:30
22	recipient	12	INSERT	\N	{"name": "Lakshmi Pillai", "status": "ACTIVE", "height_cm": 150.00, "weight_kg": 45.00, "hospital_id": 3, "recipient_id": 12, "date_of_birth": "1959-07-13", "blood_group_id": 2}	\N	2026-10-07 07:50:50.556174+05:30
23	recipient	13	INSERT	\N	{"name": "Rohan Joshi", "status": "ACTIVE", "height_cm": 182.00, "weight_kg": 90.00, "hospital_id": 4, "recipient_id": 13, "date_of_birth": "1995-03-04", "blood_group_id": 6}	\N	2026-10-07 07:50:50.556174+05:30
24	recipient	14	INSERT	\N	{"name": "Farah Khan", "status": "ACTIVE", "height_cm": 150.00, "weight_kg": 38.00, "hospital_id": 1, "recipient_id": 14, "date_of_birth": "1998-12-19", "blood_group_id": 4}	\N	2026-10-07 07:50:50.556174+05:30
25	recipient	15	INSERT	\N	{"name": "Gopal Reddy", "status": "ACTIVE", "height_cm": 168.00, "weight_kg": 68.00, "hospital_id": 6, "recipient_id": 15, "date_of_birth": "1974-08-08", "blood_group_id": 2}	\N	2026-10-07 07:50:50.556174+05:30
26	recipient	16	INSERT	\N	{"name": "Nisha Bansal", "status": "ACTIVE", "height_cm": 160.00, "weight_kg": 57.00, "hospital_id": 5, "recipient_id": 16, "date_of_birth": "1983-04-16", "blood_group_id": 7}	\N	2026-10-07 07:50:50.556174+05:30
27	recipient	17	INSERT	\N	{"name": "Tarun Ghosh", "status": "ACTIVE", "height_cm": 174.00, "weight_kg": 76.00, "hospital_id": 8, "recipient_id": 17, "date_of_birth": "1970-10-02", "blood_group_id": 4}	\N	2026-10-07 07:50:50.556174+05:30
28	recipient	18	INSERT	\N	{"name": "Divya Shetty", "status": "ACTIVE", "height_cm": 161.00, "weight_kg": 59.00, "hospital_id": 6, "recipient_id": 18, "date_of_birth": "1992-01-31", "blood_group_id": 6}	\N	2026-10-07 07:50:50.556174+05:30
29	recipient	19	INSERT	\N	{"name": "Harish Patel", "status": "ACTIVE", "height_cm": 177.00, "weight_kg": 82.00, "hospital_id": 4, "recipient_id": 19, "date_of_birth": "1961-09-26", "blood_group_id": 2}	\N	2026-10-07 07:50:50.556174+05:30
30	recipient	20	INSERT	\N	{"name": "Zoya Ali", "status": "ACTIVE", "height_cm": 158.00, "weight_kg": 54.00, "hospital_id": 7, "recipient_id": 20, "date_of_birth": "1987-06-20", "blood_group_id": 4}	\N	2026-10-07 07:50:50.556174+05:30
31	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2025-08-07", "recipient_id": 1, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
32	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 1, "listed_date": "2026-07-07", "recipient_id": 2, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
33	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-02-07", "recipient_id": 3, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
34	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2025-02-07", "recipient_id": 4, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
35	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-04-07", "recipient_id": 5, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
36	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-04-07", "recipient_id": 5, "organ_type_id": 5}	\N	2026-10-07 07:50:50.567048+05:30
37	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 1, "listed_date": "2025-11-07", "recipient_id": 6, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
38	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-05-07", "recipient_id": 7, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
39	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2026-01-07", "recipient_id": 8, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
40	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2026-06-07", "recipient_id": 9, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
41	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 1, "listed_date": "2026-08-07", "recipient_id": 10, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
42	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2025-10-07", "recipient_id": 11, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
43	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2024-10-07", "recipient_id": 12, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
44	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2026-07-07", "recipient_id": 13, "organ_type_id": 5}	\N	2026-10-07 07:50:50.567048+05:30
45	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-07-07", "recipient_id": 13, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
46	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 1, "listed_date": "2026-09-07", "recipient_id": 14, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
47	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 2, "listed_date": "2026-03-07", "recipient_id": 15, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
48	waitlist_entry	composite	INSERT	\N	{"status": "SUSPENDED", "urgency_id": 3, "listed_date": "2025-07-07", "recipient_id": 16, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
49	waitlist_entry	composite	INSERT	\N	{"status": "SUSPENDED", "urgency_id": 2, "listed_date": "2025-04-07", "recipient_id": 17, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
50	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2025-12-07", "recipient_id": 18, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
51	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 1, "listed_date": "2026-09-07", "recipient_id": 19, "organ_type_id": 3}	\N	2026-10-07 07:50:50.567048+05:30
52	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2024-12-07", "recipient_id": 20, "organ_type_id": 1}	\N	2026-10-07 07:50:50.567048+05:30
53	waitlist_entry	composite	INSERT	\N	{"status": "ACTIVE", "urgency_id": 3, "listed_date": "2025-06-07", "recipient_id": 20, "organ_type_id": 4}	\N	2026-10-07 07:50:50.567048+05:30
54	organ	1	INSERT	\N	{"status": "AVAILABLE", "donor_id": 1, "organ_id": 1, "recovered_at": "2026-10-07T06:50:50.579524+05:30", "organ_type_id": 1, "discard_reason_id": null, "recovering_hospital_id": 1}	\N	2026-10-07 07:50:50.579524+05:30
55	organ	2	INSERT	\N	{"status": "AVAILABLE", "donor_id": 2, "organ_id": 2, "recovered_at": "2026-10-07T06:20:50.579524+05:30", "organ_type_id": 3, "discard_reason_id": null, "recovering_hospital_id": 4}	\N	2026-10-07 07:50:50.579524+05:30
56	organ	3	INSERT	\N	{"status": "AVAILABLE", "donor_id": 3, "organ_id": 3, "recovered_at": "2026-10-07T07:20:50.579524+05:30", "organ_type_id": 4, "discard_reason_id": null, "recovering_hospital_id": 2}	\N	2026-10-07 07:50:50.579524+05:30
\.


--
-- Data for Name: blood_compatibility; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.blood_compatibility (donor_bg_id, recipient_bg_id, compatible) FROM stdin;
1	1	t
1	2	t
1	3	t
1	4	t
1	5	t
1	6	t
1	7	t
1	8	t
2	1	f
2	2	t
2	3	f
2	4	t
2	5	f
2	6	t
2	7	f
2	8	t
3	1	f
3	2	f
3	3	t
3	4	t
3	5	f
3	6	f
3	7	t
3	8	t
4	1	f
4	2	f
4	3	f
4	4	t
4	5	f
4	6	f
4	7	f
4	8	t
5	1	f
5	2	f
5	3	f
5	4	f
5	5	t
5	6	t
5	7	t
5	8	t
6	1	f
6	2	f
6	3	f
6	4	f
6	5	f
6	6	t
6	7	f
6	8	t
7	1	f
7	2	f
7	3	f
7	4	f
7	5	f
7	6	f
7	7	t
7	8	t
8	1	f
8	2	f
8	3	f
8	4	f
8	5	f
8	6	f
8	7	f
8	8	t
\.


--
-- Data for Name: blood_group; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.blood_group (blood_group_id, group_name) FROM stdin;
1	O-
2	O+
3	A-
4	A+
5	B-
6	B+
7	AB-
8	AB+
\.


--
-- Data for Name: decline_reason; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.decline_reason (decline_reason_id, code, description) FROM stdin;
1	RECIPIENT_UNFIT	Recipient medically unfit at time of offer
2	ORGAN_QUALITY	Organ quality assessed as unsuitable
3	SIZE_MISMATCH	Size mismatch identified on review
4	LOGISTICS	Transport or theatre logistics not feasible
5	RECIPIENT_REFUSED	Recipient or family declined
6	OTHER	Other â€” see notes
\.


--
-- Data for Name: discard_reason; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.discard_reason (discard_reason_id, code, description) FROM stdin;
1	NO_SUITABLE_RECIPIENT	No compatible recipient identified
2	ALL_DECLINED	All ranked candidates declined the offer
3	VIABILITY_ELAPSED	Viability window elapsed before placement
4	QUALITY_ASSESSMENT	Failed quality assessment on inspection
5	TRANSPLANT_FAILED	Organ not used or transplant unsuccessful
6	TRANSPORT_FAILURE	Lost or damaged in transport
\.


--
-- Data for Name: donor; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.donor (donor_id, name, date_of_birth, blood_group_id, hospital_id, donor_type, status, height_cm, weight_kg, death_date, death_cause) FROM stdin;
1	Anil Kapoor	1984-03-12	2	1	DECEASED	ACTIVE	176.00	72.00	2026-10-07 03:50:50.538795+05:30	Traumatic brain injury
2	Rekha Deshmukh	1979-07-30	1	4	DECEASED	ACTIVE	165.00	75.00	2026-10-07 02:50:50.538795+05:30	Intracranial haemorrhage
3	Mohan Krishnan	1990-11-02	6	2	DECEASED	ACTIVE	172.00	70.00	2026-10-07 04:50:50.538795+05:30	Road traffic accident
4	Sanjay Malhotra	1975-01-19	4	5	DECEASED	ACTIVE	178.00	80.00	2026-10-04 07:50:50.538795+05:30	Cerebral anoxia
5	Pooja Hegde	1988-09-05	8	6	DECEASED	ACTIVE	160.00	58.00	2026-10-01 07:50:50.538795+05:30	Stroke
6	Biswajit Sahoo	1969-12-24	2	8	DECEASED	ACTIVE	170.00	68.00	2026-09-28 07:50:50.538795+05:30	Traumatic brain injury
7	Kavita Reddy	1992-05-17	4	3	LIVING	ACTIVE	162.00	60.00	\N	\N
8	Nikhil Bhatt	1986-02-08	6	4	LIVING	ACTIVE	180.00	82.00	\N	\N
9	Shalini Gupta	1994-10-29	2	1	LIVING	ACTIVE	158.00	52.00	\N	\N
10	Aditya Pandey	1981-06-14	3	7	LIVING	ACTIVE	174.00	77.00	\N	\N
11	Kamalakar Sen	1963-12-22	7	1	DECEASED	ACTIVE	161.00	60.00	2025-03-01 07:00:00+05:30	Bronchiectasis
12	Yamini Gokhale	1974-12-19	6	1	DECEASED	ACTIVE	172.00	66.00	2026-02-01 07:00:00+05:30	Road traffic accident
13	Gangadhar Panicker	1981-12-17	2	1	DECEASED	ACTIVE	167.00	72.00	2026-09-01 07:00:00+05:30	Road traffic accident
14	Shrikant Dhotre	1967-12-21	1	2	DECEASED	ACTIVE	177.00	76.00	2025-07-01 07:00:00+05:30	Road traffic accident
15	Balaji Venkatesan	1975-12-19	4	2	DECEASED	ACTIVE	165.00	74.00	2026-03-01 07:00:00+05:30	Acute-on-chronic liver failure
16	Ilavarasan Muthu	1979-12-18	6	2	DECEASED	ACTIVE	181.00	75.00	2026-07-01 07:00:00+05:30	Post-operative complication
17	Anilbhai Vaghela	1961-12-22	2	3	DECEASED	ACTIVE	175.00	72.00	2025-01-01 07:00:00+05:30	Cardiomyopathy
18	Lalita Bhinge	1971-12-20	2	3	DECEASED	ACTIVE	171.00	70.00	2025-11-01 07:00:00+05:30	Alcoholic hepatitis
19	Ramnarayan Bhide	1977-12-18	1	3	DECEASED	ACTIVE	173.00	80.00	2026-05-01 07:00:00+05:30	Cerebral anoxia
20	Om Prakash Dhaka	1959-12-23	6	4	DECEASED	ACTIVE	167.00	68.00	2024-11-01 07:00:00+05:30	Chronic pancreatitis
21	Vinod Kharat	1970-12-20	4	4	DECEASED	ACTIVE	178.00	84.00	2025-10-01 07:00:00+05:30	Cerebral anoxia
22	Hariram Sawant	1976-12-18	2	4	DECEASED	ACTIVE	180.00	70.00	2026-04-01 07:00:00+05:30	Cardiomyopathy
23	Nandini Deshpande	1982-12-17	1	4	DECEASED	ACTIVE	160.00	70.00	2026-10-06 21:50:50.585139+05:30	Intracranial haemorrhage
24	Rajendra Saliya	1960-12-22	4	5	DECEASED	ACTIVE	160.00	64.00	2024-12-01 07:00:00+05:30	Acute liver failure
25	Girja Prasad	1964-12-21	6	5	DECEASED	ACTIVE	176.00	74.00	2025-04-01 07:00:00+05:30	Road traffic accident
26	Bhagwan Kadam	1958-12-23	7	6	DECEASED	ACTIVE	174.00	66.00	2024-10-01 07:00:00+05:30	Cerebral anoxia
27	Mohanlal Sisodia	1965-12-21	4	6	DECEASED	ACTIVE	169.00	58.00	2025-05-01 07:00:00+05:30	Cerebral anoxia
28	Ashok Wagh	1972-12-19	1	6	DECEASED	ACTIVE	164.00	78.00	2025-12-01 07:00:00+05:30	Intracranial haemorrhage
29	Deepak Chavan	1978-12-18	7	6	DECEASED	ACTIVE	166.00	62.00	2026-06-01 07:00:00+05:30	Pulmonary fibrosis
30	Bhaskar Naik	1966-12-21	2	7	DECEASED	ACTIVE	162.00	66.00	2025-06-01 07:00:00+05:30	Acute liver failure
31	Pravin Sathe	1962-12-22	1	8	DECEASED	ACTIVE	168.00	70.00	2025-02-01 07:00:00+05:30	Road traffic accident
32	Ratanlal Parmar	1968-12-20	7	8	DECEASED	ACTIVE	170.00	68.00	2025-08-01 07:00:00+05:30	Post-surgical complication
33	Nirmala Bhosale	1969-12-20	6	8	DECEASED	ACTIVE	163.00	64.00	2025-09-01 07:00:00+05:30	Idiopathic pulmonary fibrosis
34	Suresh Rathi	1973-12-19	7	8	DECEASED	ACTIVE	179.00	72.00	2026-01-01 07:00:00+05:30	Chronic pancreatitis
35	Sudarshan Mahapatra	1980-12-17	4	8	DECEASED	ACTIVE	174.00	68.00	2026-08-01 07:00:00+05:30	Chronic liver failure
\.


--
-- Data for Name: donor_hla; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.donor_hla (donor_id, allele_id) FROM stdin;
10	1
7	1
4	1
2	1
7	2
6	2
3	2
1	2
9	3
5	3
2	3
10	4
8	4
5	4
1	4
9	5
6	5
3	5
8	6
4	6
8	7
4	7
1	7
10	8
7	8
4	8
2	8
9	9
6	9
3	9
10	10
7	10
5	10
1	10
8	11
5	11
2	11
9	12
6	12
3	12
7	13
4	13
9	14
6	14
2	14
9	15
8	15
4	15
1	15
10	16
7	16
5	16
2	16
8	17
5	17
3	17
10	18
6	18
3	18
1	18
23	3
23	11
23	13
23	14
23	1
23	8
22	3
22	11
22	13
22	14
22	1
22	8
21	3
21	11
21	13
21	14
21	1
21	8
25	3
25	11
25	13
25	14
25	1
25	8
26	3
26	11
26	13
26	14
26	1
26	8
11	2
11	10
11	16
11	15
11	4
11	7
13	2
13	10
13	16
13	15
13	4
13	7
15	2
15	10
15	16
15	15
15	4
15	7
33	2
33	10
33	16
33	15
33	4
33	7
31	14
31	9
31	17
31	3
31	12
31	5
35	14
35	9
35	17
35	3
35	12
35	5
12	14
12	9
12	17
12	3
12	12
12	5
32	14
32	9
32	17
32	3
32	12
32	5
14	18
14	6
14	8
14	10
14	13
14	1
17	18
17	6
17	8
17	10
17	13
17	1
34	18
34	6
34	8
34	10
34	13
34	1
16	18
16	6
16	8
16	10
16	13
16	1
28	7
28	5
28	17
28	15
28	4
28	11
30	7
30	5
30	17
30	15
30	4
30	11
24	7
24	5
24	17
24	15
24	4
24	11
29	7
29	5
29	17
29	15
29	4
29	11
19	16
19	9
19	18
19	3
19	2
19	12
18	16
18	9
18	18
18	3
18	2
18	12
27	16
27	9
27	18
27	3
27	2
27	12
20	16
20	9
20	18
20	3
20	2
20	12
\.


--
-- Data for Name: exclusion_reason; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exclusion_reason (exclusion_reason_id, code, description) FROM stdin;
1	ABO_INCOMPATIBLE	Blood group incompatible with donor
2	RECIPIENT_INACTIVE	Recipient or waitlist entry not active
3	ALREADY_OFFERED	This organ has already been offered to this recipient
4	SIZE_MISMATCH	Donor/recipient size ratio outside permitted range
5	VIABILITY_UNREACHABLE	Organ cannot reach recipient within viability window
\.


--
-- Data for Name: hla_allele; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.hla_allele (allele_id, locus, allele_name) FROM stdin;
1	A	A*01:01
2	A	A*02:01
3	A	A*03:01
4	A	A*11:01
5	A	A*24:02
6	A	A*68:01
7	B	B*07:02
8	B	B*08:01
9	B	B*15:01
10	B	B*35:01
11	B	B*44:02
12	B	B*51:01
13	DRB1	DRB1*01:01
14	DRB1	DRB1*03:01
15	DRB1	DRB1*04:01
16	DRB1	DRB1*07:01
17	DRB1	DRB1*11:01
18	DRB1	DRB1*15:01
\.


--
-- Data for Name: hospital; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.hospital (hospital_id, name, address, phone, latitude, longitude, region_id, status) FROM stdin;
1	AIIMS New Delhi	Ansari Nagar, New Delhi	+91-11-0000-0001	28.567200	77.210000	3	ACTIVE
2	Apollo Chennai	Greams Lane, Off Greams Road, Chennai	+91-44-0000-0002	13.060400	80.249600	1	ACTIVE
3	CMC Vellore	Ida Scudder Road, Vellore	+91-416-000-0003	12.924900	79.136900	1	ACTIVE
4	KEM Mumbai	Acharya Donde Marg, Parel, Mumbai	+91-22-0000-0004	19.000200	72.842200	2	ACTIVE
5	PGIMER Chandigarh	Sector 12, Chandigarh	+91-172-000-0005	30.764100	76.776100	3	ACTIVE
6	Narayana Bangalore	Bommasandra Industrial Area, Bangalore	+91-80-0000-0006	12.906100	77.598000	1	ACTIVE
7	KGMU Lucknow	Shah Mina Road, Chowk, Lucknow	+91-522-000-0007	26.858000	80.942500	4	SUSPENDED
8	SCB Cuttack	Mangalabag, Cuttack	+91-671-000-0008	20.473400	85.883000	4	ACTIVE
\.


--
-- Data for Name: match_result; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.match_result (run_id, recipient_id, rank, match_score, hla_score, urgency_score, distance_score, wait_score, distance_km, qualified, exclusion_reason_id) FROM stdin;
1	23	1	93.75	100.00	100.00	100.00	58.33	0.00	t	\N
1	21	\N	\N	50.00	25.00	100.00	60.01	0.00	f	1
1	54	3	28.43	0.00	60.00	8.11	16.03	1255.99	t	\N
2	1	1	66.03	50.00	60.00	100.00	46.85	0.00	t	\N
2	6	2	57.40	50.00	100.00	9.97	32.72	1152.58	t	\N
2	26	\N	\N	0.00	60.00	100.00	46.96	0.00	f	1
2	36	\N	\N	0.00	100.00	9.97	81.10	1152.58	f	1
2	27	\N	\N	0.00	100.00	3.00	71.43	1752.73	f	1
2	43	6	51.12	0.00	60.00	60.91	79.30	247.85	t	\N
2	46	\N	\N	37.50	60.00	3.07	91.53	1741.90	f	1
2	38	\N	\N	37.50	60.00	9.97	72.95	1152.58	f	1
2	47	\N	\N	37.50	60.00	3.07	65.94	1741.90	f	1
2	48	\N	\N	37.50	25.00	43.72	75.05	413.64	f	1
2	28	\N	\N	100.00	25.00	3.00	38.44	1752.73	f	1
2	17	\N	\N	0.00	60.00	8.11	58.04	1255.99	f	1
2	4	13	32.57	62.50	25.00	3.07	62.03	1741.90	t	\N
2	20	\N	\N	0.00	25.00	43.72	53.08	413.64	f	1
2	12	\N	\N	37.50	25.00	3.02	68.70	1750.75	f	1
2	34	16	28.15	37.50	25.00	3.02	65.94	1750.75	t	\N
2	18	17	27.09	62.50	25.00	3.07	25.50	1741.90	t	\N
2	37	\N	\N	0.00	25.00	9.97	85.11	1152.58	f	1
3	56	1	72.37	100.00	100.00	8.11	68.98	1255.99	t	\N
3	25	2	69.07	0.00	100.00	100.00	27.12	0.00	t	\N
3	49	3	67.79	37.50	100.00	43.72	62.40	413.64	t	\N
3	3	4	61.49	25.00	60.00	100.00	49.91	0.00	t	\N
3	11	5	58.94	75.00	60.00	43.72	60.08	413.64	t	\N
3	2	6	57.08	62.50	100.00	3.00	25.50	1752.73	t	\N
3	44	7	54.98	12.50	100.00	3.07	78.10	1741.90	t	\N
3	32	8	53.51	0.00	100.00	3.02	85.06	1750.75	t	\N
3	41	9	50.51	0.00	60.00	60.91	75.20	247.85	t	\N
3	20	10	47.18	75.00	25.00	43.72	74.98	413.64	t	\N
3	35	11	30.32	0.00	60.00	9.97	25.50	1152.58	t	\N
3	9	\N	\N	62.50	25.00	9.97	32.72	1152.58	f	1
3	45	13	17.21	0.00	25.00	3.07	42.94	1741.90	t	\N
4	36	1	77.35	100.00	100.00	12.73	74.04	1030.61	t	\N
4	27	2	70.13	12.50	100.00	100.00	60.01	0.00	t	\N
4	43	3	60.69	100.00	60.00	1.83	71.60	2000.53	t	\N
4	46	4	55.93	25.00	60.00	56.23	87.17	287.82	t	\N
4	17	\N	\N	75.00	60.00	13.03	32.51	1019.08	f	2
4	47	6	48.60	25.00	60.00	56.23	50.51	287.82	t	\N
4	38	7	48.53	50.00	60.00	12.73	62.40	1030.61	t	\N
4	12	8	44.91	37.50	25.00	78.43	55.48	121.50	t	\N
4	4	9	37.88	37.50	25.00	56.23	42.52	287.82	t	\N
4	48	10	35.29	50.00	25.00	4.63	65.57	1535.92	t	\N
4	34	11	34.54	0.00	25.00	78.43	50.51	121.50	t	\N
4	37	12	30.28	12.50	25.00	12.73	79.27	1030.61	t	\N
4	20	13	21.91	37.50	25.00	4.63	14.31	1535.92	t	\N
5	31	\N	\N	37.50	100.00	78.43	24.64	121.50	f	1
5	33	\N	\N	0.00	60.00	78.43	70.26	121.50	f	1
5	42	\N	\N	50.00	60.00	1.83	82.73	2000.53	f	1
5	29	4	42.52	0.00	25.00	100.00	68.84	0.00	t	\N
5	51	\N	\N	0.00	60.00	13.03	74.94	1019.08	f	1
5	50	6	32.84	12.50	60.00	4.63	38.93	1535.92	t	\N
5	16	\N	\N	37.50	25.00	1.83	52.90	2000.53	f	1
5	40	8	28.94	12.50	25.00	1.83	83.51	2000.53	t	\N
5	8	\N	\N	25.00	25.00	13.03	24.64	1019.08	f	1
6	36	\N	\N	100.00	100.00	12.73	85.04	1030.61	f	1
6	27	\N	\N	12.50	100.00	100.00	77.08	0.00	f	1
6	43	3	63.07	100.00	60.00	1.83	83.51	2000.53	t	\N
6	6	4	57.48	37.50	100.00	12.73	52.81	1030.61	t	\N
6	46	\N	\N	25.00	60.00	56.23	94.16	287.82	f	1
6	17	\N	\N	75.00	60.00	13.03	67.13	1019.08	f	1
6	47	\N	\N	25.00	60.00	56.23	72.83	287.82	f	1
6	38	\N	\N	50.00	60.00	12.73	78.30	1030.61	f	1
6	5	9	50.63	12.50	60.00	100.00	32.51	0.00	t	\N
6	12	\N	\N	37.50	25.00	78.43	74.94	121.50	f	1
6	4	11	43.36	37.50	25.00	56.23	69.95	287.82	t	\N
6	28	\N	\N	0.00	25.00	100.00	55.48	0.00	f	1
6	34	13	39.00	0.00	25.00	78.43	72.83	121.50	t	\N
6	48	\N	\N	50.00	25.00	4.63	79.99	1535.92	f	1
6	26	\N	\N	12.50	60.00	3.00	60.08	1752.73	f	1
6	18	16	36.23	25.00	25.00	56.23	49.91	287.82	t	\N
6	1	17	33.60	0.00	60.00	3.00	60.01	1752.73	t	\N
6	37	\N	\N	12.50	25.00	12.73	88.49	1030.61	f	1
6	20	\N	\N	37.50	25.00	4.63	63.83	1535.92	f	1
7	44	1	81.98	100.00	100.00	71.63	38.28	166.80	t	\N
7	32	2	67.49	0.00	100.00	100.00	62.46	0.00	t	\N
7	41	3	37.32	50.00	60.00	1.84	17.24	1998.36	t	\N
7	20	4	21.96	37.50	25.00	4.41	14.75	1560.67	t	\N
8	33	1	56.97	12.50	60.00	100.00	64.24	0.00	t	\N
8	51	\N	\N	37.50	60.00	10.98	70.08	1104.43	f	1
8	29	3	46.29	37.50	25.00	78.43	62.40	121.50	t	\N
8	42	4	37.23	0.00	60.00	1.84	79.30	1998.36	t	\N
8	40	5	31.41	25.00	25.00	1.84	80.20	1998.36	t	\N
8	50	6	28.19	25.00	60.00	4.41	0.31	1560.67	t	\N
8	16	\N	\N	37.50	25.00	1.84	38.44	1998.36	f	1
9	46	1	78.95	100.00	60.00	71.63	93.13	166.80	t	\N
9	27	2	75.05	37.50	100.00	78.43	74.94	121.50	t	\N
9	47	3	74.38	100.00	60.00	71.63	70.26	166.80	t	\N
9	6	4	62.90	62.50	100.00	14.86	46.49	953.23	t	\N
9	36	5	60.92	25.00	100.00	14.86	83.51	953.23	t	\N
9	12	6	52.64	37.50	25.00	100.00	72.59	0.00	t	\N
9	5	7	52.05	50.00	60.00	78.43	14.31	121.50	t	\N
9	4	8	48.98	50.00	25.00	71.63	67.03	166.80	t	\N
9	18	9	47.23	62.50	25.00	71.63	42.66	166.80	t	\N
9	43	10	44.00	25.00	60.00	1.84	81.89	1998.36	t	\N
9	28	11	43.79	37.50	25.00	78.43	49.91	121.50	t	\N
9	34	12	42.80	0.00	25.00	100.00	70.26	0.00	t	\N
9	38	13	42.35	12.50	60.00	14.86	76.26	953.23	t	\N
9	26	14	42.09	37.50	60.00	3.02	55.56	1750.75	t	\N
9	1	15	42.08	37.50	60.00	3.02	55.48	1750.75	t	\N
9	37	16	38.53	37.50	25.00	14.86	87.17	953.23	t	\N
9	17	\N	\N	0.00	60.00	10.98	63.83	1104.43	f	2
9	20	18	31.01	37.50	25.00	4.41	60.01	1560.67	t	\N
9	48	19	28.38	12.50	25.00	4.41	78.10	1560.67	t	\N
10	30	\N	\N	100.00	60.00	14.86	38.44	953.23	f	1
10	53	2	30.49	0.00	60.00	6.40	56.05	1374.29	t	\N
11	38	1	81.50	100.00	60.00	100.00	67.48	0.00	t	\N
11	36	2	80.46	50.00	100.00	100.00	77.32	0.00	t	\N
11	48	\N	\N	100.00	25.00	9.00	70.08	1204.05	f	1
11	43	4	49.34	50.00	60.00	6.50	75.20	1366.61	t	\N
11	27	\N	\N	0.00	100.00	12.73	65.57	1030.61	f	1
11	37	6	43.89	0.00	25.00	100.00	81.94	0.00	t	\N
11	17	\N	\N	50.00	60.00	6.40	46.73	1374.29	f	2
11	46	\N	\N	12.50	60.00	18.38	89.13	846.99	f	1
11	47	9	37.09	12.50	60.00	18.38	58.33	846.99	t	\N
11	1	\N	\N	12.50	60.00	9.97	25.22	1152.58	f	1
11	34	11	25.89	12.50	25.00	14.86	58.33	953.23	t	\N
11	26	12	25.09	0.00	60.00	9.97	25.50	1152.58	t	\N
11	12	\N	\N	0.00	25.00	14.86	62.03	953.23	f	1
11	4	\N	\N	0.00	25.00	18.38	52.81	846.99	f	1
11	20	15	16.96	0.00	25.00	9.00	38.28	1204.05	t	\N
12	44	1	63.19	50.00	100.00	18.38	72.59	846.99	t	\N
12	41	2	63.08	100.00	60.00	6.50	68.89	1366.61	t	\N
12	32	3	60.43	37.50	100.00	14.86	81.04	953.23	t	\N
12	49	4	45.65	12.50	100.00	9.00	50.51	1204.05	t	\N
12	56	5	43.38	0.00	100.00	6.40	60.48	1374.29	t	\N
12	11	6	36.62	25.00	60.00	9.00	46.61	1204.05	t	\N
12	3	7	36.17	37.50	60.00	9.97	24.64	1152.58	t	\N
12	20	8	23.02	0.00	25.00	9.00	68.61	1204.05	t	\N
13	38	1	84.25	100.00	60.00	100.00	81.23	0.00	t	\N
13	36	2	82.46	50.00	100.00	100.00	87.30	0.00	t	\N
13	6	3	65.83	12.50	100.00	100.00	60.39	0.00	t	\N
13	48	4	55.85	100.00	25.00	9.00	82.74	1204.05	t	\N
13	43	5	51.48	50.00	60.00	6.50	85.91	1366.61	t	\N
13	17	\N	\N	50.00	60.00	6.40	71.63	1374.29	f	2
13	27	7	48.58	0.00	100.00	12.73	80.16	1030.61	t	\N
13	37	8	45.59	0.00	25.00	100.00	90.46	0.00	t	\N
13	13	9	44.77	0.00	60.00	100.00	33.86	0.00	t	\N
13	46	10	44.57	12.50	60.00	18.38	95.74	846.99	t	\N
13	47	11	40.72	12.50	60.00	18.38	76.46	846.99	t	\N
13	1	12	36.92	12.50	60.00	9.97	65.87	1152.58	t	\N
13	28	13	33.77	37.50	25.00	12.73	62.38	1030.61	t	\N
13	26	14	33.18	0.00	60.00	9.97	65.92	1152.58	t	\N
13	5	15	30.02	0.00	60.00	12.73	47.38	1030.61	t	\N
13	34	16	29.51	12.50	25.00	14.86	76.46	953.23	t	\N
13	12	17	26.13	0.00	25.00	14.86	78.28	953.23	t	\N
13	4	18	25.97	0.00	25.00	18.38	73.99	846.99	t	\N
13	20	19	23.08	0.00	25.00	9.00	68.92	1204.05	t	\N
13	18	20	22.84	0.00	25.00	18.38	58.30	846.99	t	\N
14	42	\N	\N	100.00	60.00	100.00	65.94	0.00	f	1
14	40	2	45.12	0.00	25.00	100.00	67.48	0.00	t	\N
14	51	\N	\N	37.50	60.00	5.37	46.73	1462.52	f	1
14	33	\N	\N	12.50	60.00	1.84	26.86	1998.36	f	1
14	29	5	20.48	37.50	25.00	1.83	16.84	2000.53	t	\N
15	41	1	74.86	100.00	60.00	100.00	39.09	0.00	t	\N
15	32	2	58.07	37.50	100.00	1.84	67.43	1998.36	t	\N
15	44	3	57.96	50.00	100.00	1.88	49.91	1987.51	t	\N
15	20	\N	\N	0.00	25.00	30.46	38.11	594.39	f	1
16	36	\N	\N	50.00	100.00	18.38	60.48	846.99	f	1
16	46	2	60.17	12.50	60.00	100.00	80.20	0.00	t	\N
16	38	\N	\N	100.00	60.00	18.38	33.94	846.99	f	1
16	27	\N	\N	0.00	100.00	56.23	25.22	287.82	f	1
16	43	5	45.09	50.00	60.00	1.88	56.05	1987.51	t	\N
16	48	\N	\N	100.00	25.00	4.16	42.94	1590.04	f	1
16	37	\N	\N	0.00	25.00	18.38	68.98	846.99	f	1
17	46	\N	\N	100.00	60.00	100.00	85.78	0.00	f	1
17	47	2	74.70	100.00	60.00	100.00	43.48	0.00	t	\N
17	27	\N	\N	37.50	100.00	56.23	55.48	287.82	f	1
17	36	4	59.25	25.00	100.00	18.38	71.60	846.99	t	\N
17	4	\N	\N	50.00	25.00	100.00	32.08	0.00	f	1
17	12	\N	\N	37.50	25.00	71.63	49.91	166.80	f	1
17	43	7	41.40	25.00	60.00	1.88	68.89	1987.51	t	\N
17	38	8	39.47	12.50	60.00	18.38	58.33	846.99	t	\N
17	37	9	37.27	37.50	25.00	18.38	77.32	846.99	t	\N
17	34	10	31.77	0.00	25.00	71.63	43.48	166.80	t	\N
17	17	\N	\N	0.00	60.00	8.74	14.31	1218.68	f	2
17	48	\N	\N	12.50	25.00	4.16	62.03	1590.04	f	1
18	32	1	74.17	37.50	100.00	71.63	77.32	166.80	t	\N
18	44	2	68.43	0.00	100.00	100.00	67.13	0.00	t	\N
18	56	3	59.39	50.00	100.00	8.74	50.71	1218.68	t	\N
18	49	4	42.58	0.00	100.00	4.16	33.74	1590.04	t	\N
18	11	5	39.38	50.00	60.00	4.16	25.22	1590.04	t	\N
18	41	6	36.98	12.50	60.00	1.88	62.40	1987.51	t	\N
18	20	7	34.49	50.00	25.00	4.16	62.03	1590.04	t	\N
19	23	1	63.97	50.00	100.00	3.07	79.27	1741.90	t	\N
19	21	\N	\N	100.00	25.00	3.07	79.99	1741.90	f	1
19	54	3	45.89	37.50	60.00	8.74	68.84	1218.68	t	\N
19	24	4	45.08	0.00	100.00	3.07	47.31	1741.90	t	\N
19	52	\N	\N	50.00	60.00	8.74	14.75	1218.68	f	1
20	42	1	65.43	100.00	60.00	30.46	74.08	594.39	t	\N
20	51	\N	\N	37.50	60.00	17.56	62.03	869.91	f	1
20	33	3	32.92	12.50	60.00	4.41	53.44	1560.67	t	\N
20	40	4	30.16	0.00	25.00	30.46	75.20	594.39	t	\N
20	29	5	28.13	37.50	25.00	4.63	50.51	1535.92	t	\N
21	46	1	46.28	37.50	60.00	8.74	83.59	1218.68	t	\N
21	36	2	45.11	0.00	100.00	6.40	67.53	1374.29	t	\N
21	27	3	42.63	0.00	100.00	13.03	46.85	1019.08	t	\N
21	38	4	39.14	37.50	60.00	6.40	50.81	1374.29	t	\N
21	47	5	34.98	37.50	60.00	8.74	27.12	1218.68	t	\N
21	48	6	32.41	37.50	25.00	17.56	55.72	869.91	t	\N
21	43	7	32.20	0.00	60.00	5.37	64.29	1462.52	t	\N
21	12	8	27.31	37.50	25.00	10.98	38.44	1104.43	t	\N
21	34	9	25.04	37.50	25.00	10.98	27.12	1104.43	t	\N
21	37	10	23.93	0.00	25.00	6.40	74.16	1374.29	t	\N
22	32	\N	\N	100.00	100.00	10.98	72.87	1104.43	f	1
22	56	\N	\N	0.00	100.00	100.00	33.94	0.00	f	1
22	44	\N	\N	0.00	100.00	8.74	60.01	1218.68	f	1
22	41	4	39.41	37.50	60.00	5.37	53.44	1462.52	t	\N
22	20	\N	\N	0.00	25.00	17.56	52.90	869.91	f	1
23	23	\N	\N	100.00	100.00	8.11	68.98	1255.99	f	1
23	54	2	53.10	0.00	60.00	100.00	50.51	0.00	t	\N
23	21	\N	\N	50.00	25.00	8.11	70.08	1255.99	f	1
24	55	1	65.72	0.00	100.00	100.00	53.61	0.00	t	\N
24	39	\N	\N	100.00	100.00	5.37	42.94	1462.52	f	1
24	53	3	58.46	0.00	60.00	100.00	77.32	0.00	t	\N
24	30	\N	\N	25.00	60.00	10.98	71.43	1104.43	f	1
25	51	\N	\N	100.00	60.00	100.00	79.99	0.00	f	1
25	31	\N	\N	37.50	100.00	10.98	49.91	1104.43	f	1
25	29	3	50.79	100.00	25.00	13.03	75.16	1019.08	t	\N
25	8	\N	\N	25.00	25.00	100.00	49.91	0.00	f	1
25	42	\N	\N	37.50	60.00	5.37	86.50	1462.52	f	1
25	33	\N	\N	37.50	60.00	10.98	76.26	1104.43	f	1
25	15	\N	\N	37.50	60.00	8.74	42.94	1218.68	f	1
25	7	\N	\N	37.50	60.00	5.37	32.72	1462.52	f	1
25	16	\N	\N	50.00	25.00	5.37	63.89	1462.52	f	1
25	50	10	33.58	0.00	60.00	17.56	55.97	869.91	t	\N
25	40	11	26.28	0.00	25.00	5.37	87.17	1462.52	t	\N
\.


--
-- Data for Name: match_run; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.match_run (run_id, organ_id, run_at, hla_weight, urgency_weight, distance_weight, wait_weight, run_by) FROM stdin;
1	4	2025-03-01 09:20:00+05:30	20.00	40.00	25.00	15.00	1
2	5	2026-02-01 09:20:00+05:30	20.00	40.00	25.00	15.00	1
3	6	2026-09-01 09:20:00+05:30	20.00	40.00	25.00	15.00	1
4	7	2025-07-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
5	8	2026-03-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
6	9	2026-07-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
7	10	2025-01-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
8	11	2025-11-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
9	12	2026-05-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
10	13	2024-11-01 09:20:00+05:30	30.00	30.00	20.00	20.00	1
11	14	2025-10-01 09:20:00+05:30	30.00	30.00	20.00	20.00	1
12	15	2026-04-01 09:20:00+05:30	30.00	30.00	20.00	20.00	1
13	16	2026-10-07 00:10:50.585139+05:30	30.00	30.00	20.00	20.00	1
14	17	2024-12-01 09:20:00+05:30	20.00	40.00	25.00	15.00	1
15	18	2025-04-01 09:20:00+05:30	20.00	40.00	25.00	15.00	1
16	19	2024-10-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
17	20	2025-05-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
18	21	2025-12-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
19	22	2026-06-01 09:20:00+05:30	25.00	35.00	20.00	20.00	1
20	23	2025-06-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
21	24	2025-02-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
22	25	2025-08-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
23	26	2025-09-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
24	27	2026-01-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
25	28	2026-08-01 09:20:00+05:30	25.00	30.00	25.00	20.00	1
\.


--
-- Data for Name: organ; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organ (organ_id, donor_id, organ_type_id, recovering_hospital_id, recovered_at, status, discard_reason_id) FROM stdin;
1	1	1	1	2026-10-07 06:50:50.579524+05:30	AVAILABLE	\N
2	2	3	4	2026-10-07 06:20:50.579524+05:30	AVAILABLE	\N
3	3	4	2	2026-10-07 07:20:50.579524+05:30	AVAILABLE	\N
4	11	2	1	2025-03-01 09:00:00+05:30	TRANSPLANTED	\N
5	12	4	1	2026-02-01 09:00:00+05:30	TRANSPLANTED	\N
6	13	1	1	2026-09-01 09:00:00+05:30	TRANSPLANTED	\N
7	14	4	2	2025-07-01 09:00:00+05:30	DISCARDED	3
8	15	3	2	2026-03-01 09:00:00+05:30	TRANSPLANTED	\N
9	16	4	2	2026-07-01 09:00:00+05:30	TRANSPLANTED	\N
10	17	1	3	2025-01-01 09:00:00+05:30	EXPIRED	\N
11	18	3	3	2025-11-01 09:00:00+05:30	TRANSPLANTED	\N
12	19	4	3	2026-05-01 09:00:00+05:30	TRANSPLANTED	\N
13	20	5	4	2024-11-01 09:00:00+05:30	DISCARDED	6
14	21	4	4	2025-10-01 09:00:00+05:30	TRANSPLANTED	\N
15	22	1	4	2026-04-01 09:00:00+05:30	TRANSPLANTED	\N
16	23	4	4	2026-10-06 23:50:50.585139+05:30	TRANSPLANTED	\N
17	24	3	5	2024-12-01 09:00:00+05:30	EXPIRED	\N
18	25	1	5	2025-04-01 09:00:00+05:30	TRANSPLANTED	\N
19	26	4	6	2024-10-01 09:00:00+05:30	TRANSPLANTED	\N
20	27	4	6	2025-05-01 09:00:00+05:30	DISCARDED	5
21	28	1	6	2025-12-01 09:00:00+05:30	DISCARDED	5
22	29	2	6	2026-06-01 09:00:00+05:30	TRANSPLANTED	\N
23	30	3	7	2025-06-01 09:00:00+05:30	TRANSPLANTED	\N
24	31	4	8	2025-02-01 09:00:00+05:30	DISCARDED	1
25	32	1	8	2025-08-01 09:00:00+05:30	EXPIRED	\N
26	33	2	8	2025-09-01 09:00:00+05:30	TRANSPLANTED	\N
27	34	5	8	2026-01-01 09:00:00+05:30	TRANSPLANTED	\N
28	35	3	8	2026-08-01 09:00:00+05:30	TRANSPLANTED	\N
\.


--
-- Data for Name: organ_offer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organ_offer (offer_id, organ_id, recipient_id, run_id, status, created_at, sent_at, responded_at, decline_reason_id, void_reason, notes, created_by) FROM stdin;
1	4	23	1	ACCEPTED	2025-03-01 09:20:00+05:30	2025-03-01 09:40:00+05:30	2025-03-01 11:00:00+05:30	\N	\N	\N	1
2	5	43	2	ACCEPTED	2026-02-01 09:20:00+05:30	2026-02-01 09:40:00+05:30	2026-02-01 11:00:00+05:30	\N	\N	\N	1
3	5	28	2	DECLINED	2026-02-01 09:20:00+05:30	2026-02-01 09:40:00+05:30	2026-02-01 12:00:00+05:30	4	\N	Theatre slot could not be secured in time	1
4	6	35	3	DECLINED	2026-09-01 09:20:00+05:30	2026-09-01 09:40:00+05:30	2026-09-01 12:00:00+05:30	5	\N	Family declined after counselling	1
5	6	25	3	ACCEPTED	2026-09-01 09:20:00+05:30	2026-09-01 09:40:00+05:30	2026-09-01 11:00:00+05:30	\N	\N	\N	1
6	7	36	4	VOIDED	2025-07-01 09:20:00+05:30	2025-07-01 09:40:00+05:30	2025-07-01 13:00:00+05:30	\N	Organ viability window elapsed	\N	1
7	8	29	5	ACCEPTED	2026-03-01 09:20:00+05:30	2026-03-01 09:40:00+05:30	2026-03-01 11:00:00+05:30	\N	\N	\N	1
8	9	34	6	ACCEPTED	2026-07-01 09:20:00+05:30	2026-07-01 09:40:00+05:30	2026-07-01 11:00:00+05:30	\N	\N	\N	1
9	10	32	7	VOIDED	2025-01-01 09:20:00+05:30	2025-01-01 09:40:00+05:30	2025-01-01 13:00:00+05:30	\N	Recipient no longer active	\N	1
10	11	33	8	ACCEPTED	2025-11-01 09:20:00+05:30	2025-11-01 09:40:00+05:30	2025-11-01 11:00:00+05:30	\N	\N	\N	1
11	12	38	9	ACCEPTED	2026-05-01 09:20:00+05:30	2026-05-01 09:40:00+05:30	2026-05-01 11:00:00+05:30	\N	\N	\N	1
12	13	53	10	ACCEPTED	2024-11-01 09:20:00+05:30	2024-11-01 09:40:00+05:30	2024-11-01 11:00:00+05:30	\N	\N	\N	1
13	14	37	11	ACCEPTED	2025-10-01 09:20:00+05:30	2025-10-01 09:40:00+05:30	2025-10-01 11:00:00+05:30	\N	\N	\N	1
14	15	56	12	ACCEPTED	2026-04-01 09:20:00+05:30	2026-04-01 09:40:00+05:30	2026-04-01 11:00:00+05:30	\N	\N	\N	1
15	16	26	13	ACCEPTED	2026-10-07 00:10:50.585139+05:30	2026-10-07 00:30:50.585139+05:30	2026-10-07 01:50:50.585139+05:30	\N	\N	\N	1
16	17	40	14	CANCELLED	2024-12-01 09:20:00+05:30	\N	\N	\N	\N	Offer withdrawn; candidate unreachable	1
17	18	45	15	DECLINED	2025-04-01 09:20:00+05:30	2025-04-01 09:40:00+05:30	2025-04-01 12:00:00+05:30	6	\N	Transplant centre requested an alternative organ	1
18	18	41	15	ACCEPTED	2025-04-01 09:20:00+05:30	2025-04-01 09:40:00+05:30	2025-04-01 11:00:00+05:30	\N	\N	\N	1
19	19	46	16	ACCEPTED	2024-10-01 09:20:00+05:30	2024-10-01 09:40:00+05:30	2024-10-01 11:00:00+05:30	\N	\N	\N	1
20	20	47	17	ACCEPTED	2025-05-01 09:20:00+05:30	2025-05-01 09:40:00+05:30	2025-05-01 11:00:00+05:30	\N	\N	\N	1
21	21	49	18	ACCEPTED	2025-12-01 09:20:00+05:30	2025-12-01 09:40:00+05:30	2025-12-01 11:00:00+05:30	\N	\N	\N	1
22	22	52	19	DECLINED	2026-06-01 09:20:00+05:30	2026-06-01 09:40:00+05:30	2026-06-01 12:00:00+05:30	2	\N	Echocardiography on review	1
23	22	24	19	ACCEPTED	2026-06-01 09:20:00+05:30	2026-06-01 09:40:00+05:30	2026-06-01 11:00:00+05:30	\N	\N	\N	1
24	23	42	20	ACCEPTED	2025-06-01 09:20:00+05:30	2025-06-01 09:40:00+05:30	2025-06-01 11:00:00+05:30	\N	\N	\N	1
25	23	31	20	DECLINED	2025-06-01 09:20:00+05:30	2025-06-01 09:40:00+05:30	2025-06-01 12:00:00+05:30	1	\N	Recipient deteriorated before theatre	1
26	26	54	23	ACCEPTED	2025-09-01 09:20:00+05:30	2025-09-01 09:40:00+05:30	2025-09-01 11:00:00+05:30	\N	\N	\N	1
27	26	22	23	DECLINED	2025-09-01 09:20:00+05:30	2025-09-01 09:40:00+05:30	2025-09-01 12:00:00+05:30	3	\N	Size mismatch identified on review	1
28	27	55	24	ACCEPTED	2026-01-01 09:20:00+05:30	2026-01-01 09:40:00+05:30	2026-01-01 11:00:00+05:30	\N	\N	\N	1
29	27	39	24	EXPIRED	2026-01-01 09:20:00+05:30	2026-01-01 09:40:00+05:30	2026-01-01 13:30:00+05:30	\N	\N	No response inside the response window	1
30	28	50	25	ACCEPTED	2026-08-01 09:20:00+05:30	2026-08-01 09:40:00+05:30	2026-08-01 11:00:00+05:30	\N	\N	\N	1
\.


--
-- Data for Name: organ_type; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organ_type (organ_type_id, name, max_viability_hours, response_window_hours, priority_weight, min_weight_ratio, max_weight_ratio) FROM stdin;
1	Heart	6	1	1.50	0.80	1.50
2	Lung	8	2	1.40	0.80	1.30
3	Liver	12	3	1.30	0.70	2.00
4	Kidney	30	6	1.00	0.50	3.00
5	Pancreas	18	4	1.10	0.70	2.00
\.


--
-- Data for Name: recipient; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipient (recipient_id, name, date_of_birth, blood_group_id, hospital_id, status, height_cm, weight_kg) FROM stdin;
1	Arjun Mehta	1971-04-03	6	1	ACTIVE	175.00	72.00
2	Priya Nair	1985-08-21	4	2	ACTIVE	160.00	58.00
3	Rahul Verma	1968-12-11	2	1	ACTIVE	178.00	80.00
4	Sunita Rao	1979-02-27	6	6	ACTIVE	158.00	62.00
5	Karthik Iyer	1990-06-09	8	2	ACTIVE	172.00	74.00
6	Meera Kulkarni	1976-10-15	6	4	ACTIVE	165.00	66.00
7	Vikram Singh	1964-03-30	1	5	ACTIVE	180.00	85.00
8	Ananya Das	1982-09-18	3	8	ACTIVE	162.00	55.00
9	Imran Sheikh	1973-01-25	5	4	ACTIVE	170.00	70.00
10	Deepa Menon	1988-11-07	8	3	ACTIVE	155.00	60.00
11	Suresh Kumar	1966-05-22	4	7	ACTIVE	176.00	78.00
12	Lakshmi Pillai	1959-07-13	2	3	ACTIVE	150.00	45.00
13	Rohan Joshi	1995-03-04	6	4	ACTIVE	182.00	90.00
14	Farah Khan	1998-12-19	4	1	ACTIVE	150.00	38.00
15	Gopal Reddy	1974-08-08	2	6	ACTIVE	168.00	68.00
16	Nisha Bansal	1983-04-16	7	5	ACTIVE	160.00	57.00
17	Tarun Ghosh	1970-10-02	4	8	ACTIVE	174.00	76.00
18	Divya Shetty	1992-01-31	6	6	ACTIVE	161.00	59.00
19	Harish Patel	1961-09-26	2	4	ACTIVE	177.00	82.00
20	Zoya Ali	1987-06-20	4	7	ACTIVE	158.00	54.00
21	Rakesh Yadav	1966-10-02	1	1	ACTIVE	175.00	76.00
22	Pooja Ramesh	1972-12-29	2	1	ACTIVE	158.00	54.00
23	Chitra Ranganathan	1982-05-11	7	1	TRANSPLANTED	159.00	54.00
24	Kalyani Menon	1996-12-03	7	1	TRANSPLANTED	165.00	56.00
25	Anjali Kulkarni	2000-01-17	6	1	TRANSPLANTED	160.00	64.00
26	Vikram Sethi	2001-01-31	4	1	TRANSPLANTED	168.00	62.00
27	Bhavna Tambe	1969-11-15	2	2	ACTIVE	163.00	60.00
28	Sameer Joshi	1975-01-28	1	2	ACTIVE	172.00	68.00
29	Sridhar Iyer	1993-10-20	4	2	TRANSPLANTED	166.00	64.00
30	Meera Deshpande	1965-09-17	4	3	ACTIVE	160.00	58.00
31	Tara Menon	1971-12-15	5	3	ACTIVE	161.00	59.00
32	Geetha Krishnan	1981-04-26	6	3	INACTIVE	160.00	62.00
33	Gayathri Rao	1989-08-22	6	3	TRANSPLANTED	161.00	62.00
34	Shobana Iyer	1997-12-18	8	3	TRANSPLANTED	157.00	66.00
35	Rahul Bhattacharya	1977-02-26	6	4	ACTIVE	170.00	72.00
36	Rekha Sharma	1986-07-09	4	4	ACTIVE	163.00	66.00
37	Harish Babu	1988-08-07	4	4	TRANSPLANTED	174.00	72.00
38	Naveen Shetty	1995-11-19	4	4	TRANSPLANTED	172.00	70.00
39	Amit Kothari	1974-01-13	4	5	ACTIVE	176.00	74.00
40	Mohan Das	1980-04-11	4	5	ACTIVE	166.00	56.00
41	Ashok Verma	1983-05-26	8	5	TRANSPLANTED	171.00	64.00
42	Kavitha Raman	1985-06-24	6	5	TRANSPLANTED	158.00	58.00
43	Tarun Jain	1992-10-05	8	5	TRANSPLANTED	170.00	58.00
44	Kavya Nair	1967-10-17	6	6	ACTIVE	156.00	52.00
45	Sanjay Patil	1970-11-30	4	6	ACTIVE	170.00	70.00
46	Indira Prasad	1978-03-13	7	6	TRANSPLANTED	154.00	58.00
47	Srinivasan Rajan	1984-06-09	4	6	ACTIVE	167.00	52.00
48	Vinod Gaikwad	1964-09-02	5	7	ACTIVE	168.00	66.00
49	Pradeep Kumar	1990-09-06	4	7	DECEASED	169.00	68.00
50	Rukmini Rao	1999-01-02	4	7	TRANSPLANTED	162.00	60.00
51	Sanjay Kulkarni	1968-10-31	3	8	ACTIVE	171.00	70.00
52	Omar Farooqui	1976-02-12	2	8	ACTIVE	164.00	60.00
53	Sarita Mahajan	1979-03-28	8	8	ACTIVE	157.00	62.00
54	Padmavathi Devi	1987-07-24	8	8	TRANSPLANTED	156.00	58.00
55	Lakshmi Narayan	1991-09-21	7	8	TRANSPLANTED	158.00	64.00
56	Meenakshi Rao	1994-11-04	6	8	TRANSPLANTED	155.00	62.00
\.


--
-- Data for Name: recipient_hla; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipient_hla (recipient_id, allele_id) FROM stdin;
1	17
1	15
1	12
1	7
1	3
1	2
2	18
2	15
2	11
2	7
2	4
2	2
3	18
3	14
3	10
3	8
3	5
3	2
4	18
4	17
4	12
4	9
4	6
4	5
5	17
5	16
5	10
5	9
5	5
5	2
6	18
6	17
6	12
6	9
6	2
6	1
7	16
7	14
7	11
7	8
7	3
7	1
8	14
8	13
8	8
8	7
8	4
8	1
9	16
9	15
9	11
9	10
9	6
9	3
10	16
10	14
10	12
10	11
10	5
10	3
11	15
11	13
11	10
11	7
11	4
11	2
12	18
12	17
12	9
12	7
12	6
12	4
13	17
13	15
13	12
13	9
13	5
13	2
14	15
14	14
14	8
14	7
14	2
14	1
15	18
15	14
15	10
15	8
15	3
15	2
16	17
16	16
16	12
16	11
16	5
16	4
17	15
17	13
17	10
17	8
17	6
17	1
18	18
18	17
18	12
18	9
18	5
18	2
19	16
19	14
19	11
19	7
19	4
19	3
20	18
20	15
20	10
20	7
20	4
20	2
45	3
45	11
45	13
45	14
45	1
45	8
41	3
41	11
41	13
41	14
41	1
41	8
33	3
33	11
33	13
33	14
33	1
33	8
48	3
48	11
48	13
48	14
48	1
48	8
35	3
35	11
35	13
35	14
35	1
35	8
38	3
38	11
38	13
38	14
38	1
38	8
26	2
26	10
26	16
26	15
26	4
26	7
52	2
52	10
52	16
52	15
52	4
52	7
37	2
37	10
37	16
37	15
37	4
37	7
23	2
23	10
23	16
23	15
23	4
23	7
56	2
56	10
56	16
56	15
56	4
56	7
27	2
27	10
27	16
27	15
27	4
27	7
25	14
25	9
25	17
25	3
25	12
25	5
28	14
28	9
28	17
28	3
28	12
28	5
29	14
29	9
29	17
29	3
29	12
29	5
54	14
54	9
54	17
54	3
54	12
54	5
51	14
51	9
51	17
51	3
51	12
51	5
32	14
32	9
32	17
32	3
32	12
32	5
39	18
39	6
39	8
39	10
39	13
39	1
36	18
36	6
36	8
36	10
36	13
36	1
40	18
40	6
40	8
40	10
40	13
40	1
43	18
43	6
43	8
43	10
43	13
43	1
44	18
44	6
44	8
44	10
44	13
44	1
50	18
50	6
50	8
50	10
50	13
50	1
21	7
21	5
21	17
21	15
21	4
21	11
34	7
34	5
34	17
34	15
34	4
34	11
22	7
22	5
22	17
22	15
22	4
22	11
53	7
53	5
53	17
53	15
53	4
53	11
42	7
42	5
42	17
42	15
42	4
42	11
55	7
55	5
55	17
55	15
55	4
55	11
31	16
31	9
31	18
31	3
31	2
31	12
46	16
46	9
46	18
46	3
46	2
46	12
47	16
47	9
47	18
47	3
47	2
47	12
30	16
30	9
30	18
30	3
30	2
30	12
49	16
49	9
49	18
49	3
49	2
49	12
24	16
24	9
24	18
24	3
24	2
24	12
\.


--
-- Data for Name: region; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.region (region_id, region_code, region_name, hla_weight, urgency_weight, distance_weight, wait_weight) FROM stdin;
1	SR	Southern Region	25.00	35.00	20.00	20.00
2	WR	Western Region	30.00	30.00	20.00	20.00
3	NR	Northern Region	20.00	40.00	25.00	15.00
4	ER	Eastern Region	25.00	30.00	25.00	20.00
\.


--
-- Data for Name: role; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role (role_id, role_name) FROM stdin;
1	ADMIN
2	TRANSPLANT_COORDINATOR
3	HOSPITAL_STAFF
4	MEDICAL_REVIEWER
5	AUDITOR
\.


--
-- Data for Name: transplant_event; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.transplant_event (transplant_id, offer_id, hospital_id, transplant_at, outcome, notes) FROM stdin;
1	1	1	2025-03-01 14:00:00+05:30	SUCCESS	Uneventful recovery
2	2	5	2026-02-01 14:00:00+05:30	SUCCESS	Uneventful recovery
3	5	1	2026-09-01 14:00:00+05:30	SUCCESS	Uneventful recovery
4	7	2	2026-03-01 14:00:00+05:30	SUCCESS	Uneventful recovery
5	8	3	2026-07-01 14:00:00+05:30	SUCCESS	Uneventful recovery
6	10	3	2025-11-01 14:00:00+05:30	SUCCESS	Uneventful recovery
7	11	4	2026-05-01 14:00:00+05:30	SUCCESS	Uneventful recovery
8	13	4	2025-10-01 14:00:00+05:30	SUCCESS	Uneventful recovery
9	14	8	2026-04-01 14:00:00+05:30	SUCCESS	Uneventful recovery
10	15	1	2026-10-07 04:50:50.585139+05:30	SUCCESS	Uneventful recovery
11	18	5	2025-04-01 14:00:00+05:30	SUCCESS	Uneventful recovery
12	19	6	2024-10-01 14:00:00+05:30	SUCCESS	Uneventful recovery
13	20	6	2025-05-01 14:00:00+05:30	ORGAN_NOT_USED	Organ assessed unsuitable on receipt; not implanted
14	21	7	2025-12-01 14:00:00+05:30	FAILED	Recipient did not survive the procedure
15	23	1	2026-06-01 14:00:00+05:30	SUCCESS	Uneventful recovery
16	24	5	2025-06-01 14:00:00+05:30	SUCCESS	Uneventful recovery
17	26	8	2025-09-01 14:00:00+05:30	SUCCESS	Uneventful recovery
18	28	8	2026-01-01 14:00:00+05:30	SUCCESS	Uneventful recovery
19	30	7	2026-08-01 14:00:00+05:30	SUCCESS	Uneventful recovery
\.


--
-- Data for Name: transport_record; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.transport_record (transport_id, organ_id, origin_hospital_id, destination_hospital_id, status, departed_at, arrived_at) FROM stdin;
1	4	1	1	DELIVERED	2025-03-01 10:00:00+05:30	2025-03-01 10:00:00+05:30
2	5	1	5	DELIVERED	2026-02-01 10:00:00+05:30	2026-02-01 12:00:00+05:30
3	6	1	1	DELIVERED	2026-09-01 10:00:00+05:30	2026-09-01 10:00:00+05:30
4	8	2	2	DELIVERED	2026-03-01 10:00:00+05:30	2026-03-01 10:00:00+05:30
5	9	2	3	DELIVERED	2026-07-01 10:00:00+05:30	2026-07-01 12:00:00+05:30
6	11	3	3	DELIVERED	2025-11-01 10:00:00+05:30	2025-11-01 10:00:00+05:30
7	12	3	4	DELIVERED	2026-05-01 10:00:00+05:30	2026-05-01 12:00:00+05:30
8	13	4	8	FAILED	2024-11-01 10:00:00+05:30	\N
9	14	4	4	DELIVERED	2025-10-01 10:00:00+05:30	2025-10-01 10:00:00+05:30
10	15	4	8	DELIVERED	2026-04-01 10:00:00+05:30	2026-04-01 12:00:00+05:30
11	16	4	1	DELIVERED	2026-10-07 00:50:50.585139+05:30	2026-10-07 02:50:50.585139+05:30
12	18	5	5	DELIVERED	2025-04-01 10:00:00+05:30	2025-04-01 10:00:00+05:30
13	19	6	6	DELIVERED	2024-10-01 10:00:00+05:30	2024-10-01 10:00:00+05:30
14	20	6	6	DELIVERED	2025-05-01 10:00:00+05:30	2025-05-01 10:00:00+05:30
15	21	6	7	DELIVERED	2025-12-01 10:00:00+05:30	2025-12-01 12:00:00+05:30
16	22	6	1	DELIVERED	2026-06-01 10:00:00+05:30	2026-06-01 12:00:00+05:30
17	23	7	5	DELIVERED	2025-06-01 10:00:00+05:30	2025-06-01 12:00:00+05:30
18	26	8	8	DELIVERED	2025-09-01 10:00:00+05:30	2025-09-01 10:00:00+05:30
19	27	8	8	DELIVERED	2026-01-01 10:00:00+05:30	2026-01-01 10:00:00+05:30
20	28	8	7	DELIVERED	2026-08-01 10:00:00+05:30	2026-08-01 12:00:00+05:30
\.


--
-- Data for Name: urgency; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.urgency (urgency_id, code, description, score_value) FROM stdin;
1	1A	Critical â€” days of expected survival without transplant	100.00
2	1B	High priority â€” hospitalised or rapidly deteriorating	60.00
3	2	Stable â€” routine waitlist status	25.00
\.


--
-- Data for Name: waitlist_entry; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date, status) FROM stdin;
1	4	2	2025-08-07	ACTIVE
2	1	1	2026-07-07	ACTIVE
3	1	2	2026-02-07	ACTIVE
4	4	3	2025-02-07	ACTIVE
5	4	2	2026-04-07	ACTIVE
5	5	2	2026-04-07	ACTIVE
6	4	1	2025-11-07	ACTIVE
7	3	2	2026-05-07	ACTIVE
8	3	3	2026-01-07	ACTIVE
9	1	3	2026-06-07	ACTIVE
10	3	1	2026-08-07	ACTIVE
11	1	2	2025-10-07	ACTIVE
12	4	3	2024-10-07	ACTIVE
13	5	3	2026-07-07	ACTIVE
13	4	2	2026-07-07	ACTIVE
14	1	1	2026-09-07	ACTIVE
15	3	2	2026-03-07	ACTIVE
16	3	3	2025-07-07	SUSPENDED
17	4	2	2025-04-07	SUSPENDED
18	4	3	2025-12-07	ACTIVE
19	3	1	2026-09-07	ACTIVE
20	1	3	2024-12-07	ACTIVE
20	4	3	2025-06-07	ACTIVE
26	4	2	2025-08-06	TRANSPLANTED
25	1	1	2026-07-01	TRANSPLANTED
50	3	2	2025-11-01	TRANSPLANTED
34	4	3	2024-12-01	TRANSPLANTED
24	2	1	2025-12-01	TRANSPLANTED
38	4	2	2024-07-01	TRANSPLANTED
56	1	1	2025-05-01	TRANSPLANTED
29	3	3	2024-11-01	TRANSPLANTED
43	4	2	2024-01-01	TRANSPLANTED
55	5	1	2025-05-01	TRANSPLANTED
49	1	1	2025-09-01	TRANSPLANTED
33	3	2	2024-10-01	TRANSPLANTED
37	4	3	2023-06-01	TRANSPLANTED
54	2	2	2025-02-01	TRANSPLANTED
36	4	1	2023-11-01	ACTIVE
42	3	2	2023-10-01	TRANSPLANTED
47	4	2	2024-12-01	ACTIVE
41	1	2	2024-12-01	TRANSPLANTED
23	2	1	2024-05-01	TRANSPLANTED
32	1	1	2024-01-01	SUSPENDED
40	3	3	2023-09-01	ACTIVE
53	5	2	2024-02-01	ACTIVE
46	4	2	2022-08-01	TRANSPLANTED
35	1	2	2026-07-07	ACTIVE
52	2	2	2026-05-07	ACTIVE
28	4	3	2025-10-07	ACTIVE
39	5	1	2025-08-07	ACTIVE
22	2	3	2026-08-07	ACTIVE
31	3	1	2026-01-07	REMOVED
45	1	3	2026-04-07	ACTIVE
27	4	1	2024-08-07	ACTIVE
51	3	2	2024-06-07	ACTIVE
44	1	1	2024-09-07	ACTIVE
21	2	3	2024-04-07	ACTIVE
30	5	2	2024-07-07	ACTIVE
48	4	3	2024-05-07	ACTIVE
\.


--
-- Name: app_user_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.app_user_user_id_seq', 1, true);


--
-- Name: audit_log_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_audit_id_seq', 56, true);


--
-- Name: blood_group_blood_group_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.blood_group_blood_group_id_seq', 8, true);


--
-- Name: decline_reason_decline_reason_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.decline_reason_decline_reason_id_seq', 6, true);


--
-- Name: discard_reason_discard_reason_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.discard_reason_discard_reason_id_seq', 6, true);


--
-- Name: donor_donor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.donor_donor_id_seq', 35, true);


--
-- Name: exclusion_reason_exclusion_reason_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.exclusion_reason_exclusion_reason_id_seq', 5, true);


--
-- Name: hla_allele_allele_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.hla_allele_allele_id_seq', 18, true);


--
-- Name: hospital_hospital_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.hospital_hospital_id_seq', 8, true);


--
-- Name: match_run_run_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.match_run_run_id_seq', 25, true);


--
-- Name: organ_offer_offer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.organ_offer_offer_id_seq', 30, true);


--
-- Name: organ_organ_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.organ_organ_id_seq', 28, true);


--
-- Name: organ_type_organ_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.organ_type_organ_type_id_seq', 5, true);


--
-- Name: recipient_recipient_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.recipient_recipient_id_seq', 56, true);


--
-- Name: region_region_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.region_region_id_seq', 4, true);


--
-- Name: role_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_role_id_seq', 5, true);


--
-- Name: transplant_event_transplant_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transplant_event_transplant_id_seq', 19, true);


--
-- Name: transport_record_transport_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transport_record_transport_id_seq', 20, true);


--
-- Name: urgency_urgency_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.urgency_urgency_id_seq', 3, true);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);


--
-- Name: app_user app_user_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_username_key UNIQUE (username);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id);


--
-- Name: blood_compatibility blood_compatibility_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blood_compatibility
    ADD CONSTRAINT blood_compatibility_pkey PRIMARY KEY (donor_bg_id, recipient_bg_id);


--
-- Name: blood_group blood_group_group_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blood_group
    ADD CONSTRAINT blood_group_group_name_key UNIQUE (group_name);


--
-- Name: blood_group blood_group_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blood_group
    ADD CONSTRAINT blood_group_pkey PRIMARY KEY (blood_group_id);


--
-- Name: decline_reason decline_reason_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.decline_reason
    ADD CONSTRAINT decline_reason_code_key UNIQUE (code);


--
-- Name: decline_reason decline_reason_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.decline_reason
    ADD CONSTRAINT decline_reason_pkey PRIMARY KEY (decline_reason_id);


--
-- Name: discard_reason discard_reason_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discard_reason
    ADD CONSTRAINT discard_reason_code_key UNIQUE (code);


--
-- Name: discard_reason discard_reason_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discard_reason
    ADD CONSTRAINT discard_reason_pkey PRIMARY KEY (discard_reason_id);


--
-- Name: donor_hla donor_hla_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor_hla
    ADD CONSTRAINT donor_hla_pkey PRIMARY KEY (donor_id, allele_id);


--
-- Name: donor donor_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor
    ADD CONSTRAINT donor_pkey PRIMARY KEY (donor_id);


--
-- Name: exclusion_reason exclusion_reason_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exclusion_reason
    ADD CONSTRAINT exclusion_reason_code_key UNIQUE (code);


--
-- Name: exclusion_reason exclusion_reason_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exclusion_reason
    ADD CONSTRAINT exclusion_reason_pkey PRIMARY KEY (exclusion_reason_id);


--
-- Name: hla_allele hla_allele_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hla_allele
    ADD CONSTRAINT hla_allele_pkey PRIMARY KEY (allele_id);


--
-- Name: hospital hospital_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hospital
    ADD CONSTRAINT hospital_pkey PRIMARY KEY (hospital_id);


--
-- Name: match_result match_result_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_result
    ADD CONSTRAINT match_result_pkey PRIMARY KEY (run_id, recipient_id);


--
-- Name: match_run match_run_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_run
    ADD CONSTRAINT match_run_pkey PRIMARY KEY (run_id);


--
-- Name: organ_offer organ_offer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_pkey PRIMARY KEY (offer_id);


--
-- Name: organ organ_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ
    ADD CONSTRAINT organ_pkey PRIMARY KEY (organ_id);


--
-- Name: organ_type organ_type_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_type
    ADD CONSTRAINT organ_type_name_key UNIQUE (name);


--
-- Name: organ_type organ_type_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_type
    ADD CONSTRAINT organ_type_pkey PRIMARY KEY (organ_type_id);


--
-- Name: recipient_hla recipient_hla_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient_hla
    ADD CONSTRAINT recipient_hla_pkey PRIMARY KEY (recipient_id, allele_id);


--
-- Name: recipient recipient_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient
    ADD CONSTRAINT recipient_pkey PRIMARY KEY (recipient_id);


--
-- Name: region region_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.region
    ADD CONSTRAINT region_pkey PRIMARY KEY (region_id);


--
-- Name: region region_region_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.region
    ADD CONSTRAINT region_region_code_key UNIQUE (region_code);


--
-- Name: role role_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (role_id);


--
-- Name: role role_role_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT role_role_name_key UNIQUE (role_name);


--
-- Name: transplant_event transplant_event_offer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transplant_event
    ADD CONSTRAINT transplant_event_offer_id_key UNIQUE (offer_id);


--
-- Name: transplant_event transplant_event_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transplant_event
    ADD CONSTRAINT transplant_event_pkey PRIMARY KEY (transplant_id);


--
-- Name: transport_record transport_record_organ_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_record
    ADD CONSTRAINT transport_record_organ_id_key UNIQUE (organ_id);


--
-- Name: transport_record transport_record_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_record
    ADD CONSTRAINT transport_record_pkey PRIMARY KEY (transport_id);


--
-- Name: urgency urgency_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.urgency
    ADD CONSTRAINT urgency_code_key UNIQUE (code);


--
-- Name: urgency urgency_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.urgency
    ADD CONSTRAINT urgency_pkey PRIMARY KEY (urgency_id);


--
-- Name: hla_allele ux_hla_allele_natural; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hla_allele
    ADD CONSTRAINT ux_hla_allele_natural UNIQUE (locus, allele_name);


--
-- Name: waitlist_entry waitlist_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entry
    ADD CONSTRAINT waitlist_entry_pkey PRIMARY KEY (recipient_id, organ_type_id);


--
-- Name: ix_audit_table_row; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_audit_table_row ON public.audit_log USING btree (table_name, row_id);


--
-- Name: ix_match_result_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_match_result_run ON public.match_result USING btree (run_id);


--
-- Name: ix_offer_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_offer_open ON public.organ_offer USING btree (status) WHERE (status = ANY (ARRAY['CREATED'::text, 'SENT'::text]));


--
-- Name: ix_offer_organ; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_offer_organ ON public.organ_offer USING btree (organ_id);


--
-- Name: ix_offer_recipient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_offer_recipient ON public.organ_offer USING btree (recipient_id);


--
-- Name: ix_organ_available; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_organ_available ON public.organ USING btree (status) WHERE (status = 'AVAILABLE'::text);


--
-- Name: ix_organ_donor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_organ_donor ON public.organ USING btree (donor_id);


--
-- Name: ix_waitlist_organ_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_waitlist_organ_type ON public.waitlist_entry USING btree (organ_type_id);


--
-- Name: ix_waitlist_recipient; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_waitlist_recipient ON public.waitlist_entry USING btree (recipient_id);


--
-- Name: ux_match_rank; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_match_rank ON public.match_result USING btree (run_id, rank) WHERE qualified;


--
-- Name: ux_offer_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_offer_active ON public.organ_offer USING btree (organ_id) WHERE (status = ANY (ARRAY['CREATED'::text, 'SENT'::text]));


--
-- Name: ux_offer_no_reoffer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_offer_no_reoffer ON public.organ_offer USING btree (organ_id, recipient_id) WHERE (status <> ALL (ARRAY['VOIDED'::text, 'CANCELLED'::text]));


--
-- Name: organ_offer trg_accept_recheck; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_accept_recheck BEFORE UPDATE ON public.organ_offer FOR EACH ROW EXECUTE FUNCTION public.fn_accept_recheck();


--
-- Name: donor trg_audit_donor; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_donor AFTER INSERT OR DELETE OR UPDATE ON public.donor FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: organ_offer trg_audit_offer; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_offer AFTER INSERT OR DELETE OR UPDATE ON public.organ_offer FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: organ trg_audit_organ; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_organ AFTER INSERT OR DELETE OR UPDATE ON public.organ FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: recipient trg_audit_recipient; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_recipient AFTER INSERT OR DELETE OR UPDATE ON public.recipient FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: transplant_event trg_audit_transplant; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_transplant AFTER INSERT OR DELETE OR UPDATE ON public.transplant_event FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: waitlist_entry trg_audit_waitlist; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_waitlist AFTER INSERT OR DELETE OR UPDATE ON public.waitlist_entry FOR EACH ROW EXECUTE FUNCTION public.fn_audit();


--
-- Name: organ_offer trg_offer_accepted; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_offer_accepted AFTER UPDATE ON public.organ_offer FOR EACH ROW EXECUTE FUNCTION public.fn_offer_accepted();


--
-- Name: organ_offer trg_offer_compatibility; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_offer_compatibility BEFORE INSERT ON public.organ_offer FOR EACH ROW EXECUTE FUNCTION public.fn_offer_compatibility();


--
-- Name: organ_offer trg_offer_viability; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_offer_viability BEFORE INSERT ON public.organ_offer FOR EACH ROW EXECUTE FUNCTION public.fn_offer_viability();


--
-- Name: organ trg_organ_status_transitions; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_organ_status_transitions BEFORE UPDATE ON public.organ FOR EACH ROW EXECUTE FUNCTION public.fn_organ_status_transitions();


--
-- Name: transplant_event trg_transplant_recorded; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_transplant_recorded AFTER INSERT ON public.transplant_event FOR EACH ROW EXECUTE FUNCTION public.fn_transplant_recorded();


--
-- Name: transplant_event trg_transplant_requires_delivery; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_transplant_requires_delivery BEFORE INSERT ON public.transplant_event FOR EACH ROW EXECUTE FUNCTION public.fn_transplant_requires_delivery();


--
-- Name: app_user app_user_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.role(role_id) ON DELETE RESTRICT;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(user_id) ON DELETE SET NULL;


--
-- Name: blood_compatibility blood_compatibility_donor_bg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blood_compatibility
    ADD CONSTRAINT blood_compatibility_donor_bg_id_fkey FOREIGN KEY (donor_bg_id) REFERENCES public.blood_group(blood_group_id) ON DELETE RESTRICT;


--
-- Name: blood_compatibility blood_compatibility_recipient_bg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.blood_compatibility
    ADD CONSTRAINT blood_compatibility_recipient_bg_id_fkey FOREIGN KEY (recipient_bg_id) REFERENCES public.blood_group(blood_group_id) ON DELETE RESTRICT;


--
-- Name: donor donor_blood_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor
    ADD CONSTRAINT donor_blood_group_id_fkey FOREIGN KEY (blood_group_id) REFERENCES public.blood_group(blood_group_id) ON DELETE RESTRICT;


--
-- Name: donor_hla donor_hla_allele_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor_hla
    ADD CONSTRAINT donor_hla_allele_id_fkey FOREIGN KEY (allele_id) REFERENCES public.hla_allele(allele_id) ON DELETE RESTRICT;


--
-- Name: donor_hla donor_hla_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor_hla
    ADD CONSTRAINT donor_hla_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donor(donor_id) ON DELETE CASCADE;


--
-- Name: donor donor_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.donor
    ADD CONSTRAINT donor_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: hospital hospital_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hospital
    ADD CONSTRAINT hospital_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.region(region_id) ON DELETE RESTRICT;


--
-- Name: match_result match_result_exclusion_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_result
    ADD CONSTRAINT match_result_exclusion_reason_id_fkey FOREIGN KEY (exclusion_reason_id) REFERENCES public.exclusion_reason(exclusion_reason_id) ON DELETE RESTRICT;


--
-- Name: match_result match_result_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_result
    ADD CONSTRAINT match_result_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipient(recipient_id) ON DELETE RESTRICT;


--
-- Name: match_result match_result_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_result
    ADD CONSTRAINT match_result_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.match_run(run_id) ON DELETE CASCADE;


--
-- Name: match_run match_run_organ_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_run
    ADD CONSTRAINT match_run_organ_id_fkey FOREIGN KEY (organ_id) REFERENCES public.organ(organ_id) ON DELETE RESTRICT;


--
-- Name: match_run match_run_run_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.match_run
    ADD CONSTRAINT match_run_run_by_fkey FOREIGN KEY (run_by) REFERENCES public.app_user(user_id) ON DELETE SET NULL;


--
-- Name: organ organ_discard_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ
    ADD CONSTRAINT organ_discard_reason_id_fkey FOREIGN KEY (discard_reason_id) REFERENCES public.discard_reason(discard_reason_id) ON DELETE RESTRICT;


--
-- Name: organ organ_donor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ
    ADD CONSTRAINT organ_donor_id_fkey FOREIGN KEY (donor_id) REFERENCES public.donor(donor_id) ON DELETE RESTRICT;


--
-- Name: organ_offer organ_offer_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_user(user_id) ON DELETE SET NULL;


--
-- Name: organ_offer organ_offer_decline_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_decline_reason_id_fkey FOREIGN KEY (decline_reason_id) REFERENCES public.decline_reason(decline_reason_id) ON DELETE RESTRICT;


--
-- Name: organ_offer organ_offer_organ_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_organ_id_fkey FOREIGN KEY (organ_id) REFERENCES public.organ(organ_id) ON DELETE RESTRICT;


--
-- Name: organ_offer organ_offer_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipient(recipient_id) ON DELETE RESTRICT;


--
-- Name: organ_offer organ_offer_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ_offer
    ADD CONSTRAINT organ_offer_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.match_run(run_id) ON DELETE SET NULL;


--
-- Name: organ organ_organ_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ
    ADD CONSTRAINT organ_organ_type_id_fkey FOREIGN KEY (organ_type_id) REFERENCES public.organ_type(organ_type_id) ON DELETE RESTRICT;


--
-- Name: organ organ_recovering_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organ
    ADD CONSTRAINT organ_recovering_hospital_id_fkey FOREIGN KEY (recovering_hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: recipient recipient_blood_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient
    ADD CONSTRAINT recipient_blood_group_id_fkey FOREIGN KEY (blood_group_id) REFERENCES public.blood_group(blood_group_id) ON DELETE RESTRICT;


--
-- Name: recipient_hla recipient_hla_allele_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient_hla
    ADD CONSTRAINT recipient_hla_allele_id_fkey FOREIGN KEY (allele_id) REFERENCES public.hla_allele(allele_id) ON DELETE RESTRICT;


--
-- Name: recipient_hla recipient_hla_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient_hla
    ADD CONSTRAINT recipient_hla_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipient(recipient_id) ON DELETE CASCADE;


--
-- Name: recipient recipient_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipient
    ADD CONSTRAINT recipient_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: transplant_event transplant_event_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transplant_event
    ADD CONSTRAINT transplant_event_hospital_id_fkey FOREIGN KEY (hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: transplant_event transplant_event_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transplant_event
    ADD CONSTRAINT transplant_event_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.organ_offer(offer_id) ON DELETE RESTRICT;


--
-- Name: transport_record transport_record_destination_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_record
    ADD CONSTRAINT transport_record_destination_hospital_id_fkey FOREIGN KEY (destination_hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: transport_record transport_record_organ_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_record
    ADD CONSTRAINT transport_record_organ_id_fkey FOREIGN KEY (organ_id) REFERENCES public.organ(organ_id) ON DELETE RESTRICT;


--
-- Name: transport_record transport_record_origin_hospital_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_record
    ADD CONSTRAINT transport_record_origin_hospital_id_fkey FOREIGN KEY (origin_hospital_id) REFERENCES public.hospital(hospital_id) ON DELETE RESTRICT;


--
-- Name: waitlist_entry waitlist_entry_organ_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entry
    ADD CONSTRAINT waitlist_entry_organ_type_id_fkey FOREIGN KEY (organ_type_id) REFERENCES public.organ_type(organ_type_id) ON DELETE RESTRICT;


--
-- Name: waitlist_entry waitlist_entry_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entry
    ADD CONSTRAINT waitlist_entry_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.recipient(recipient_id) ON DELETE CASCADE;


--
-- Name: waitlist_entry waitlist_entry_urgency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.waitlist_entry
    ADD CONSTRAINT waitlist_entry_urgency_id_fkey FOREIGN KEY (urgency_id) REFERENCES public.urgency(urgency_id) ON DELETE RESTRICT;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict DAfF1l3ULKkhoazBcDEUdpmxGN651Ief3rkEWfHh9AAhEn0Udon8mbiEGka54q3

