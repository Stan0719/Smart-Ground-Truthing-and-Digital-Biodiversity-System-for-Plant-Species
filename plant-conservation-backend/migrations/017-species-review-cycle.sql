-- NOT APPLIED. Run in the configured plant schema after 004, 006 and 016.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='species_request_submission' AND column_name='content_revision'
      AND data_type='integer' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Verify migration 016 in the selected plant schema before migration 017';
  END IF;
END $$;
ALTER TABLE species_request_submission
  ADD COLUMN IF NOT EXISTS review_cycle INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS review_decision_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='species_request_submission'::regclass AND conname='species_request_review_cycle_positive') THEN
    ALTER TABLE species_request_submission ADD CONSTRAINT species_request_review_cycle_positive CHECK(review_cycle > 0);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION advance_species_request_review_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.request_status='Correction Required' AND NEW.request_status='Pending Review' THEN
    NEW.review_cycle := OLD.review_cycle + 1;
  ELSE
    NEW.review_cycle := OLD.review_cycle;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS species_request_review_cycle ON species_request_submission;
CREATE TRIGGER species_request_review_cycle BEFORE UPDATE ON species_request_submission
  FOR EACH ROW EXECUTE FUNCTION advance_species_request_review_cycle();
ALTER TABLE observation_review
  ADD COLUMN IF NOT EXISTS review_origin TEXT NOT NULL DEFAULT 'officer',
  ADD COLUMN IF NOT EXISTS species_request_id INTEGER REFERENCES species_request_submission(request_id),
  ADD COLUMN IF NOT EXISTS species_review_cycle INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='observation_review'::regclass AND conname='observation_review_dependency_origin') THEN
    ALTER TABLE observation_review ADD CONSTRAINT observation_review_dependency_origin CHECK (
      (review_origin='officer' AND species_request_id IS NULL AND species_review_cycle IS NULL)
      OR (review_origin='species_dependency' AND species_request_id IS NOT NULL AND species_review_cycle IS NOT NULL AND species_review_cycle > 0));
  END IF;
END $$;
COMMIT;
