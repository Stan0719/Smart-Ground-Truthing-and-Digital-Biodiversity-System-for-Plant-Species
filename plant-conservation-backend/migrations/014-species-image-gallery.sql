-- Checkpoint 1: apply only through a separately approved deployment, after 013.
-- No legacy collections, primary choices, provenance or bytes are inferred.
-- Checkpoint 2 deployment order: deploy compatible readers/review helpers first;
-- apply this migration once in the configured application schema after backup;
-- verify role/RLS access and offline-tested constraints; only then deploy and
-- explicitly enable management routes/UI. Old readers must not be restored after
-- removals: retained bytes require the membership checks to remain deployed.
BEGIN;
ALTER TABLE plant_asset ADD CONSTRAINT plant_asset_species_image_key UNIQUE(species_id,id);
ALTER TABLE species_request_submission ADD COLUMN photo_asset_id TEXT REFERENCES plant_asset(id);
CREATE TABLE species_image_collection (
  species_id BIGINT PRIMARY KEY REFERENCES species(species_id),
  revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL
);
CREATE TABLE species_image_reference (
  species_id BIGINT NOT NULL REFERENCES species_image_collection(species_id),
  asset_id TEXT NOT NULL,
  position INTEGER,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT NOT NULL,
  removed_at TIMESTAMPTZ,
  removed_by TEXT,
  PRIMARY KEY(species_id,asset_id),
  FOREIGN KEY(species_id,asset_id) REFERENCES plant_asset(species_id,id),
  CONSTRAINT species_image_position UNIQUE(species_id,position) DEFERRABLE INITIALLY DEFERRED,
  CHECK((removed_at IS NULL AND removed_by IS NULL AND position IS NOT NULL AND position>=0)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND position IS NULL AND NOT is_primary))
);
CREATE UNIQUE INDEX species_image_primary ON species_image_reference(species_id) WHERE is_primary;
CREATE TABLE species_image_arrangement_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  species_id BIGINT NOT NULL REFERENCES species_image_collection(species_id),
  previous_revision BIGINT NOT NULL CHECK(previous_revision>=0),
  new_revision BIGINT NOT NULL CHECK(new_revision=previous_revision+1),
  previous_arrangement JSONB NOT NULL,
  new_arrangement JSONB NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('save','upload','request-photo')),
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(species_id,new_revision)
);
CREATE FUNCTION species_image_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Species image arrangement history is append-only'; END $$;
CREATE TRIGGER species_image_history_no_mutation BEFORE UPDATE OR DELETE ON species_image_arrangement_history
  FOR EACH ROW EXECUTE FUNCTION species_image_history_immutable();
ALTER TABLE species_image_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_image_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_image_arrangement_history ENABLE ROW LEVEL SECURITY;
COMMIT;
