"use strict";

const { createHash } = require("node:crypto");

const POST_015_RECOGNITION_SQL = `
WITH qr AS (
  SELECT to_regclass('plant_app.qr_code') AS oid
), expected_columns(name, type_name, type_mod, not_null, identity_mode) AS (
  VALUES
    ('qr_id', 'bigint', -1, true, 'a'),
    ('plant_id', 'bigint', -1, false, ''),
    ('qr_code', 'text', -1, true, ''),
    ('status', 'character varying', 34, true, ''),
    ('generated_at', 'timestamp with time zone', -1, true, ''),
    ('assigned_at', 'timestamp with time zone', -1, false, ''),
    ('activated_at', 'timestamp with time zone', -1, false, ''),
    ('retired_at', 'timestamp with time zone', -1, false, '')
), column_check AS (
  SELECT count(*) = 8 AND bool_and(
    format_type(a.atttypid, a.atttypmod) = e.type_name ||
      CASE WHEN e.type_mod = 34 THEN '(30)' ELSE '' END
    AND a.attnotnull = e.not_null
    AND a.attidentity::text = e.identity_mode
  ) AND (SELECT count(*)=8 FROM pg_attribute all_columns
    JOIN qr table_ref ON table_ref.oid=all_columns.attrelid
    WHERE all_columns.attnum>0 AND NOT all_columns.attisdropped) AS valid
  FROM expected_columns e
  JOIN qr ON qr.oid IS NOT NULL
  JOIN pg_attribute a ON a.attrelid = qr.oid AND a.attname = e.name
    AND a.attnum > 0 AND NOT a.attisdropped
), default_check AS (
  SELECT
    EXISTS (
      SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
        ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=qr.oid AND a.attname='status'
        AND lower(pg_get_expr(d.adbin,d.adrelid)) = '''generated''::character varying'
    ) AND EXISTS (
      SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
        ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=qr.oid AND a.attname='generated_at'
        AND lower(pg_get_expr(d.adbin,d.adrelid)) = 'current_timestamp'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_attrdef d JOIN pg_attribute a
        ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid=qr.oid AND a.attname IN
        ('plant_id','qr_code','assigned_at','activated_at','retired_at')
    ) AS valid
  FROM qr
), index_check AS (
  SELECT (SELECT count(*)=3 FROM pg_index all_indexes WHERE all_indexes.indrelid=qr.oid)
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('qr_code_pkey','qr_id',true,'int8_ops'),
        ('qr_code_plant_id_key','plant_id',false,'int8_ops'),
        ('qr_code_qr_code_key','qr_code',false,'text_ops')
      ) e(index_name,column_name,is_primary,opclass)
      LEFT JOIN pg_class index_row ON index_row.relname=e.index_name
        AND index_row.relnamespace=(SELECT relnamespace FROM pg_class WHERE oid=qr.oid)
      LEFT JOIN pg_index i ON i.indexrelid=index_row.oid AND i.indrelid=qr.oid
      LEFT JOIN pg_am am ON am.oid=index_row.relam
      LEFT JOIN pg_attribute a ON a.attrelid=qr.oid AND a.attname=e.column_name
      LEFT JOIN pg_opclass opc ON opc.oid=i.indclass[0]
      LEFT JOIN pg_namespace opn ON opn.oid=opc.opcnamespace
      WHERE i.indexrelid IS NULL OR NOT i.indisunique OR NOT i.indisvalid OR NOT i.indisready
        OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
        OR i.indnkeyatts<>1 OR i.indnatts<>1
        OR i.indkey[0]<>a.attnum OR i.indisprimary IS DISTINCT FROM e.is_primary
        OR am.amname IS DISTINCT FROM 'btree' OR opc.opcname IS DISTINCT FROM e.opclass
        OR opn.nspname IS DISTINCT FROM 'pg_catalog' OR opc.opcdefault IS DISTINCT FROM TRUE
        OR i.indcollation[0] IS DISTINCT FROM a.attcollation
        OR i.indoption[0] IS DISTINCT FROM 0 OR i.indnullsnotdistinct IS DISTINCT FROM FALSE
    ) AS valid
  FROM qr
), constraint_check AS (
  SELECT
    (SELECT count(*)=4 FROM pg_constraint c WHERE c.conrelid=qr.oid
      AND c.contype IN ('p','u','f'))
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=qr.oid
      AND c.contype NOT IN ('p','u','f','n'))
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('qr_code_pkey','p','qr_id','qr_code_pkey'),
        ('qr_code_plant_id_key','u','plant_id','qr_code_plant_id_key'),
        ('qr_code_qr_code_key','u','qr_code','qr_code_qr_code_key')
      ) e(name,kind,column_name,index_name)
      LEFT JOIN pg_constraint c ON c.conrelid=qr.oid AND c.conname=e.name
      LEFT JOIN pg_attribute a ON a.attrelid=qr.oid AND a.attname=e.column_name
      LEFT JOIN pg_class backing ON backing.oid=c.conindid
      WHERE c.oid IS NULL OR c.contype<>e.kind
        OR c.conkey IS DISTINCT FROM ARRAY[a.attnum]::smallint[]
        OR NOT c.convalidated OR c.condeferrable OR c.condeferred
        OR backing.relname IS DISTINCT FROM e.index_name
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=qr.oid AND a.attname='plant_id'
      JOIN pg_attribute parent_col ON parent_col.attrelid=c.confrelid
        AND parent_col.attname='plant_id' AND parent_col.attnotnull
      WHERE c.conrelid=qr.oid AND c.conname='qr_code_plant_id_fkey'
        AND c.contype='f' AND c.conkey=ARRAY[a.attnum]::smallint[]
        AND c.confrelid=to_regclass('plant_app.plant_record')
        AND parent_col.atttypid='bigint'::regtype
        AND c.confkey=ARRAY[parent_col.attnum]::smallint[]
        AND c.confdeltype='n' AND c.confupdtype='a' AND c.confmatchtype='s'
        AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
    ) AS valid
  FROM qr
), incoming_check AS (
  SELECT (SELECT count(*)=2 FROM pg_constraint c
      WHERE c.confrelid=qr.oid AND c.contype='f')
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.confrelid=qr.oid AND c.contype='f'
        AND NOT (c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
          AND c.confupdtype='a' AND c.confmatchtype='s'
          AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute
            WHERE attrelid=qr.oid AND attname='qr_id')]::smallint[]
          AND ((c.conname='qr_scan_history_qr_id_fkey'
              AND c.conrelid=to_regclass('public.qr_scan_history')
              AND c.confdeltype='c'
              AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
                WHERE attrelid=c.conrelid AND attname='qr_id')]::smallint[])
            OR (c.conname='visitor_scan_history_qr_id_fkey'
              AND c.conrelid=to_regclass('plant_app.visitor_scan_history')
              AND c.confdeltype='n'
              AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
                WHERE attrelid=c.conrelid AND attname='qr_id')]::smallint[])))
    ) AS valid
  FROM qr
), sequence_check AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_class seq JOIN pg_namespace n ON n.oid=seq.relnamespace
    JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=seq.oid
      AND d.refclassid='pg_class'::regclass AND d.refobjid=qr.oid
      AND d.refobjsubid=(SELECT attnum FROM pg_attribute
        WHERE attrelid=qr.oid AND attname='qr_id') AND d.deptype='i'
    WHERE seq.oid=to_regclass(pg_get_serial_sequence('plant_app.qr_code','qr_id'))
      AND seq.relkind='S' AND n.nspname='plant_app'
  ) AS valid FROM qr
)
SELECT to_regclass('public.qr_code') IS NULL AS source_absent,
  qr.oid IS NOT NULL AS destination_present,
  (SELECT relkind='r' FROM pg_class WHERE oid=qr.oid) AS regular_table,
  (SELECT valid FROM column_check) AS reviewed_columns,
  (SELECT valid FROM default_check) AS reviewed_defaults,
  (SELECT valid FROM index_check) AS reviewed_indexes,
  (SELECT valid FROM constraint_check) AS reviewed_constraints,
  (SELECT valid FROM incoming_check) AS reviewed_incoming_foreign_keys,
  (SELECT valid FROM sequence_check) AS sequence_owned_in_plant_app
FROM qr;
`;

const MIGRATION_003_STATE_SQL = `
WITH plant_state AS (
  SELECT p.plant_id, p.qr_token,
    EXISTS (SELECT 1 FROM plant_app.qr_code q
      WHERE q.plant_id=p.plant_id AND q.qr_code=p.qr_token
        AND q.status=CASE WHEN p.rbac_status='Approved' THEN 'active' ELSE 'assigned' END
        AND q.generated_at=p.registered_at AND q.assigned_at=p.registered_at
        AND q.activated_at IS NOT DISTINCT FROM
          CASE WHEN p.rbac_status='Approved' THEN p.registered_at ELSE NULL END
    ) AS matched,
    EXISTS (SELECT 1 FROM plant_app.qr_code q
      WHERE q.plant_id=p.plant_id AND (
        q.qr_code IS DISTINCT FROM p.qr_token
        OR q.status IS DISTINCT FROM CASE WHEN p.rbac_status='Approved' THEN 'active' ELSE 'assigned' END
        OR q.generated_at IS DISTINCT FROM p.registered_at
        OR q.assigned_at IS DISTINCT FROM p.registered_at
        OR q.activated_at IS DISTINCT FROM CASE WHEN p.rbac_status='Approved' THEN p.registered_at ELSE NULL END
      ))
      AS plant_mismatch,
    EXISTS (SELECT 1 FROM plant_app.qr_code q
      WHERE q.qr_code=p.qr_token AND q.plant_id IS DISTINCT FROM p.plant_id)
      AS token_mismatch
  FROM plant_app.plant_record p
), duplicate_tokens AS (
  SELECT count(*) AS n FROM (
    SELECT qr_token FROM plant_app.plant_record
    WHERE qr_token IS NOT NULL GROUP BY qr_token HAVING count(*)>1
  ) d
), invalid_source AS (
  SELECT count(*) AS n FROM plant_app.plant_record
  WHERE qr_token IS NULL OR registered_at IS NULL
)
SELECT (SELECT count(*) FROM plant_state)::int AS plant_count,
  (SELECT count(*) FROM plant_state WHERE matched)::int AS matched_count,
  (SELECT count(*) FROM plant_state WHERE plant_mismatch OR token_mismatch)::int AS mismatch_count,
  (SELECT n FROM duplicate_tokens)::int AS duplicate_token_groups,
  (SELECT n FROM invalid_source)::int AS invalid_source_count,
  to_regclass('public.plant_record') IS NOT NULL AS public_plant_exists
`;

const MIGRATION_003_PUBLIC_CHECK_SQL = `
SELECT count(*)::int AS mismatch_count FROM plant_app.plant_record a
LEFT JOIN public.plant_record p ON p.plant_id=a.plant_id
WHERE p.plant_id IS NULL OR p.species_id IS DISTINCT FROM a.species_id
`;

function checksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

function classifyQrInventory003(state) {
  const plants = Number(state.plant_count);
  const matched = Number(state.matched_count);
  if (
    Number(state.mismatch_count) !== 0 ||
    Number(state.duplicate_token_groups) !== 0 ||
    Number(state.invalid_source_count ?? 0) !== 0 ||
    Number(state.public_mismatch_count ?? 0) !== 0
  ) return "ambiguous";
  if (plants > 0 && matched === plants) return "complete";
  if (plants > 0 && matched === 0) return "not-applied";
  return "ambiguous";
}

function isPost015Catalog(shape) {
  return Boolean(shape?.source_absent && shape?.destination_present &&
    shape?.regular_table && shape?.reviewed_columns && shape?.reviewed_defaults &&
    shape?.reviewed_indexes && shape?.reviewed_constraints &&
    shape?.reviewed_incoming_foreign_keys && shape?.sequence_owned_in_plant_app);
}

function validateHistory(rows, knownChecksums) {
  const byName = new Map(rows.map((row) => [row.migration_name, row]));
  for (const row of rows) {
    if (!Object.hasOwn(knownChecksums, row.migration_name))
      throw Error(`Unknown migration history entry: ${row.migration_name}`);
    if (row.migration_checksum !== knownChecksums[row.migration_name])
      throw Error(`Migration history checksum needs operator review: ${row.migration_name}`);
    if (!["executed", "recognized", "superseded"].includes(row.resolution))
      throw Error(`Migration history resolution needs operator review: ${row.migration_name}`);
    if (row.resolution === "executed" && (!row.executed_at || row.recognized_at || row.superseded_by))
      throw Error(`Invalid executed migration history entry: ${row.migration_name}`);
    if (row.resolution === "recognized" && (!row.recognized_at || row.executed_at || row.superseded_by))
      throw Error(`Invalid recognized migration history entry: ${row.migration_name}`);
    if (row.resolution === "superseded" &&
        (row.migration_name !== "014-move-qr-code-to-plant-app.sql" ||
         !row.recognized_at || row.executed_at ||
         row.superseded_by !== "015-local-qr-only-move.sql"))
      throw Error(`Invalid superseded migration history entry: ${row.migration_name}`);
    if (row.resolution === "recognized" &&
        !["003-plant-qr-inventory.sql", "015-local-qr-only-move.sql"].includes(row.migration_name))
      throw Error(`Invalid recognized migration history entry: ${row.migration_name}`);
  }
  const oldMove = byName.get("014-move-qr-code-to-plant-app.sql");
  if (oldMove?.resolution === "superseded" &&
      byName.get("015-local-qr-only-move.sql")?.resolution !== "recognized")
    throw Error("Migration 014 supersession lacks recognized migration 015 history.");
  return byName;
}

module.exports = {
  MIGRATION_003_STATE_SQL,
  MIGRATION_003_PUBLIC_CHECK_SQL,
  POST_015_RECOGNITION_SQL,
  checksum,
  classifyQrInventory003,
  isPost015Catalog,
  validateHistory,
};
