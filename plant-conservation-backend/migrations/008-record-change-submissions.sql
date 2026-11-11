-- Apply separately in the configured PLANT_PG_SCHEMA after approval.
-- Adds reviewable versions; never overwrites or deletes existing records.
BEGIN;
CREATE TABLE IF NOT EXISTS record_change_submission (
  id TEXT PRIMARY KEY,
  plant_id INTEGER REFERENCES plant_record(plant_id),
  species_id INTEGER REFERENCES species(species_id),
  owner_subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending Review' CHECK(status IN ('Pending Review','Approved','Rejected')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  base_snapshot JSONB NOT NULL,
  proposed_snapshot JSONB NOT NULL,
  base_fingerprint TEXT NOT NULL,
  client_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  review_comment TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_subject,client_key),
  CHECK((plant_id IS NULL) <> (species_id IS NULL)),
  CHECK((status='Pending Review' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status<>'Pending Review' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS record_change_pending_plant ON record_change_submission(plant_id) WHERE status='Pending Review' AND plant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS record_change_pending_species ON record_change_submission(species_id) WHERE status='Pending Review' AND species_id IS NOT NULL;
ALTER TABLE record_change_submission ENABLE ROW LEVEL SECURITY;
COMMIT;
