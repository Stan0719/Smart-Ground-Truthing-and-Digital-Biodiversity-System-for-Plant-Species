-- QR migration 015 production preflight and security inventory.
-- READ ONLY: every executable statement in this file is SELECT.
-- Run only from an approved read-only production session. Do not paste the
-- session connection string or raw QR tokens into logs or the change record.
-- Run sections in order. If a required relation is absent, stop before running
-- later queries that name it and have the database owner review the result.

-- 1. Session identity and PostgreSQL version. Confirm target by approved
-- deployment metadata; do not use a copied connection string as evidence.
SELECT current_database() AS database_name,
       current_user AS current_role,
       session_user AS session_role,
       version() AS server_version,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;

-- 2. Required relations, owners, kind, persistence, RLS and forced RLS.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind,
       c.relpersistence,
       pg_get_userbyid(c.relowner) AS owner_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.reltuples::bigint AS planner_row_estimate
FROM (VALUES
  ('public','qr_code'),
  ('plant_app','qr_code'),
  ('plant_app','plant_record'),
  ('public','qr_scan_history'),
  ('plant_app','visitor_scan_history'),
  ('plant_app','schema_migration_history'),
  ('supabase_migrations','schema_migrations')
) expected(schema_name, relation_name)
LEFT JOIN pg_namespace n ON n.nspname=expected.schema_name
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.relation_name
ORDER BY expected.schema_name, expected.relation_name;

-- 3. QR column types, identity mode, defaults, and NOT NULL state.
SELECT a.attnum AS ordinal_position,
       a.attname AS column_name,
       format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       a.attidentity AS identity_code,
       pg_get_expr(d.adbin,d.adrelid) AS column_default
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname='qr_code'
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- 4. Plant parent key and QR/plant mapping diagnostics. Token values are not
-- returned; fingerprints allow comparison without displaying QR payloads.
SELECT p.plant_id,
       md5(p.qr_token) AS plant_token_fingerprint,
       length(p.qr_token) AS plant_token_length,
       p.rbac_status,
       p.registered_at,
       matched.qr_id AS exact_inventory_qr_id,
       matched.status AS exact_inventory_status,
       matched.generated_at,
       matched.assigned_at,
       matched.activated_at,
       matched.retired_at,
       token_match.qr_id AS token_matched_inventory_qr_id,
       token_match.plant_id AS token_matched_inventory_plant_id,
       plant_match.qr_id AS plant_matched_inventory_qr_id,
       md5(plant_match.qr_code) AS plant_matched_inventory_token_fingerprint
FROM plant_app.plant_record p
LEFT JOIN public.qr_code matched
  ON matched.plant_id=p.plant_id AND matched.qr_code=p.qr_token
LEFT JOIN public.qr_code token_match ON token_match.qr_code=p.qr_token
LEFT JOIN public.qr_code plant_match ON plant_match.plant_id=p.plant_id
WHERE p.plant_id IN (1,4)
ORDER BY p.plant_id;

-- 5. Duplicate plant tokens, duplicate inventory tokens, duplicate inventory
-- plant assignments, and all plant-to-inventory mismatches. Values are masked.
SELECT 'duplicate_plant_token' AS issue,
       md5(qr_token) AS token_fingerprint,
       count(*) AS row_count,
       array_agg(plant_id ORDER BY plant_id) AS plant_ids
FROM plant_app.plant_record
WHERE qr_token IS NOT NULL
GROUP BY qr_token HAVING count(*)>1
UNION ALL
SELECT 'duplicate_inventory_token', md5(qr_code), count(*), array_agg(qr_id ORDER BY qr_id)
FROM public.qr_code
GROUP BY qr_code HAVING count(*)>1
UNION ALL
SELECT 'duplicate_inventory_plant_assignment', NULL, count(*), array_agg(plant_id ORDER BY plant_id)
FROM public.qr_code
WHERE plant_id IS NOT NULL
GROUP BY plant_id HAVING count(*)>1
ORDER BY issue, token_fingerprint;

SELECT p.plant_id,
       md5(p.qr_token) AS plant_token_fingerprint,
       q_by_plant.qr_id AS qr_id_for_plant,
       md5(q_by_plant.qr_code) AS inventory_token_fingerprint_for_plant,
       q_by_token.qr_id AS qr_id_for_token,
       q_by_token.plant_id AS plant_id_for_token,
       q_by_token.status AS status_for_token
FROM plant_app.plant_record p
LEFT JOIN public.qr_code q_by_plant ON q_by_plant.plant_id=p.plant_id
LEFT JOIN public.qr_code q_by_token ON q_by_token.qr_code=p.qr_token
WHERE q_by_plant.qr_id IS NULL
   OR q_by_plant.qr_code IS DISTINCT FROM p.qr_token
   OR q_by_token.plant_id IS DISTINCT FROM p.plant_id
ORDER BY p.plant_id;

-- 6. Pre-move row count, status totals, and a content fingerprint. Fingerprint
-- includes full row contents but does not reveal token values.
SELECT count(*) AS qr_rows,
       count(*) FILTER (WHERE plant_id IS NOT NULL) AS assigned_rows,
       count(*) FILTER (WHERE plant_id IS NULL) AS unassigned_rows,
       count(*) FILTER (WHERE status='active') AS active_rows,
       count(*) FILTER (WHERE status='retired') AS retired_rows,
       md5(coalesce(string_agg(to_jsonb(q)::text,E'\n' ORDER BY qr_id),'')) AS row_fingerprint
FROM public.qr_code q;

-- 7. All foreign keys entering or leaving the source table, with full DDL and
-- update/delete actions. The expected source has one outgoing and two incoming.
SELECT cn.nspname||'.'||cc.relname AS constraint_table,
       c.conname,
       c.contype,
       rn.nspname||'.'||rc.relname AS referenced_table,
       c.convalidated,
       c.condeferrable,
       c.condeferred,
       c.confmatchtype,
       c.confupdtype,
       c.confdeltype,
       pg_get_constraintdef(c.oid,true) AS definition
FROM pg_constraint c
JOIN pg_class cc ON cc.oid=c.conrelid
JOIN pg_namespace cn ON cn.oid=cc.relnamespace
LEFT JOIN pg_class rc ON rc.oid=c.confrelid
LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
WHERE c.contype='f'
  AND (c.conrelid=to_regclass('public.qr_code')
       OR c.confrelid=to_regclass('public.qr_code'))
ORDER BY constraint_table,c.conname;

-- 8. Constraints and indexes on the QR table. Review exact definitions,
-- validity, readiness, uniqueness and backing-index names.
SELECT c.conname,
       c.contype,
       c.convalidated,
       c.condeferrable,
       c.condeferred,
       pg_get_constraintdef(c.oid,true) AS definition,
       index_class.relname AS backing_index
FROM pg_constraint c
LEFT JOIN pg_class index_class ON index_class.oid=c.conindid
WHERE c.conrelid=to_regclass('public.qr_code')
ORDER BY c.contype,c.conname;

SELECT index_class.relname AS index_name,
       i.indisprimary AS is_primary,
       i.indisunique AS is_unique,
       i.indisvalid AS is_valid,
       i.indisready AS is_ready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class index_class ON index_class.oid=i.indexrelid
WHERE i.indrelid=to_regclass('public.qr_code')
ORDER BY index_class.relname;

-- 9. Identity sequence location, owner dependency, sequence metadata, and
-- state. The final SELECT assumes the previously reviewed sequence name.
SELECT pg_get_serial_sequence('public.qr_code','qr_id') AS identity_sequence;

SELECT seq_ns.nspname AS sequence_schema,
       seq.relname AS sequence_name,
       pg_get_userbyid(seq.relowner) AS sequence_owner,
       dep.deptype AS ownership_dependency_type,
       table_ns.nspname||'.'||table_class.relname AS owned_by_table,
       column_attr.attname AS owned_by_column,
       ps.start_value,
       ps.increment_by,
       ps.min_value,
       ps.max_value,
       ps.cache_size,
       ps.cycle,
       ps.last_value
FROM pg_class seq
JOIN pg_namespace seq_ns ON seq_ns.oid=seq.relnamespace
LEFT JOIN pg_depend dep ON dep.classid='pg_class'::regclass AND dep.objid=seq.oid
  AND dep.refclassid='pg_class'::regclass AND dep.deptype IN ('a','i')
LEFT JOIN pg_class table_class ON table_class.oid=dep.refobjid
LEFT JOIN pg_namespace table_ns ON table_ns.oid=table_class.relnamespace
LEFT JOIN pg_attribute column_attr ON column_attr.attrelid=dep.refobjid
  AND column_attr.attnum=dep.refobjsubid
LEFT JOIN pg_sequences ps ON ps.schemaname=seq_ns.nspname AND ps.sequencename=seq.relname
WHERE seq.oid=to_regclass(pg_get_serial_sequence('public.qr_code','qr_id'));

-- Optional state read for the currently observed name. If the identity query
-- above returns a different name, adapt this SELECT only after review.
SELECT last_value,is_called FROM public.qr_code_qr_id_seq;

-- 10. Scan-history relationships and affected records. These queries return
-- IDs/status only; they do not return the QR token payload.
SELECT 'public.qr_scan_history' AS history_table,
       h.qr_id,
       NULL::bigint AS plant_reference,
       (q.qr_id IS NOT NULL) AS qr_reference_resolves,
       q.plant_id AS inventory_plant_id,
       q.status AS inventory_status
FROM public.qr_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id=h.qr_id
UNION ALL
SELECT 'plant_app.visitor_scan_history',
       h.qr_id,
       h.plant_reference,
       (q.qr_id IS NOT NULL),
       q.plant_id,
       q.status
FROM plant_app.visitor_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id=h.qr_id
WHERE h.qr_id IS NOT NULL
  AND (h.plant_id IN (1,4) OR h.plant_reference IN (1,4) OR q.plant_id IN (1,4))
ORDER BY history_table,qr_id;

SELECT 'public.qr_scan_history' AS history_table,
       count(*) AS history_rows,
       count(*) FILTER (WHERE h.qr_id IS NOT NULL AND q.qr_id IS NULL) AS orphan_qr_ids
FROM public.qr_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id=h.qr_id
UNION ALL
SELECT 'plant_app.visitor_scan_history',
       count(*),
       count(*) FILTER (WHERE h.qr_id IS NOT NULL AND q.qr_id IS NULL)
FROM plant_app.visitor_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id=h.qr_id
ORDER BY history_table;

-- 11. Views, rules, user triggers, inheritance/partition links and catalog
-- dependencies that migration 015 may not safely relocate.
SELECT view_ns.nspname||'.'||view_class.relname AS dependent_view,
       view_class.relkind,
       rw.rulename,
       pg_get_viewdef(view_class.oid,true) AS definition
FROM pg_rewrite rw
JOIN pg_class view_class ON view_class.oid=rw.ev_class
JOIN pg_namespace view_ns ON view_ns.oid=view_class.relnamespace
JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
WHERE d.refclassid='pg_class'::regclass
  AND d.refobjid=to_regclass('public.qr_code')
ORDER BY dependent_view,rw.rulename;

SELECT tgname,pg_get_triggerdef(oid,true) AS definition
FROM pg_trigger
WHERE tgrelid=to_regclass('public.qr_code') AND NOT tgisinternal
ORDER BY tgname;

SELECT inhparent::regclass AS parent_relation, inhrelid::regclass AS child_relation
FROM pg_inherits
WHERE inhparent=to_regclass('public.qr_code') OR inhrelid=to_regclass('public.qr_code');

-- Function bodies are not always dependency-tracked (for example, dynamic SQL
-- or PL/pgSQL text). Return matching function identities and reference flags,
-- not function bodies, which could contain sensitive literals.
SELECT n.nspname AS function_schema,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       l.lanname AS language_name,
       position('public.qr_code' in lower(pg_get_functiondef(p.oid)))>0 AS references_public_qr_code,
       position('qr_code' in lower(pg_get_functiondef(p.oid)))>0 AS contains_qr_code_reference
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_language l ON l.oid=p.prolang
WHERE p.prokind IN ('f','p')
  AND (position('qr_code' in lower(p.prosrc))>0
       OR p.prokind='f' AND position('qr_code' in lower(pg_get_functiondef(p.oid)))>0)
ORDER BY n.nspname,p.proname,identity_arguments;

-- 12. RLS flags and policies for the source and related tables.
SELECT n.nspname AS schema_name,c.relname AS table_name,
       c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname,c.relname) IN
  (('public','qr_code'),('public','qr_scan_history'),
   ('plant_app','visitor_scan_history'),('plant_app','plant_record'))
ORDER BY n.nspname,c.relname;

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies
WHERE (schemaname,tablename) IN
  (('public','qr_code'),('public','qr_scan_history'),
   ('plant_app','visitor_scan_history'),('plant_app','plant_record'))
ORDER BY schemaname,tablename,policyname;

-- 13. Raw ACL entries and effective privileges for all database roles. Review
-- the identified backend runtime role separately; current_user may be the DBA.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       pg_get_userbyid(x.grantor) AS grantor,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
       x.privilege_type,
       x.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee
WHERE (n.nspname,c.relname) IN
  (('public','qr_code'),('plant_app','plant_record'),
   ('plant_app','visitor_scan_history'),('public','qr_scan_history'))
ORDER BY n.nspname,c.relname,grantee,x.privilege_type;

SELECT n.nspname AS schema_name,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
       x.privilege_type,x.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x
LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee
WHERE n.nspname IN ('public','plant_app')
ORDER BY n.nspname,grantee,x.privilege_type;

SELECT r.rolname,
       r.rolcanlogin,
       r.rolsuper,
       r.rolbypassrls,
       pg_has_schema_privilege(r.rolname,'public','USAGE') AS public_usage,
       pg_has_schema_privilege(r.rolname,'plant_app','USAGE') AS plant_app_usage,
       has_table_privilege(r.rolname,'public.qr_code','SELECT') AS qr_select,
       has_table_privilege(r.rolname,'public.qr_code','INSERT') AS qr_insert,
       has_table_privilege(r.rolname,'public.qr_code','UPDATE') AS qr_update,
       has_table_privilege(r.rolname,'public.qr_code','DELETE') AS qr_delete,
       has_table_privilege(r.rolname,'plant_app.plant_record','SELECT') AS plant_select,
       has_table_privilege(r.rolname,'plant_app.plant_record','INSERT') AS plant_insert,
       has_table_privilege(r.rolname,'plant_app.plant_record','UPDATE') AS plant_update,
       has_table_privilege(r.rolname,'plant_app.plant_record','DELETE') AS plant_delete,
       has_table_privilege(r.rolname,'plant_app.visitor_scan_history','SELECT') AS visitor_history_select,
       has_table_privilege(r.rolname,'plant_app.visitor_scan_history','INSERT') AS visitor_history_insert,
       has_sequence_privilege(r.rolname,'public.qr_code_qr_id_seq','USAGE') AS qr_sequence_usage,
       has_sequence_privilege(r.rolname,'plant_app.visitor_scan_history_scan_id_seq','USAGE') AS visitor_sequence_usage
FROM pg_roles r
ORDER BY r.rolname;

-- Role membership edges and inheritance/admin options.
SELECT member_role.rolname AS member_role,
       granted_role.rolname AS granted_role,
       m.admin_option
FROM pg_auth_members m
JOIN pg_roles member_role ON member_role.oid=m.member
JOIN pg_roles granted_role ON granted_role.oid=m.roleid
ORDER BY member_role.rolname,granted_role.rolname;

-- 14. PostgREST schema exposure hints available in PostgreSQL settings.
-- Dashboard/API settings remain a required manual verification.
SELECT current_setting('pgrst.db_schemas',true) AS pgrst_db_schemas,
       current_setting('pgrst.db_extra_search_path',true) AS pgrst_extra_search_path;

SELECT coalesce(r.rolname,'ALL_ROLES') AS applies_to_role,
       setting_row.setdatabase,
       setting_name.setting
FROM pg_db_role_setting setting_row
LEFT JOIN pg_roles r ON setting_row.setrole=r.oid
CROSS JOIN LATERAL unnest(setting_row.setconfig) AS setting_name(setting)
WHERE (setting_row.setdatabase=0 OR setting_row.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()))
  AND split_part(setting_name.setting,'=',1) IN ('pgrst.db_schemas','pgrst.db_extra_search_path')
ORDER BY applies_to_role,setting_row.setdatabase,setting_name.setting;

-- 15. Migration-ledger presence and structure (does not assume either ledger
-- exists). If a ledger is present, inspect its rows in a separately reviewed
-- SELECT using only columns confirmed by the structure result.
SELECT table_schema,table_name,column_name,ordinal_position,data_type,is_nullable
FROM information_schema.columns
WHERE (table_schema='plant_app' AND table_name='schema_migration_history')
   OR (table_schema='supabase_migrations' AND table_name='schema_migrations')
ORDER BY table_schema,table_name,ordinal_position;
