BEGIN;

DO $$
BEGIN
  IF to_regclass('public.plant_record') IS NOT NULL THEN
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
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plant_app.plant_record
    WHERE qr_token IS NOT NULL
    GROUP BY qr_token
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate QR tokens found in plant_app.plant_record; manual review required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM plant_app.plant_record AS p
    JOIN plant_app.qr_code AS q
      ON q.qr_code = p.qr_token
    WHERE q.plant_id IS DISTINCT FROM p.plant_id
  ) OR EXISTS (
    SELECT 1
    FROM plant_app.plant_record AS p
    JOIN plant_app.qr_code AS q
      ON q.plant_id = p.plant_id
    WHERE q.qr_code IS DISTINCT FROM p.qr_token
  ) THEN
    RAISE EXCEPTION 'Existing QR inventory mappings need manual review; no changes made';
  END IF;
END;
$$;

INSERT INTO plant_app.qr_code
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
