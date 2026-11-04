-- Account/account-audit metadata only. Run the whole script in Supabase SQL Editor.
-- Uses the application's default account schema, plant_auth (not Supabase auth).
-- If AUTH_PG_SCHEMA differs, replace only the 'plant_auth' literals before running.
-- No account rows, password hashes, session values or database credentials are read.
-- SQL Editor's current role may differ from the application's connection role.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

-- 1. Role used by this inspection; does NOT establish the backend role's privileges.
SELECT current_user AS inspection_role, rolsuper, rolbypassrls
FROM pg_catalog.pg_roles WHERE rolname = current_user;

-- 2. Account schema ownership and effective API-role schema access.
SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner,
       r.rolname, has_schema_privilege(r.oid, n.oid, 'USAGE') AS api_role_usage
FROM pg_catalog.pg_namespace n
LEFT JOIN pg_catalog.pg_roles r ON r.rolname IN ('anon', 'authenticated', 'service_role')
WHERE n.nspname = 'plant_auth';

-- 3. Account table RLS/ownership; missing rows mean missing/inaccessible metadata.
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'plant_auth' AND c.relkind IN ('r', 'p')
  AND c.relname IN ('users', 'visitors', 'sessions', 'visitor_sessions', 'auth_events',
                   'password_resets', 'activation_tokens', 'security_settings', 'account_emails')
ORDER BY c.relname;

-- 4. Existing account policies, including their USING/WITH CHECK predicates.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'plant_auth'
  AND tablename IN ('users', 'visitors', 'sessions', 'visitor_sessions', 'auth_events',
                    'password_resets', 'activation_tokens', 'security_settings', 'account_emails')
ORDER BY tablename, policyname;

-- 5. Effective API-role privileges (includes inherited privileges).
SELECT c.relname AS table_name, r.rolname,
       has_table_privilege(r.oid, c.oid, 'SELECT') AS can_select,
       has_table_privilege(r.oid, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(r.oid, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(r.oid, c.oid, 'TRUNCATE') AS can_truncate
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname = 'plant_auth' AND c.relkind IN ('r', 'p')
  AND c.relname IN ('users', 'visitors', 'sessions', 'visitor_sessions', 'auth_events',
                   'password_resets', 'activation_tokens', 'security_settings', 'account_emails')
  AND r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY c.relname, r.rolname;

-- 6. Direct grants, including PUBLIC; table ownership still confers privileges.
SELECT c.relname AS table_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
WHERE n.nspname = 'plant_auth' AND c.relkind IN ('r', 'p')
  AND c.relname IN ('users', 'visitors', 'sessions', 'visitor_sessions', 'auth_events',
                   'password_resets', 'activation_tokens', 'security_settings', 'account_emails')
ORDER BY c.relname, grantee, a.privilege_type;

-- 7. Known account trigger functions: execution security and search_path presence.
-- Trigger-returning functions are not ordinary PostgREST RPC endpoints.
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) x
               WHERE x LIKE 'search_path=%') AS has_fixed_search_path,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
WHERE n.nspname = 'plant_auth'
  AND p.proname IN ('maintain_account_email', 'restrict_account_sessions')
ORDER BY p.proname, grantee;

ROLLBACK;
