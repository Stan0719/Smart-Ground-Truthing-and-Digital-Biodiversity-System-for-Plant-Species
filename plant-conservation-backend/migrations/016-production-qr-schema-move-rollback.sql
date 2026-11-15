-- PRODUCTION ROLLBACK REVIEW ARTIFACT — execute only after explicit approval.
-- This reverses the schema location only. It does not undo application writes,
-- permissions changed separately, or any other migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  moved_table OID := to_regclass('plant_app.qr_code');
  destination_table OID := to_regclass('public.qr_code');
  app_plant OID := to_regclass('plant_app.plant_record');
  public_history OID := to_regclass('public.qr_scan_history');
  visitor_history OID := to_regclass('plant_app.visitor_scan_history');
  qr_id_attnum SMALLINT;
  public_history_qr_id_attnum SMALLINT;
  visitor_history_qr_id_attnum SMALLINT;
  original_owner OID;
  original_acl ACLITEM[];
  rls_enabled BOOLEAN;
  rls_forced BOOLEAN;
  qr_count BIGINT;
  public_history_count BIGINT;
  visitor_history_count BIGINT;
  identity_sequence OID;
  identity_owner OID;
  identity_acl ACLITEM[];
BEGIN
  IF moved_table IS NULL OR destination_table IS NOT NULL THEN
    RAISE EXCEPTION 'Expected only plant_app.qr_code to exist; no rollback was performed';
  END IF;
  IF app_plant IS NULL OR public_history IS NULL OR visitor_history IS NULL THEN
    RAISE EXCEPTION 'Expected plant/history tables are missing; no rollback was performed';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Rollback role requires CREATE on public';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class source
    JOIN pg_roles rollback_role ON rollback_role.rolname = current_user
    WHERE source.oid = moved_table
      AND (rollback_role.rolsuper OR source.relowner = rollback_role.oid
           OR pg_has_role(current_user, source.relowner, 'USAGE'))
  ) THEN
    RAISE EXCEPTION 'Rollback role requires effective ownership of plant_app.qr_code';
  END IF;

  LOCK TABLE public.qr_scan_history IN SHARE MODE;
  LOCK TABLE plant_app.visitor_scan_history IN SHARE MODE;
  LOCK TABLE plant_app.plant_record IN SHARE MODE;
  LOCK TABLE plant_app.qr_code IN ACCESS EXCLUSIVE MODE;

  SELECT relowner, relacl, relrowsecurity, relforcerowsecurity
    INTO original_owner, original_acl, rls_enabled, rls_forced
  FROM pg_class WHERE oid = moved_table;
  SELECT count(*) INTO qr_count FROM plant_app.qr_code;
  SELECT count(*) INTO public_history_count FROM public.qr_scan_history;
  SELECT count(*) INTO visitor_history_count FROM plant_app.visitor_scan_history;

  SELECT attnum INTO qr_id_attnum FROM pg_attribute
   WHERE attrelid = moved_table AND attname = 'qr_id' AND NOT attisdropped;
  SELECT attnum INTO public_history_qr_id_attnum FROM pg_attribute
   WHERE attrelid = public_history AND attname = 'qr_id' AND NOT attisdropped;
  SELECT attnum INTO visitor_history_qr_id_attnum FROM pg_attribute
   WHERE attrelid = visitor_history AND attname = 'qr_id' AND NOT attisdropped;

  IF qr_id_attnum IS NULL OR public_history_qr_id_attnum IS NULL
     OR visitor_history_qr_id_attnum IS NULL THEN
    RAISE EXCEPTION 'Expected QR ID columns are missing; no rollback was performed';
  END IF;

    -- Verify the exact foreign-key dependency counts.
    IF (
      SELECT count(*)
      FROM pg_constraint
      WHERE confrelid = moved_table
        AND contype = 'f'
    ) <> 2 THEN
      RAISE EXCEPTION
        'Expected exactly two incoming QR foreign keys; no rollback was performed';
    END IF;

    IF (
      SELECT count(*)
      FROM pg_constraint
      WHERE conrelid = moved_table
        AND contype = 'f'
    ) <> 1 THEN
      RAISE EXCEPTION
        'Expected exactly one outgoing QR foreign key; no rollback was performed';
    END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = public_history AND c.conname = 'qr_scan_history_qr_id_fkey'
      AND c.contype = 'f' AND c.confrelid = moved_table
      AND c.conkey = ARRAY[public_history_qr_id_attnum]::SMALLINT[]
      AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
      AND c.confdeltype = 'c' AND c.confupdtype = 'a'
      AND c.confmatchtype = 's' AND NOT c.condeferrable
      AND NOT c.condeferred AND c.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = visitor_history AND c.conname = 'visitor_scan_history_qr_id_fkey'
      AND c.contype = 'f' AND c.confrelid = moved_table
      AND c.conkey = ARRAY[visitor_history_qr_id_attnum]::SMALLINT[]
      AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
      AND c.confdeltype = 'n' AND c.confupdtype = 'a'
      AND c.confmatchtype = 's' AND NOT c.condeferrable
      AND NOT c.condeferred AND c.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = moved_table AND c.conname = 'qr_code_plant_id_fkey'
      AND c.contype = 'f' AND c.confrelid = app_plant
      AND c.confdeltype = 'n' AND c.confupdtype = 'a'
      AND c.confmatchtype = 's' AND NOT c.condeferrable
      AND c.convalidated
  ) THEN
    RAISE EXCEPTION 'Expected QR foreign keys are not intact; no rollback was performed';
  END IF;

  identity_sequence := to_regclass(pg_get_serial_sequence('plant_app.qr_code', 'qr_id'));
  SELECT relowner, relacl INTO identity_owner, identity_acl
    FROM pg_class WHERE oid = identity_sequence;
  IF identity_sequence IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = identity_sequence
      AND d.refclassid = 'pg_class'::regclass AND d.refobjid = moved_table
      AND d.refobjsubid = qr_id_attnum AND d.deptype = 'i'
  ) THEN
    RAISE EXCEPTION 'QR identity sequence ownership is unexpected; no rollback was performed';
  END IF;

  IF to_regclass('public.qr_code_qr_id_seq') IS NOT NULL THEN
    RAISE EXCEPTION
      'Sequence name public.qr_code_qr_id_seq is already occupied; no rollback was performed';
  END IF;

  ALTER TABLE plant_app.qr_code SET SCHEMA public;

  IF to_regclass('plant_app.qr_code') IS NOT NULL
     OR to_regclass('public.qr_code') IS DISTINCT FROM moved_table THEN
    RAISE EXCEPTION 'Reverse QR table OID/location postcondition failed';
  END IF;
  IF (SELECT count(*) FROM public.qr_code) <> qr_count
     OR (SELECT count(*) FROM public.qr_scan_history) <> public_history_count
     OR (SELECT count(*) FROM plant_app.visitor_scan_history) <> visitor_history_count THEN
    RAISE EXCEPTION 'QR/history row-count postcondition failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c WHERE c.oid = moved_table
      AND c.relowner = original_owner
      AND c.relacl IS NOT DISTINCT FROM original_acl
      AND c.relrowsecurity = rls_enabled
      AND c.relforcerowsecurity = rls_forced
  ) THEN
    RAISE EXCEPTION 'QR table owner, ACL, or RLS state changed unexpectedly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE s.oid = identity_sequence AND n.nspname = 'public'
      AND s.relowner = identity_owner
      AND s.relacl IS NOT DISTINCT FROM identity_acl
      AND s.oid = to_regclass(pg_get_serial_sequence('public.qr_code', 'qr_id'))
      AND EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
          AND d.objid = s.oid AND d.refclassid = 'pg_class'::regclass
          AND d.refobjid = moved_table AND d.refobjsubid = qr_id_attnum
          AND d.deptype = 'i'
      )
  ) THEN
    RAISE EXCEPTION 'QR identity sequence reverse-move postcondition failed';
  END IF;
END;
$$;

COMMIT;
