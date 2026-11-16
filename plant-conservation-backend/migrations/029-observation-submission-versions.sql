-- Draft only. Apply after reviewed migrations 025-028, an isolated rehearsal,
-- live-schema verification, and a separately verified database backup.
-- This migration is additive: it does not backfill or reinterpret legacy rows.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
  IF to_regclass('plant_app.plant_observation') IS NULL
     OR to_regclass('plant_app.observation_edit_request') IS NULL
     OR to_regclass('plant_app.observation_review') IS NULL
     OR to_regclass('plant_app.observation_version_history') IS NULL
     OR to_regclass('plant_app.plant_asset') IS NULL THEN
    RAISE EXCEPTION 'Observation, edit-request, review, legacy-history, and photo prerequisites are required';
  END IF;
  IF to_regclass('plant_app.observation_submission_version') IS NOT NULL THEN
    RAISE EXCEPTION 'plant_app.observation_submission_version already exists; inspect before rerunning';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='plant_observation' AND column_name='origin_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='observation_edit_request' AND column_name='revision'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='observation_version_history' AND column_name='version_number'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='observation_version_history' AND column_name='photo_ids'
  ) THEN
    RAISE EXCEPTION 'Observation origin, edit revision, and legacy history prerequisites are required';
  END IF;
END $$;

-- Each row is one immutable submission snapshot, or an explicitly labelled
-- legacy baseline captured when an eligible edit starts. For all rows,
-- version_number is a monotonically increasing Observation-local ordinal:
-- allocate MAX(version_number)+1 across this table and the legacy
-- observation_version_history table, while holding the Observation row lock.
-- Never renumber old rows. A legacy baseline consumes one ordinal; the first
-- newly submitted edit consumes the next. UI labels (Original/Edit 1/etc.)
-- must use submission/request lineage, not assume version_number is an edit
-- number. `Approved` denotes the current approved state, constrained to one
-- row per Observation. `photo_refs` contains ordered opaque asset IDs, not
-- public URLs; authenticated API code resolves the assets.
CREATE TABLE observation_submission_version (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES plant_observation(id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  submission_type TEXT NOT NULL CHECK (submission_type IN ('original','pending_edit','edit','correction_resubmission','legacy_baseline')),
  status TEXT NOT NULL CHECK (status IN (
    'Pending Review','Correction Required','Approved','Rejected','Withdrawn','Superseded','Cancelled','Flagged'
  )),
  owner_subject TEXT NOT NULL,
  submitted_by TEXT,
  request_id TEXT REFERENCES observation_edit_request(id),
  request_revision INTEGER CHECK (request_revision IS NULL OR request_revision > 0),
  baseline_for_request_id TEXT REFERENCES observation_edit_request(id),
  correction_review_id TEXT REFERENCES observation_review(id),
  -- Immutable source version. An approved base can remain current while its
  -- derived edit is pending, then become Superseded only when that edit passes.
  based_on_version_id TEXT,
  content JSONB NOT NULL CHECK (jsonb_typeof(content)='object'),
  photo_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(photo_refs)='array'),
  submitted_at TIMESTAMPTZ,
  baseline_captured_at TIMESTAMPTZ,
  baseline_captured_by TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  withdrawn_by TEXT,
  withdrawn_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (observation_id, version_number),
  UNIQUE (observation_id, id),
  UNIQUE (id, observation_id),
  FOREIGN KEY (observation_id, based_on_version_id)
    REFERENCES observation_submission_version(observation_id, id),
  CHECK (
    (submission_type IN ('original','pending_edit') AND request_id IS NULL AND request_revision IS NULL
      AND baseline_for_request_id IS NULL AND correction_review_id IS NULL)
    OR (submission_type='edit' AND request_id IS NOT NULL AND request_revision IS NOT NULL
      AND baseline_for_request_id IS NULL AND correction_review_id IS NULL)
    OR (submission_type='correction_resubmission' AND correction_review_id IS NOT NULL
      AND baseline_for_request_id IS NULL
      AND ((request_id IS NULL AND request_revision IS NULL)
        OR (request_id IS NOT NULL AND request_revision IS NOT NULL)))
    OR (submission_type='legacy_baseline' AND request_id IS NULL AND request_revision IS NULL
      AND baseline_for_request_id IS NOT NULL AND correction_review_id IS NULL)
  ),
  CHECK (
    (submission_type='legacy_baseline' AND status IN ('Approved','Superseded') AND submitted_at IS NULL
      AND baseline_captured_at IS NOT NULL AND baseline_captured_by IS NOT NULL
      AND submitted_by IS NULL AND request_id IS NULL AND request_revision IS NULL
      AND correction_review_id IS NULL AND based_on_version_id IS NULL)
    OR (submission_type<>'legacy_baseline' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL
      AND baseline_captured_at IS NULL AND baseline_captured_by IS NULL)
  ),
  CHECK ((reviewed_by IS NULL)=(reviewed_at IS NULL)),
  CHECK ((withdrawn_by IS NULL)=(withdrawn_at IS NULL)),
  CHECK ((cancelled_by IS NULL)=(cancelled_at IS NULL)),
  CHECK ((status='Withdrawn')=(withdrawn_by IS NOT NULL)),
  CHECK ((status='Cancelled')=(cancelled_by IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS observation_submission_request_revision
  ON observation_submission_version(request_id, request_revision)
  WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS observation_submission_correction_review
  ON observation_submission_version(correction_review_id)
  WHERE correction_review_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS observation_submission_single_baseline_per_request
  ON observation_submission_version(baseline_for_request_id)
  WHERE baseline_for_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS observation_submission_single_current_approved
  ON observation_submission_version(observation_id)
  WHERE status='Approved';
CREATE INDEX IF NOT EXISTS observation_submission_owner_history
  ON observation_submission_version(owner_subject, observation_id, version_number DESC);
CREATE INDEX IF NOT EXISTS observation_submission_review_queue
  ON observation_submission_version(status, submitted_at, id)
  WHERE status='Pending Review';

-- Fail closed for standalone history when origin is unknown or belongs to the
-- Plant's initial-registration workflow. Legacy rows are not backfilled.
CREATE OR REPLACE FUNCTION plant_app.guard_observation_submission_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = plant_app, pg_catalog
AS $$
DECLARE
  observation_owner TEXT;
  observation_origin TEXT;
  observation_status TEXT;
  observation_content JSONB;
  observation_plant_id BIGINT;
  request_observation_id TEXT;
  request_owner TEXT;
  request_current_revision INTEGER;
  request_current_status TEXT;
  baseline_request_observation_id TEXT;
  baseline_request_owner TEXT;
  baseline_request_status TEXT;
  baseline_request_revision INTEGER;
  baseline_request_base_revision INTEGER;
  baseline_request_snapshot JSONB;
  correction_review_observation_id TEXT;
  correction_review_decision TEXT;
  next_version_number INTEGER;
  expected_photo_refs JSONB;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Observation submission versions are retained for audit'
      USING ERRCODE='55000';
  END IF;

  IF TG_OP='INSERT' THEN
    SELECT owner_subject, origin_type, status, content, plant_id
      INTO observation_owner, observation_origin, observation_status, observation_content, observation_plant_id
      FROM plant_observation WHERE id=NEW.observation_id FOR UPDATE;
    IF NOT FOUND OR observation_origin IS DISTINCT FROM 'subsequent_observation' THEN
      RAISE EXCEPTION 'Standalone version history requires a known subsequent Observation origin'
        USING ERRCODE='23514';
    END IF;
    IF observation_owner IS DISTINCT FROM NEW.owner_subject THEN
      RAISE EXCEPTION 'Observation version owner does not match its Observation'
        USING ERRCODE='23514';
    END IF;
    SELECT GREATEST(
      COALESCE((SELECT MAX(version_number) FROM observation_version_history WHERE observation_id=NEW.observation_id),0),
      COALESCE((SELECT MAX(version_number) FROM observation_submission_version WHERE observation_id=NEW.observation_id),0)
    ) + 1 INTO next_version_number;
    IF NEW.version_number IS DISTINCT FROM next_version_number THEN
      RAISE EXCEPTION 'Observation version number must be the next unused ordinal (%)', next_version_number
        USING ERRCODE='23514';
    END IF;

    IF NEW.submission_type='legacy_baseline' THEN
      IF observation_status IS DISTINCT FROM 'Approved'
         OR NEW.status IS DISTINCT FROM 'Approved'
         OR NEW.submitted_at IS NOT NULL
         OR NEW.baseline_captured_at IS NULL
         OR NEW.content IS DISTINCT FROM observation_content
         OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.review_comment IS NOT NULL
         OR NEW.submitted_by IS NOT NULL
         OR NEW.baseline_captured_by IS DISTINCT FROM NEW.owner_subject THEN
        RAISE EXCEPTION 'Legacy baseline must exactly capture the owner-held current Approved subsequent Observation'
          USING ERRCODE='23514';
      END IF;
      SELECT observation_id, owner_subject, status, revision, base_revision, base_snapshot
        INTO baseline_request_observation_id, baseline_request_owner, baseline_request_status,
          baseline_request_revision, baseline_request_base_revision, baseline_request_snapshot
        FROM observation_edit_request WHERE id=NEW.baseline_for_request_id FOR UPDATE;
      IF NOT FOUND
         OR baseline_request_observation_id IS DISTINCT FROM NEW.observation_id
         OR baseline_request_owner IS DISTINCT FROM NEW.owner_subject
         OR baseline_request_status IS DISTINCT FROM 'Pending Review'
         OR baseline_request_revision IS DISTINCT FROM 1
         OR baseline_request_base_revision IS DISTINCT FROM (SELECT revision FROM plant_observation WHERE id=NEW.observation_id)
         OR baseline_request_snapshot->'content' IS DISTINCT FROM observation_content THEN
        RAISE EXCEPTION 'Legacy baseline must be captured for a newly opened, owner-scoped edit of the current approved Observation'
          USING ERRCODE='23514';
      END IF;
      SELECT COALESCE(jsonb_agg(id ORDER BY created_at,id),'[]'::jsonb) INTO expected_photo_refs
        FROM plant_asset
        WHERE observation_id=NEW.observation_id AND approved=TRUE
          AND content_type IN ('image/jpeg','image/png');
      IF NEW.photo_refs IS DISTINCT FROM expected_photo_refs THEN
        RAISE EXCEPTION 'Legacy baseline photo references do not match the current approved Observation photos'
          USING ERRCODE='23514';
      END IF;
      IF baseline_request_snapshot->'photo_ids' IS DISTINCT FROM expected_photo_refs THEN
        RAISE EXCEPTION 'Legacy baseline request does not reference the exact current approved photos'
          USING ERRCODE='23514';
      END IF;
    ELSIF NEW.submitted_at IS NULL OR NEW.baseline_captured_at IS NOT NULL THEN
      RAISE EXCEPTION 'Submitted Observation versions require submitted_at and cannot have a baseline capture time'
        USING ERRCODE='23514';
    END IF;
    IF NEW.submission_type='original' AND NEW.status<>'Pending Review' THEN
      RAISE EXCEPTION 'An original submitted Observation version must start Pending Review'
        USING ERRCODE='23514';
    END IF;
    IF NEW.submission_type IN ('edit','correction_resubmission') AND NEW.request_id IS NOT NULL THEN
      SELECT observation_id, owner_subject, revision, status
        INTO request_observation_id, request_owner, request_current_revision, request_current_status
        FROM observation_edit_request WHERE id=NEW.request_id;
      IF NOT FOUND OR request_observation_id IS DISTINCT FROM NEW.observation_id
         OR request_owner IS DISTINCT FROM NEW.owner_subject
         OR request_current_revision IS DISTINCT FROM NEW.request_revision
         OR request_current_status IS DISTINCT FROM 'Pending Review' THEN
        RAISE EXCEPTION 'Observation version request linkage is inconsistent'
          USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.submission_type='correction_resubmission' THEN
      SELECT observation_id, decision INTO correction_review_observation_id, correction_review_decision
        FROM observation_review WHERE id=NEW.correction_review_id;
      IF NOT FOUND OR correction_review_observation_id IS DISTINCT FROM NEW.observation_id
         OR correction_review_decision IS DISTINCT FROM 'Correction Required' THEN
        RAISE EXCEPTION 'Correction resubmission must reference a Correction Required review for this Observation'
          USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.submission_type<>'legacy_baseline' AND NEW.status<>'Pending Review' THEN
      RAISE EXCEPTION 'A newly submitted Observation version must start Pending Review'
        USING ERRCODE='23514';
    END IF;
    IF NEW.based_on_version_id=NEW.id THEN
      RAISE EXCEPTION 'An Observation version cannot be based on itself' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  -- The submitted identity, lineage, content and photo set are immutable.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.submission_type IS DISTINCT FROM OLD.submission_type
     OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.request_revision IS DISTINCT FROM OLD.request_revision
     OR NEW.baseline_for_request_id IS DISTINCT FROM OLD.baseline_for_request_id
     OR NEW.correction_review_id IS DISTINCT FROM OLD.correction_review_id
     OR NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.photo_refs IS DISTINCT FROM OLD.photo_refs
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.baseline_captured_at IS DISTINCT FROM OLD.baseline_captured_at
     OR NEW.baseline_captured_by IS DISTINCT FROM OLD.baseline_captured_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Observation submission snapshot and lineage are immutable'
      USING ERRCODE='55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status='Pending Review' AND NEW.status IN ('Correction Required','Approved','Rejected','Withdrawn','Superseded','Cancelled','Flagged'))
      OR (OLD.status='Correction Required' AND NEW.status IN ('Withdrawn','Superseded','Cancelled'))
      OR (OLD.status='Approved' AND NEW.status='Superseded')
      OR (OLD.status='Flagged' AND NEW.status IN ('Correction Required','Approved','Rejected','Superseded'))
    ) THEN
      RAISE EXCEPTION 'Invalid Observation version status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE='23514';
    END IF;
    IF OLD.submission_type='correction_resubmission' AND OLD.status='Pending Review'
       AND NEW.status IN ('Withdrawn','Cancelled') THEN
      RAISE EXCEPTION 'A correction resubmission awaiting review cannot be withdrawn or cancelled'
        USING ERRCODE='23514';
    END IF;
    IF NEW.status IN ('Correction Required','Approved','Rejected','Flagged')
       AND (NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL) THEN
      RAISE EXCEPTION 'Officer decision status requires reviewer and review timestamp'
        USING ERRCODE='23514';
    END IF;
    IF NEW.status='Withdrawn' AND NEW.withdrawn_by IS DISTINCT FROM OLD.owner_subject THEN
      RAISE EXCEPTION 'Observation withdrawal must be recorded by its owner'
        USING ERRCODE='23514';
    END IF;
    IF NEW.status='Cancelled' AND NEW.cancelled_by IS DISTINCT FROM OLD.owner_subject THEN
      RAISE EXCEPTION 'Observation cancellation must be recorded by its owner'
        USING ERRCODE='23514';
    END IF;
    IF NEW.status NOT IN ('Correction Required','Approved','Rejected','Flagged')
       AND (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
         OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
         OR NEW.review_comment IS DISTINCT FROM OLD.review_comment) THEN
      RAISE EXCEPTION 'Review metadata can only change with an Officer decision'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.review_comment IS DISTINCT FROM OLD.review_comment THEN
    RAISE EXCEPTION 'Review metadata can only change with a status decision'
      USING ERRCODE='55000';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND (NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by
       OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at) THEN
    RAISE EXCEPTION 'Observation withdrawal and cancellation audit fields are immutable'
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS observation_submission_version_guard ON observation_submission_version;
CREATE TRIGGER observation_submission_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON observation_submission_version
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_submission_version();

ALTER TABLE observation_submission_version ENABLE ROW LEVEL SECURITY;
COMMIT;
