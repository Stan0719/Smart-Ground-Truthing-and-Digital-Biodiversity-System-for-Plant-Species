-- Add soft cancellation metadata for Botanist owned edit proposals.
-- Apply only after approval; this migration never deletes record or version data.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(current_schema() || '.record_change_submission') IS NOT NULL THEN
    ALTER TABLE record_change_submission ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE record_change_submission ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    ALTER TABLE record_change_submission DROP CONSTRAINT IF EXISTS record_change_submission_check1;
    ALTER TABLE record_change_submission DROP CONSTRAINT IF EXISTS record_change_submission_status_check;
    ALTER TABLE record_change_submission DROP CONSTRAINT IF EXISTS record_change_submission_review_state_check;
    ALTER TABLE record_change_submission ADD CONSTRAINT record_change_submission_status_check
      CHECK(status IN ('Pending Review','Correction Required','Approved','Rejected','Cancelled'));
    ALTER TABLE record_change_submission ADD CONSTRAINT record_change_submission_review_state_check
      CHECK ((status='Pending Review' AND reviewed_at IS NULL AND reviewed_by IS NULL
          AND cancelled_at IS NULL AND cancelled_by IS NULL)
        OR (status='Correction Required' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
          AND cancelled_at IS NULL AND cancelled_by IS NULL)
        OR (status IN ('Approved','Rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
          AND cancelled_at IS NULL AND cancelled_by IS NULL)
        OR (status='Cancelled' AND cancelled_at IS NOT NULL AND cancelled_by=owner_subject
          AND ((reviewed_at IS NULL AND reviewed_by IS NULL) OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))));
    DROP INDEX IF EXISTS record_change_pending_plant;
    DROP INDEX IF EXISTS record_change_pending_species;
    CREATE UNIQUE INDEX record_change_pending_plant ON record_change_submission(plant_id)
      WHERE status IN ('Pending Review','Correction Required') AND plant_id IS NOT NULL;
    CREATE UNIQUE INDEX record_change_pending_species ON record_change_submission(species_id)
      WHERE status IN ('Pending Review','Correction Required') AND species_id IS NOT NULL;
  END IF;
  IF to_regclass(current_schema() || '.record_version_history') IS NOT NULL THEN
    ALTER TABLE record_version_history DROP CONSTRAINT IF EXISTS record_version_history_status_check;
    ALTER TABLE record_version_history ADD CONSTRAINT record_version_history_status_check
      CHECK(status IN ('Pending Review','Approved','Rejected','Correction Required','Flagged','Superseded','Cancelled'));
  END IF;
  IF to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL THEN
    ALTER TABLE observation_edit_request ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE observation_edit_request ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    ALTER TABLE observation_edit_request DROP CONSTRAINT IF EXISTS observation_edit_request_status_check;
    ALTER TABLE observation_edit_request DROP CONSTRAINT IF EXISTS observation_edit_request_cancel_state_check;
    ALTER TABLE observation_edit_request ADD CONSTRAINT observation_edit_request_status_check
      CHECK(status IN ('Pending Review','Correction Required','Approved','Rejected','Cancelled'));
    ALTER TABLE observation_edit_request ADD CONSTRAINT observation_edit_request_cancel_state_check
      CHECK ((status='Cancelled' AND cancelled_at IS NOT NULL AND cancelled_by=owner_subject)
        OR (status<>'Cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL));
    ALTER TABLE observation_edit_event DROP CONSTRAINT IF EXISTS observation_edit_event_event_type_check;
    ALTER TABLE observation_edit_event ADD CONSTRAINT observation_edit_event_event_type_check
      CHECK(event_type IN ('submitted','correction_required','resubmitted','approved','rejected','cancelled'));
  END IF;
END $$;
COMMIT;
