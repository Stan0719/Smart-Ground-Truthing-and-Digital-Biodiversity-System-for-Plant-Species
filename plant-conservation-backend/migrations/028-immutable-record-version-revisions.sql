-- Draft only. Apply after reviewed migrations 025-027 and an independently
-- verified backup. This migration preserves legacy rows; it does not infer or
-- backfill missing historical snapshots.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
  IF to_regclass('plant_app.record_version_history') IS NULL OR
     to_regclass('plant_app.record_change_submission') IS NULL THEN
    RAISE EXCEPTION 'Required record history and change tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='record_change_submission' AND column_name='revision') THEN
    RAISE EXCEPTION 'record_change_submission.revision is required';
  END IF;
END $$;

ALTER TABLE record_version_history ADD COLUMN IF NOT EXISTS change_revision INTEGER;
-- Existing code retained one mutable history row per change request. If exactly
-- one row exists, associate it with the request's current revision without
-- changing its snapshot/status; ambiguous multi-row legacy links remain NULL.
WITH single_rows AS (
  SELECT v.change_id, MAX(c.revision) AS revision
  FROM record_version_history v JOIN record_change_submission c ON c.id=v.change_id
  WHERE v.change_id IS NOT NULL AND v.change_revision IS NULL
  GROUP BY v.change_id HAVING COUNT(*)=1
)
UPDATE record_version_history v SET change_revision=s.revision
FROM single_rows s WHERE v.change_id=s.change_id AND v.change_revision IS NULL;
ALTER TABLE record_version_history DROP CONSTRAINT IF EXISTS record_version_history_change_revision_check;
ALTER TABLE record_version_history ADD CONSTRAINT record_version_history_change_revision_check
  CHECK (change_revision IS NULL OR change_revision > 0);
CREATE UNIQUE INDEX IF NOT EXISTS record_version_change_revision
  ON record_version_history(change_id, change_revision)
  WHERE change_id IS NOT NULL AND change_revision IS NOT NULL;

CREATE OR REPLACE FUNCTION plant_app.prevent_record_version_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plant_app, pg_catalog
AS $$ BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.record_type IS DISTINCT FROM OLD.record_type OR
     NEW.plant_id IS DISTINCT FROM OLD.plant_id OR
     NEW.request_id IS DISTINCT FROM OLD.request_id OR
     NEW.version_number IS DISTINCT FROM OLD.version_number OR
     NEW.owner_subject IS DISTINCT FROM OLD.owner_subject OR
     NEW.edited_by IS DISTINCT FROM OLD.edited_by OR
     NEW.snapshot IS DISTINCT FROM OLD.snapshot OR
     NEW.previous_snapshot IS DISTINCT FROM OLD.previous_snapshot OR
     NEW.species_photo IS DISTINCT FROM OLD.species_photo OR
     NEW.change_id IS DISTINCT FROM OLD.change_id OR
     NEW.change_revision IS DISTINCT FROM OLD.change_revision OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Record version snapshots are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_version_snapshot_immutable ON record_version_history;
CREATE TRIGGER record_version_snapshot_immutable
  BEFORE UPDATE ON record_version_history
  FOR EACH ROW EXECUTE FUNCTION plant_app.prevent_record_version_snapshot_mutation();
COMMIT;
