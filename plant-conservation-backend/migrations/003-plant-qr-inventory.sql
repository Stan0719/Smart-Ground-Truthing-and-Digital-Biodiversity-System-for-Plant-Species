BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM plant_app.plant_record AS app_plant
    LEFT JOIN public.plant_record AS legacy_plant
      ON legacy_plant.plant_id = app_plant.plant_id
    WHERE legacy_plant.plant_id IS NULL
       OR legacy_plant.species_id IS DISTINCT FROM app_plant.species_id
  ) THEN
    RAISE EXCEPTION 'plant_app and public plant IDs do not match; QR inventory migration stopped';
  END IF;
END;
$$;

ALTER TABLE public.qr_code
  DROP CONSTRAINT IF EXISTS qr_code_plant_id_fkey;

ALTER TABLE public.qr_code
  ADD CONSTRAINT qr_code_plant_id_fkey
  FOREIGN KEY (plant_id)
  REFERENCES plant_app.plant_record(plant_id)
  ON DELETE SET NULL;

INSERT INTO public.qr_code
  (plant_id, qr_code, status, generated_at, assigned_at, activated_at)
SELECT
  plant_id,
  qr_token,
  CASE WHEN rbac_status = 'Approved' THEN 'active' ELSE 'assigned' END,
  registered_at,
  registered_at,
  CASE WHEN rbac_status = 'Approved' THEN registered_at ELSE NULL END
FROM plant_app.plant_record
ON CONFLICT (plant_id) DO NOTHING;

COMMIT;
