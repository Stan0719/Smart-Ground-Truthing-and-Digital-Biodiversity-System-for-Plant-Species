-- Apply in the configured PLANT_PG_SCHEMA only after deployment approval.
-- Existing observations and assets remain intact.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF current_schema() <> 'plant_app' THEN
    RAISE EXCEPTION 'Wrong schema; expected plant_app';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS observation_edit_request (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES plant_observation(id),
  owner_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending Review'
    CHECK (status IN ('Pending Review','Correction Required','Approved','Rejected')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  base_revision INTEGER NOT NULL CHECK (base_revision > 0),
  base_fingerprint TEXT NOT NULL,
  base_snapshot JSONB NOT NULL,
  proposed_content JSONB NOT NULL,
  retained_photo_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  added_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  client_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  review_comment TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_subject,client_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS observation_edit_active_one
  ON observation_edit_request(observation_id)
  WHERE status IN ('Pending Review','Correction Required');
CREATE INDEX IF NOT EXISTS observation_edit_owner_history
  ON observation_edit_request(owner_subject,observation_id,created_at DESC);
CREATE TABLE IF NOT EXISTS observation_version_history (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES plant_observation(id),
  version_number INTEGER NOT NULL CHECK (version_number >= 0),
  owner_subject TEXT NOT NULL,
  content JSONB NOT NULL,
  photo_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  edit_request_id TEXT REFERENCES observation_edit_request(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (observation_id,version_number)
);
CREATE TABLE IF NOT EXISTS observation_edit_event (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES observation_edit_request(id),
  observation_id TEXT NOT NULL REFERENCES plant_observation(id),
  actor_subject TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('submitted','correction_required','resubmitted','approved','rejected')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ
);
ALTER TABLE observation_edit_event ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS observation_edit_event_request ON observation_edit_event(request_id,created_at);
ALTER TABLE observation_edit_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_version_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_edit_event ENABLE ROW LEVEL SECURITY;
COMMIT;
