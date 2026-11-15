-- PRODUCTION REVIEW ARTIFACT — do not execute until the checklist in
-- QR-PRODUCTION-READINESS-PACKAGE.md is approved and completed.
-- Expected initial counts are explicit deployment gates; change only after a
-- fresh read-only preflight and owner approval.
BEGIN;

-- Configurable per deployment window. A timeout aborts the transaction; it
-- must not be worked around by removing the timeout during live traffic.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  source_table OID := to_regclass('public.qr_code');
  destination_table OID := to_regclass('plant_app.qr_code');
  public_plant OID := to_regclass('plant_app.plant_record');
  scan_history_table OID := to_regclass('public.qr_scan_history');
  visitor_history_table OID := to_regclass('plant_app.visitor_scan_history');
  table_kind "char";
  qr_id_attnum SMALLINT;
  scan_history_qr_id_attnum SMALLINT;
  visitor_history_qr_id_attnum SMALLINT;
  plant_id_attnum SMALLINT;
  qr_code_attnum SMALLINT;
  status_attnum SMALLINT;
  generated_at_attnum SMALLINT;
  foreign_key_count INTEGER;
  incoming_foreign_key_count INTEGER;
  foreign_key_name TEXT;
  foreign_key_parent OID;
  source_owner OID;
  source_acl ACLITEM[];
  source_rls_enabled BOOLEAN;
  source_rls_forced BOOLEAN;
  source_row_count BIGINT;
  visitor_row_count BIGINT;
  public_scan_row_count BIGINT;
  identity_sequence OID;
  identity_sequence_owner OID;
  identity_sequence_acl ACLITEM[];
BEGIN
  IF to_regnamespace('plant_app') IS NULL THEN
    RAISE EXCEPTION 'plant_app schema is required; no QR table was moved';
  END IF;
  IF destination_table IS NOT NULL THEN
    RAISE EXCEPTION 'plant_app.qr_code already exists; manual review required';
  END IF;
  IF source_table IS NULL THEN
    RAISE EXCEPTION 'public.qr_code is required; no table was moved';
  END IF;
  IF public_plant IS NULL THEN
    RAISE EXCEPTION 'plant_app.plant_record is required; no QR table was moved';
  END IF;
  IF scan_history_table IS NULL THEN
    RAISE EXCEPTION 'public.qr_scan_history is required; manual dependency review required';
  END IF;
  IF visitor_history_table IS NULL THEN
    RAISE EXCEPTION 'plant_app.visitor_scan_history is required; manual dependency review required';
  END IF;

  IF NOT has_schema_privilege(current_user, 'plant_app', 'CREATE') THEN
    RAISE EXCEPTION 'Migration role requires CREATE privilege on plant_app';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class source
    JOIN pg_roles migration_role ON migration_role.rolname = current_user
    WHERE source.oid = source_table
      AND (
        migration_role.rolsuper
        OR source.relowner = migration_role.oid
        OR pg_has_role(current_user, source.relowner, 'USAGE')
      )
  ) THEN
    RAISE EXCEPTION 'Migration role needs effective ownership rights on public.qr_code';
  END IF;

  SELECT relkind INTO table_kind FROM pg_class WHERE oid = source_table;
  IF table_kind <> 'r' THEN
    RAISE EXCEPTION 'public.qr_code is not a regular table; manual review required';
  END IF;
  SELECT relkind INTO table_kind FROM pg_class WHERE oid = public_plant;
  IF table_kind <> 'r' THEN
    RAISE EXCEPTION 'plant_app.plant_record is not a regular table; manual review required';
  END IF;
  SELECT relkind INTO table_kind FROM pg_class WHERE oid = scan_history_table;
  IF table_kind <> 'r' THEN
    RAISE EXCEPTION 'public.qr_scan_history is not a regular table; manual review required';
  END IF;
  SELECT relkind INTO table_kind FROM pg_class WHERE oid = visitor_history_table;
  IF table_kind <> 'r' THEN
    RAISE EXCEPTION 'plant_app.visitor_scan_history is not a regular table; manual review required';
  END IF;

  EXECUTE 'LOCK TABLE public.qr_scan_history IN SHARE MODE';
  EXECUTE 'LOCK TABLE plant_app.visitor_scan_history IN SHARE MODE';
  EXECUTE 'LOCK TABLE plant_app.plant_record IN SHARE MODE';
  EXECUTE 'LOCK TABLE public.qr_code IN ACCESS EXCLUSIVE MODE';

  -- Record the locked baseline. These counts are deployment assumptions, not
  -- data repair instructions; any mismatch stops before the schema move.
  SELECT relowner, relacl, relrowsecurity, relforcerowsecurity
    INTO source_owner, source_acl, source_rls_enabled, source_rls_forced
  FROM pg_class WHERE oid = source_table;
  SELECT count(*) INTO source_row_count FROM public.qr_code;
  SELECT count(*) INTO visitor_row_count FROM plant_app.visitor_scan_history;
  SELECT count(*) INTO public_scan_row_count FROM public.qr_scan_history;

  IF source_row_count <> 18 THEN
    RAISE EXCEPTION 'Expected 18 public.qr_code rows, found %; no table was moved', source_row_count;
  END IF;
  IF visitor_row_count <> 18 THEN
    RAISE EXCEPTION 'Expected 18 visitor history rows, found %; no table was moved', visitor_row_count;
  END IF;
  IF public_scan_row_count <> 0 THEN
    RAISE EXCEPTION 'Expected 0 public QR scan history rows, found %; no table was moved', public_scan_row_count;
  END IF;
  IF source_rls_enabled OR source_rls_forced THEN
    RAISE EXCEPTION 'Expected RLS disabled and not forced on public.qr_code; manual security review required';
  END IF;

  SELECT attnum INTO qr_id_attnum
  FROM pg_attribute
  WHERE attrelid = source_table AND attname = 'qr_id' AND NOT attisdropped;
  SELECT attnum INTO scan_history_qr_id_attnum
  FROM pg_attribute
  WHERE attrelid = scan_history_table AND attname = 'qr_id' AND NOT attisdropped;
  SELECT attnum INTO visitor_history_qr_id_attnum
  FROM pg_attribute
  WHERE attrelid = visitor_history_table AND attname = 'qr_id' AND NOT attisdropped;
  SELECT attnum INTO plant_id_attnum
  FROM pg_attribute
  WHERE attrelid = source_table AND attname = 'plant_id' AND NOT attisdropped;
  SELECT attnum INTO qr_code_attnum
  FROM pg_attribute
  WHERE attrelid = source_table AND attname = 'qr_code' AND NOT attisdropped;
  SELECT attnum INTO status_attnum
  FROM pg_attribute
  WHERE attrelid = source_table AND attname = 'status' AND NOT attisdropped;
  SELECT attnum INTO generated_at_attnum
  FROM pg_attribute
  WHERE attrelid = source_table AND attname = 'generated_at' AND NOT attisdropped;

  IF qr_id_attnum IS NULL OR plant_id_attnum IS NULL OR qr_code_attnum IS NULL
     OR status_attnum IS NULL OR generated_at_attnum IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attname = 'assigned_at' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attname = 'activated_at' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attname = 'retired_at' AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'public.qr_code columns do not match the reviewed table shape';
  END IF;

  IF (
    SELECT count(*) FROM pg_attribute
    WHERE attrelid = source_table AND attnum > 0 AND NOT attisdropped
  ) <> 8 THEN
    RAISE EXCEPTION 'public.qr_code has unexpected columns; manual review required';
  END IF;
  
  IF scan_history_qr_id_attnum IS NULL THEN
    RAISE EXCEPTION 'public.qr_scan_history.qr_id is required; manual dependency review required';
  END IF;

  IF visitor_history_qr_id_attnum IS NULL THEN
    RAISE EXCEPTION 'plant_app.visitor_scan_history.qr_id is required; manual dependency review required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('qr_id', 'bigint'::regtype),
      ('plant_id', 'bigint'::regtype),
      ('qr_code', 'text'::regtype),
      ('status', 'character varying'::regtype),
      ('generated_at', 'timestamptz'::regtype),
      ('assigned_at', 'timestamptz'::regtype),
      ('activated_at', 'timestamptz'::regtype),
      ('retired_at', 'timestamptz'::regtype)
    ) AS expected(column_name, expected_type)
    LEFT JOIN pg_attribute actual
      ON actual.attrelid = source_table
     AND actual.attname = expected.column_name
     AND NOT actual.attisdropped
    WHERE actual.attnum IS NULL OR actual.atttypid <> expected.expected_type
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = public_plant
      AND attname = 'plant_id'
      AND atttypid = 'bigint'::regtype
      AND attnotnull
      AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = source_table
      AND attname = 'status'
      AND atttypid = 'character varying'::regtype
      AND atttypmod = 34
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'QR and public plant column types do not match the reviewed local schema';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attnum = qr_id_attnum
         AND attidentity = 'a' AND attnotnull
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attnum = qr_code_attnum AND attnotnull
     )
     OR EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attnum = plant_id_attnum AND attnotnull
     )
     OR EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table
         AND attname IN ('assigned_at', 'activated_at', 'retired_at')
         AND attnotnull
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attnum = status_attnum AND attnotnull
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = source_table AND attnum = generated_at_attnum AND attnotnull
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attrdef
       WHERE adrelid = source_table AND adnum = status_attnum
         AND lower(pg_get_expr(adbin, adrelid)) = '''generated''::character varying'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_attrdef
       WHERE adrelid = source_table AND adnum = generated_at_attnum
         AND lower(pg_get_expr(adbin, adrelid)) = 'current_timestamp'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_attrdef defaults
       JOIN pg_attribute columns
         ON columns.attrelid = defaults.adrelid
        AND columns.attnum = defaults.adnum
       WHERE defaults.adrelid = source_table
         AND columns.attname IN ('plant_id', 'qr_code', 'assigned_at', 'activated_at', 'retired_at')
     ) THEN
    RAISE EXCEPTION 'public.qr_code defaults or nullability do not match the reviewed table shape';
  END IF;

  IF (
    SELECT count(*) FROM pg_index
    WHERE indrelid = source_table
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('qr_code_pkey', qr_id_attnum, true, 'int8_ops'),
      ('qr_code_plant_id_key', plant_id_attnum, false, 'int8_ops'),
      ('qr_code_qr_code_key', qr_code_attnum, false, 'text_ops')
    ) AS expected(index_name, key_attnum, is_primary, operator_class_name)
    LEFT JOIN pg_class index_relation
      ON index_relation.relname = expected.index_name
     AND index_relation.relnamespace = (
       SELECT relnamespace FROM pg_class WHERE oid = source_table
     )
    LEFT JOIN pg_index actual
      ON actual.indexrelid = index_relation.oid
    LEFT JOIN pg_am access_method ON access_method.oid = index_relation.relam
    LEFT JOIN pg_attribute index_column
      ON index_column.attrelid = source_table
     AND index_column.attnum = expected.key_attnum
    LEFT JOIN pg_opclass operator_class
      ON operator_class.oid = actual.indclass[0]
    LEFT JOIN pg_namespace operator_class_namespace
      ON operator_class_namespace.oid = operator_class.opcnamespace
    WHERE index_relation.oid IS NULL
       OR actual.indexrelid IS NULL
       OR actual.indrelid <> source_table
       OR NOT actual.indisunique
       OR NOT actual.indisvalid
       OR NOT actual.indisready
       OR actual.indisprimary IS DISTINCT FROM expected.is_primary
       OR actual.indpred IS NOT NULL
       OR actual.indexprs IS NOT NULL
       OR actual.indnkeyatts <> 1
       OR actual.indnatts <> 1
       OR actual.indkey[0] <> expected.key_attnum
       OR access_method.amname IS DISTINCT FROM 'btree'
       OR operator_class.opcname IS DISTINCT FROM expected.operator_class_name
       OR operator_class_namespace.nspname IS DISTINCT FROM 'pg_catalog'
       OR operator_class.opcmethod IS DISTINCT FROM access_method.oid
       OR operator_class.opcdefault IS DISTINCT FROM TRUE
       OR actual.indcollation[0] IS DISTINCT FROM index_column.attcollation
       OR actual.indoption[0] IS DISTINCT FROM 0
       OR actual.indnullsnotdistinct IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'public.qr_code indexes do not match the reviewed local index inventory';
  END IF;

  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = source_table AND contype IN ('p', 'u', 'f')
  ) <> 4 OR EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = source_table AND contype NOT IN ('p', 'u', 'f', 'n')
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('qr_id', true),
      ('plant_id', false),
      ('qr_code', true),
      ('status', true),
      ('generated_at', true),
      ('assigned_at', false),
      ('activated_at', false),
      ('retired_at', false)
    ) AS expected(column_name, expected_not_null)
    LEFT JOIN pg_attribute actual
      ON actual.attrelid = source_table
     AND actual.attname = expected.column_name
     AND NOT actual.attisdropped
    WHERE actual.attnum IS NULL
       OR actual.attnotnull IS DISTINCT FROM expected.expected_not_null
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('qr_code_pkey', 'p'::"char", qr_id_attnum, 'qr_code_pkey'::text),
      ('qr_code_plant_id_key', 'u'::"char", plant_id_attnum, 'qr_code_plant_id_key'::text),
      ('qr_code_qr_code_key', 'u'::"char", qr_code_attnum, 'qr_code_qr_code_key'::text),
      ('qr_code_plant_id_fkey', 'f'::"char", plant_id_attnum, NULL::text)
    ) AS expected(conname, contype, key_attnum, index_name)
    LEFT JOIN pg_constraint actual
      ON actual.conrelid = source_table
     AND actual.conname = expected.conname
    LEFT JOIN pg_class backing_index ON backing_index.oid = actual.conindid
    WHERE actual.oid IS NULL
       OR actual.contype <> expected.contype
       OR actual.conkey IS DISTINCT FROM ARRAY[expected.key_attnum]::SMALLINT[]
       OR NOT actual.convalidated
       OR actual.condeferrable
       OR (
         expected.index_name IS NOT NULL
         AND backing_index.relname IS DISTINCT FROM expected.index_name
       )
  ) THEN
    RAISE EXCEPTION 'public.qr_code constraints do not match the reviewed table shape';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('qr_id', true),
      ('plant_id', false),
      ('qr_code', true),
      ('status', true),
      ('generated_at', true),
      ('assigned_at', false),
      ('activated_at', false),
      ('retired_at', false)
    ) AS expected(column_name, expected_not_null)
    LEFT JOIN pg_attribute actual
      ON actual.attrelid = source_table
     AND actual.attname = expected.column_name
     AND NOT actual.attisdropped
    WHERE actual.attnum IS NULL
       OR actual.attnotnull IS DISTINCT FROM expected.expected_not_null
  ) THEN
    RAISE EXCEPTION 'public.qr_code NOT NULL constraints do not match the reviewed columns';
  END IF;

  SELECT count(*) INTO incoming_foreign_key_count
  FROM pg_constraint
  WHERE confrelid = source_table
    AND contype = 'f';

  IF incoming_foreign_key_count <> 2
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = scan_history_table
        AND c.conname = 'qr_scan_history_qr_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = source_table
        AND c.conkey = ARRAY[scan_history_qr_id_attnum]::SMALLINT[]
        AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
        AND c.confdeltype = 'c'
        AND c.confupdtype = 'a'
        AND c.confmatchtype = 's'
        AND NOT c.condeferrable
        AND NOT c.condeferred
        AND c.convalidated
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = visitor_history_table
        AND c.conname = 'visitor_scan_history_qr_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = source_table
        AND c.conkey = ARRAY[visitor_history_qr_id_attnum]::SMALLINT[]
        AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
        AND c.confdeltype = 'n'
        AND c.confupdtype = 'a'
        AND c.confmatchtype = 's'
        AND NOT c.condeferrable
        AND NOT c.condeferred
        AND c.convalidated
    ) THEN
    RAISE EXCEPTION 'Unexpected incoming QR foreign key dependency; manual review required';
  END IF;

  SELECT count(*), (array_agg(c.conname))[1], (array_agg(c.confrelid))[1]
    INTO foreign_key_count, foreign_key_name, foreign_key_parent
  FROM pg_constraint c
  WHERE c.conrelid = source_table AND c.contype = 'f'
    AND c.conkey = ARRAY[plant_id_attnum]::SMALLINT[];

  IF foreign_key_count <> 1
     OR foreign_key_name <> 'qr_code_plant_id_fkey'
     OR foreign_key_parent <> public_plant
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_attribute parent_column
         ON parent_column.attrelid = c.confrelid
        AND parent_column.attname = 'plant_id'
        AND NOT parent_column.attisdropped
       WHERE c.conrelid = source_table
         AND c.conname = foreign_key_name
         AND c.contype = 'f'
         AND c.confkey = ARRAY[parent_column.attnum]::SMALLINT[]
         AND c.confdeltype = 'n'
         AND c.confupdtype = 'a'
         AND c.confmatchtype = 's'
         AND NOT c.condeferrable
         AND c.convalidated
     ) THEN
    RAISE EXCEPTION 'QR foreign key must remain validated to plant_app.plant_record; no table moved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class sequence_row
    JOIN pg_namespace sequence_schema ON sequence_schema.oid = sequence_row.relnamespace
    WHERE sequence_row.oid =
        to_regclass(pg_get_serial_sequence('public.qr_code', 'qr_id'))
      AND sequence_row.relkind = 'S'
      AND sequence_schema.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'QR identity sequence is not associated with public.qr_code.qr_id';
  END IF;

  identity_sequence := to_regclass(pg_get_serial_sequence('public.qr_code', 'qr_id'));
  SELECT relowner, relacl
    INTO identity_sequence_owner, identity_sequence_acl
  FROM pg_class WHERE oid = identity_sequence;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_depend dependency
    WHERE dependency.classid = 'pg_class'::regclass
      AND dependency.objid = identity_sequence
      AND dependency.refclassid = 'pg_class'::regclass
      AND dependency.refobjid = source_table
      AND dependency.refobjsubid = qr_id_attnum
      AND dependency.deptype = 'i'
  ) THEN
    RAISE EXCEPTION 'QR identity sequence is not internally owned by public.qr_code.qr_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_depend dependency
    JOIN pg_rewrite rewrite_rule
      ON dependency.classid = 'pg_rewrite'::regclass
     AND dependency.objid = rewrite_rule.oid
    JOIN pg_class dependent_relation
      ON dependent_relation.oid = rewrite_rule.ev_class
    WHERE dependency.refclassid = 'pg_class'::regclass
      AND dependency.refobjid = source_table
      AND dependent_relation.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'Views or materialized views reference public.qr_code; manual review required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_rewrite
    WHERE ev_class = source_table AND rulename <> '_RETURN'
  ) THEN
    RAISE EXCEPTION 'Rules are attached to public.qr_code; manual review required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = source_table AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'User-defined triggers are attached to public.qr_code; manual review required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_inherits
    WHERE inhrelid = source_table OR inhparent = source_table
  ) THEN
    RAISE EXCEPTION 'Inheritance or partition dependencies on public.qr_code; manual review required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_depend dependency
    WHERE dependency.refclassid = 'pg_class'::regclass
      AND dependency.refobjid = source_table
      AND NOT (
        (
          dependency.classid = 'pg_class'::regclass
          AND (
            dependency.objid = source_table
            OR EXISTS (
              SELECT 1 FROM pg_index index_row
              JOIN pg_class index_relation
                ON index_relation.oid = index_row.indexrelid
              WHERE index_row.indexrelid = dependency.objid
                AND index_row.indrelid = source_table
                AND index_relation.relname IN (
                  'qr_code_pkey',
                  'qr_code_plant_id_key',
                  'qr_code_qr_code_key'
                )
            )
            OR dependency.objid =
              to_regclass(pg_get_serial_sequence('public.qr_code', 'qr_id'))
            OR EXISTS (
              SELECT 1
              FROM pg_class source
              JOIN pg_class storage ON storage.oid = source.reltoastrelid
              WHERE source.oid = source_table
                AND storage.oid = dependency.objid
                AND storage.relkind = 't'
            )
          )
        )
        OR (
          dependency.classid = 'pg_type'::regclass
          AND EXISTS (
            SELECT 1 FROM pg_type
            WHERE oid = dependency.objid AND typrelid = source_table
          )
        )
        OR (
          dependency.classid = 'pg_attrdef'::regclass
          AND EXISTS (
            SELECT 1 FROM pg_attrdef
            WHERE oid = dependency.objid AND adrelid = source_table
          )
        )
        OR (
          dependency.classid = 'pg_constraint'::regclass
          AND EXISTS (
            SELECT 1 FROM pg_constraint constraint_row
            WHERE constraint_row.oid = dependency.objid
              AND (
                (
                  constraint_row.conrelid = source_table
                  AND (
                    constraint_row.conname IN (
                      'qr_code_pkey',
                      'qr_code_plant_id_key',
                      'qr_code_qr_code_key',
                      'qr_code_plant_id_fkey'
                    )
                    OR (
                      constraint_row.contype = 'n'
                      AND cardinality(constraint_row.conkey) = 1
                      AND constraint_row.conkey[1] IN (
                        qr_id_attnum, qr_code_attnum, status_attnum, generated_at_attnum
                      )
                      AND constraint_row.convalidated
                      AND NOT constraint_row.condeferrable
                      AND EXISTS (
                        SELECT 1 FROM pg_attribute required_column
                        WHERE required_column.attrelid = source_table
                          AND required_column.attnum = constraint_row.conkey[1]
                          AND required_column.attnotnull
                          AND NOT required_column.attisdropped
                      )
                    )
                  )
                )
                OR (
                  constraint_row.conrelid = scan_history_table
                  AND constraint_row.conname = 'qr_scan_history_qr_id_fkey'
                  AND constraint_row.confrelid = source_table
                )
                OR (
                  constraint_row.conrelid = visitor_history_table
                  AND constraint_row.conname = 'visitor_scan_history_qr_id_fkey'
                  AND constraint_row.confrelid = source_table
                )
              )
          )
        )
        OR (
          dependency.classid = 'pg_trigger'::regclass
          AND EXISTS (
            SELECT 1
            FROM pg_trigger trigger_row
            JOIN pg_constraint constraint_row
              ON constraint_row.oid = trigger_row.tgconstraint
            WHERE trigger_row.oid = dependency.objid
              AND trigger_row.tgrelid = source_table
              AND trigger_row.tgisinternal
              AND (
                (
                  constraint_row.conrelid = source_table
                  AND constraint_row.conname IN (
                    'qr_code_pkey',
                    'qr_code_plant_id_key',
                    'qr_code_qr_code_key',
                    'qr_code_plant_id_fkey'
                  )
                )
                OR (
                  constraint_row.conrelid = scan_history_table
                  AND constraint_row.conname = 'qr_scan_history_qr_id_fkey'
                  AND constraint_row.confrelid = source_table
                )
                OR (
                  constraint_row.conrelid = visitor_history_table
                  AND constraint_row.conname = 'visitor_scan_history_qr_id_fkey'
                  AND constraint_row.confrelid = source_table
                )
              )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgreSQL catalog dependency on public.qr_code; manual review required';
  END IF;

    ALTER TABLE public.qr_code SET SCHEMA plant_app;

    -- The table move must retain the original relation object and all rows.
    IF to_regclass('public.qr_code') IS NOT NULL
       OR to_regclass('plant_app.qr_code') IS DISTINCT FROM source_table THEN
      RAISE EXCEPTION 'QR table OID/location postcondition failed';
    END IF;
    IF (SELECT count(*) FROM plant_app.qr_code) <> source_row_count
       OR (SELECT count(*) FROM plant_app.visitor_scan_history) <> visitor_row_count
       OR (SELECT count(*) FROM public.qr_scan_history) <> public_scan_row_count THEN
      RAISE EXCEPTION 'QR or history row-count postcondition failed';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class moved
      WHERE moved.oid = source_table
        AND moved.relowner = source_owner
        AND moved.relacl IS NOT DISTINCT FROM source_acl
        AND moved.relrowsecurity = source_rls_enabled
        AND moved.relforcerowsecurity = source_rls_forced
        AND NOT moved.relrowsecurity
        AND NOT moved.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'QR table owner, ACL, or RLS postcondition failed';
    END IF;

    -- Verify the outgoing QR-to-plant foreign key
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('plant_app.qr_code')
        AND c.conname = 'qr_code_plant_id_fkey'
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('plant_app.plant_record')
        AND c.confdeltype = 'n'
        AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'QR foreign key changed during the schema move';
    END IF;

    -- Verify both incoming QR foreign keys
    SELECT count(*) INTO incoming_foreign_key_count
    FROM pg_constraint
    WHERE confrelid = to_regclass('plant_app.qr_code')
      AND contype = 'f';

    IF incoming_foreign_key_count <> 2
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = to_regclass('public.qr_scan_history')
          AND c.conname = 'qr_scan_history_qr_id_fkey'
          AND c.contype = 'f'
          AND c.confrelid = to_regclass('plant_app.qr_code')
          AND c.conkey = ARRAY[scan_history_qr_id_attnum]::SMALLINT[]
          AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
          AND c.confdeltype = 'c'
          AND c.confupdtype = 'a'
          AND c.confmatchtype = 's'
          AND NOT c.condeferrable
          AND NOT c.condeferred
          AND c.convalidated
      )
      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = to_regclass('plant_app.visitor_scan_history')
          AND c.conname = 'visitor_scan_history_qr_id_fkey'
          AND c.contype = 'f'
          AND c.confrelid = to_regclass('plant_app.qr_code')
          AND c.conkey = ARRAY[visitor_history_qr_id_attnum]::SMALLINT[]
          AND c.confkey = ARRAY[qr_id_attnum]::SMALLINT[]
          AND c.confdeltype = 'n'
          AND c.confupdtype = 'a'
          AND c.confmatchtype = 's'
          AND NOT c.condeferrable
          AND NOT c.condeferred
          AND c.convalidated
      ) THEN
      RAISE EXCEPTION 'QR incoming foreign keys were not preserved';
    END IF;

    -- Verify the same identity sequence moved with its owner and ACL intact.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class sequence_row
      JOIN pg_namespace sequence_schema
        ON sequence_schema.oid = sequence_row.relnamespace
      WHERE sequence_row.oid =
          to_regclass(pg_get_serial_sequence('plant_app.qr_code', 'qr_id'))
        AND sequence_row.oid = identity_sequence
        AND sequence_row.relkind = 'S'
        AND sequence_schema.nspname = 'plant_app'
        AND sequence_row.relowner = identity_sequence_owner
        AND sequence_row.relacl IS NOT DISTINCT FROM identity_sequence_acl
        AND EXISTS (
          SELECT 1 FROM pg_depend dependency
          WHERE dependency.classid = 'pg_class'::regclass
            AND dependency.objid = sequence_row.oid
            AND dependency.refclassid = 'pg_class'::regclass
            AND dependency.refobjid = source_table
            AND dependency.refobjsubid = qr_id_attnum
            AND dependency.deptype = 'i'
        )
    ) THEN
      RAISE EXCEPTION 'QR identity sequence ownership/location/ACL postcondition failed';
    END IF;
  END;
  $$;

  COMMIT;
