# RBAC migration operating notes

## Supported source schema and definitions

The migration supports `public.role(role_id, role_name)`,
`public.permission(permission_id, permission_name)` with an optional nullable or
defaulted text `description`, and
`public.role_permission(role_id, permission_id)`. It requires primary keys,
unique role and permission names, a unique or primary composite assignment key,
and foreign keys from both assignment columns to the corresponding public ID
columns. Assignment ID columns must be `NOT NULL`. Other columns or constraints
are rejected for review. Row-level security must be disabled on these tables;
the migration checks that state but never changes RLS or grants.

The permission catalog must contain only the nine established names and the 13
approved proposed names. All nine established names, including
`manage_qr_codes`, must exist. Unknown permission definitions cause preflight to
stop even when unassigned. Existing role and permission definitions are never
deleted. `manage_qr_codes` remains unmapped and unassigned. Rollback restores
assignments only; newly created permission definitions are left in place and
unused.

Only the reviewed legacy assignment matrix or the approved target matrix is an
accepted starting state. Other assignment changes stop the migration for
review.

## Assignment writers and coordination

Repository inspection found `rbac-migration.cjs` as the only in-repository
writer of `public.role_permission`. The application authorization modules use
the shared in-memory policy and no role-assignment CRUD writer was found.
Manual SQL, Supabase dashboard operations, and external tools are outside this
repository and cannot be confirmed to use the advisory lock.

The migration and existing plant schema migration use advisory lock ID
`87423901`. The RBAC migration also locks the role, permission, and assignment
tables while it checks and replaces assignments. These measures serialize
cooperating migration runs and block concurrent table writes during its
transaction; they do not protect writers that ignore the advisory lock after
the migration commits.

Before any approved live execution, arrange a write-freeze for role,
permission, and role-permission changes. Pause manual dashboard edits and
external automation for the duration, confirm no assignment writer is active,
and keep the freeze in place until post-migration verification finishes. If a
freeze cannot be guaranteed, stop and coordinate a shared locking/version-check
protocol with every writer first.

## Backup and recovery

The explicit `migrate:rbac` command asks the backup helper for the `public`
schema regardless of `PLANT_PG_SCHEMA`. This is a schema-wide backup, not a
selective RBAC-only dump. The helper checks archive readability, not restore
success. Before live use, rehearse restoring the archive to an isolated
PostgreSQL database and verify the RBAC schema and assignment rows there.

The migration transaction rolls back all permission additions and assignment
changes on an in-transaction failure. Recovery after a committed migration
restores a validated snapshot containing exactly the reviewed legacy or target
matrix. It never removes role or permission definitions. Do not restore from a
partial or hand-edited snapshot.

## Live execution status

This document does not authorize or perform live preflight, backup, or
migration execution. The separate reported `TRUNCATE` grants remain a DBA
issue and are not changed here.
