-- Apply separately with search_path set to the configured PLANT_PG_SCHEMA.
-- Existing records stay NULL; do not backfill from species scientific names.
BEGIN;
ALTER TABLE plant_record ADD COLUMN IF NOT EXISTS scientific_name TEXT
  CHECK (scientific_name IS NULL OR length(btrim(scientific_name)) BETWEEN 1 AND 200);
COMMIT;
