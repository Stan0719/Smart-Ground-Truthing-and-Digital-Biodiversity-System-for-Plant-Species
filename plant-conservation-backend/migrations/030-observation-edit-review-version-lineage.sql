-- Review and rehearse in isolation before deployment. Existing review events
-- remain unlinked; only an immutable migration-seeded set of active legacy
-- records may continue through revision-bound, versionless review.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' OR
     to_regclass('plant_app.observation_submission_version') IS NULL OR
     to_regclass('plant_app.observation_edit_event') IS NULL OR
     to_regclass('plant_app.observation_edit_request') IS NULL OR
     to_regclass('plant_app.record_version_history') IS NULL OR
     to_regclass('plant_app.plant_asset') IS NULL OR
     to_regclass('plant_app.plant_submission_receipt') IS NULL OR
     to_regclass('plant_app.business_audit') IS NULL THEN
    RAISE EXCEPTION 'Migration 006 receipts/audit, Migration 029 versions, Plant history/assets, and Observation edit tables are required in plant_app';
  END IF;
END $$;

ALTER TABLE observation_edit_event ADD COLUMN request_revision INTEGER;
ALTER TABLE observation_edit_event ADD COLUMN submission_version_id TEXT;
ALTER TABLE observation_review ADD COLUMN submission_version_id TEXT;
-- Legacy review evidence is revision-bound, but deliberately remains
-- versionless.  This does not manufacture a historical submission snapshot.
ALTER TABLE observation_review ADD COLUMN legacy_revision INTEGER;
ALTER TABLE observation_review ADD CONSTRAINT observation_review_legacy_revision_positive
  CHECK (legacy_revision IS NULL OR legacy_revision > 0);
ALTER TABLE observation_review ADD CONSTRAINT observation_review_version_or_legacy_revision
  CHECK (submission_version_id IS NULL OR legacy_revision IS NULL);
ALTER TABLE observation_review ADD CONSTRAINT observation_review_exact_version
  FOREIGN KEY (observation_id, submission_version_id)
  REFERENCES observation_submission_version(observation_id, id);
CREATE UNIQUE INDEX observation_review_one_final_decision_per_version
  ON observation_review(submission_version_id)
  WHERE submission_version_id IS NOT NULL
    AND decision IN ('Approved','Rejected','Correction Required');
ALTER TABLE observation_edit_event ADD CONSTRAINT observation_edit_event_revision_positive
  CHECK (request_revision IS NULL OR request_revision > 0);
ALTER TABLE observation_edit_event ADD CONSTRAINT observation_edit_event_link_pair
  CHECK ((request_revision IS NULL) = (submission_version_id IS NULL));
ALTER TABLE observation_edit_event DROP CONSTRAINT observation_edit_event_event_type_check;
ALTER TABLE observation_edit_event ADD CONSTRAINT observation_edit_event_event_type_check
  CHECK(event_type IN ('submitted','correction_required','resubmitted','approved','rejected','cancelled','flagged'));

-- A redundant composite key makes every dimension of the event's reference
-- enforceable by one FK. The existing version ID PK remains authoritative.
ALTER TABLE observation_submission_version
  ADD CONSTRAINT observation_submission_event_target
  UNIQUE (id, observation_id, request_id, request_revision);
ALTER TABLE observation_edit_event
  ADD CONSTRAINT observation_edit_event_exact_version
  FOREIGN KEY (submission_version_id, observation_id, request_id, request_revision)
  REFERENCES observation_submission_version(id, observation_id, request_id, request_revision);
CREATE UNIQUE INDEX observation_edit_event_one_decision_per_version
  ON observation_edit_event(submission_version_id)
  WHERE submission_version_id IS NOT NULL
    AND event_type IN ('approved','rejected','correction_required');
CREATE UNIQUE INDEX observation_edit_event_one_flag_per_version
  ON observation_edit_event(submission_version_id)
  WHERE submission_version_id IS NOT NULL AND event_type='flagged';

-- Version JSON retains order for existing API consumers. This relation makes
-- every NEW snapshot's photo IDs durable without reinterpreting legacy rows.
-- The database can prove asset ownership and exact stored IDs, but the current
-- edit request stores new photos as JSON bytes, not staged asset IDs. The
-- integrating route must stage bytes before insertion and compare the exact
-- retained-plus-staged selection with photo_refs in the same transaction.
CREATE TABLE observation_submission_photo (
  version_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  asset_id TEXT NOT NULL REFERENCES plant_asset(id) ON DELETE RESTRICT,
  plant_id BIGINT NOT NULL,
  owner_subject TEXT NOT NULL,
  PRIMARY KEY (version_id, position),
  UNIQUE (version_id, asset_id),
  FOREIGN KEY (observation_id, version_id)
    REFERENCES observation_submission_version(observation_id, id) ON DELETE RESTRICT
);
CREATE INDEX observation_submission_photo_asset ON observation_submission_photo(asset_id);
ALTER TABLE observation_submission_photo ENABLE ROW LEVEL SECURITY;

-- One-time compatibility set for active records that predate Migration 030.
-- Entries are seeded only from exact persisted creation audit evidence and
-- capture the state as seen during migration.  Membership means legacy-only;
-- it never classifies the Observation as subsequent or creates a version.
CREATE TABLE observation_legacy_review_eligibility (
  observation_id TEXT PRIMARY KEY REFERENCES plant_observation(id) ON DELETE RESTRICT,
  plant_id BIGINT NOT NULL,
  owner_subject TEXT NOT NULL,
  captured_revision INTEGER NOT NULL CHECK (captured_revision > 0),
  captured_status TEXT NOT NULL CHECK (captured_status IN ('Pending Review','Correction Required')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (plant_id) REFERENCES plant_record(plant_id) ON DELETE RESTRICT
);
ALTER TABLE observation_legacy_review_eligibility ENABLE ROW LEVEL SECURITY;
INSERT INTO observation_legacy_review_eligibility
  (observation_id,plant_id,owner_subject,captured_revision,captured_status)
SELECT o.id,o.plant_id,o.owner_subject,o.revision,o.status
FROM plant_observation o
WHERE o.status IN ('Pending Review','Correction Required')
  AND o.origin_type IN ('subsequent_observation','unknown')
  AND NOT EXISTS (SELECT 1 FROM observation_submission_version v WHERE v.observation_id=o.id)
  AND NOT EXISTS (SELECT 1 FROM plant_submission_receipt r WHERE r.result->>'id'=o.id)
  AND (SELECT count(*) FROM business_audit a
       WHERE a.action='observation_submitted' AND a.target=o.id
         AND a.actor_subject=o.owner_subject AND a.created_at=o.created_at)=1
  AND (o.status <> 'Correction Required' OR EXISTS (
       SELECT 1 FROM observation_review r WHERE r.observation_id=o.id
         AND r.decision='Correction Required' AND r.reviewer_subject<>o.owner_subject
         AND NULLIF(btrim(r.comment),'') IS NOT NULL
         AND r.id=(SELECT latest.id FROM observation_review latest
           WHERE latest.observation_id=o.id ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)));
-- The set is immutable after migration.  In particular, API writes cannot
-- enroll a new Observation or broaden the grandfathered population.
CREATE OR REPLACE FUNCTION plant_app.guard_observation_legacy_review_registry()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$ BEGIN
  RAISE EXCEPTION 'Legacy Observation review eligibility is migration-seeded and immutable'
    USING ERRCODE='55000';
END $$;
CREATE TRIGGER observation_legacy_review_registry_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON observation_legacy_review_eligibility
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_legacy_review_registry();
REVOKE ALL ON observation_legacy_review_eligibility FROM PUBLIC;

-- The capture trigger below uses this same INSERT path. Validate direct writes
-- against the immutable ordered snapshot as well as the current asset owner.
CREATE OR REPLACE FUNCTION plant_app.guard_observation_submission_photo_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE submitted observation_submission_version%ROWTYPE;
        parent_plant_id BIGINT;
        parent_owner TEXT;
        asset plant_asset%ROWTYPE;
BEGIN
  SELECT * INTO submitted FROM observation_submission_version
    WHERE id=NEW.version_id AND observation_id=NEW.observation_id;
  IF submitted.id IS NULL OR NEW.position < 0
     OR jsonb_typeof(submitted.photo_refs -> NEW.position) IS DISTINCT FROM 'string'
     OR submitted.photo_refs ->> NEW.position IS DISTINCT FROM NEW.asset_id THEN
    RAISE EXCEPTION 'Historical Observation photo link does not match its version snapshot'
      USING ERRCODE='23514';
  END IF;
  SELECT plant_id, owner_subject INTO parent_plant_id, parent_owner
    FROM plant_observation WHERE id=NEW.observation_id FOR UPDATE;
  SELECT * INTO asset FROM plant_asset WHERE id=NEW.asset_id FOR UPDATE;
  IF parent_plant_id IS NULL OR parent_owner IS DISTINCT FROM submitted.owner_subject
     OR NEW.plant_id IS DISTINCT FROM parent_plant_id
     OR NEW.owner_subject IS DISTINCT FROM submitted.owner_subject
     OR asset.id IS NULL OR asset.plant_id IS DISTINCT FROM parent_plant_id
     OR asset.observation_id IS DISTINCT FROM NEW.observation_id
     OR asset.owner_subject IS DISTINCT FROM submitted.owner_subject
     OR asset.content_type NOT IN ('image/jpeg','image/png') THEN
    RAISE EXCEPTION 'Historical Observation photo asset does not belong to its version'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_submission_photo_insert_guard
  BEFORE INSERT ON observation_submission_photo
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_submission_photo_insert();

CREATE OR REPLACE FUNCTION plant_app.capture_observation_submission_photos()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE item JSONB; asset plant_asset%ROWTYPE; ordinal INTEGER := 0;
        expected_plant BIGINT;
BEGIN
  SELECT plant_id INTO expected_plant FROM plant_observation WHERE id=NEW.observation_id;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.photo_refs) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Observation snapshot photo IDs must be strings' USING ERRCODE='23514';
    END IF;
    SELECT * INTO asset FROM plant_asset WHERE id=item #>> '{}' FOR UPDATE;
    IF asset.id IS NULL OR asset.observation_id IS DISTINCT FROM NEW.observation_id
       OR asset.plant_id IS DISTINCT FROM expected_plant
       OR asset.owner_subject IS DISTINCT FROM NEW.owner_subject
       OR asset.content_type NOT IN ('image/jpeg','image/png') THEN
      RAISE EXCEPTION 'Observation snapshot photo does not belong to its submitted record'
        USING ERRCODE='23514';
    END IF;
    INSERT INTO observation_submission_photo(version_id,observation_id,position,asset_id,plant_id,owner_subject)
      VALUES(NEW.id,NEW.observation_id,ordinal,asset.id,expected_plant,NEW.owner_subject);
    ordinal := ordinal + 1;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_submission_photo_capture
  AFTER INSERT ON observation_submission_version
  FOR EACH ROW EXECUTE FUNCTION plant_app.capture_observation_submission_photos();

CREATE OR REPLACE FUNCTION plant_app.guard_observation_original_review_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE parent plant_observation%ROWTYPE;
        submitted observation_submission_version%ROWTYPE;
        legacy observation_legacy_review_eligibility%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Observation review history is retained' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Observation review evidence is immutable' USING ERRCODE='55000';
  END IF;
  SELECT * INTO parent FROM plant_observation WHERE id=NEW.observation_id FOR UPDATE;
  IF parent.id IS NULL THEN
    RAISE EXCEPTION 'Observation review parent is missing' USING ERRCODE='23514';
  END IF;
  IF parent.origin_type='subsequent_observation' AND NEW.submission_version_id IS NOT NULL THEN
    SELECT * INTO submitted FROM observation_submission_version
      WHERE id=NEW.submission_version_id AND observation_id=NEW.observation_id FOR UPDATE;
    IF submitted.id IS NULL OR submitted.status NOT IN ('Pending Review','Flagged')
       OR submitted.request_id IS NOT NULL OR submitted.owner_subject IS DISTINCT FROM parent.owner_subject
       OR submitted.id IS DISTINCT FROM (SELECT id FROM observation_submission_version
         WHERE observation_id=NEW.observation_id ORDER BY version_number DESC LIMIT 1)
       OR NEW.reviewer_subject IS NOT DISTINCT FROM parent.owner_subject
       OR NEW.decision NOT IN ('Approved','Rejected','Correction Required','Flagged') THEN
      RAISE EXCEPTION 'Original Observation review targets a stale or unrelated version'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.submission_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Plant-linked or legacy Observation reviews cannot claim standalone version evidence'
      USING ERRCODE='23514';
  ELSIF parent.origin_type='initial_registration' THEN
    IF NEW.legacy_revision IS NOT NULL OR parent.status IS DISTINCT FROM 'Pending Review'
       OR NEW.reviewer_subject IS NOT DISTINCT FROM parent.owner_subject
       OR NEW.decision NOT IN ('Approved','Rejected','Correction Required','Flagged')
       OR (NEW.decision<>'Approved' AND NULLIF(btrim(NEW.comment),'') IS NULL)
       OR NOT EXISTS (
      SELECT 1 FROM plant_submission_receipt r
      WHERE r.owner_subject=parent.owner_subject AND r.client_key=parent.client_key
        AND r.result->>'id'=parent.id AND r.result->>'plant_id'=parent.plant_id::text
        AND r.result->>'status'='Pending Review' AND r.payload_hash ~ '^[a-f0-9]{64}$'
    ) THEN
      RAISE EXCEPTION 'Initial-registration Observation review requires its persisted Plant receipt'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.legacy_revision IS NOT NULL THEN
    SELECT * INTO legacy FROM observation_legacy_review_eligibility
      WHERE observation_id=parent.id;
    IF legacy.observation_id IS NULL OR legacy.plant_id IS DISTINCT FROM parent.plant_id
       OR legacy.owner_subject IS DISTINCT FROM parent.owner_subject
       OR parent.origin_type NOT IN ('subsequent_observation','unknown')
       OR parent.status IS DISTINCT FROM 'Pending Review'
       OR parent.revision IS DISTINCT FROM NEW.legacy_revision
       OR parent.revision < legacy.captured_revision
       OR EXISTS (SELECT 1 FROM observation_submission_version v WHERE v.observation_id=parent.id)
       OR EXISTS (SELECT 1 FROM plant_submission_receipt r WHERE r.result->>'id'=parent.id)
       OR NEW.reviewer_subject IS NOT DISTINCT FROM parent.owner_subject
       OR NEW.decision NOT IN ('Approved','Rejected','Correction Required','Flagged')
       OR (NEW.decision<>'Approved' AND NULLIF(btrim(NEW.comment),'') IS NULL) THEN
      RAISE EXCEPTION 'Legacy Observation review does not match its migration-captured current revision'
        USING ERRCODE='23514';
    END IF;
    IF legacy.captured_status='Correction Required' AND legacy.captured_revision=parent.revision
       AND NOT EXISTS (SELECT 1 FROM observation_review prior WHERE prior.observation_id=parent.id
         AND prior.decision='Correction Required' AND prior.reviewer_subject<>parent.owner_subject
         AND NULLIF(btrim(prior.comment),'') IS NOT NULL) THEN
      RAISE EXCEPTION 'Legacy correction review evidence is missing'
        USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Observation review requires verified initial, versioned, or migration-captured legacy evidence'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_review_version_lineage_guard
  BEFORE INSERT OR UPDATE OR DELETE ON observation_review
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_original_review_lineage();

CREATE OR REPLACE FUNCTION plant_app.guard_observation_submission_photo()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Historical Observation photo references are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER observation_submission_photo_immutable
  BEFORE UPDATE OR DELETE ON observation_submission_photo
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_submission_photo();

-- Parent Plant versions are also used to review edits to verified
-- initial-registration Observations. The default FALSE keeps existing and
-- legacy version rows readable without inventing photo links. New callers set
-- this marker only when inserting a snapshot whose photo_refs are all ordered
-- {"asset_id": "..."} objects and insert the matching rows below in the same
-- transaction.
ALTER TABLE record_version_history
  ADD COLUMN IF NOT EXISTS photo_refs_sealed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE plant_record_version_photo (
  version_id TEXT NOT NULL REFERENCES record_version_history(id) ON DELETE RESTRICT,
  plant_id INTEGER NOT NULL REFERENCES plant_record(plant_id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL REFERENCES plant_observation(id) ON DELETE RESTRICT,
  owner_subject TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  asset_id TEXT NOT NULL REFERENCES plant_asset(id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id, position),
  UNIQUE (version_id, asset_id)
);
CREATE INDEX plant_record_version_photo_asset ON plant_record_version_photo(asset_id);
CREATE INDEX plant_record_version_photo_observation ON plant_record_version_photo(observation_id, version_id);
ALTER TABLE plant_record_version_photo ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION plant_app.guard_record_version_photo_marker()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$ BEGIN
  IF NEW.photo_refs_sealed IS DISTINCT FROM OLD.photo_refs_sealed THEN
    RAISE EXCEPTION 'Plant version photo capture mode is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_version_photo_marker_immutable
  BEFORE UPDATE ON record_version_history
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_record_version_photo_marker();

CREATE OR REPLACE FUNCTION plant_app.guard_plant_record_version_photo_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE version_row record_version_history%ROWTYPE;
        observation_row plant_observation%ROWTYPE;
        asset plant_asset%ROWTYPE;
        snapshot_photo JSONB;
BEGIN
  SELECT * INTO version_row FROM record_version_history WHERE id=NEW.version_id FOR UPDATE;
  IF version_row.id IS NULL OR version_row.record_type IS DISTINCT FROM 'plant'
     OR version_row.photo_refs_sealed IS DISTINCT FROM TRUE
     OR version_row.plant_id IS DISTINCT FROM NEW.plant_id
     OR version_row.owner_subject IS DISTINCT FROM NEW.owner_subject THEN
    RAISE EXCEPTION 'Historical Plant photo link does not match a sealed Plant version'
      USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(version_row.snapshot->'photo_refs') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Sealed Plant version must contain an ordered photo_refs array'
      USING ERRCODE='23514';
  END IF;
  snapshot_photo := version_row.snapshot->'photo_refs'->NEW.position;
  IF jsonb_typeof(snapshot_photo) IS DISTINCT FROM 'object'
     OR snapshot_photo->>'asset_id' IS DISTINCT FROM NEW.asset_id
     OR snapshot_photo ? 'change_id' OR snapshot_photo ? 'change_photo_index' THEN
    RAISE EXCEPTION 'Historical Plant photo link does not match its immutable version position'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO observation_row FROM plant_observation
    WHERE id=NEW.observation_id AND plant_id=NEW.plant_id;
  IF observation_row.id IS NULL OR version_row.snapshot->>'observation_id' IS DISTINCT FROM NEW.observation_id THEN
    RAISE EXCEPTION 'Historical Plant photo link targets a different Observation'
      USING ERRCODE='23514';
  END IF;
  SELECT * INTO asset FROM plant_asset WHERE id=NEW.asset_id FOR UPDATE;
  IF asset.id IS NULL OR asset.plant_id IS DISTINCT FROM NEW.plant_id
     OR asset.owner_subject IS DISTINCT FROM NEW.owner_subject
     OR asset.content_type NOT IN ('image/jpeg','image/png')
     OR (asset.observation_id IS NOT NULL AND asset.observation_id IS DISTINCT FROM NEW.observation_id)
     OR (asset.approved AND asset.observation_id IS DISTINCT FROM NEW.observation_id) THEN
    RAISE EXCEPTION 'Historical Plant photo asset does not belong to this Plant, Observation, and owner'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plant_record_version_photo_insert_guard
  BEFORE INSERT ON plant_record_version_photo
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_plant_record_version_photo_insert();

CREATE OR REPLACE FUNCTION plant_app.guard_plant_record_version_photo_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Historical Plant photo references are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER plant_record_version_photo_immutable
  BEFORE UPDATE OR DELETE ON plant_record_version_photo
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_plant_record_version_photo_mutation();

-- Deferred validation allows a caller to insert a sealed history row followed
-- by its ordered photo links in one transaction. Legacy rows have the default
-- FALSE and are deliberately not backfilled or validated.
CREATE OR REPLACE FUNCTION plant_app.validate_sealed_plant_version_photos()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE version_row record_version_history%ROWTYPE;
        linked_refs JSONB;
BEGIN
  SELECT * INTO version_row FROM record_version_history WHERE id=NEW.id;
  IF version_row.photo_refs_sealed IS DISTINCT FROM TRUE THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('asset_id', asset_id) ORDER BY position), '[]'::jsonb)
    INTO linked_refs FROM plant_record_version_photo WHERE version_id=version_row.id;
  IF jsonb_typeof(version_row.snapshot->'photo_refs') IS DISTINCT FROM 'array'
     OR version_row.snapshot->'photo_refs' IS DISTINCT FROM linked_refs THEN
    RAISE EXCEPTION 'Sealed Plant version photo references must exactly match its ordered asset links'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER plant_record_version_photo_set_complete
  AFTER INSERT ON record_version_history
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION plant_app.validate_sealed_plant_version_photos();

CREATE OR REPLACE FUNCTION plant_app.guard_versioned_observation_asset()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE has_observation_history BOOLEAN;
        has_plant_history BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM observation_submission_photo WHERE asset_id=OLD.id)
    INTO has_observation_history;
  SELECT EXISTS(SELECT 1 FROM plant_record_version_photo WHERE asset_id=OLD.id)
    INTO has_plant_history;
  IF has_observation_history OR has_plant_history THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'Historical version photo bytes must be retained' USING ERRCODE='55000';
    END IF;
    IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.plant_id IS DISTINCT FROM OLD.plant_id OR NEW.owner_subject IS DISTINCT FROM OLD.owner_subject
       OR NEW.species_id IS DISTINCT FROM OLD.species_id THEN
      RAISE EXCEPTION 'Historical photo bytes and ownership are immutable'
        USING ERRCODE='55000';
    END IF;
    IF has_observation_history AND NEW.observation_id IS DISTINCT FROM OLD.observation_id
       AND NEW.observation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Historical Observation photo cannot be reassigned' USING ERRCODE='55000';
    END IF;
    IF has_plant_history AND NEW.observation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM plant_record_version_photo WHERE asset_id=OLD.id AND observation_id=NEW.observation_id
    ) THEN
      RAISE EXCEPTION 'Historical Plant photo cannot be reassigned to another Observation' USING ERRCODE='55000';
    END IF;
    IF has_plant_history AND NEW.approved AND NOT EXISTS (
      SELECT 1 FROM plant_record_version_photo WHERE asset_id=OLD.id AND observation_id=NEW.observation_id
    ) THEN
      RAISE EXCEPTION 'A staged historical Plant photo can be approved only for its recorded Observation'
        USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER versioned_observation_asset_retention
  BEFORE UPDATE OR DELETE ON plant_asset
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_versioned_observation_asset();

ALTER TABLE observation_submission_version ADD COLUMN correction_edit_event_id TEXT
  REFERENCES observation_edit_event(id);
CREATE UNIQUE INDEX observation_submission_correction_edit_event
  ON observation_submission_version(correction_edit_event_id)
  WHERE correction_edit_event_id IS NOT NULL;

-- Migration 029 used an unnamed CHECK. Locate it by its exact known
-- structural clauses; abort if live DDL differs or more than one matches.
DO $$ DECLARE target_name TEXT; matches INTEGER; BEGIN
  SELECT COUNT(*), MIN(conname) INTO matches, target_name FROM pg_constraint
  WHERE conrelid='plant_app.observation_submission_version'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%submission_type%'
    AND pg_get_constraintdef(oid) LIKE '%correction_review_id%'
    AND pg_get_constraintdef(oid) LIKE '%baseline_for_request_id%'
    AND pg_get_constraintdef(oid) LIKE '%request_revision%';
  IF matches <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one migration 029 submission-type CHECK, found %', matches;
  END IF;
  EXECUTE format('ALTER TABLE plant_app.observation_submission_version DROP CONSTRAINT %I', target_name);
END $$;
ALTER TABLE observation_submission_version
  ADD CONSTRAINT observation_submission_correction_evidence_type CHECK (
    (submission_type IN ('original','pending_edit') AND request_id IS NULL AND request_revision IS NULL
      AND baseline_for_request_id IS NULL AND correction_review_id IS NULL AND correction_edit_event_id IS NULL)
    OR (submission_type='edit' AND request_id IS NOT NULL AND request_revision IS NOT NULL
      AND baseline_for_request_id IS NULL AND correction_review_id IS NULL AND correction_edit_event_id IS NULL)
    OR (submission_type='correction_resubmission' AND baseline_for_request_id IS NULL
      AND ((request_id IS NULL AND request_revision IS NULL AND correction_review_id IS NOT NULL
            AND correction_edit_event_id IS NULL)
        OR (request_id IS NOT NULL AND request_revision IS NOT NULL AND correction_review_id IS NULL
            AND correction_edit_event_id IS NOT NULL)))
    OR (submission_type='legacy_baseline' AND request_id IS NULL AND request_revision IS NULL
      AND baseline_for_request_id IS NOT NULL AND correction_review_id IS NULL
      AND correction_edit_event_id IS NULL)
  );

CREATE OR REPLACE FUNCTION plant_app.guard_observation_edit_event_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE request_row observation_edit_request%ROWTYPE;
        version_row observation_submission_version%ROWTYPE;
        parent_row plant_observation%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Observation edit events are retained for audit' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
      RAISE EXCEPTION 'Observation edit event evidence is immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_type IN ('approved','rejected','correction_required','flagged') THEN
    IF NEW.request_revision IS NULL OR NEW.submission_version_id IS NULL THEN
      RAISE EXCEPTION 'Officer edit decisions require exact version and revision evidence' USING ERRCODE='23514';
    END IF;
    -- One lock order: Observation, then request, then version.
    SELECT * INTO parent_row FROM plant_observation WHERE id=NEW.observation_id FOR UPDATE;
    SELECT * INTO request_row FROM observation_edit_request WHERE id=NEW.request_id FOR UPDATE;
    SELECT * INTO version_row FROM observation_submission_version
      WHERE id=NEW.submission_version_id AND observation_id=NEW.observation_id FOR UPDATE;
    IF parent_row.id IS NULL OR request_row.id IS NULL OR version_row.id IS NULL
       OR request_row.observation_id IS DISTINCT FROM NEW.observation_id
       OR request_row.status IS DISTINCT FROM 'Pending Review'
       OR request_row.revision IS DISTINCT FROM NEW.request_revision
       OR version_row.status NOT IN ('Pending Review','Flagged')
       OR version_row.request_id IS DISTINCT FROM NEW.request_id
       OR version_row.request_revision IS DISTINCT FROM NEW.request_revision
       OR version_row.owner_subject IS DISTINCT FROM request_row.owner_subject
       OR NEW.actor_subject IS NOT DISTINCT FROM request_row.owner_subject THEN
      RAISE EXCEPTION 'Officer decision targets a stale or unrelated edit version' USING ERRCODE='23514';
    END IF;
    IF NEW.event_type <> 'approved' AND (NEW.comment IS NULL OR btrim(NEW.comment)='') THEN
      RAISE EXCEPTION 'Officer feedback is required for this decision' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.request_revision IS NOT NULL OR NEW.submission_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only Officer decisions may carry review-version evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_edit_event_lineage_guard
  BEFORE INSERT OR UPDATE OR DELETE ON observation_edit_event
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_edit_event_lineage();

CREATE OR REPLACE FUNCTION plant_app.guard_observation_correction_edit_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE source_row observation_submission_version%ROWTYPE;
        evidence observation_edit_event%ROWTYPE;
        original_evidence observation_review%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.correction_edit_event_id IS DISTINCT FROM OLD.correction_edit_event_id THEN
      RAISE EXCEPTION 'Correction edit evidence is immutable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.submission_type='correction_resubmission' AND NEW.request_id IS NOT NULL THEN
    SELECT * INTO source_row FROM observation_submission_version
      WHERE id=NEW.based_on_version_id AND observation_id=NEW.observation_id;
    SELECT * INTO evidence FROM observation_edit_event WHERE id=NEW.correction_edit_event_id;
    IF source_row.id IS NULL OR evidence.id IS NULL
       OR source_row.status IS DISTINCT FROM 'Superseded'
       OR source_row.request_id IS DISTINCT FROM NEW.request_id
       OR source_row.request_revision + 1 IS DISTINCT FROM NEW.request_revision
       OR evidence.event_type IS DISTINCT FROM 'correction_required'
       OR evidence.submission_version_id IS DISTINCT FROM source_row.id
       OR evidence.observation_id IS DISTINCT FROM NEW.observation_id
       OR evidence.request_id IS DISTINCT FROM NEW.request_id
       OR evidence.request_revision IS DISTINCT FROM source_row.request_revision
       OR source_row.reviewed_by IS DISTINCT FROM evidence.actor_subject
       OR source_row.reviewed_at IS DISTINCT FROM evidence.created_at
       OR source_row.review_comment IS DISTINCT FROM evidence.comment THEN
      RAISE EXCEPTION 'Edit correction does not link to its exact reviewed source version'
        USING ERRCODE='23514';
    END IF;
  ELSIF NEW.submission_type='correction_resubmission' THEN
    SELECT * INTO source_row FROM observation_submission_version
      WHERE id=NEW.based_on_version_id AND observation_id=NEW.observation_id;
    SELECT * INTO original_evidence FROM observation_review WHERE id=NEW.correction_review_id;
    IF source_row.id IS NULL OR original_evidence.id IS NULL
       OR source_row.status IS DISTINCT FROM 'Superseded'
       OR source_row.request_id IS NOT NULL
       OR original_evidence.decision IS DISTINCT FROM 'Correction Required'
       OR original_evidence.submission_version_id IS DISTINCT FROM source_row.id
       OR original_evidence.observation_id IS DISTINCT FROM NEW.observation_id
       OR source_row.reviewed_by IS DISTINCT FROM original_evidence.reviewer_subject
       OR source_row.reviewed_at IS DISTINCT FROM original_evidence.created_at
       OR source_row.review_comment IS DISTINCT FROM original_evidence.comment THEN
      RAISE EXCEPTION 'Original correction does not link to its exact reviewed source version'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_submission_030_correction_guard
  BEFORE INSERT OR UPDATE ON observation_submission_version
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_correction_edit_lineage();

CREATE OR REPLACE FUNCTION plant_app.guard_observation_version_review_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE expected_event TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR
     NEW.status NOT IN ('Approved','Rejected','Correction Required','Flagged') THEN
    RETURN NEW;
  END IF;
  IF NEW.request_id IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM observation_review r
      WHERE r.observation_id=NEW.observation_id AND r.submission_version_id=NEW.id
        AND r.decision=NEW.status AND r.reviewer_subject=NEW.reviewed_by
        AND r.created_at=NEW.reviewed_at
        AND r.comment IS NOT DISTINCT FROM NEW.review_comment) THEN
      RAISE EXCEPTION 'Original Observation decision lacks exact persisted review evidence'
        USING ERRCODE='23514';
    END IF;
  ELSE
    expected_event := lower(replace(NEW.status,' ','_'));
    IF NOT EXISTS(SELECT 1 FROM observation_edit_event e
      WHERE e.observation_id=NEW.observation_id AND e.submission_version_id=NEW.id
        AND e.request_id=NEW.request_id AND e.request_revision=NEW.request_revision
        AND e.event_type=expected_event AND e.actor_subject=NEW.reviewed_by
        AND e.created_at=NEW.reviewed_at
        AND e.comment IS NOT DISTINCT FROM NEW.review_comment) THEN
      RAISE EXCEPTION 'Observation edit decision lacks exact persisted review evidence'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER observation_submission_030_review_guard
  BEFORE UPDATE ON observation_submission_version
  FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_version_review_evidence();

-- PostgreSQL cannot infer the Officer's application role from actor_subject.
-- Existing authenticated route permission checks remain mandatory. The
-- database rejects self-review and mismatched persisted evidence.

-- The existing migration 029 guard is replaced below, preserving all of its
-- immutable snapshot, status, ownership and version-allocation checks.

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
    IF NEW.submission_type='correction_resubmission' AND NEW.request_id IS NULL THEN
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


COMMIT;
