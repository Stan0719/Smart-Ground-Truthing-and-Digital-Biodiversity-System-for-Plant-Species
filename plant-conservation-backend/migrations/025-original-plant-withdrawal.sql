-- Review against the live plant_app constraints and take a verified backup before applying.
-- Retains the Plant, initial Observation, photos, QR assignment and review history.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
  IF to_regclass('plant_app.plant_record') IS NULL OR
     to_regclass('plant_app.plant_observation') IS NULL OR
     to_regclass('plant_app.record_version_history') IS NULL THEN
    RAISE EXCEPTION 'Required Plant submission tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='plant_app.plant_record'::regclass AND conname='plant_record_rbac_status_check') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='plant_app.plant_observation'::regclass AND conname='plant_observation_status_check') OR
     NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='plant_app.record_version_history'::regclass AND conname='record_version_history_status_check') THEN
    RAISE EXCEPTION 'Review the live status constraint names before this migration';
  END IF;
END $$;

ALTER TABLE plant_record ADD COLUMN IF NOT EXISTS withdrawn_by TEXT;
ALTER TABLE plant_record ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE plant_record DROP CONSTRAINT plant_record_rbac_status_check;
ALTER TABLE plant_record ADD CONSTRAINT plant_record_rbac_status_check
  CHECK (rbac_status IN ('Pending Review','Approved','Rejected','Flagged','Correction Required','Withdrawn'));
ALTER TABLE plant_record DROP CONSTRAINT IF EXISTS plant_record_withdrawal_state_check;
ALTER TABLE plant_record ADD CONSTRAINT plant_record_withdrawal_state_check
  CHECK ((rbac_status='Withdrawn') = (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL));

ALTER TABLE plant_observation DROP CONSTRAINT plant_observation_status_check;
ALTER TABLE plant_observation ADD CONSTRAINT plant_observation_status_check
  CHECK (status IN ('Draft','Pending Review','Approved','Rejected','Flagged','Correction Required','Withdrawn'));

ALTER TABLE record_version_history DROP CONSTRAINT record_version_history_status_check;
ALTER TABLE record_version_history ADD CONSTRAINT record_version_history_status_check
  CHECK (status IN ('Pending Review','Approved','Rejected','Correction Required','Flagged','Superseded','Cancelled','Withdrawn'));
COMMIT;
