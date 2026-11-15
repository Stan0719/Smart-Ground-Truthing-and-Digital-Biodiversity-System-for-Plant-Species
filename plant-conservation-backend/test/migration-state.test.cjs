"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  MIGRATION_003_PUBLIC_CHECK_SQL,
  MIGRATION_003_STATE_SQL,
  POST_015_RECOGNITION_SQL,
  classifyQrInventory003,
  isPost015Catalog,
  validateHistory,
} = require("../scripts/migration-state.cjs");

async function database(t) {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  t.after(() => pool.end());
  return pool;
}

async function createPost015Shape(db) {
  await db.query(`
    CREATE SCHEMA plant_app;
    CREATE TABLE plant_app.plant_record(
      plant_id BIGINT PRIMARY KEY,
      species_id BIGINT NOT NULL
    );
    CREATE TABLE public.qr_scan_history(
      scan_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      qr_id BIGINT
    );
    CREATE TABLE plant_app.visitor_scan_history(
      scan_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      qr_id BIGINT
    );
    CREATE TABLE plant_app.qr_code(
      qr_id BIGINT GENERATED ALWAYS AS IDENTITY,
      plant_id BIGINT,
      qr_code TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'generated',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ,
      retired_at TIMESTAMPTZ,
      CONSTRAINT qr_code_pkey PRIMARY KEY(qr_id),
      CONSTRAINT qr_code_plant_id_key UNIQUE(plant_id),
      CONSTRAINT qr_code_qr_code_key UNIQUE(qr_code),
      CONSTRAINT qr_code_plant_id_fkey FOREIGN KEY(plant_id)
        REFERENCES plant_app.plant_record(plant_id) ON DELETE SET NULL
    );
    ALTER TABLE public.qr_scan_history ADD CONSTRAINT qr_scan_history_qr_id_fkey
      FOREIGN KEY(qr_id) REFERENCES plant_app.qr_code(qr_id) ON DELETE CASCADE;
    ALTER TABLE plant_app.visitor_scan_history ADD CONSTRAINT visitor_scan_history_qr_id_fkey
      FOREIGN KEY(qr_id) REFERENCES plant_app.qr_code(qr_id) ON DELETE SET NULL;
  `);
}

async function recognition(db) {
  return (await db.query(POST_015_RECOGNITION_SQL)).rows[0];
}

test("complete post-015 catalog signature is recognized", async (t) => {
  const db = await database(t);
  await createPost015Shape(db);
  const result = await recognition(db);
  assert.equal(result.source_absent, true);
  assert.equal(result.destination_present, true);
  assert.equal(result.regular_table, true);
  assert.equal(result.reviewed_columns, true);
  assert.equal(result.reviewed_defaults, true);
  assert.equal(result.reviewed_indexes, true);
  assert.equal(result.reviewed_constraints, true);
  assert.equal(result.reviewed_incoming_foreign_keys, true);
  assert.equal(result.sequence_owned_in_plant_app, true);
});

test("post-015 recognition rejects an incorrectly defined unique index", async (t) => {
  const db = await database(t);
  await createPost015Shape(db);
  await db.query(`
    ALTER TABLE plant_app.qr_code DROP CONSTRAINT qr_code_qr_code_key;
    CREATE UNIQUE INDEX qr_code_qr_code_key ON plant_app.qr_code(status)
  `);
  const result = await recognition(db);
  assert.equal(result.reviewed_indexes, false);
  assert.equal(result.reviewed_constraints, false);
});

test("post-015 recognition rejects an invalid incoming foreign key", async (t) => {
  const db = await database(t);
  await createPost015Shape(db);
  await db.query(`
    ALTER TABLE public.qr_scan_history DROP CONSTRAINT qr_scan_history_qr_id_fkey;
    ALTER TABLE public.qr_scan_history ADD CONSTRAINT qr_scan_history_qr_id_fkey
      FOREIGN KEY(qr_id) REFERENCES plant_app.qr_code(qr_id) ON DELETE SET NULL
  `);
  const result = await recognition(db);
  assert.equal(result.reviewed_incoming_foreign_keys, false);
});

test("post-015 signature rejects a sequence reported outside plant_app", () => {
  const valid = {
    source_absent: true, destination_present: true, regular_table: true,
    reviewed_columns: true, reviewed_defaults: true, reviewed_indexes: true,
    reviewed_constraints: true, reviewed_incoming_foreign_keys: true,
    sequence_owned_in_plant_app: true,
  };
  assert.equal(isPost015Catalog(valid), true);
  assert.equal(isPost015Catalog({ ...valid, sequence_owned_in_plant_app: false }), false);
});

test("post-015 recognition rejects incorrect defaults and nullability", async (t) => {
  for (const change of [
    "ALTER TABLE plant_app.qr_code ALTER COLUMN status SET DEFAULT 'other'",
    "ALTER TABLE plant_app.qr_code ALTER COLUMN generated_at DROP NOT NULL",
  ]) {
    const db = await database(t);
    await createPost015Shape(db);
    await db.query(change);
    const result = await recognition(db);
    assert.equal(result.reviewed_columns && result.reviewed_defaults, false);
  }
});

test("post-015 recognition rejects unexpected columns and identity mode", async (t) => {
  for (const mutation of [
    "ALTER TABLE plant_app.qr_code ADD COLUMN extra_data TEXT",
    "ALTER TABLE plant_app.qr_code ALTER COLUMN qr_id SET GENERATED BY DEFAULT",
  ]) {
    const db = await database(t);
    await createPost015Shape(db);
    await db.query(mutation);
    assert.equal((await recognition(db)).reviewed_columns, false);
  }
});

test("migration 003 state classifier distinguishes complete, missing, and ambiguous", () => {
  assert.equal(classifyQrInventory003({
    plant_count: 3, matched_count: 3, mismatch_count: 0, duplicate_token_groups: 0,
  }), "complete");
  assert.equal(classifyQrInventory003({
    plant_count: 3, matched_count: 0, mismatch_count: 0, duplicate_token_groups: 0,
  }), "not-applied");
  assert.equal(classifyQrInventory003({
    plant_count: 3, matched_count: 1, mismatch_count: 0, duplicate_token_groups: 0,
  }), "ambiguous");
  assert.equal(classifyQrInventory003({
    plant_count: 3, matched_count: 3, mismatch_count: 0, duplicate_token_groups: 0,
    public_mismatch_count: 1,
  }), "ambiguous");
  assert.equal(classifyQrInventory003({
    plant_count: 0, matched_count: 0, mismatch_count: 0, duplicate_token_groups: 0,
  }), "ambiguous");
});

test("migration 003 catalog query sees completed and unapplied mappings", async (t) => {
  const db = await database(t);
  await db.query(`
    CREATE SCHEMA plant_app;
    CREATE TABLE plant_app.plant_record(
      plant_id BIGINT PRIMARY KEY, qr_token TEXT NOT NULL UNIQUE,
      rbac_status TEXT NOT NULL, registered_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE plant_app.qr_code(
      plant_id BIGINT UNIQUE, qr_code TEXT UNIQUE, status TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL, assigned_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ
    );
    INSERT INTO plant_app.plant_record VALUES
      (1,'one','Approved','2026-01-01T00:00:00Z'),
      (2,'two','Pending','2026-01-02T00:00:00Z');
  `);
  let state = (await db.query(MIGRATION_003_STATE_SQL)).rows[0];
  assert.equal(classifyQrInventory003(state), "not-applied");
  await db.query(`INSERT INTO plant_app.qr_code VALUES
    (1,'one','active','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
    (2,'two','assigned','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z',NULL)`);
  state = (await db.query(MIGRATION_003_STATE_SQL)).rows[0];
  assert.equal(classifyQrInventory003(state), "complete", JSON.stringify(state));
  await db.query(`
    CREATE TABLE public.plant_record(plant_id BIGINT PRIMARY KEY,species_id BIGINT);
    ALTER TABLE plant_app.plant_record ADD COLUMN species_id BIGINT;
    INSERT INTO public.plant_record VALUES(1,7),(2,7);
    UPDATE plant_app.plant_record SET species_id=7;
  `);
  const publicCheck = await db.query(MIGRATION_003_PUBLIC_CHECK_SQL);
  assert.equal(publicCheck.rows[0].mismatch_count, 0);
});

test("migration 003 recognition rejects mappings with incorrect status or timestamps", async (t) => {
  const db = await database(t);
  await db.query(`
    CREATE SCHEMA plant_app;
    CREATE TABLE plant_app.plant_record(
      plant_id BIGINT PRIMARY KEY, qr_token TEXT NOT NULL UNIQUE,
      rbac_status TEXT NOT NULL, registered_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE plant_app.qr_code(
      plant_id BIGINT UNIQUE, qr_code TEXT UNIQUE, status TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL, assigned_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ
    );
    INSERT INTO plant_app.plant_record VALUES
      (1,'one','Approved','2026-01-01T00:00:00Z');
    INSERT INTO plant_app.qr_code VALUES
      (1,'one','generated','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',NULL);
  `);
  assert.equal(classifyQrInventory003((await db.query(MIGRATION_003_STATE_SQL)).rows[0]), "ambiguous");
});

test("migration 003 fills missing inventory rows without consuming spare QR tokens", async (t) => {
  const db = await database(t);
  await db.query(`
    CREATE SCHEMA plant_app;
    CREATE TABLE plant_app.plant_record(
      plant_id BIGINT PRIMARY KEY, species_id BIGINT NOT NULL,
      qr_token TEXT NOT NULL UNIQUE, rbac_status TEXT NOT NULL,
      registered_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE public.plant_record(plant_id BIGINT PRIMARY KEY,species_id BIGINT NOT NULL);
    CREATE TABLE plant_app.qr_code(
      qr_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      plant_id BIGINT UNIQUE, qr_code TEXT NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL DEFAULT 'generated',
      generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      assigned_at TIMESTAMPTZ, activated_at TIMESTAMPTZ, retired_at TIMESTAMPTZ
    );
    INSERT INTO plant_app.plant_record
    SELECT id, 7, 'plant-token-' || id,
      CASE WHEN id % 2 = 0 THEN 'Approved' ELSE 'Pending Review' END,
      '2026-01-01T00:00:00Z'::timestamptz + id * interval '1 minute'
    FROM generate_series(1,18) id;
    INSERT INTO public.plant_record SELECT plant_id,species_id FROM plant_app.plant_record;
    INSERT INTO plant_app.qr_code
      (plant_id,qr_code,status,generated_at,assigned_at,activated_at)
    SELECT plant_id,qr_token,
      CASE WHEN rbac_status='Approved' THEN 'active' ELSE 'assigned' END,
      registered_at,registered_at,
      CASE WHEN rbac_status='Approved' THEN registered_at ELSE NULL END
    FROM plant_app.plant_record WHERE plant_id NOT IN (1,4);
    INSERT INTO plant_app.qr_code(qr_code) VALUES('spare-token-a'),('spare-token-b');
  `);
  const before = (await db.query(`
    SELECT qr_id,plant_id,qr_code,status,generated_at,assigned_at,activated_at
    FROM plant_app.qr_code ORDER BY qr_id
  `)).rows;
  const migration = readFileSync(resolve(__dirname, "../migrations/003-plant-qr-inventory.sql"), "utf8");
  await db.query(migration);
  const after = (await db.query(`
    SELECT qr_id,plant_id,qr_code,status,generated_at,assigned_at,activated_at
    FROM plant_app.qr_code ORDER BY qr_id
  `)).rows;
  assert.equal(before.length, 18);
  assert.equal(after.length, 20);
  for (const original of before) {
    const migrated = after.find((row) => row.qr_id === original.qr_id);
    assert.deepEqual(migrated, original);
  }
  for (const plantId of [1, 4]) {
    const plant = (await db.query(
      "SELECT qr_token FROM plant_app.plant_record WHERE plant_id=$1", [plantId],
    )).rows[0];
    assert.equal(after.some((row) => row.plant_id === plantId && row.qr_code === plant.qr_token), true);
  }
  assert.equal(after.filter((row) => row.plant_id === null).map((row) => row.qr_code).sort().join(","), "spare-token-a,spare-token-b");
});

test("migration history validates identities, checksums, resolution and supersession", () => {
  const known = {
    "003-plant-qr-inventory.sql": "hash-003",
    "014-move-qr-code-to-plant-app.sql": "hash-014",
    "015-local-qr-only-move.sql": "hash-015",
  };
  const now = new Date();
  assert.doesNotThrow(() => validateHistory([
    { migration_name: "015-local-qr-only-move.sql", migration_checksum: "hash-015", resolution: "recognized", executed_at: null, recognized_at: now, superseded_by: null },
    { migration_name: "014-move-qr-code-to-plant-app.sql", migration_checksum: "hash-014", resolution: "superseded", executed_at: null, recognized_at: now, superseded_by: "015-local-qr-only-move.sql" },
  ], known));
  for (const row of [
    { migration_name: "unknown.sql", migration_checksum: "x", resolution: "executed", executed_at: now },
    { migration_name: "003-plant-qr-inventory.sql", migration_checksum: null, resolution: "executed", executed_at: now },
    { migration_name: "003-plant-qr-inventory.sql", migration_checksum: "wrong", resolution: "executed", executed_at: now },
    { migration_name: "003-plant-qr-inventory.sql", migration_checksum: "hash-003", resolution: "executed", executed_at: null },
  ]) assert.throws(() => validateHistory([row], known));
  assert.throws(() => validateHistory([
    { migration_name: "014-move-qr-code-to-plant-app.sql", migration_checksum: "hash-014", resolution: "superseded", executed_at: null, recognized_at: now, superseded_by: "015-local-qr-only-move.sql" },
  ], known), /lacks recognized migration 015/);
});
