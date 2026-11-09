-- READ ONLY: run these SELECT statements in Supabase SQL Editor and retain results.
-- Target is explicitly plant_app. Do not run any migration from this file.
-- SQL Editor's role may differ from the backend runtime role: verify BOTH contexts.

SELECT current_database() AS database_name,current_user AS inspecting_role,
       session_user,current_schema(),current_setting('search_path') AS search_path,
       to_regnamespace('plant_app') IS NOT NULL AS plant_app_exists;

-- Prerequisites and both migrations: authoritative deployed column types/defaults.
SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,
       is_identity,identity_generation
FROM information_schema.columns
WHERE table_schema='plant_app'
  AND table_name IN ('species','plant_asset','plant_record','plant_observation',
    'rbac_species_visibility','species_request_submission','plant_submission_receipt',
    'record_change_submission','record_version_history','species_image_collection',
    'species_image_reference','species_image_arrangement_history',
    'plant_asset_photo_role','species_request_proposed_image')
ORDER BY table_name,ordinal_position;

-- Presence alone is not proof of a complete migration. Compare every definition
-- against 014 and 015, including FKs, deferred ordering and removal CHECKs.
SELECT c.relname AS table_name,k.conname,k.contype,k.convalidated,
       k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k
JOIN pg_class c ON c.oid=k.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='plant_app'
ORDER BY c.relname,k.conname;

SELECT c.relname AS table_name,ci.relname AS index_name,i.indisunique,
       i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='plant_app'
ORDER BY c.relname,ci.relname;

SELECT c.relname AS table_name,t.tgname,t.tgenabled,
       pg_get_triggerdef(t.oid) AS trigger_definition,
       pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='plant_app' AND NOT t.tgisinternal
ORDER BY c.relname,t.tgname;

SELECT p.proname,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='plant_app'
  AND p.proname IN ('species_image_history_immutable','validate_photo_role_origin');

-- RLS and backend grants: do not add or modify a policy during verification.
SELECT c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS owner,
       has_table_privilege(c.oid,'SELECT') AS inspector_can_select,
       has_table_privilege(c.oid,'INSERT') AS inspector_can_insert,
       has_table_privilege(c.oid,'UPDATE') AS inspector_can_update
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='plant_app' AND c.relkind='r'
ORDER BY c.relname;

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='plant_app' ORDER BY tablename,policyname;

SELECT grantee,table_name,privilege_type,is_grantable
FROM information_schema.role_table_grants
WHERE table_schema='plant_app' ORDER BY grantee,table_name,privilege_type;

SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolinherit
FROM pg_roles r
WHERE r.rolname=current_user OR r.oid IN (
  SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='plant_app'
);

SELECT n.nspname AS schema_name,pg_get_userbyid(n.nspowner) AS owner,
       has_schema_privilege(n.oid,'USAGE') AS inspector_can_use
FROM pg_namespace n WHERE n.nspname='plant_app';

SELECT c.relname AS sequence_name,has_sequence_privilege(c.oid,'USAGE') AS inspector_can_use
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='plant_app' AND c.relkind='S' ORDER BY c.relname;

-- Inventory, NOT migration certification. A missing subset means partial presence;
-- complete presence still needs all type/constraint/trigger/index/RLS/grant checks above.
SELECT expected.migration,expected.object_name,
       to_regclass('plant_app.' || expected.object_name) IS NOT NULL AS present
FROM (VALUES
 ('014','species_image_collection'),('014','species_image_reference'),
 ('014','species_image_arrangement_history'),('014','species_image_primary'),
 ('015','plant_asset_photo_role'),('015','species_request_proposed_image'),
 ('015','species_photo_plant_source'),('015','species_photo_approved_observation'),
 ('015','species_photo_direct_order'),('015','species_photo_evidence_order'),
 ('015','species_photo_whole_plant')) expected(migration,object_name)
ORDER BY migration,object_name;

-- Resolve every FK endpoint and type from the catalogs, including the existing
-- INTEGER approved_species_id -> BIGINT species_id relationship. A matching
-- definition must also have convalidated=true. No result means no such FK.
SELECT k.conname,k.convalidated,
       ns.nspname AS child_schema,c.relname AS child_table,a.attname AS child_column,
       format_type(a.atttypid,a.atttypmod) AS child_type,
       pn.nspname AS parent_schema,p.relname AS parent_table,pa.attname AS parent_column,
       format_type(pa.atttypid,pa.atttypmod) AS parent_type,
       pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k
JOIN pg_class c ON c.oid=k.conrelid
JOIN pg_namespace ns ON ns.oid=c.relnamespace
JOIN pg_class p ON p.oid=k.confrelid
JOIN pg_namespace pn ON pn.oid=p.relnamespace
CROSS JOIN LATERAL generate_subscripts(k.conkey,1) AS key_position(i)
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[key_position.i]
JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=k.confkey[key_position.i]
WHERE k.contype='f' AND (ns.nspname='plant_app' OR pn.nspname='plant_app')
ORDER BY child_schema,child_table,k.conname,key_position.i;

-- Find same-named migration relations/functions in other schemas. Do not treat
-- objects in public (or another schema) as an applied plant_app migration.
SELECT n.nspname AS schema_name,c.relname AS object_name,c.relkind::text AS kind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname IN ('species_image_collection','species_image_reference',
  'species_image_arrangement_history','species_image_primary','plant_asset_photo_role',
  'species_request_proposed_image','species_photo_plant_source',
  'species_photo_approved_observation','species_photo_direct_order',
  'species_photo_evidence_order','species_photo_whole_plant')
UNION ALL
SELECT n.nspname,p.proname,'function'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.proname IN ('species_image_history_immutable','validate_photo_role_origin')
ORDER BY schema_name,object_name;

-- Current range is a separate application compatibility check. Decimal strings
-- keep these aggregate IDs exact in clients. These are not migration readiness
-- booleans, and small current IDs do not establish future sequence safety.
SELECT 'species' AS source,min(species_id)::text AS minimum_id,
       max(species_id)::text AS maximum_id,
       count(*) FILTER (WHERE species_id>2147483647) AS beyond_int32,
       count(*) FILTER (WHERE species_id>9007199254740991) AS beyond_js_safe
FROM plant_app.species
UNION ALL
SELECT 'plant_record',min(plant_id)::text,max(plant_id)::text,
       count(*) FILTER (WHERE plant_id>2147483647),
       count(*) FILTER (WHERE plant_id>9007199254740991)
FROM plant_app.plant_record;

SELECT count(*) FILTER (WHERE sr.approved_species_id IS NOT NULL AND approved.species_id IS NULL)
         AS orphan_approved_references,
       count(*) FILTER (WHERE sr.proposed_species_id IS NOT NULL AND proposed.species_id IS NULL)
         AS orphan_proposed_references
FROM plant_app.species_request_submission sr
LEFT JOIN plant_app.species approved ON approved.species_id=sr.approved_species_id
LEFT JOIN plant_app.species proposed ON proposed.species_id=sr.proposed_species_id;

-- Sequence values require inspection privileges; NULL last_value is inconclusive.
SELECT schemaname,sequencename,data_type,start_value::text,increment_by::text,
       max_value::text,last_value::text,cycle
FROM pg_sequences WHERE schemaname='plant_app' ORDER BY sequencename;
