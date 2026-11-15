-- Preserve each Plant/Species edit review decision and comment by proposal revision.
-- Backfill only the latest review still present on existing proposal rows.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(current_schema() || '.record_change_submission') IS NULL THEN
    RAISE EXCEPTION 'Migration 008 record_change_submission is required before migration 024';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS record_change_review_event (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES record_change_submission(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('Correction Required','Approved','Rejected')),
  reviewer_subject TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (change_id, revision)
);
CREATE INDEX IF NOT EXISTS record_change_review_event_history
  ON record_change_review_event(change_id, revision DESC);
ALTER TABLE record_change_review_event ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prevent_record_change_review_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record change review events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS record_change_review_event_immutable ON record_change_review_event;
CREATE TRIGGER record_change_review_event_immutable
  BEFORE UPDATE OR DELETE ON record_change_review_event
  FOR EACH ROW EXECUTE FUNCTION prevent_record_change_review_event_mutation();

INSERT INTO record_change_review_event(id,change_id,revision,status,reviewer_subject,comment,created_at)
SELECT 'legacy-review:' || c.id || ':' || c.revision, c.id, c.revision, c.status,
       c.reviewed_by, c.review_comment, c.reviewed_at
FROM record_change_submission c
WHERE c.status IN ('Correction Required','Approved','Rejected')
  AND c.reviewed_by IS NOT NULL AND c.reviewed_at IS NOT NULL
ON CONFLICT(change_id,revision) DO NOTHING;
COMMIT;
