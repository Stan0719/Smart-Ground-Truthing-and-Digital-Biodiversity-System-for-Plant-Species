
-- READ-ONLY REVIEW QUERIES ONLY.
-- Run on the backend's real PostgreSQL connection for the current_user check.
-- No QR token values are selected and no SQL here changes database state.

-- 1. Establish actual session identity on the connection being audited.
SELECT current_database() AS database_name,
       session_user AS login_role,
       current_user AS effective_role,
       current_setting('search_path') AS search_path;


-- 2. Effective privileges for this actual connection.
-- Detects qr_code and its identity sequence in either schema.
WITH objects AS (
  SELECT
    COALESCE(
      to_regclass('plant_app.qr_code'),
      to_regclass('public.qr_code')
    ) AS qr_table,
    COALESCE(
      to_regclass('plant_app.qr_code_qr_id_seq'),
      to_regclass('public.qr_code_qr_id_seq')
    ) AS qr_sequence,
    to_regclass('plant_app.visitor_scan_history') AS visitor_history
)
SELECT current_user AS effective_role,
       qr_table::regclass AS qr_table_location,
       qr_sequence::regclass AS qr_sequence_location,
       has_schema_privilege(current_user, 'plant_app', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'plant_app', 'CREATE') AS schema_create,
       CASE WHEN qr_table IS NULL THEN NULL
            ELSE has_table_privilege(current_user, qr_table, 'SELECT') END AS qr_select,
       CASE WHEN qr_table IS NULL THEN NULL
            ELSE has_table_privilege(current_user, qr_table, 'INSERT') END AS qr_insert,
       CASE WHEN qr_table IS NULL THEN NULL
            ELSE has_table_privilege(current_user, qr_table, 'UPDATE') END AS qr_update,
       CASE WHEN qr_table IS NULL THEN NULL
            ELSE has_table_privilege(current_user, qr_table, 'DELETE') END AS qr_delete,
       CASE WHEN qr_sequence IS NULL THEN NULL
            ELSE has_sequence_privilege(current_user, qr_sequence, 'USAGE') END AS qr_sequence_usage,
       CASE WHEN qr_sequence IS NULL THEN NULL
            ELSE has_sequence_privilege(current_user, qr_sequence, 'SELECT') END AS qr_sequence_select,
       CASE WHEN visitor_history IS NULL THEN NULL
            ELSE has_table_privilege(current_user, visitor_history, 'SELECT') END AS history_select,
       CASE WHEN visitor_history IS NULL THEN NULL
            ELSE has_table_privilege(current_user, visitor_history, 'INSERT') END AS history_insert
FROM objects;


-- 3. Effective access for Supabase API roles, if those roles exist.
-- Diagnostic only; does not grant or revoke anything.
WITH objects AS (
  SELECT
    COALESCE(
      to_regclass('plant_app.qr_code'),
      to_regclass('public.qr_code')
    ) AS qr_table,
    COALESCE(
      to_regclass('plant_app.qr_code_qr_id_seq'),
      to_regclass('public.qr_code_qr_id_seq')
    ) AS qr_sequence
)
SELECT r.rolname AS api_role,
       has_schema_privilege(r.rolname, 'plant_app', 'USAGE') AS plant_app_schema_usage,
       CASE WHEN o.qr_table IS NULL THEN NULL
            ELSE has_table_privilege(r.rolname, o.qr_table, 'SELECT') END AS qr_select,
       CASE WHEN o.qr_table IS NULL THEN NULL
            ELSE has_table_privilege(r.rolname, o.qr_table, 'INSERT') END AS qr_insert,
       CASE WHEN o.qr_table IS NULL THEN NULL
            ELSE has_table_privilege(r.rolname, o.qr_table, 'UPDATE') END AS qr_update,
       CASE WHEN o.qr_table IS NULL THEN NULL
            ELSE has_table_privilege(r.rolname, o.qr_table, 'DELETE') END AS qr_delete,
       CASE WHEN o.qr_sequence IS NULL THEN NULL
            ELSE has_sequence_privilege(r.rolname, o.qr_sequence, 'USAGE') END AS qr_sequence_usage
FROM pg_roles r
CROSS JOIN objects o
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;


-- 4. Raw object owner/ACL and RLS flags.
-- ACL output contains role/grant metadata only, not QR token data.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relacl AS explicit_acl,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN
      (('plant_app', 'qr_code'), ('public', 'qr_code'),
       ('plant_app', 'visitor_scan_history'), ('public', 'qr_scan_history'))
  AND c.relkind IN ('r', 'p')
ORDER BY n.nspname, c.relname;


-- 4A. Identity sequence configuration.
-- Does not call nextval() or change sequence state.
SELECT n.nspname AS sequence_schema,
       c.relname AS sequence_name,
       pg_get_userbyid(c.relowner) AS owner,
       s.seqstart AS start_value,
       s.seqincrement AS increment_by,
       s.seqmin AS minimum_value,
       s.seqmax AS maximum_value,
       s.seqcache AS cache_size,
       s.seqcycle AS cycle_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_sequence s ON s.seqrelid = c.oid
WHERE c.relname = 'qr_code_qr_id_seq'
  AND c.relkind = 'S';

-- 4C. Current identity sequence state.
-- Reading last_value and is_called does not advance the sequence.
SELECT last_value, is_called
FROM public.qr_code_qr_id_seq;

-- 4B. Column-level privileges for qr_code in either schema.
SELECT table_schema,
       table_name,
       grantee,
       privilege_type,
       is_grantable,
       column_name
FROM information_schema.column_privileges
WHERE table_schema IN ('public', 'plant_app')
  AND table_name = 'qr_code'
ORDER BY table_schema, grantee, column_name, privilege_type;


-- 5. Supabase/PostgREST schema settings visible from PostgreSQL, where set.
-- These values may be absent or incomplete when the platform manages exposure
-- outside database GUCs. The Dashboard's Data API > Exposed schemas setting is
-- authoritative and must also be checked by an authorized project operator.
SELECT current_setting('pgrst.db_schemas', true) AS session_postgrest_schemas;

SELECT COALESCE(d.datname, '(all databases)') AS database_scope,
       COALESCE(r.rolname, '(all roles)') AS role_scope,
       setting.config_entry AS postgrest_schema_setting
FROM pg_db_role_setting s
LEFT JOIN pg_database d ON d.oid = s.setdatabase
LEFT JOIN pg_roles r ON r.oid = s.setrole
CROSS JOIN LATERAL unnest(s.setconfig) AS setting(config_entry)
WHERE split_part(setting.config_entry, '=', 1) = 'pgrst.db_schemas'
ORDER BY database_scope, role_scope;



-- 6. Count-only production preservation baseline.
-- Current production location: public.qr_code.
-- No QR token values are returned.

SELECT 'public.qr_code' AS relation_name, count(*) AS row_count
FROM public.qr_code

UNION ALL

SELECT 'plant_app.visitor_scan_history', count(*)
FROM plant_app.visitor_scan_history

UNION ALL

SELECT 'public.qr_scan_history', count(*)
FROM public.qr_scan_history;

