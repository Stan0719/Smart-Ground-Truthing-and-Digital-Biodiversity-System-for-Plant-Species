-- Apply explicitly in the configured PLANT_PG_SCHEMA before relying on origin persistence.
-- No historical inference or receipt rewriting. Existing rows receive unknown.
BEGIN;
ALTER TABLE plant_observation ADD COLUMN IF NOT EXISTS origin_type TEXT NOT NULL DEFAULT 'unknown';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='plant_observation'::regclass AND conname='plant_observation_origin_type_check') THEN
    ALTER TABLE plant_observation ADD CONSTRAINT plant_observation_origin_type_check
      CHECK (origin_type IN ('initial_registration','subsequent_observation','unknown'));
  END IF;
END $$;
COMMIT;
