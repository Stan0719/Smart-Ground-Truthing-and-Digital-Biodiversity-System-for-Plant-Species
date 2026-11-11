-- Apply only after a verified backup and separate approval. No existing rows change.
-- Versions begin at the first snapshot captured after this migration; older edits
-- cannot be reconstructed from current record tables.
BEGIN;
CREATE TABLE IF NOT EXISTS record_version_history (
  id TEXT PRIMARY KEY,
  record_type TEXT NOT NULL CHECK (record_type IN ('plant','species')),
  plant_id INTEGER REFERENCES plant_record(plant_id),
  request_id INTEGER REFERENCES species_request_submission(request_id),
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  owner_subject TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending Review','Approved','Rejected','Correction Required','Flagged','Superseded')),
  snapshot JSONB NOT NULL,
  previous_snapshot JSONB,
  species_photo BYTEA CHECK (species_photo IS NULL OR octet_length(species_photo) <= 4194304),
  change_id TEXT REFERENCES record_change_submission(id),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((record_type='plant' AND plant_id IS NOT NULL AND request_id IS NULL)
    OR (record_type='species' AND request_id IS NOT NULL AND plant_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS record_version_plant_number ON record_version_history(plant_id,version_number) WHERE plant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS record_version_species_number ON record_version_history(request_id,version_number) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS record_version_change ON record_version_history(change_id) WHERE change_id IS NOT NULL;
ALTER TABLE record_version_history ENABLE ROW LEVEL SECURITY;
COMMIT;
