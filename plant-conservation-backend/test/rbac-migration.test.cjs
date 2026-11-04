"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const {
  ROLE_NAMES,
  EXISTING_PERMISSION_NAMES,
  PROPOSED_PERMISSION_NAMES,
  TARGET_ASSIGNMENTS,
  RBAC_BACKUP_SCHEMAS,
  MIGRATION_LOCK_ID,
  readPreflight,
  verifyAssignments,
  applyRbacMigration,
  restoreAssignments,
} = require("../rbac-migration.cjs");
const { runRbacMigration } = require("../scripts/migrate-rbac.cjs");
const { backupPostgres } = require("../scripts/postgres-backup.cjs");

const fixture = readFileSync(join(__dirname, "fixtures/rbac-legacy.sql"), "utf8");

async function database(withFixture = true) {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  if (withFixture) await pool.query(fixture);
  const client = await pool.connect();
  return { pool, client, close: async () => { client.release(); await pool.end(); } };
}

async function rows(client) {
  return (await client.query(
    `SELECT r.role_name, p.permission_name
       FROM public.role_permission AS rp
       JOIN public.role AS r ON r.role_id = rp.role_id
       JOIN public.permission AS p ON p.permission_id = rp.permission_id
      ORDER BY r.role_name, p.permission_name`,
  )).rows;
}

test("fresh migration creates the approved permissions and exact assignments", async (t) => {
  const db = await database();
  t.after(db.close);
  const result = await applyRbacMigration(db.client);
  assert.deepEqual(result, { roles: 4, assignments: 27 });
  assert.equal(await verifyAssignments(db.client), true);
  const permissions = (await db.client.query("SELECT permission_name FROM public.permission")).rows.map((row) => row.permission_name);
  for (const permission of [...EXISTING_PERMISSION_NAMES, ...PROPOSED_PERMISSION_NAMES])
    assert.ok(permissions.includes(permission), `missing ${permission}`);
  const assignments = await rows(db.client);
  assert.equal(assignments.some((row) => row.permission_name === "manage_qr_codes"), false);
  assert.deepEqual(
    assignments.filter((row) => row.permission_name === "generate_qr_codes").map((row) => row.role_name),
    ["Botanist"],
  );
});

test("supports the documented composite UNIQUE alternative", async (t) => {
  const db = await database();
  t.after(db.close);
  await db.client.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_pkey");
  await db.client.query("ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_pair_key UNIQUE(role_id, permission_id)");
  await assert.doesNotReject(readPreflight(db.client));
});

test("repeat migration is idempotent", async (t) => {
  const db = await database();
  t.after(db.close);
  await applyRbacMigration(db.client);
  const firstAssignments = await rows(db.client);
  const firstPermissions = (await db.client.query("SELECT permission_name FROM public.permission ORDER BY permission_name")).rows;
  await applyRbacMigration(db.client);
  assert.deepEqual(await rows(db.client), firstAssignments);
  assert.deepEqual((await db.client.query("SELECT permission_name FROM public.permission ORDER BY permission_name")).rows, firstPermissions);
});

test("matrix verification detects missing and extra assignments", async (t) => {
  const db = await database();
  t.after(db.close);
  await applyRbacMigration(db.client);
  await db.client.query(
    `DELETE FROM public.role_permission rp USING public.role r, public.permission p
      WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
        AND r.role_name = 'Visitor' AND p.permission_name = 'view_plants'`,
  );
  await assert.rejects(verifyAssignments(db.client), /assignment mismatch/);
  const ids = await db.client.query(
    `SELECT r.role_id, p.permission_id FROM public.role r CROSS JOIN public.permission p
      WHERE r.role_name = 'Visitor' AND p.permission_name IN ('view_plants','manage_users')`,
  );
  for (const row of ids.rows)
    await db.client.query("INSERT INTO public.role_permission(role_id, permission_id) VALUES ($1,$2)", [row.role_id, row.permission_id]);
  await assert.rejects(verifyAssignments(db.client), /assignment mismatch/);
});

test("preflight rejects each unsafe schema or data condition", async (t) => {
  const cases = [
    ["missing tables", false, async () => {}],
    ["missing required column", true, async (c) => c.query("ALTER TABLE public.permission DROP COLUMN permission_name CASCADE")],
    ["missing role", true, async (c) => { await c.query("DELETE FROM public.role_permission WHERE role_id = (SELECT role_id FROM public.role WHERE role_name='Visitor')"); await c.query("DELETE FROM public.role WHERE role_name='Visitor'"); }],
    ["missing established permission", true, async (c) => { await c.query("DELETE FROM public.role_permission WHERE permission_id = (SELECT permission_id FROM public.permission WHERE permission_name='manage_qr_codes')"); await c.query("DELETE FROM public.permission WHERE permission_name='manage_qr_codes'"); }],
    ["duplicate role names", true, async (c) => { await c.query("ALTER TABLE public.role DROP CONSTRAINT role_role_name_key"); await c.query("INSERT INTO public.role(role_name) VALUES ('Botanist')"); }],
    ["duplicate permission names", true, async (c) => { await c.query("ALTER TABLE public.permission DROP CONSTRAINT permission_permission_name_key"); await c.query("INSERT INTO public.permission(permission_name) VALUES ('view_plants')"); }],
    ["missing role primary key", true, async (c) => { await c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_role_id_fkey"); await c.query("ALTER TABLE public.role DROP CONSTRAINT role_pkey"); }],
    ["missing role name uniqueness", true, async (c) => c.query("ALTER TABLE public.role DROP CONSTRAINT role_role_name_key")],
    ["missing permission primary key", true, async (c) => { await c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_permission_id_fkey"); await c.query("ALTER TABLE public.permission DROP CONSTRAINT permission_pkey"); }],
    ["missing permission name uniqueness", true, async (c) => c.query("ALTER TABLE public.permission DROP CONSTRAINT permission_permission_name_key")],
    ["missing required constraint", true, async (c) => c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_pkey")],
    ["nullable assignment IDs with a unique pair", true, async (c) => { await c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_pkey"); await c.query("ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_pair_key UNIQUE(role_id, permission_id)"); await c.query("ALTER TABLE public.role_permission ALTER COLUMN role_id DROP NOT NULL"); }],
    ["missing role foreign key", true, async (c) => c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_role_id_fkey")],
    ["missing permission foreign key", true, async (c) => c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_permission_id_fkey")],
    ["duplicate assignment rows", true, async (c) => { await c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_pkey"); await c.query("INSERT INTO public.role_permission SELECT role_id, permission_id FROM public.role_permission LIMIT 1"); }],
    ["orphan assignment row", true, async (c) => { await c.query("ALTER TABLE public.role_permission DROP CONSTRAINT role_permission_role_id_fkey"); await c.query("INSERT INTO public.role_permission(role_id, permission_id) SELECT 999999, permission_id FROM public.permission LIMIT 1"); }],
    ["unreviewed assigned permission", true, async (c) => { await c.query("INSERT INTO public.permission(permission_name) VALUES ('unreviewed')"); await c.query("INSERT INTO public.role_permission SELECT role_id, permission_id FROM public.role CROSS JOIN public.permission WHERE role_name='Botanist' AND permission_name='unreviewed'"); }],
    ["required permission insertion value", true, async (c) => { await c.query("ALTER TABLE public.permission ADD COLUMN description TEXT"); await c.query("UPDATE public.permission SET description = 'existing'"); await c.query("ALTER TABLE public.permission ALTER COLUMN description SET NOT NULL"); }],
    ["unsupported optional column", true, async (c) => c.query("ALTER TABLE public.role_permission ADD COLUMN scope TEXT")],
    ["unsupported check constraint", true, async (c) => c.query("ALTER TABLE public.role ADD CONSTRAINT role_name_check CHECK (length(role_name) > 0)")],
    ["RLS enabled", true, async (c) => c.query("ALTER TABLE public.role_permission ENABLE ROW LEVEL SECURITY")],
    ["unassigned unknown permission definition", true, async (c) => c.query("INSERT INTO public.permission(permission_name) VALUES ('unreviewed_unassigned')")],
    ["unexpected valid permission assignment", true, async (c) => { await c.query("INSERT INTO public.permission(permission_name) VALUES ('manage_permissions')"); await c.query("INSERT INTO public.role_permission SELECT role_id, permission_id FROM public.role CROSS JOIN public.permission WHERE role_name='Visitor' AND permission_name='manage_permissions'"); }],
  ];

  for (const [name, withFixture, mutate] of cases) {
    await t.test(name, async (st) => {
      const db = await database(withFixture);
      st.after(db.close);
      await mutate(db.client);
      await assert.rejects(readPreflight(db.client), /RBAC migration preflight failed/);
    });
  }
});

test("injected failure rolls back all migration writes", async (t) => {
  const db = await database();
  t.after(db.close);
  const original = await rows(db.client);
  const failingClient = {
    async query(sql, values) {
      if (/SELECT r\.role_name, p\.permission_name/.test(sql)) throw new Error("injected verification failure");
      return db.client.query(sql, values);
    },
  };
  await assert.rejects(applyRbacMigration(failingClient), /injected verification failure/);
  assert.deepEqual(await rows(db.client), original);
  const proposed = await db.client.query(
    "SELECT COUNT(*) AS count FROM public.permission WHERE permission_name = ANY($1::text[])",
    [PROPOSED_PERMISSION_NAMES],
  );
  assert.equal(Number(proposed.rows[0].count), 0);
});

test("previous assignments can be restored from a snapshot", async (t) => {
  const db = await database();
  t.after(db.close);
  const snapshot = await rows(db.client);
  await applyRbacMigration(db.client);
  const permissionCountAfterMigration = Number((await db.client.query("SELECT COUNT(*) AS count FROM public.permission")).rows[0].count);
  await restoreAssignments(db.client, snapshot);
  assert.deepEqual(await rows(db.client), snapshot);
  assert.equal(Number((await db.client.query("SELECT COUNT(*) AS count FROM public.permission")).rows[0].count), permissionCountAfterMigration);
});

test("rejects invalid snapshots before changing any assignments", async (t) => {
  const db = await database();
  t.after(db.close);
  const snapshot = await rows(db.client);
  const symbolField = { role_name: "Visitor", permission_name: "view_plants" };
  symbolField[Symbol("unexpected")] = true;
  const accessorField = Object.defineProperties({}, {
    role_name: { enumerable: true, get: () => "Visitor" },
    permission_name: { enumerable: true, value: "view_plants" },
  });
  const customPrototype = Object.assign(Object.create({ inherited: true }), {
    role_name: "Visitor", permission_name: "view_plants",
  });
  const invalidSnapshots = [
    [], snapshot.slice(1), [...snapshot, snapshot[0]], null,
    [null], [{ role_name: "Unknown", permission_name: "view_plants" }],
    [{ role_name: "Visitor", permission_name: "unknown_permission" }],
    [{ role_name: "Visitor", permission_name: "view_plants", extra: true }],
    [{ role_name: "Visitor" }],
    [symbolField], [accessorField], [customPrototype],
  ];
  for (const invalid of invalidSnapshots) {
    await assert.rejects(restoreAssignments(db.client, invalid), TypeError);
    assert.deepEqual(await rows(db.client), snapshot);
  }
});

test("rejects snapshots with missing database role or permission references before deletion", async (t) => {
  const db = await database();
  t.after(db.close);
  const validSnapshot = await rows(db.client);

  await db.client.query("DELETE FROM public.role_permission WHERE role_id = (SELECT role_id FROM public.role WHERE role_name = 'Visitor')");
  await db.client.query("DELETE FROM public.role WHERE role_name = 'Visitor'");
  const beforeMissingRole = await rows(db.client);
  await assert.rejects(restoreAssignments(db.client, validSnapshot), /role or permission definitions are ambiguous/);
  assert.deepEqual(await rows(db.client), beforeMissingRole);

  await db.client.query("INSERT INTO public.role(role_name) VALUES ('Visitor')");
  await db.client.query("DELETE FROM public.role_permission WHERE permission_id = (SELECT permission_id FROM public.permission WHERE permission_name = 'manage_qr_codes')");
  await db.client.query("DELETE FROM public.permission WHERE permission_name = 'manage_qr_codes'");
  const beforeMissingPermission = await rows(db.client);
  await assert.rejects(restoreAssignments(db.client, validSnapshot), /snapshot role or permission is missing/);
  assert.deepEqual(await rows(db.client), beforeMissingPermission);
});

test("preflight refuses assignments changed from both reviewed matrices", async (t) => {
  const db = await database();
  t.after(db.close);
  await db.client.query("INSERT INTO public.permission(permission_name) VALUES ('manage_permissions')");
  await db.client.query(
    `INSERT INTO public.role_permission(role_id, permission_id)
     SELECT r.role_id, p.permission_id FROM public.role r CROSS JOIN public.permission p
      WHERE r.role_name = 'Visitor' AND p.permission_name = 'manage_permissions'`,
  );
  const changed = await rows(db.client);
  await assert.rejects(applyRbacMigration(db.client), /reviewed legacy and target matrices/);
  assert.deepEqual(await rows(db.client), changed);
});

test("concurrent invocations converge using the shared advisory lock", async (t) => {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  await pool.query(fixture);
  t.after(() => pool.end());
  // testPool serializes its single embedded PGlite connection. These are
  // concurrent command invocations; real multi-session lock contention is
  // intentionally left for the disposable PostgreSQL integration check.
  const backup = () => {};
  const first = runRbacMigration({ pool, backup });
  const second = runRbacMigration({ pool, backup });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.assignments), [27, 27]);
  assert.equal(await verifyAssignments({ query: (...args) => pool.query(...args) }), true);
});

test("backup helper passes public to pg_dump and validates its output", () => {
  assert.deepEqual(RBAC_BACKUP_SCHEMAS, ["public"]);
  let archiveExists = false;
  const calls = [];
  const result = backupPostgres("isolated/fake.dump", {
    settings: { PLANT_PG_SCHEMA: "plant_app" },
    connection: "postgresql://isolated-test@127.0.0.1/testdb",
    schemas: [...RBAC_BACKUP_SCHEMAS],
    fileSystem: { existsSync: () => archiveExists, mkdirSync() {}, chmodSync() {} },
    run(binary, args) {
      calls.push({ binary, args });
      if (binary === "pg_dump") archiveExists = true; // simulated output only
      return { status: 0 };
    },
  });
  assert.equal(calls[0].binary, "pg_dump");
  assert.ok(calls[0].args.includes("--schema"));
  assert.ok(calls[0].args.includes("public"));
  assert.deepEqual(calls[1].args, ["--list", resolve("isolated/fake.dump")]);
  assert.deepEqual(result.schemas, ["public"]);
});

test("backup failure prevents connection and migration", async () => {
  let connects = 0;
  let applies = 0;
  let schemas;
  await assert.rejects(runRbacMigration({
    pool: { async connect() { connects++; throw new Error("unexpected connect"); } },
    backup(_path, options) { schemas = options.schemas; throw new Error("backup failed"); },
    async apply() { applies++; },
    backupPath: "isolated-placeholder.dump",
  }), /backup failed/);
  assert.deepEqual(schemas, ["public"]);
  assert.equal(connects, 0);
  assert.equal(applies, 0);
});

test("backup helper propagates dump and archive validation failures", () => {
  const fileSystem = { existsSync: () => false, mkdirSync() {}, chmodSync() {} };
  const options = {
    settings: {}, connection: "postgresql://isolated-test@127.0.0.1/testdb",
    schemas: ["public"], fileSystem,
  };
  assert.throws(() => backupPostgres("fake.dump", { ...options, run: () => ({ status: 1 }) }), /PostgreSQL backup failed/);
  let archiveExists = false;
  assert.throws(() => backupPostgres("fake.dump", {
    ...options,
    fileSystem: { existsSync: () => archiveExists, mkdirSync() {}, chmodSync() {} },
    run(binary) { if (binary === "pg_dump") archiveExists = true; return { status: binary === "pg_restore" ? 1 : 0 }; },
  }), /archive validation failed/);
  assert.throws(() => backupPostgres("missing.dump", {
    ...options, run: () => ({ status: 0 }),
  }), /archive file was not created/);
});

test("uses the existing schema migration advisory lock and table locks", async (t) => {
  const db = await database();
  t.after(db.close);
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      return db.client.query(sql, values);
    },
  };
  const runner = readFileSync(join(__dirname, "../scripts/migrate.cjs"), "utf8");
  await applyRbacMigration(client);
  assert.equal(MIGRATION_LOCK_ID, 87423901);
  assert.match(runner, /pg_advisory_xact_lock\(87423901\)/);
  const advisory = statements.find(({ sql }) => sql.includes("pg_advisory_xact_lock"));
  assert.deepEqual(advisory.values, [87423901]);
  assert.ok(statements.some(({ sql }) => sql.includes("LOCK TABLE public.role_permission")));
});

test("approved matrix retains role-specific separation", () => {
  assert.deepEqual(ROLE_NAMES, ["Admin", "Conservation Officer", "Botanist", "Visitor"]);
  assert.ok(TARGET_ASSIGNMENTS.Botanist.includes("record_observations"));
  assert.ok(TARGET_ASSIGNMENTS.Botanist.includes("generate_qr_codes"));
  assert.equal(TARGET_ASSIGNMENTS.Botanist.includes("verify_observations"), false);
  assert.equal(TARGET_ASSIGNMENTS.Botanist.includes("view_protected_species"), false);
  assert.equal(TARGET_ASSIGNMENTS.Botanist.includes("read_exact_plant_gps"), false);
  assert.equal(TARGET_ASSIGNMENTS["Conservation Officer"].includes("manage_sensors"), false);
  assert.equal(TARGET_ASSIGNMENTS["Conservation Officer"].includes("manage_thresholds"), false);
  assert.equal(TARGET_ASSIGNMENTS.Admin.some((name) => ["view_plants", "register_plants", "record_observations", "verify_observations", "manage_qr_codes", "generate_qr_codes"].includes(name)), false);
});
