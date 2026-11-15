-- Add owner-scoped correction notifications for approved Plant/Species edit proposals.
-- Existing notification rows and read state remain unchanged.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('plant_app.botanist_notification') IS NULL THEN
    RAISE EXCEPTION 'Apply the Botanist notification migration before this migration';
  END IF;
  ALTER TABLE plant_app.botanist_notification DROP CONSTRAINT IF EXISTS botanist_notification_type_check;
  ALTER TABLE plant_app.botanist_notification ADD CONSTRAINT botanist_notification_type_check
    CHECK (type IN ('observation_submitted','observation_approved','observation_rejected','correction_requested',
      'sync_failed','sync_completed','record_change_correction'));
  ALTER TABLE plant_app.botanist_notification DROP CONSTRAINT IF EXISTS botanist_notification_check;
  ALTER TABLE plant_app.botanist_notification ADD CONSTRAINT botanist_notification_check CHECK (
    (type IN ('observation_submitted','observation_approved','observation_rejected','correction_requested') AND observation_id IS NOT NULL)
    OR (type IN ('sync_failed','sync_completed') AND observation_id IS NULL)
    OR (type='record_change_correction' AND observation_id IS NULL AND review_id IS NULL
      AND metadata->>'entityType'='record_change'
      AND length(COALESCE(metadata->>'changeId','')) BETWEEN 1 AND 100
      AND metadata->>'recordKind' IN ('plant','species')
      AND length(COALESCE(metadata->>'targetId','')) BETWEEN 1 AND 100
      AND ((metadata->>'recordKind'='plant' AND plant_id::text=(metadata->>'targetId'))
        OR (metadata->>'recordKind'='species' AND plant_id IS NULL)))
  );
END $$;
COMMIT;
