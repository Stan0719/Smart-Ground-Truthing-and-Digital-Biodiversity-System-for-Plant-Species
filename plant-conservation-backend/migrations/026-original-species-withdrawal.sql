-- Draft only. Review the live plant_app schema and verify a current backup before applying.
-- Preserves Species request rows, proposed Species, photos, and Officer feedback.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN RAISE EXCEPTION 'Wrong schema; expected plant_app'; END IF;
  IF to_regclass('plant_app.species_request_submission') IS NULL OR
     to_regclass('plant_app.record_version_history') IS NULL THEN
    RAISE EXCEPTION 'Required Species request/history tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='plant_app.species_request_submission'::regclass
      AND conname='species_request_submission_request_status_check') THEN
    RAISE EXCEPTION 'Review the live Species request status constraint before migration';
  END IF;
  IF to_regclass('plant_app.record_version_history') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid='plant_app.record_version_history'::regclass
        AND conname='record_version_history_status_check') THEN
    RAISE EXCEPTION 'Review the live version history status constraint before migration';
  END IF;
END $$;

ALTER TABLE species_request_submission ADD COLUMN IF NOT EXISTS withdrawn_by TEXT;
ALTER TABLE species_request_submission ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
ALTER TABLE species_request_submission DROP CONSTRAINT species_request_submission_request_status_check;
ALTER TABLE species_request_submission ADD CONSTRAINT species_request_submission_request_status_check
  CHECK (request_status IN ('Pending Review','Approved','Rejected','Correction Required','Withdrawn'));
ALTER TABLE species_request_submission DROP CONSTRAINT IF EXISTS species_request_withdrawal_state_check;
ALTER TABLE species_request_submission ADD CONSTRAINT species_request_withdrawal_state_check
  CHECK ((request_status='Withdrawn') = (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL));
DO $$ BEGIN
  IF to_regclass('plant_app.record_version_history') IS NOT NULL THEN
    ALTER TABLE record_version_history DROP CONSTRAINT record_version_history_status_check;
    ALTER TABLE record_version_history ADD CONSTRAINT record_version_history_status_check
      CHECK (status IN ('Pending Review','Approved','Rejected','Correction Required','Flagged','Superseded','Cancelled','Withdrawn'));
  END IF;
END $$;
COMMIT;
