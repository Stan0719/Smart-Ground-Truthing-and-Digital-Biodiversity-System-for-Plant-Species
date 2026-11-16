-- Apply in the configured plant schema after migration 006.
BEGIN;
ALTER TABLE species_request_submission
  ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='species_request_submission'::regclass
    AND conname='species_request_content_revision_positive') THEN
    ALTER TABLE species_request_submission ADD CONSTRAINT species_request_content_revision_positive CHECK(content_revision > 0);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION advance_species_request_content_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.scientific_name,NEW.common_name,NEW.genus_name,NEW.family_name,
         NEW.conservation_status,NEW.description,NEW.habitat,NEW.photo,NEW.proposed_species_id)
     IS DISTINCT FROM
     ROW(OLD.scientific_name,OLD.common_name,OLD.genus_name,OLD.family_name,
         OLD.conservation_status,OLD.description,OLD.habitat,OLD.photo,OLD.proposed_species_id) THEN
    NEW.content_revision := OLD.content_revision + 1;
    NEW.content_updated_at := clock_timestamp();
  ELSE
    NEW.content_revision := OLD.content_revision;
    NEW.content_updated_at := OLD.content_updated_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS species_request_content_revision ON species_request_submission;
CREATE TRIGGER species_request_content_revision BEFORE UPDATE ON species_request_submission
FOR EACH ROW EXECUTE FUNCTION advance_species_request_content_revision();
COMMIT;
