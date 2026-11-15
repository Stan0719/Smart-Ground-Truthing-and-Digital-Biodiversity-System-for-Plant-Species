-- Additive follow-up to 014. Apply only after separate backup/deployment approval.
-- No old asset is classified by position/client key. No bytes or evidence links change.
BEGIN;
ALTER TABLE plant_asset ADD CONSTRAINT plant_asset_plant_image_key UNIQUE(id,plant_id);
ALTER TABLE plant_observation ADD CONSTRAINT observation_plant_image_key UNIQUE(id,plant_id);
CREATE TABLE plant_asset_photo_role (
  asset_id TEXT PRIMARY KEY,
  plant_id BIGINT NOT NULL,
  observation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('whole_plant','leaf_close_up','stem_bark','flower_fruit','additional')),
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asset_id,plant_id) REFERENCES plant_asset(id,plant_id),
  FOREIGN KEY(observation_id,plant_id) REFERENCES plant_observation(id,plant_id),
  UNIQUE(asset_id,role)
);
CREATE FUNCTION validate_photo_role_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Photo role provenance is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM plant_asset a WHERE a.id=NEW.asset_id AND a.plant_id=NEW.plant_id
    AND a.observation_id=NEW.observation_id AND a.owner_subject=NEW.recorded_by
    AND a.species_id IS NULL AND a.content_type IN ('image/jpeg','image/png')) THEN
    RAISE EXCEPTION 'Photo role does not match original evidence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER photo_role_origin BEFORE INSERT OR UPDATE OR DELETE ON plant_asset_photo_role
  FOR EACH ROW EXECUTE FUNCTION validate_photo_role_origin();
CREATE TABLE species_request_proposed_image (
  request_id INTEGER PRIMARY KEY REFERENCES species_request_submission(request_id),
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'whole_plant' CHECK(role='whole_plant'),
  FOREIGN KEY(asset_id,role) REFERENCES plant_asset_photo_role(asset_id,role)
);
CREATE INDEX species_photo_plant_source ON plant_record(species_id,plant_id) WHERE rbac_status='Approved';
CREATE INDEX species_photo_approved_observation ON plant_observation(plant_id,id) WHERE status='Approved';
CREATE INDEX species_photo_direct_order ON plant_asset(species_id,created_at DESC,id) WHERE approved AND content_type IN ('image/jpeg','image/png');
CREATE INDEX species_photo_evidence_order ON plant_asset(plant_id,observation_id,created_at DESC,id);
CREATE INDEX species_photo_whole_plant ON plant_asset_photo_role(plant_id,observation_id,asset_id) WHERE role='whole_plant';
ALTER TABLE plant_asset_photo_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE species_request_proposed_image ENABLE ROW LEVEL SECURITY;
COMMIT;
