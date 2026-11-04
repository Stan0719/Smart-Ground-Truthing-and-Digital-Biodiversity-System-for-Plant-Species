-- Apply after 004 and 005 in the configured PLANT_PG_SCHEMA. Additive only.
BEGIN;
ALTER TABLE species_request_submission ADD COLUMN IF NOT EXISTS proposed_species_id BIGINT REFERENCES species(species_id);
CREATE TABLE IF NOT EXISTS plant_submission_receipt (
  owner_subject TEXT NOT NULL,
  client_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_subject,client_key)
);
ALTER TABLE plant_submission_receipt ENABLE ROW LEVEL SECURITY;
COMMIT;
