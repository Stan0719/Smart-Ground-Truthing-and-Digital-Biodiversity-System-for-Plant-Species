"use strict";

const ROLE_NAMES = Object.freeze([
  "Admin",
  "Conservation Officer",
  "Botanist",
  "Visitor",
]);

const EXISTING_PERMISSION_NAMES = Object.freeze([
  "manage_users",
  "manage_species",
  "register_plants",
  "record_observations",
  "verify_observations",
  "view_plants",
  "manage_sensors",
  "view_alerts",
  "manage_qr_codes",
]);

const PROPOSED_PERMISSION_NAMES = Object.freeze([
  "manage_permissions",
  "read_audit_logs",
  "manage_security_settings",
  "read_system_status",
  "view_scientific_plants",
  "view_protected_species",
  "read_exact_plant_gps",
  "read_reports",
  "view_devices",
  "view_readings",
  "manage_thresholds",
  "manage_alert_responses",
  "generate_qr_codes",
]);

const TARGET_ASSIGNMENTS = Object.freeze({
  Admin: Object.freeze([
    "manage_users",
    "manage_sensors",
    "view_alerts",
    "manage_permissions",
    "read_audit_logs",
    "manage_security_settings",
    "read_system_status",
    "view_devices",
    "view_readings",
    "manage_thresholds",
  ]),
  "Conservation Officer": Object.freeze([
    "manage_species",
    "verify_observations",
    "view_plants",
    "view_alerts",
    "view_scientific_plants",
    "view_protected_species",
    "read_exact_plant_gps",
    "read_reports",
    "view_devices",
    "view_readings",
    "manage_alert_responses",
  ]),
  Botanist: Object.freeze([
    "register_plants",
    "record_observations",
    "view_plants",
    "view_scientific_plants",
    "generate_qr_codes",
  ]),
  Visitor: Object.freeze(["view_plants"]),
});

const LEGACY_ASSIGNMENTS = Object.freeze({
  Admin: Object.freeze([...EXISTING_PERMISSION_NAMES]),
  "Conservation Officer": Object.freeze(EXISTING_PERMISSION_NAMES.filter((name) => name !== "manage_users")),
  Botanist: Object.freeze(["manage_species", "register_plants", "record_observations", "view_plants"]),
  Visitor: Object.freeze(["view_plants"]),
});

const SUPPORTED_COLUMNS = Object.freeze({
  role: new Set(["role_id", "role_name"]),
  permission: new Set(["permission_id", "permission_name", "description"]),
  role_permission: new Set(["role_id", "permission_id"]),
});

const REQUIRED_RBAC_CONSTRAINTS = Object.freeze([
  Object.freeze({ table: "role", type: "PRIMARY KEY", columns: Object.freeze(["role_id"]) }),
  Object.freeze({ table: "role", type: "UNIQUE", columns: Object.freeze(["role_name"]) }),
  Object.freeze({ table: "permission", type: "PRIMARY KEY", columns: Object.freeze(["permission_id"]) }),
  Object.freeze({ table: "permission", type: "UNIQUE", columns: Object.freeze(["permission_name"]) }),
  Object.freeze({
    table: "role_permission", type: "FOREIGN KEY", columns: Object.freeze(["role_id"]),
    foreignSchema: "public", foreignTable: "role", foreignColumns: Object.freeze(["role_id"]),
  }),
  Object.freeze({
    table: "role_permission", type: "FOREIGN KEY", columns: Object.freeze(["permission_id"]),
    foreignSchema: "public", foreignTable: "permission", foreignColumns: Object.freeze(["permission_id"]),
  }),
]);

const ASSIGNMENT_KEY_ALTERNATIVES = Object.freeze([
  Object.freeze({ table: "role_permission", type: "PRIMARY KEY", columns: Object.freeze(["role_id", "permission_id"]) }),
  Object.freeze({ table: "role_permission", type: "UNIQUE", columns: Object.freeze(["role_id", "permission_id"]) }),
]);

const ALL_APPROVED_PERMISSION_NAMES = new Set([
  ...EXISTING_PERMISSION_NAMES,
  ...PROPOSED_PERMISSION_NAMES,
]);

// pg_dump is schema-scoped. Always include the schema containing these tables,
// independent of PLANT_PG_SCHEMA.
const RBAC_BACKUP_SCHEMAS = Object.freeze(["public"]);
const MIGRATION_LOCK_ID = 87423901;

function fail(message) {
  throw new Error(`RBAC migration preflight failed: ${message}`);
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((value) => expected.has(value));
}

function assignmentSet(assignments) {
  return new Set(
    Object.entries(assignments).flatMap(([role, names]) => names.map((name) => `${role}\0${name}`)),
  );
}

function constraintKey(constraint) {
  const columns = [...constraint.columns].sort().join(",");
  if (constraint.type === "CHECK") return `${constraint.table}:CHECK:${constraint.name}`;
  if (constraint.type === "FOREIGN KEY")
    return `${constraint.table}:FOREIGN KEY:${columns}->${constraint.foreignSchema}.${constraint.foreignTable}:${[...constraint.foreignColumns].sort().join(",")}`;
  return `${constraint.table}:${constraint.type}:${columns}`;
}

async function readPreflight(client) {
  const rowSecurity = await client.query(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class AS c
       JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
        AND c.relkind IN ('r', 'p')`,
    [["role", "permission", "role_permission"]],
  );
  if (
    rowSecurity.rows.length !== 3 ||
    rowSecurity.rows.some((row) => row.relrowsecurity || row.relforcerowsecurity)
  ) fail("RBAC tables must exist with row-level security disabled");

  const columnsResult = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [["role", "permission", "role_permission"]],
  );
  const columnsByTable = new Map();
  for (const row of columnsResult.rows) {
    if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, []);
    columnsByTable.get(row.table_name).push(row);
  }
  const requiredColumns = {
    role: ["role_id", "role_name"],
    permission: ["permission_id", "permission_name"],
    role_permission: ["role_id", "permission_id"],
  };
  for (const [table, required] of Object.entries(requiredColumns)) {
    const definitions = columnsByTable.get(table) || [];
    const actual = new Set(definitions.map((row) => row.column_name));
    if (!required.every((column) => actual.has(column))) fail(`unexpected ${table} columns`);
    if (definitions.some((column) => !SUPPORTED_COLUMNS[table].has(column.column_name)))
      fail(`unsupported ${table} column`);
    const idColumns = table === "role" ? ["role_id"] : table === "permission" ? ["permission_id"] : ["role_id", "permission_id"];
    for (const name of idColumns) {
      const definition = definitions.find((column) => column.column_name === name);
      if (definition && !["smallint", "integer", "bigint"].includes(definition.data_type))
        fail(`unsupported ${table}.${name} type`);
    }
  }
  for (const [table, nameColumn] of [["role", "role_name"], ["permission", "permission_name"]]) {
    const nameDefinition = (columnsByTable.get(table) || []).find((column) => column.column_name === nameColumn);
    if (
      !nameDefinition ||
      nameDefinition.is_nullable !== "NO" ||
      !["text", "character varying", "character"].includes(nameDefinition.data_type)
    ) fail(`${table}.${nameColumn} must use a supported NOT NULL text type`);
  }
  for (const columnName of ["role_id", "permission_id"]) {
    const definition = (columnsByTable.get("role_permission") || []).find((column) => column.column_name === columnName);
    if (!definition || definition.is_nullable !== "NO")
      fail(`role_permission.${columnName} must be NOT NULL`);
  }

  const permissionColumns = columnsByTable.get("permission") || [];
  const permissionId = permissionColumns.find((column) => column.column_name === "permission_id");
  const descriptionColumn = permissionColumns.find((column) => column.column_name === "description");
  if (
    descriptionColumn &&
    !["text", "character varying", "character"].includes(descriptionColumn.data_type)
  ) fail("permission.description must use a supported text type");
  if (!permissionId || (permissionId.is_identity !== "YES" && !permissionId.column_default))
    fail("permission_id must be generated or have a default");
  for (const column of permissionColumns) {
    if (
      column.column_name === "description" &&
      !["text", "character varying", "character"].includes(column.data_type)
    ) fail("permission.description must use a supported text type");
    if (
      column.column_name !== "permission_id" &&
      column.column_name !== "permission_name" &&
      column.is_generated !== "ALWAYS" &&
      column.is_nullable === "NO" &&
      !column.column_default
    )
      fail(`permission.${column.column_name} needs an approved insertion value`);
  }
  for (const column of columnsByTable.get("role_permission") || []) {
    if (
      !["role_id", "permission_id"].includes(column.column_name) &&
      column.is_generated !== "ALWAYS" &&
      column.is_nullable === "NO" &&
      !column.column_default
    )
      fail(`role_permission.${column.column_name} needs an approved insertion value`);
  }

  const roles = await client.query("SELECT role_id, role_name FROM public.role ORDER BY role_name");
  const roleNames = roles.rows.map((row) => row.role_name);
  if (new Set(roleNames).size !== roleNames.length) fail("duplicate role names");
  if (!sameSet(new Set(roleNames), new Set(ROLE_NAMES))) fail("unexpected role names");
  const roleIds = new Set(roles.rows.map((row) => String(row.role_id)));
  if (roleIds.size !== roles.rows.length) fail("duplicate role IDs");

  const permissions = await client.query(
    "SELECT permission_id, permission_name FROM public.permission ORDER BY permission_name",
  );
  const permissionNames = permissions.rows.map((row) => row.permission_name);
  if (new Set(permissionNames).size !== permissionNames.length) fail("duplicate permission names");
  if (permissionNames.some((name) => !ALL_APPROVED_PERMISSION_NAMES.has(name)))
    fail("unreviewed permission definition");
  const permissionIds = new Set(permissions.rows.map((row) => String(row.permission_id)));
  if (permissionIds.size !== permissions.rows.length) fail("duplicate permission IDs");
  for (const name of EXISTING_PERMISSION_NAMES) {
    if (!permissionNames.includes(name)) fail(`missing established permission ${name}`);
  }

  const assignments = await client.query(
    `SELECT r.role_name, rp.role_id, rp.permission_id, p.permission_name
       FROM public.role_permission AS rp
       LEFT JOIN public.role AS r ON r.role_id = rp.role_id
       LEFT JOIN public.permission AS p ON p.permission_id = rp.permission_id
      ORDER BY rp.role_id, rp.permission_id`,
  );
  const assignmentKeys = new Set();
  for (const row of assignments.rows) {
    if (!roleIds.has(String(row.role_id)) || !permissionIds.has(String(row.permission_id)))
      fail("orphan assignment row");
    const key = `${row.role_id}:${row.permission_id}`;
    if (assignmentKeys.has(key)) fail("duplicate assignment row");
    assignmentKeys.add(key);
  }

  const actualAssignments = new Set(
    assignments.rows.map((row) => `${row.role_name}\0${row.permission_name}`),
  );
  if (
    !sameSet(actualAssignments, assignmentSet(LEGACY_ASSIGNMENTS)) &&
    !sameSet(actualAssignments, assignmentSet(TARGET_ASSIGNMENTS))
  ) fail("assignments differ from both the reviewed legacy and target matrices");

  const constraints = await client.query(
    `SELECT tc.table_name, tc.constraint_type, tc.constraint_name, pgc.contype AS catalog_type,
            kcu.column_name, ccu.table_schema AS foreign_schema,
            ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints AS tc
       LEFT JOIN information_schema.key_column_usage AS kcu
         ON kcu.constraint_catalog = tc.constraint_catalog
        AND kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_name = tc.table_name
       LEFT JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_catalog = tc.constraint_catalog
        AND ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
       LEFT JOIN pg_namespace AS pgns
         ON pgns.nspname = tc.constraint_schema
       LEFT JOIN pg_class AS pgrel
         ON pgrel.relnamespace = pgns.oid
        AND pgrel.relname = tc.table_name
       LEFT JOIN pg_constraint AS pgc
         ON pgc.conrelid = pgrel.oid
        AND pgc.conname = tc.constraint_name
      WHERE tc.constraint_schema = 'public'
        AND tc.table_name = ANY($1::text[])
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
    [["role", "permission", "role_permission"]],
  );
  const grouped = new Map();
  for (const row of constraints.rows) {
    // Newer catalog views may expose NOT NULL as a constraint; column metadata
    // validates it separately. This is not an application CHECK constraint.
    if (row.catalog_type === "n") continue;
    const key = `${row.table_name}:${row.constraint_name}`;
    if (!grouped.has(key)) grouped.set(key, { table: row.table_name, name: row.constraint_name, type: row.constraint_type, columns: [], foreignSchema: row.foreign_schema, foreignTable: row.foreign_table_name, foreignColumns: [] });
    const constraint = grouped.get(key);
    if (row.column_name && !constraint.columns.includes(row.column_name)) constraint.columns.push(row.column_name);
    if (row.foreign_column_name && !constraint.foreignColumns.includes(row.foreign_column_name)) constraint.foreignColumns.push(row.foreign_column_name);
  }
  const constraintList = [...grouped.values()];
  const hasConstraint = (table, types, columns, foreignTable = null, foreignColumns = null) =>
    constraintList.some((constraint) =>
      constraint.table === table &&
      types.includes(constraint.type) &&
      sameSet(new Set(constraint.columns), new Set(columns)) &&
      (foreignTable === null || constraint.foreignSchema === "public") &&
      (foreignTable === null || constraint.foreignTable === foreignTable) &&
      (foreignColumns === null || sameSet(new Set(constraint.foreignColumns), new Set(foreignColumns))),
    );
  for (const rule of REQUIRED_RBAC_CONSTRAINTS) {
    if (!hasConstraint(rule.table, [rule.type], rule.columns, rule.foreignTable || null, rule.foreignColumns || null))
      fail(`missing required ${rule.table} constraint on ${rule.columns.join(",")}`);
  }
  const baseConstraints = new Set(REQUIRED_RBAC_CONSTRAINTS.map(constraintKey));
  const actualConstraintList = constraintList.map(constraintKey);
  const actualConstraintSet = new Set(actualConstraintList);
  const acceptedConstraintSets = ASSIGNMENT_KEY_ALTERNATIVES.map((alternative) =>
    new Set([...baseConstraints, constraintKey(alternative)]),
  );
  if (
    actualConstraintSet.size !== actualConstraintList.length ||
    !acceptedConstraintSets.some((accepted) => sameSet(actualConstraintSet, accepted))
  ) fail(`unsupported table constraint set: ${actualConstraintList.join(" | ")}`);

  return { roles: roles.rows, permissions: permissions.rows };
}

async function verifyAssignments(client) {
  const actualResult = await client.query(
    `SELECT r.role_name, p.permission_name
       FROM public.role_permission AS rp
       JOIN public.role AS r ON r.role_id = rp.role_id
       JOIN public.permission AS p ON p.permission_id = rp.permission_id
      WHERE r.role_name = ANY($1::text[])`,
    [ROLE_NAMES],
  );
  const actual = new Set(actualResult.rows.map((row) => `${row.role_name}\0${row.permission_name}`));
  const expected = new Set(
    Object.entries(TARGET_ASSIGNMENTS).flatMap(([role, names]) => names.map((name) => `${role}\0${name}`)),
  );
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const extra = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length || extra.length) {
    fail(`assignment mismatch (missing ${missing.length}, extra ${extra.length})`);
  }
  return true;
}

async function restoreAssignments(client, snapshot) {
  validateSnapshot(snapshot);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query("LOCK TABLE public.role IN SHARE MODE");
    await client.query("LOCK TABLE public.permission IN SHARE ROW EXCLUSIVE MODE");
    await client.query("LOCK TABLE public.role_permission IN SHARE ROW EXCLUSIVE MODE");
    const roleResult = await client.query("SELECT role_id, role_name FROM public.role");
    const permissionResult = await client.query("SELECT permission_id, permission_name FROM public.permission");
    if (
      new Set(roleResult.rows.map((row) => row.role_name)).size !== roleResult.rows.length ||
      !sameSet(new Set(roleResult.rows.map((row) => row.role_name)), new Set(ROLE_NAMES)) ||
      new Set(roleResult.rows.map((row) => String(row.role_id))).size !== roleResult.rows.length ||
      new Set(permissionResult.rows.map((row) => row.permission_name)).size !== permissionResult.rows.length ||
      new Set(permissionResult.rows.map((row) => String(row.permission_id))).size !== permissionResult.rows.length
    ) fail("cannot restore; role or permission definitions are ambiguous");
    const roleIds = new Map(roleResult.rows.map((row) => [row.role_name, row.role_id]));
    const permissionIds = new Map(permissionResult.rows.map((row) => [row.permission_name, row.permission_id]));
    const managedRoleIds = ROLE_NAMES.map((name) => roleIds.get(name));
    if (managedRoleIds.some((id) => id === undefined)) fail("cannot restore; an expected role is missing");
    const resolvedSnapshot = snapshot.map((row) => {
      const roleId = roleIds.get(row.role_name);
      const permissionId = permissionIds.get(row.permission_name);
      if (roleId === undefined || permissionId === undefined)
        fail("cannot restore; a snapshot role or permission is missing");
      return { roleId, permissionId };
    });
    await client.query("DELETE FROM public.role_permission WHERE role_id = ANY($1)", [managedRoleIds]);
    for (const row of resolvedSnapshot) {
      await client.query(
        "INSERT INTO public.role_permission (role_id, permission_id) VALUES ($1, $2)",
        [row.roleId, row.permissionId],
      );
    }
    const restored = await client.query(
      `SELECT r.role_name, p.permission_name
         FROM public.role_permission AS rp
         JOIN public.role AS r ON r.role_id = rp.role_id
         JOIN public.permission AS p ON p.permission_id = rp.permission_id
        WHERE r.role_name = ANY($1::text[])`,
      [ROLE_NAMES],
    );
    const expected = new Set(snapshot.map((row) => `${row.role_name}\0${row.permission_name}`));
    const actual = new Set(restored.rows.map((row) => `${row.role_name}\0${row.permission_name}`));
    if (!sameSet(actual, expected)) fail("restored assignment snapshot does not match");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

function validateSnapshot(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0)
    throw new TypeError("Assignment snapshot must be a non-empty array.");
  const actual = new Set();
  for (const row of snapshot) {
    const keys = row && typeof row === "object" ? Reflect.ownKeys(row) : [];
    const roleDescriptor = row && Object.getOwnPropertyDescriptor(row, "role_name");
    const permissionDescriptor = row && Object.getOwnPropertyDescriptor(row, "permission_name");
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(row)) ||
      keys.length !== 2 ||
      keys.some((key) => typeof key !== "string") ||
      !Object.hasOwn(row, "role_name") ||
      !Object.hasOwn(row, "permission_name") ||
      !roleDescriptor || !Object.hasOwn(roleDescriptor, "value") || !roleDescriptor.enumerable ||
      !permissionDescriptor || !Object.hasOwn(permissionDescriptor, "value") || !permissionDescriptor.enumerable ||
      typeof roleDescriptor.value !== "string" ||
      typeof permissionDescriptor.value !== "string" ||
      !ROLE_NAMES.includes(roleDescriptor.value) ||
      !ALL_APPROVED_PERMISSION_NAMES.has(permissionDescriptor.value)
    ) throw new TypeError("Assignment snapshot contains an invalid role or permission reference.");
    const key = `${roleDescriptor.value}\0${permissionDescriptor.value}`;
    if (actual.has(key)) throw new TypeError("Assignment snapshot contains duplicate rows.");
    actual.add(key);
  }
  if (
    !sameSet(actual, assignmentSet(LEGACY_ASSIGNMENTS)) &&
    !sameSet(actual, assignmentSet(TARGET_ASSIGNMENTS))
  ) throw new TypeError("Assignment snapshot is incomplete or ambiguous.");
  return true;
}

async function applyRbacMigration(client) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query("LOCK TABLE public.role IN SHARE MODE");
    await client.query("LOCK TABLE public.permission IN SHARE ROW EXCLUSIVE MODE");
    await client.query("LOCK TABLE public.role_permission IN SHARE ROW EXCLUSIVE MODE");
    const { roles, permissions } = await readPreflight(client);
    const roleIdByName = new Map(roles.map((row) => [row.role_name, row.role_id]));
    const permissionIdByName = new Map(permissions.map((row) => [row.permission_name, row.permission_id]));

    for (const name of PROPOSED_PERMISSION_NAMES) {
      if (!permissionIdByName.has(name)) {
        const inserted = await client.query(
          "INSERT INTO public.permission (permission_name) VALUES ($1) RETURNING permission_id",
          [name],
        );
        if (inserted.rows.length !== 1) fail(`could not add permission ${name}`);
        permissionIdByName.set(name, inserted.rows[0].permission_id);
      }
    }

    for (const roleName of ROLE_NAMES) {
      await client.query("DELETE FROM public.role_permission WHERE role_id = $1", [roleIdByName.get(roleName)]);
      for (const permissionName of TARGET_ASSIGNMENTS[roleName]) {
        await client.query(
          "INSERT INTO public.role_permission (role_id, permission_id) VALUES ($1, $2)",
          [roleIdByName.get(roleName), permissionIdByName.get(permissionName)],
        );
      }
    }

    await verifyAssignments(client);
    await client.query("COMMIT");
    return { roles: ROLE_NAMES.length, assignments: [...Object.values(TARGET_ASSIGNMENTS)].reduce((sum, names) => sum + names.length, 0) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

module.exports = {
  ROLE_NAMES,
  EXISTING_PERMISSION_NAMES,
  PROPOSED_PERMISSION_NAMES,
  TARGET_ASSIGNMENTS,
  REQUIRED_RBAC_CONSTRAINTS,
  ASSIGNMENT_KEY_ALTERNATIVES,
  constraintKey,
  RBAC_BACKUP_SCHEMAS,
  MIGRATION_LOCK_ID,
  readPreflight,
  verifyAssignments,
  applyRbacMigration,
  restoreAssignments,
};
