-- Run against the existing PostgreSQL database, never against a replacement database.
-- Metadata only. No application rows, password hashes, or connection strings.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT jsonb_pretty(jsonb_build_object(
  'format_version', 1,
  'tables', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  ) t), '[]'::jsonb),
  'columns', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (
    SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable,
           is_identity, identity_generation, is_generated
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  ) c), '[]'::jsonb),
  'constraints', COALESCE((SELECT jsonb_agg(to_jsonb(k)) FROM (
    SELECT n.nspname AS table_schema, c.relname AS table_name,
           k.conname AS constraint_name, pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2, 3
  ) k), '[]'::jsonb),
  'indexes', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (
    SELECT schemaname AS table_schema, tablename AS table_name, indexname
    FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2, 3
  ) i), '[]'::jsonb),
  'triggers', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT trigger_schema, event_object_table AS table_name, trigger_name,
           event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1, 2, 3, 4
  ) t), '[]'::jsonb),
  'extensions', COALESCE((SELECT jsonb_agg(extname ORDER BY extname) FROM pg_extension), '[]'::jsonb)
)) AS schema_report;
ROLLBACK;
