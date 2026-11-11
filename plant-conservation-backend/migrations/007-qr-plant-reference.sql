-- Repair only the QR parent reference. No rows are inserted, updated or deleted.
-- Run with an authorized migration role after reviewing the target database.
BEGIN;
LOCK TABLE public.qr_code IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.plant_record IN SHARE MODE;
LOCK TABLE plant_app.plant_record IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  parent_oid OID;
  child_columns SMALLINT[];
  delete_action "char";
BEGIN
  SELECT confrelid, conkey, confdeltype
    INTO parent_oid, child_columns, delete_action
    FROM pg_constraint
    WHERE conrelid = 'public.qr_code'::regclass
      AND conname = 'qr_code_plant_id_fkey'
      AND contype = 'f';
  IF parent_oid IS NULL THEN
    RAISE EXCEPTION 'Expected QR plant foreign key is missing; no changes made';
  END IF;
  IF child_columns IS DISTINCT FROM ARRAY[
    (SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.qr_code'::regclass AND attname = 'plant_id')
  ]::SMALLINT[] OR delete_action <> 'n' THEN
    RAISE EXCEPTION 'Unexpected QR foreign key definition; no changes made';
  END IF;
  IF parent_oid = 'plant_app.plant_record'::regclass THEN
    RETURN; -- Already repaired.
  END IF;
  IF parent_oid <> 'public.plant_record'::regclass THEN
    RAISE EXCEPTION 'Unexpected QR parent table; no changes made';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.qr_code q
    LEFT JOIN plant_app.plant_record app_plant ON app_plant.plant_id = q.plant_id
    LEFT JOIN public.plant_record legacy_plant ON legacy_plant.plant_id = q.plant_id
    WHERE q.plant_id IS NOT NULL AND (
      app_plant.plant_id IS NULL OR legacy_plant.plant_id IS NULL
      OR app_plant.species_id IS DISTINCT FROM legacy_plant.species_id
    )
  ) THEN
    RAISE EXCEPTION 'Existing assigned QR mappings need manual review; no changes made';
  END IF;

  -- Validate the correct reference before replacing the old constraint.
  ALTER TABLE public.qr_code ADD CONSTRAINT qr_code_plant_id_app_fkey
    FOREIGN KEY (plant_id) REFERENCES plant_app.plant_record(plant_id)
    ON DELETE SET NULL NOT VALID;
  ALTER TABLE public.qr_code VALIDATE CONSTRAINT qr_code_plant_id_app_fkey;
  ALTER TABLE public.qr_code DROP CONSTRAINT qr_code_plant_id_fkey;
  ALTER TABLE public.qr_code RENAME CONSTRAINT qr_code_plant_id_app_fkey
    TO qr_code_plant_id_fkey;
END;
$$;
COMMIT;
