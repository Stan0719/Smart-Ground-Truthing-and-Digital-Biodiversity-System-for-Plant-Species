-- Draft only. Verify the live plant_app schema and a usable backup before applying.
-- Adds Observation withdrawal audit metadata without changing existing Observation,
-- review, version-history, photo, Plant, Species, or QR records.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
  IF to_regclass('plant_app.plant_observation') IS NULL THEN
    RAISE EXCEPTION 'Required plant_app.plant_observation table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='plant_app.plant_observation'::regclass
      AND conname='plant_observation_status_check') THEN
    RAISE EXCEPTION 'Review the live Observation status constraint before migration';
  END IF;
END $$;

ALTER TABLE plant_observation ADD COLUMN IF NOT EXISTS withdrawn_by TEXT;
ALTER TABLE plant_observation ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

-- Legacy Plant-withdrawal workflows may already have marked an initial
-- Observation Withdrawn without separate Observation audit metadata. Permit
-- those rows unchanged; new endpoint withdrawals always write both fields.
ALTER TABLE plant_observation DROP CONSTRAINT IF EXISTS observation_withdrawal_audit_pair_check;
ALTER TABLE plant_observation ADD CONSTRAINT observation_withdrawal_audit_pair_check
  CHECK ((withdrawn_by IS NULL) = (withdrawn_at IS NULL));

ALTER TABLE plant_observation DROP CONSTRAINT plant_observation_status_check;
ALTER TABLE plant_observation ADD CONSTRAINT plant_observation_status_check
  CHECK (status IN ('Draft','Pending Review','Approved','Rejected','Flagged','Correction Required','Withdrawn'));
COMMIT;
