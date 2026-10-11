-- =====================================================================
-- OrganLink upgrade: OL-039 (offer/run provenance)
-- Existing installs only. A fresh install needs nothing from this file:
-- db/01_schema.sql already declares these constraints.
--
-- Enforces in PostgreSQL that an offer made from a match run is for that
-- run's organ:
--   * match_run:   UNIQUE (run_id, organ_id)            (target of the FK)
--   * organ_offer: FOREIGN KEY (run_id, organ_id)
--                  REFERENCES match_run (run_id, organ_id) ON DELETE RESTRICT
--                  replacing the single-column FK on organ_offer(run_id).
-- MATCH SIMPLE (the default): offers with run_id NULL stay valid.
--
-- Behaviour change: deleting a match run that an offer references is now
-- refused (the old FK set the offer's run_id to NULL). No API path deletes
-- runs; match runs are permanent (BR-6).
--
-- Safety: it refuses to run if any existing offer references a run of a
-- different organ (it never edits rows to make the constraint fit).
-- It changes no table data. Safe to re-run; one transaction.
-- Apply after db/upgrades/OL-036_OL-037.sql (independent, but keep order).
-- Usage (choose the target database explicitly):
--   psql -v ON_ERROR_STOP=1 -X -d <database> -f db/upgrades/OL-039.sql
-- =====================================================================

\set ON_ERROR_STOP on
BEGIN;

-- 1. Refuse to proceed over inconsistent data.
DO $$
DECLARE
    n INTEGER;
BEGIN
    SELECT count(*) INTO n
      FROM organ_offer f JOIN match_run m ON m.run_id = f.run_id
     WHERE f.organ_id <> m.organ_id;
    IF n > 0 THEN
        RAISE EXCEPTION 'OL-039 upgrade refused: % offer(s) reference a match run of a different organ', n;
    END IF;
END $$;

-- 2. Parent key for the composite FK.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'match_run'::regclass
                      AND conname  = 'ux_match_run_run_organ') THEN
        ALTER TABLE match_run
            ADD CONSTRAINT ux_match_run_run_organ UNIQUE (run_id, organ_id);
    END IF;
END $$;

-- 3. Drop the single-column FK on organ_offer(run_id), whatever its name
--    (organ_offer_run_id_fkey in schemas before OL-039).
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'organ_offer'::regclass
           AND contype  = 'f'
           AND conkey   = ARRAY[(SELECT attnum FROM pg_attribute
                                  WHERE attrelid = 'organ_offer'::regclass
                                    AND attname  = 'run_id')]
    LOOP
        EXECUTE format('ALTER TABLE organ_offer DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

-- 4. The composite provenance FK.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'organ_offer'::regclass
                      AND conname  = 'fk_offer_run_same_organ') THEN
        ALTER TABLE organ_offer
            ADD CONSTRAINT fk_offer_run_same_organ FOREIGN KEY (run_id, organ_id)
                REFERENCES match_run (run_id, organ_id) ON DELETE RESTRICT;
    END IF;
END $$;

COMMIT;
