"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EXPECTED_PROJECT_REF,
  EXPECTED_DIRECT_HOST,
  EXPECTED_SESSION_POOLER_HOST,
  PREFLIGHT_LOGIN,
  EXPECTED_PERMISSIONS,
  PreflightError,
  parseTarget,
  compareMatrix,
  compareSchema,
  sanitizeError,
  verifyReadOnlyPrivileges,
  inspectRbac,
  PRIVILEGE_SQL,
} = require("../scripts/rbac-preflight.cjs");
const { parseArguments, runPreflight } = require("../scripts/preflight-rbac.cjs");
const {
  TARGET_ASSIGNMENTS,
  REQUIRED_RBAC_CONSTRAINTS,
  ASSIGNMENT_KEY_ALTERNATIVES,
} = require("../rbac-migration.cjs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

function testUrl(host = EXPECTED_DIRECT_HOST, options = "", username) {
  const user = username || (host === EXPECTED_SESSION_POOLER_HOST
    ? `${PREFLIGHT_LOGIN}.${EXPECTED_PROJECT_REF}`
    : PREFLIGHT_LOGIN);
  return `postgresql://${user}:synthetic-only@${host}:5432/postgres${options}`;
}

function matrixRows() {
  const roles = Object.keys(TARGET_ASSIGNMENTS).map((role_name, index) => ({
    role_id: index + 1,
    role_name,
  }));
  const permissions = EXPECTED_PERMISSIONS.map((permission_name, index) => ({
    permission_id: index + 1,
    permission_name,
  }));
  const assignments = Object.entries(TARGET_ASSIGNMENTS).flatMap(([role_name, names]) =>
    names.map((permission_name) => ({ role_name, permission_name })),
  );
  return { roles, permissions, assignments };
}

function catalogConstraintRows() {
  const rules = [...REQUIRED_RBAC_CONSTRAINTS, ASSIGNMENT_KEY_ALTERNATIVES[0]];
  return rules.flatMap((rule) => rule.columns.map((column_name) => ({
    table_name: rule.table,
    constraint_name: `${rule.table}_${rule.foreignTable || rule.columns.join("_")}_${rule.type.toLowerCase().replaceAll(" ", "_")}`,
    constraint_type: rule.type,
    catalog_type: rule.type === "PRIMARY KEY" ? "p" : rule.type === "UNIQUE" ? "u" : "f",
    column_name,
    foreign_schema: rule.foreignSchema || null,
    foreign_table: rule.foreignTable || null,
    foreign_column: rule.foreignColumns?.[rule.columns.indexOf(column_name)] || null,
  })));
}

function catalogIndexRows() {
  const rules = [
    ...REQUIRED_RBAC_CONSTRAINTS.filter((rule) => ["PRIMARY KEY", "UNIQUE"].includes(rule.type)),
    ASSIGNMENT_KEY_ALTERNATIVES[0],
  ];
  return rules.map((rule) => ({
    table_name: rule.table,
    index_name: `${rule.table}_${rule.type.toLowerCase().replaceAll(" ", "_")}`,
    is_primary: rule.type === "PRIMARY KEY",
    is_unique: true,
    is_valid: true,
    is_ready: true,
    constraint_type: rule.type === "PRIMARY KEY" ? "p" : "u",
    columns: [...rule.columns],
  }));
}

test("target validation accepts the explicit direct and session-pooler endpoints with verified TLS", () => {
  assert.deepEqual(parseArguments(["--project-ref", EXPECTED_PROJECT_REF]), EXPECTED_PROJECT_REF);
  const config = parseTarget(testUrl(), EXPECTED_PROJECT_REF);
  assert.equal(config.host, EXPECTED_DIRECT_HOST);
  assert.equal(config.port, 5432);
  assert.equal(config.database, "postgres");
  assert.equal(config.user, PREFLIGHT_LOGIN);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, EXPECTED_DIRECT_HOST);
  assert.equal(typeof config.ssl.checkServerIdentity, "function");
  assert.equal(config.endpointType, "direct");
  assert.equal(config.application_name, "rbac-readonly-preflight");

  const pooler = parseTarget(testUrl(EXPECTED_SESSION_POOLER_HOST), EXPECTED_PROJECT_REF);
  assert.equal(pooler.host, EXPECTED_SESSION_POOLER_HOST);
  assert.equal(pooler.user, `${PREFLIGHT_LOGIN}.${EXPECTED_PROJECT_REF}`);
  assert.equal(pooler.endpointType, "session-pooler");
  assert.equal(pooler.ssl.rejectUnauthorized, true);
  assert.equal(pooler.ssl.servername, EXPECTED_SESSION_POOLER_HOST);
  assert.equal(typeof pooler.ssl.checkServerIdentity, "function");
});

test("target validation rejects wrong endpoints, credentials, ports, database, TLS modes, and query parameters", () => {
  const rejected = [
    [undefined, EXPECTED_PROJECT_REF],
    [testUrl(), "another-project-ref"],
    [testUrl("aws-0-region.pooler.supabase.com"), EXPECTED_PROJECT_REF],
    [testUrl("localhost"), EXPECTED_PROJECT_REF],
    [testUrl().replace(":5432/", ":6543/"), EXPECTED_PROJECT_REF],
    [testUrl().replace("/postgres", "/otherdb"), EXPECTED_PROJECT_REF],
    [testUrl(EXPECTED_SESSION_POOLER_HOST, "", PREFLIGHT_LOGIN), EXPECTED_PROJECT_REF],
    [testUrl(EXPECTED_DIRECT_HOST, "", `${PREFLIGHT_LOGIN}.${EXPECTED_PROJECT_REF}`), EXPECTED_PROJECT_REF],
    [testUrl().replace("postgresql://", "https://"), EXPECTED_PROJECT_REF],
    [testUrl(undefined, "?sslmode=disable"), EXPECTED_PROJECT_REF],
    [testUrl(undefined, "?sslmode=require"), EXPECTED_PROJECT_REF],
    [testUrl(undefined, "?sslmode=verify-ca"), EXPECTED_PROJECT_REF],
    [testUrl(undefined, "?application_name=unsafe"), EXPECTED_PROJECT_REF],
    [testUrl(undefined, "?sslmode=verify-full&connect_timeout=1"), EXPECTED_PROJECT_REF],
    ["postgresql://reader:secret@db.bad.supabase.co:5432/postgres", EXPECTED_PROJECT_REF],
  ];
  for (const [url, ref] of rejected) {
    assert.throws(() => parseTarget(url, ref), PreflightError);
  }
  assert.throws(() => parseArguments(["--project-ref", "wrong"]), PreflightError);
});

test("matrix comparison uses the approved target and confirms QR permission remains unassigned", () => {
  const report = compareMatrix(matrixRows());
  assert.deepEqual(report.roles.missing, []);
  assert.deepEqual(report.roles.unexpected, []);
  assert.deepEqual(report.permissions.missing, []);
  assert.deepEqual(report.permissions.unexpected, []);
  assert.deepEqual(report.assignments.missing, []);
  assert.deepEqual(report.assignments.extra, []);
  assert.deepEqual(report.assignments.duplicateRows, []);
  assert.deepEqual(report.assignments.orphanRows, []);
  assert.equal(report.targetMatrixMatches, true);
  assert.deepEqual(report.manage_qr_codes, { defined: true, assigned: false });
  assert.equal(report.qrPolicyMatches, true);
});

test("matrix comparison reports missing and excess grants, duplicates, orphans, and definitions", () => {
  const rows = matrixRows();
  rows.assignments.splice(rows.assignments.findIndex((row) => row.role_name === "Visitor"));
  rows.assignments.push({ role_name: "Visitor", permission_name: "manage_users" });
  rows.assignments.push({ role_name: "Visitor", permission_name: "manage_users" });
  rows.assignments.push({ role_id: 999, permission_id: 999, role_name: null, permission_name: null });
  rows.permissions = rows.permissions.filter((row) => row.permission_name !== "manage_qr_codes");
  const report = compareMatrix(rows);
  assert.ok(report.assignments.missing.some((row) => row.role_name === "Visitor" && row.permission_name === "view_plants"));
  assert.ok(report.assignments.extra.some((row) => row.role_name === "Visitor" && row.permission_name === "manage_users"));
  assert.deepEqual(report.assignments.duplicateRows, [{ role_name: "Visitor", permission_name: "manage_users" }]);
  assert.deepEqual(report.assignments.orphanRows, [{ role_id: 999, permission_id: 999 }]);
  assert.equal(report.permissions.missing.includes("manage_qr_codes"), true);
  assert.equal(report.targetMatrixMatches, false);
  assert.deepEqual(report.manage_qr_codes, { defined: false, assigned: false });
});

test("schema comparison reports missing and extra constraints and relevant indexes", () => {
  const constraints = catalogConstraintRows();
  const indexes = catalogIndexRows();
  const complete = compareSchema({ constraints, indexes });
  assert.equal(complete.constraints.matchesApprovedRules, true);
  assert.equal(complete.indexes.matchesApprovedRules, true);

  const missing = compareSchema({
    constraints: constraints.filter((row) => row.constraint_type !== "UNIQUE" || row.table_name !== "role"),
    indexes: indexes.filter((row) => row.table_name !== "role" || !row.columns.includes("role_name")),
  });
  assert.ok(missing.constraints.missingRequired.some((row) => row.table === "role" && row.type === "UNIQUE"));
  assert.ok(missing.indexes.missingRequired.some((row) => row.table === "role" && row.type === "UNIQUE"));

  const extra = compareSchema({
    constraints: [...constraints, {
      table_name: "role", constraint_name: "unexpected_check", constraint_type: "CHECK",
      catalog_type: "c", column_name: null, foreign_schema: null, foreign_table: null, foreign_column: null,
    }],
    indexes,
  });
  assert.ok(extra.constraints.unexpected.some((row) => row.name === "unexpected_check"));
  assert.equal(extra.constraints.matchesApprovedRules, false);

  const extraIndex = compareSchema({
    constraints,
    indexes: [...indexes,
      {
        table_name: "role", index_name: "role_unexpected_unique", is_primary: false,
        is_unique: true, is_valid: true, is_ready: true, constraint_type: null, columns: ["unexpected_column"],
      },
      {
        table_name: "permission", index_name: "permission_unreviewed_index", is_primary: false,
        is_unique: false, is_valid: true, is_ready: true, constraint_type: null, columns: ["permission_id"],
      },
    ],
  });
  assert.ok(extraIndex.indexes.unexpectedStandalone.some((row) => row.name === "role_unexpected_unique"));
  assert.ok(extraIndex.indexes.unexpectedStandalone.some((row) => row.name === "permission_unreviewed_index"));
  assert.equal(extraIndex.indexes.matchesApprovedRules, false);

  const approvedStandaloneIndex = compareSchema({
    constraints,
    indexes: [...indexes, {
      table_name: "role", index_name: "role_approved_standalone_key", is_primary: false,
      is_unique: true, is_valid: true, is_ready: true, constraint_type: null, columns: ["role_name"],
    }],
  });
  assert.equal(approvedStandaloneIndex.indexes.unexpectedStandalone.length, 0);
});

test("error sanitization never includes a raw driver message or connection secret", () => {
  const secret = "postgresql://user:do-not-print@host.invalid/db";
  const safe = sanitizeError(Object.assign(new Error(secret), { code: "08006" }));
  assert.equal(safe.code, "PREFLIGHT_FAILED");
  assert.equal(safe.message.includes(secret), false);
  assert.equal(JSON.stringify(safe).includes("do-not-print"), false);
  const configError = sanitizeError(new PreflightError("TARGET_MISMATCH", "Target is not approved."));
  assert.deepEqual(configError, {
    code: "TARGET_MISMATCH",
    message: "Database target is not the explicitly approved Supabase project.",
  });
  const unsafeConfigMessage = sanitizeError(new PreflightError("TARGET_MISMATCH", secret));
  assert.equal(JSON.stringify(unsafeConfigMessage).includes(secret), false);
});

test("read-only boundary rejects any write or elevated capability before table inspection", async () => {
  const base = {
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    owns_database: false,
    has_role_memberships: false,
    can_create_database_objects: false,
    can_use_public_schema: true,
    can_create_public_objects: false,
    table_exists: true,
    owns_table: false,
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_reference: false,
    can_trigger: false,
  };
  const client = { query: async () => ({ rows: ["permission", "role", "role_permission"].map((table_name) => ({ ...base, table_name })) }) };
  assert.deepEqual(await verifyReadOnlyPrivileges(client), { ok: true, failures: [] });
  const writer = { ...base, can_truncate: true, table_name: "role_permission" };
  const denied = await verifyReadOnlyPrivileges({ query: async () => ({ rows: [writer, { ...base, table_name: "role" }, { ...base, table_name: "permission" }] }) });
  assert.equal(denied.ok, false);
  assert.ok(denied.failures.some((message) => message.includes("Write privilege")));
});


test("read-only boundary rejects membership in another PostgreSQL role", async () => {
  const base = {
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    owns_database: false,
    has_role_memberships: true,
    can_create_database_objects: false,
    can_use_public_schema: true,
    can_create_public_objects: false,
    table_exists: true,
    owns_table: false,
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_reference: false,
    can_trigger: false,
  };

  const result = await verifyReadOnlyPrivileges({
    query: async () => ({
      rows: ["permission", "role", "role_permission"].map((table_name) => ({
        ...base,
        table_name,
      })),
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((message) => message.includes("role membership")),
  );
});

test("read-only boundary rejects another PostgreSQL role being a member of the login role", async () => {
  const base = {
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    owns_database: false,
    has_role_memberships: true,
    can_create_database_objects: false,
    can_use_public_schema: true,
    can_create_public_objects: false,
    table_exists: true,
    owns_table: false,
    can_select: true,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_reference: false,
    can_trigger: false,
  };

  const result = await verifyReadOnlyPrivileges({
    query: async () => ({
      rows: ["permission", "role", "role_permission"].map((table_name) => ({
        ...base,
        table_name,
      })),
    }),
  });

  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((message) => message.includes("role membership")),
  );
});

test("preflight never falls back to DATABASE_URL and rejects before creating a pool", async () => {
  let poolCreated = false;
  await assert.rejects(
    runPreflight({
      args: ["--project-ref", EXPECTED_PROJECT_REF],
      env: { DATABASE_URL: testUrl() },
      PoolClass: class { constructor() { poolCreated = true; } },
    }),
    PreflightError,
  );
  assert.equal(poolCreated, false);
});

function fakePoolForCatalog({ rls = false, missingTable = null, deniedSelect = null } = {}, captured = []) {
  const safeCaps = {
    rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
    rolbypassrls: false, owns_database: false, has_role_memberships: false,
    can_create_database_objects: false, can_use_public_schema: true, can_create_public_objects: false,
    owns_table: false, can_select: true, can_insert: false, can_update: false,
    can_delete: false, can_truncate: false, can_reference: false, can_trigger: false,
  };
  return class FakePool {
    constructor() {}
    on() {}
    async connect() {
      return {
        async query(sql) {
          const statement = sql.trim();
          captured.push(statement);
          if (/^BEGIN/.test(statement) || ["COMMIT", "ROLLBACK"].includes(statement)) return { rows: [] };
          if (statement.includes("WITH wanted(table_name)"))
            return { rows: ["role", "permission", "role_permission"].map((table_name) => ({
              ...safeCaps,
              table_name,
              table_exists: table_name !== missingTable,
              can_select: table_name !== deniedSelect,
            })) };
          if (statement.includes("FROM pg_class AS c"))
            return { rows: ["role", "permission", "role_permission"]
              .filter((table_name) => table_name !== missingTable)
              .map((table_name) => ({ table_name, relkind: "r", relrowsecurity: rls, relforcerowsecurity: false })) };
          if (
            statement.includes("information_schema.columns") ||
            statement.includes("information_schema.table_constraints") ||
            statement.includes("FROM pg_constraint AS con") ||
            statement.includes("FROM pg_class AS t")
          ) {
            return { rows: [] };
          }
          throw new Error("Unexpected query in offline fake database.");
        },
        release() { captured.push("RELEASE"); },
      };
    }
    async end() { captured.push("POOL_END"); }
  };
}

test("catalog metadata is read before privileges, but failed privilege checks block row reads", async () => {
  const captured = [];
  const report = await runPreflight({
    args: ["--project-ref", EXPECTED_PROJECT_REF],
    env: { RBAC_PREFLIGHT_DATABASE_URL: testUrl() },
    PoolClass: fakePoolForCatalog({ deniedSelect: "role" }, captured),
  });
  assert.equal(report.status, "BLOCKED_INCOMPLETE");
  assert.match(report.privilegeBoundaryFailures.join(" "), /Insufficient SELECT privilege on public\.role/);
  assert.ok(captured[0].includes("REPEATABLE READ READ ONLY"));
  assert.ok(captured.indexOf("SELECT c.relname AS table_name") < captured.findIndex((sql) => sql.includes("WITH wanted(table_name)")));
  assert.equal(captured.some((sql) => sql.includes("FROM public.role ORDER BY")), false);
});

test("missing table is distinguished from insufficient SELECT", async () => {
  const report = await runPreflight({
    args: ["--project-ref", EXPECTED_PROJECT_REF],
    env: { RBAC_PREFLIGHT_DATABASE_URL: testUrl() },
    PoolClass: fakePoolForCatalog({ missingTable: "permission" }),
  });
  assert.equal(report.status, "BLOCKED_INCOMPLETE");
  assert.match(report.privilegeBoundaryFailures.join(" "), /Required table public\.permission is missing/);
  assert.equal(report.tables.some((row) => row.table_name === "permission"), false);
});

test("actual CLI main returns nonzero for RLS-blocked inspection", () => {
  const cliPath = resolve(__dirname, "../scripts/preflight-rbac.cjs");
  const serializedPool = fakePoolForCatalog.toString();
  const childSource = `
    const { main } = require(${JSON.stringify(cliPath)});
    const makePool = ${serializedPool};
    main(
      ["--project-ref", ${JSON.stringify(EXPECTED_PROJECT_REF)}],
      { RBAC_PREFLIGHT_DATABASE_URL: ${JSON.stringify(testUrl(EXPECTED_SESSION_POOLER_HOST))} },
      { PoolClass: makePool({ rls: true }), stdout: process.stdout, stderr: process.stderr }
    );
  `;
  const child = spawnSync(process.execPath, ["-e", childSource], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stdout, /"status": "BLOCKED_INCOMPLETE"/);
  assert.match(child.stdout, /"endpointType": "session-pooler"/);
  assert.match(child.stdout, /"tls": "certificate-and-hostname-verified"/);
  assert.match(child.stdout, /RLS is enabled/);
});

test("query failure rolls back and releases both client and pool", async () => {
  const captured = [];
  class ErrorPool {
    constructor() {}
    on() {}
    async connect() {
      return {
        async query(sql) {
          const statement = sql.trim();
          captured.push(statement);
          if (statement.startsWith("BEGIN")) return { rows: [] };
          throw new Error("synthetic catalog failure");
        },
        release() { captured.push("RELEASE"); },
      };
    }
    async end() { captured.push("POOL_END"); }
  }
  await assert.rejects(runPreflight({
    args: ["--project-ref", EXPECTED_PROJECT_REF],
    env: { RBAC_PREFLIGHT_DATABASE_URL: testUrl() },
    PoolClass: ErrorPool,
  }), /synthetic catalog failure/);
  assert.ok(captured.some((statement) => statement.startsWith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")));
  assert.ok(captured.includes("ROLLBACK"));
  assert.ok(captured.includes("RELEASE"));
  assert.ok(captured.includes("POOL_END"));
});

test("RLS metadata causes table-row reads to be skipped", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql.trim());
      if (sql.includes("FROM pg_class AS c")) {
        return { rows: ["role", "permission", "role_permission"].map((table_name) => ({
          table_name,
          relkind: "r",
          relrowsecurity: table_name === "role_permission",
          relforcerowsecurity: false,
        })) };
      }
      return { rows: [] };
    },
  };
  const result = await inspectRbac(client);
  assert.equal(result.comparison, null);
  assert.match(result.dataReadSkipped, /RLS is enabled/);
  assert.equal(calls.some((sql) => sql.includes("FROM public.role ORDER BY")), false);
  assert.ok(calls.every((sql) => /^(SELECT|WITH)\b/i.test(sql)));
});
