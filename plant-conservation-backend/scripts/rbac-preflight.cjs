"use strict";

const tls = require("node:tls");

const {
  ROLE_NAMES,
  EXISTING_PERMISSION_NAMES,
  PROPOSED_PERMISSION_NAMES,
  TARGET_ASSIGNMENTS,
  REQUIRED_RBAC_CONSTRAINTS,
  ASSIGNMENT_KEY_ALTERNATIVES,
  constraintKey,
} = require("../rbac-migration.cjs");

const EXPECTED_PROJECT_REF = "ksdacwolokuprxzgpbxs";
const EXPECTED_DIRECT_HOST = `db.${EXPECTED_PROJECT_REF}.supabase.co`;
const EXPECTED_SESSION_POOLER_HOST = "aws-0-ap-southeast-1.pooler.supabase.com";
const PREFLIGHT_LOGIN = "rbac_preflight_login";
const TABLE_NAMES = Object.freeze(["role", "permission", "role_permission"]);
const EXPECTED_PERMISSIONS = Object.freeze([
  ...EXISTING_PERMISSION_NAMES,
  ...PROPOSED_PERMISSION_NAMES,
]);

class PreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PreflightError";
    this.code = code;
  }
}

function parseTarget(connectionString, projectRef) {
  if (projectRef !== EXPECTED_PROJECT_REF)
    throw new PreflightError("TARGET_MISMATCH", "Expected project reference is not approved.");
  if (typeof connectionString !== "string" || connectionString.length === 0)
    throw new PreflightError("CONFIG_MISSING", "RBAC_PREFLIGHT_DATABASE_URL is required.");

  let url;
  let username;
  let password;
  let database;
  let endpointType;
  try {
    url = new URL(connectionString);
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new PreflightError("CONFIG_INVALID", "Database target configuration is invalid.");
  }
  if (url.hostname === EXPECTED_DIRECT_HOST) endpointType = "direct";
  else if (url.hostname === EXPECTED_SESSION_POOLER_HOST) endpointType = "session-pooler";
  const expectedUsername = endpointType === "session-pooler"
    ? `${PREFLIGHT_LOGIN}.${EXPECTED_PROJECT_REF}`
    : PREFLIGHT_LOGIN;
  const sslModes = url.searchParams.getAll("sslmode");
  const queryKeys = [...url.searchParams.keys()];
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !endpointType ||
    Number(url.port || "5432") !== 5432 ||
    database !== "postgres" ||
    username !== expectedUsername ||
    !password ||
    url.hash ||
    queryKeys.some((key) => key !== "sslmode") ||
    sslModes.length > 1 ||
    (sslModes.length === 1 && sslModes[0] !== "verify-full")
  )
    throw new PreflightError("TARGET_MISMATCH", "Database target is not an approved verified endpoint for the dedicated preflight login.");

  return Object.freeze({
    host: url.hostname,
    port: 5432,
    database: "postgres",
    user: username,
    password,
    ssl: Object.freeze({
      rejectUnauthorized: true,
      servername: url.hostname,
      checkServerIdentity: (_servername, certificate) => tls.checkServerIdentity(url.hostname, certificate),
    }),
    endpointType,
    application_name: "rbac-readonly-preflight",
    connectionTimeoutMillis: 10000,
    max: 1,
  });
}

function compareMatrix({ roles = [], permissions = [], assignments = [] } = {}) {
  const expectedRoleSet = new Set(ROLE_NAMES);
  const expectedPermissionSet = new Set(EXPECTED_PERMISSIONS);
  const expectedAssignments = new Set(
    Object.entries(TARGET_ASSIGNMENTS).flatMap(([role, names]) =>
      names.map((name) => `${role}\0${name}`),
    ),
  );
  const roleNames = roles.map((row) => row.role_name);
  const permissionNames = permissions.map((row) => row.permission_name);
  const actualAssignments = new Set();
  const duplicateAssignments = [];
  const orphanAssignments = [];

  for (const row of assignments) {
    if (typeof row.role_name !== "string" || typeof row.permission_name !== "string") {
      orphanAssignments.push({ role_id: row.role_id, permission_id: row.permission_id });
      continue;
    }
    const key = `${row.role_name}\0${row.permission_name}`;
    if (actualAssignments.has(key))
      duplicateAssignments.push({ role_name: row.role_name, permission_name: row.permission_name });
    actualAssignments.add(key);
  }

  const rolesReport = {
    missing: [...expectedRoleSet].filter((name) => !roleNames.includes(name)),
    unexpected: [...new Set(roleNames)].filter((name) => !expectedRoleSet.has(name)),
    duplicateNames: duplicates(roleNames),
    duplicateIds: duplicates(roles.map((row) => String(row.role_id))),
  };
  const permissionsReport = {
    missing: [...expectedPermissionSet].filter((name) => !permissionNames.includes(name)),
    unexpected: [...new Set(permissionNames)].filter((name) => !expectedPermissionSet.has(name)),
    duplicateNames: duplicates(permissionNames),
    duplicateIds: duplicates(permissions.map((row) => String(row.permission_id))),
  };
  const assignmentsReport = {
    missing: [...expectedAssignments].filter((key) => !actualAssignments.has(key)).map(splitAssignment),
    extra: [...actualAssignments].filter((key) => !expectedAssignments.has(key)).map(splitAssignment),
    duplicateRows: duplicateAssignments,
    orphanRows: orphanAssignments,
  };
  const qrPermission = permissions.find((row) => row.permission_name === "manage_qr_codes");
  const qrReport = {
    defined: Boolean(qrPermission),
    assigned: assignments.some((row) => row.permission_name === "manage_qr_codes"),
  };
  return {
    roles: rolesReport,
    permissions: permissionsReport,
    assignments: assignmentsReport,
    manage_qr_codes: qrReport,
    targetMatrixMatches:
      rolesReport.missing.length === 0 && rolesReport.unexpected.length === 0 &&
      rolesReport.duplicateNames.length === 0 && rolesReport.duplicateIds.length === 0 &&
      permissionsReport.missing.length === 0 && permissionsReport.unexpected.length === 0 &&
      permissionsReport.duplicateNames.length === 0 && permissionsReport.duplicateIds.length === 0 &&
      assignmentsReport.missing.length === 0 && assignmentsReport.extra.length === 0 &&
      assignmentsReport.duplicateRows.length === 0 && assignmentsReport.orphanRows.length === 0,
    qrPolicyMatches: qrReport.defined && !qrReport.assigned,
  };
}

function compareSchema({ constraints = [], indexes = [] } = {}) {
  const grouped = new Map();
  for (const row of constraints) {
    if (row.catalog_type === "n") continue;
    const key = `${row.table_name}\0${row.constraint_name}\0${row.constraint_type}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        table: row.table_name,
        name: row.constraint_name,
        type: row.constraint_type,
        columns: [],
        foreignSchema: row.foreign_schema,
        foreignTable: row.foreign_table,
        foreignColumns: [],
      });
    }
    const item = grouped.get(key);
    if (row.column_name && !item.columns.includes(row.column_name)) item.columns.push(row.column_name);
    if (row.foreign_column && !item.foreignColumns.includes(row.foreign_column))
      item.foreignColumns.push(row.foreign_column);
  }
  const actual = [...grouped.values()];
  const normalized = actual.map((item) => constraintKey(item));
  const normalizedSet = new Set(normalized);
  const requiredKeys = REQUIRED_RBAC_CONSTRAINTS.map((item) => constraintKey(item));
  const assignmentKeys = ASSIGNMENT_KEY_ALTERNATIVES.map((item) => constraintKey(item));
  const selectedAssignmentKey = assignmentKeys.find((key) => normalizedSet.has(key));
  const acceptedKeys = new Set([...requiredKeys, ...(selectedAssignmentKey ? [selectedAssignmentKey] : [])]);
  const primaryAndUniqueRules = [
    ...REQUIRED_RBAC_CONSTRAINTS.filter((item) => ["PRIMARY KEY", "UNIQUE"].includes(item.type)),
    ...ASSIGNMENT_KEY_ALTERNATIVES,
  ];
  const indexMatches = (rule, index) => {
    const expectedColumns = [...rule.columns].sort();
    const actualColumns = [...(index.columns || [])].sort();
    const sameColumns = expectedColumns.length === actualColumns.length &&
      expectedColumns.every((column, i) => column === actualColumns[i]);
    return index.table_name === rule.table && sameColumns && index.is_unique === true &&
      (rule.type !== "PRIMARY KEY" || index.is_primary === true);
  };
  const requiredIndexRules = REQUIRED_RBAC_CONSTRAINTS.filter((rule) =>
    ["PRIMARY KEY", "UNIQUE"].includes(rule.type),
  );
  const validAssignmentIndex = ASSIGNMENT_KEY_ALTERNATIVES.some((rule) =>
    indexes.some((index) => indexMatches(rule, index) && index.is_valid === true && index.is_ready === true),
  );
  const invalidAssignmentIndex = !validAssignmentIndex && ASSIGNMENT_KEY_ALTERNATIVES.some((rule) =>
    indexes.some((index) => indexMatches(rule, index) && (index.is_valid !== true || index.is_ready !== true)),
  );
  const missingRequiredIndexes = requiredIndexRules
    .filter((rule) => !indexes.some((index) => indexMatches(rule, index) && index.is_valid === true && index.is_ready === true))
    .map((rule) => ({ table: rule.table, type: rule.type, columns: [...rule.columns] }));
  const invalidRequiredIndexes = requiredIndexRules
    .filter((rule) => indexes.some((index) => indexMatches(rule, index) && (index.is_valid !== true || index.is_ready !== true)))
    .map((rule) => ({ table: rule.table, type: rule.type, columns: [...rule.columns] }));
  const unexpectedRelevantIndexes = indexes.filter((index) =>
    index.constraint_type && !primaryAndUniqueRules.some((rule) => indexMatches(rule, index)),
  ).map((index) => ({ table: index.table_name, name: index.index_name, type: index.constraint_type, columns: index.columns }));
  const unexpectedStandaloneIndexes = indexes.filter((index) =>
    !index.constraint_type && !primaryAndUniqueRules.some((rule) => indexMatches(rule, index)),
  ).map((index) => ({ table: index.table_name, name: index.index_name, is_unique: index.is_unique, columns: index.columns }));
  return {
    constraints: {
      missingRequired: REQUIRED_RBAC_CONSTRAINTS
        .filter((rule) => !normalizedSet.has(constraintKey(rule)))
        .map((rule) => ({ table: rule.table, type: rule.type, columns: [...rule.columns] })),
      assignmentKeySatisfied: Boolean(selectedAssignmentKey),
      assignmentKeyAlternativesPresent: assignmentKeys.filter((key) => normalizedSet.has(key)),
      unexpected: actual
        .filter((item) => !acceptedKeys.has(constraintKey(item)))
        .map((item) => ({ table: item.table, name: item.name, type: item.type, columns: item.columns, foreignSchema: item.foreignSchema, foreignTable: item.foreignTable, foreignColumns: item.foreignColumns })),
      duplicateDefinitions: [...new Set(normalized.filter((key, i) => normalized.indexOf(key) !== i))],
      matchesApprovedRules:
        REQUIRED_RBAC_CONSTRAINTS.every((rule) => normalizedSet.has(constraintKey(rule))) &&
        Boolean(selectedAssignmentKey) &&
        actual.length === acceptedKeys.size &&
        new Set(normalized).size === normalized.length,
    },
    indexes: {
      missingRequired: missingRequiredIndexes,
      invalidRequired: invalidRequiredIndexes,
      assignmentKeySatisfied: validAssignmentIndex,
      assignmentKeyInvalid: invalidAssignmentIndex,
      unexpectedRelevant: unexpectedRelevantIndexes,
      unexpectedStandalone: unexpectedStandaloneIndexes,
      matchesApprovedRules:
        missingRequiredIndexes.length === 0 && invalidRequiredIndexes.length === 0 &&
        validAssignmentIndex && !unexpectedRelevantIndexes.length && !unexpectedStandaloneIndexes.length,
      otherIndexes: indexes.filter((index) => !index.constraint_type).map((index) => ({ table: index.table_name, name: index.index_name, columns: index.columns })),
    },
  };
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function splitAssignment(key) {
  const [role_name, permission_name] = key.split("\0");
  return { role_name, permission_name };
}

function sanitizeError(error) {
  if (error instanceof PreflightError) {
    const messages = {
      TARGET_MISMATCH: "Database target is not the explicitly approved Supabase project.",
      CONFIG_MISSING: "RBAC_PREFLIGHT_DATABASE_URL is required.",
      CONFIG_INVALID: "Database target configuration is invalid.",
      READ_ONLY_BOUNDARY_FAILED: "The database login does not meet the required read-only privilege boundary.",
    };
    return {
      code: Object.hasOwn(messages, error.code) ? error.code : "PREFLIGHT_FAILED",
      message: messages[error.code] || "Read-only preflight failed.",
    };
  }
  return {
    code: "PREFLIGHT_FAILED",
    message: "Read-only preflight failed. Check connectivity and database privileges locally.",
  };
}

const PRIVILEGE_SQL = `
  WITH wanted(table_name) AS (
    VALUES ('role'::text), ('permission'::text), ('role_permission'::text)
  ), login_caps AS (
    SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
           r.rolbypassrls, d.datdba = r.oid AS owns_database,
           EXISTS (
            SELECT 1
            FROM pg_auth_members AS m
            WHERE m.member = r.oid
          ) AS has_role_memberships,
           has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database_objects,
           has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_public_schema,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_objects
      FROM pg_roles AS r
      JOIN pg_database AS d ON d.datname = current_database()
     WHERE r.rolname = current_user
  )
  SELECT login_caps.*,
         wanted.table_name,
         c.oid IS NOT NULL AS table_exists,
         COALESCE(c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user), false) AS owns_table,
         COALESCE(has_table_privilege(current_user, c.oid, 'SELECT'), false) AS can_select,
         COALESCE(has_table_privilege(current_user, c.oid, 'INSERT'), false) AS can_insert,
         COALESCE(has_table_privilege(current_user, c.oid, 'UPDATE'), false) AS can_update,
         COALESCE(has_table_privilege(current_user, c.oid, 'DELETE'), false) AS can_delete,
         COALESCE(has_table_privilege(current_user, c.oid, 'TRUNCATE'), false) AS can_truncate,
         COALESCE(has_table_privilege(current_user, c.oid, 'REFERENCES'), false) AS can_reference,
         COALESCE(has_table_privilege(current_user, c.oid, 'TRIGGER'), false) AS can_trigger
    FROM login_caps
    CROSS JOIN wanted
    LEFT JOIN pg_class AS c
      ON c.oid = to_regclass(format('public.%I', wanted.table_name))
  ORDER BY wanted.table_name`;

async function verifyReadOnlyPrivileges(client) {
  const result = await client.query(PRIVILEGE_SQL);
  const rows = result?.rows;
  const failures = [];
  if (!Array.isArray(rows) || rows.length !== TABLE_NAMES.length) {
    return { ok: false, failures: ["Could not verify the database login privileges."] };
  }
  const identity = rows[0];
  for (const [flag, label] of [
    ["rolsuper", "superuser"],
    ["rolcreaterole", "role creation"],
    ["rolcreatedb", "database creation"],
    ["rolreplication", "replication privilege"],
    ["rolbypassrls", "RLS bypass"],
    ["owns_database", "database ownership"],
    ["has_role_memberships", "inherited or settable role membership"],
    ["can_create_database_objects", "database object creation"],
    ["can_create_public_objects", "public schema object creation"],
  ]) {
    if (identity[flag] !== false) failures.push(`Login has ${label} capability.`);
  }
  if (identity.can_use_public_schema !== true)
    failures.push("Login lacks USAGE on the public schema.");
  for (const row of rows) {
    if (!TABLE_NAMES.includes(row.table_name)) {
      failures.push("Privilege query returned an unexpected RBAC table name.");
      continue;
    }
    if (row.table_exists !== true) {
      failures.push(`Required table public.${row.table_name} is missing.`);
      continue;
    }
    if (row.can_select !== true)
      failures.push(`Insufficient SELECT privilege on public.${row.table_name}.`);
    if (row.owns_table === true) failures.push(`Login owns public.${row.table_name}.`);
    for (const privilege of [
      "can_insert", "can_update", "can_delete", "can_truncate", "can_reference", "can_trigger",
    ])
      if (row[privilege] !== false) failures.push(`Write privilege is present on public.${row.table_name}.`);
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

async function inspectRbacCatalog(client) {
  const names = [...TABLE_NAMES];
  const tables = await client.query(
    `SELECT c.relname AS table_name, c.relkind, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [names],
  );
  const columns = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable,
            (column_default IS NOT NULL) AS has_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [names],
  );
  const constraints = await client.query(
    `SELECT
        t.relname AS table_name,
        con.conname AS constraint_name,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'c' THEN 'CHECK'
          ELSE con.contype::text
        END AS constraint_type,
        con.contype AS catalog_type,
        a.attname AS column_name,
        CASE WHEN con.contype = 'f' THEN fn.nspname END AS foreign_schema,
        CASE WHEN con.contype = 'f' THEN ft.relname END AS foreign_table,
        CASE WHEN con.contype = 'f' THEN fa.attname END AS foreign_column
    FROM pg_constraint AS con
    JOIN pg_class AS t
      ON t.oid = con.conrelid
    JOIN pg_namespace AS n
      ON n.oid = t.relnamespace
    LEFT JOIN pg_class AS ft
      ON ft.oid = con.confrelid
    LEFT JOIN pg_namespace AS fn
      ON fn.oid = ft.relnamespace
    LEFT JOIN LATERAL unnest(con.conkey)
      WITH ORDINALITY AS ck(attnum, ordinality) ON true
    LEFT JOIN pg_attribute AS a
      ON a.attrelid = t.oid AND a.attnum = ck.attnum
    LEFT JOIN LATERAL unnest(con.confkey)
      WITH ORDINALITY AS fk(attnum, ordinality)
      ON fk.ordinality = ck.ordinality
    LEFT JOIN pg_attribute AS fa
      ON fa.attrelid = ft.oid AND fa.attnum = fk.attnum
    WHERE n.nspname = 'public'
      AND t.relname = ANY($1::text[])
    ORDER BY t.relname, con.conname, ck.ordinality`,
    [names],
  );
  const indexes = await client.query(
    `SELECT t.relname AS table_name, i.relname AS index_name,
            ix.indisprimary AS is_primary, ix.indisunique AS is_unique,
            ix.indisvalid AS is_valid, ix.indisready AS is_ready,
            con.contype AS constraint_type,
            array_agg(
              COALESCE(a.attname::text, '<expression>')
              ORDER BY k.ordinality
            )::text[] AS columns
       FROM pg_class AS t
       JOIN pg_namespace AS n ON n.oid = t.relnamespace
       JOIN pg_index AS ix ON ix.indrelid = t.oid
       JOIN pg_class AS i ON i.oid = ix.indexrelid
       LEFT JOIN pg_constraint AS con ON con.conindid = ix.indexrelid AND con.contype IN ('p', 'u')
       CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality)
       LEFT JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
        AND k.ordinality <= ix.indnkeyatts
      GROUP BY t.relname, i.relname, ix.indisprimary, ix.indisunique, ix.indisvalid, ix.indisready, con.contype
      ORDER BY t.relname, i.relname`,
    [names],
  );

  const tableRows = tables.rows;
  return {
    tables: tableRows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    schemaComparison: compareSchema({ constraints: constraints.rows, indexes: indexes.rows }),
    missingTables: TABLE_NAMES.filter((name) => !tableRows.some((row) => row.table_name === name)),
  };
}

async function inspectRbacRows(client, catalog) {
  const tableRows = catalog.tables;
  if (
    tableRows.length !== TABLE_NAMES.length ||
    tableRows.some((row) => !["r", "p"].includes(row.relkind))
  ) {
    return {
      ...catalog,
      dataReadSkipped: "Expected RBAC tables are missing or are not tables.",
      roles: [],
      permissions: [],
      assignments: [],
      comparison: null,
    };
  }
  if (tableRows.some((row) => row.relrowsecurity || row.relforcerowsecurity)) {
    return {
      ...catalog,
      dataReadSkipped: "RLS is enabled; row visibility cannot be established with this login.",
      roles: [],
      permissions: [],
      assignments: [],
      comparison: null,
    };
  }

  const roles = await client.query("SELECT role_id, role_name FROM public.role ORDER BY role_name, role_id");
  const permissions = await client.query(
    "SELECT permission_id, permission_name FROM public.permission ORDER BY permission_name, permission_id",
  );
  const assignments = await client.query(
    `SELECT rp.role_id, r.role_name, rp.permission_id, p.permission_name
       FROM public.role_permission AS rp
       LEFT JOIN public.role AS r ON r.role_id = rp.role_id
       LEFT JOIN public.permission AS p ON p.permission_id = rp.permission_id
      ORDER BY rp.role_id, rp.permission_id`,
  );

  return {
    ...catalog,
    roles: roles.rows,
    permissions: permissions.rows,
    assignments: assignments.rows,
    comparison: compareMatrix({
      roles: roles.rows,
      permissions: permissions.rows,
      assignments: assignments.rows,
    }),
  };
}

async function inspectRbac(client) {
  const catalog = await inspectRbacCatalog(client);
  return inspectRbacRows(client, catalog);
}

module.exports = {
  EXPECTED_PROJECT_REF,
  EXPECTED_DIRECT_HOST,
  EXPECTED_SESSION_POOLER_HOST,
  PREFLIGHT_LOGIN,
  TABLE_NAMES,
  EXPECTED_PERMISSIONS,
  PreflightError,
  parseTarget,
  compareMatrix,
  compareSchema,
  sanitizeError,
  verifyReadOnlyPrivileges,
  inspectRbacCatalog,
  inspectRbacRows,
  inspectRbac,
  PRIVILEGE_SQL,
};