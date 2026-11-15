"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { basename, join } = require("node:path");
const { resolveLocalPostgresTarget } = require("../database.cjs");
const { backupPostgres } = require("../scripts/postgres-backup.cjs");
const { runMigration } = require("../scripts/migrate.cjs");
const { runQrOnlyMigration } = require("../scripts/migrate-qr-only.cjs");
const migrationState = require("../scripts/migration-state.cjs");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(join(os.tmpdir(), "migration-safety-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function localEnvironment(overrides = {}) {
  return {
    PLANT_PG_SCHEMA: "plant_app",
    DB_HOST: "localhost",
    DB_NAME: "plants",
    DB_USER: "test-user",
    ...overrides,
  };
}

function runnerMock({ catalog = {}, qrState = {}, ledger = [] } = {}) {
  const records = new Map(ledger.map((row) => [row.migration_name, { ...row }]));
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push(sql);
      if (sql.includes("SELECT migration_name,migration_checksum,resolution"))
        return { rows: [...records.values()] };
      if (sql.includes("WITH qr AS ("))
        return { rows: [{
          source_absent: false,
          destination_present: false,
          regular_table: false,
          reviewed_columns: false,
          reviewed_defaults: false,
          reviewed_indexes: false,
          reviewed_constraints: false,
          reviewed_incoming_foreign_keys: false,
          sequence_owned_in_plant_app: false,
          ...catalog,
        }] };
      if (sql.includes("WITH plant_state AS ("))
        return { rows: [{
          plant_count: 1,
          matched_count: 0,
          mismatch_count: 0,
          duplicate_token_groups: 0,
          public_plant_exists: false,
          ...qrState,
        }] };
      if (sql.includes("LEFT JOIN public.plant_record p"))
        return { rows: [{ mismatch_count: 0 }] };
      if (sql.includes("INSERT INTO plant_app.schema_migration_history")) {
        const migration_name = params[0];
        const resolution = sql.includes("'superseded'") ? "superseded"
          : sql.includes("'recognized'") ? "recognized" : "executed";
        records.set(migration_name, {
          migration_name,
          migration_checksum: params[1],
          resolution,
          executed_at: resolution === "executed" ? new Date() : null,
          recognized_at: resolution === "executed" ? null : new Date(),
          superseded_by: resolution === "superseded" ? params[2] : null,
        });
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    client,
    records,
    statements,
    createPool: () => ({ connect: async () => client, end: async () => {} }),
  };
}

function localQrEnvironment(overrides = {}) {
  return localEnvironment({
    DB_NAME: "plant_conservation_dev",
    ...overrides,
  });
}

function archivePath(args) {
  return args[args.indexOf("--file") + 1];
}

function makeFileSystem(overrides = {}) {
  return {
    existsSync: fs.existsSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    chmodSync: fs.chmodSync.bind(fs),
    linkSync: fs.linkSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    ...overrides,
  };
}

test("local PostgreSQL target accepts only normalized loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "::1"]) {
    assert.deepEqual(
      resolveLocalPostgresTarget({ DB_HOST: host }),
      { host },
    );
  }
  assert.deepEqual(
    resolveLocalPostgresTarget({ DB_HOST: "LOCALHOST" }),
    { host: "localhost" },
  );
  assert.deepEqual(
    resolveLocalPostgresTarget({ PGHOST: "[::1]" }),
    { host: "::1" },
  );
  assert.deepEqual(
    resolveLocalPostgresTarget({
      DATABASE_URL: "postgresql://user:pass@[::1]:5432/plants",
    }),
    { host: "::1" },
  );
  assert.deepEqual(
    resolveLocalPostgresTarget({
      DATABASE_URL: "postgresql://user:pass@localhost/plants",
      DB_HOST: "remote.invalid",
    }),
    { host: "localhost" },
  );
});

test("local PostgreSQL target rejects remote, public, and empty hosts", () => {
  for (const host of ["db.example.invalid", "8.8.8.8", "localhost,127.0.0.1"]) {
    assert.throws(
      () => resolveLocalPostgresTarget({ DB_HOST: host }),
      /restricted to local hosts/,
    );
  }
  for (const env of [{}, { DB_HOST: "" }]) {
    assert.throws(
      () => resolveLocalPostgresTarget(env),
      /host is required/,
    );
  }
  assert.throws(
    () => resolveLocalPostgresTarget({ DB_HOST: "", PGHOST: "" }),
    /restricted to local hosts/,
  );
});

test("local PostgreSQL target rejects explicitly empty or whitespace URLs", () => {
  for (const databaseUrl of ["", "   "]) {
    assert.throws(
      () =>
        resolveLocalPostgresTarget({
          DATABASE_URL: databaseUrl,
          DB_HOST: "localhost",
        }),
      /Invalid PostgreSQL migration URL/,
    );
  }
  for (const databaseUrl of [null, 42]) {
    assert.throws(
      () =>
        resolveLocalPostgresTarget({
          DATABASE_URL: databaseUrl,
          DB_HOST: "localhost",
        }),
      /Invalid PostgreSQL migration URL/,
    );
  }
});

test("local PostgreSQL target falls back when DATABASE_URL is absent", () => {
  assert.deepEqual(
    resolveLocalPostgresTarget({ DB_HOST: "localhost" }),
    { host: "localhost" },
  );
});

test("local PostgreSQL target rejects malformed URLs and never falls back", () => {
  const secret = "migration-test-secret";
  assert.throws(
    () =>
      resolveLocalPostgresTarget({
        DATABASE_URL: `postgresql://user:${secret}@[::1`,
        DB_HOST: "localhost",
      }),
    (error) => {
      assert.match(error.message, /Invalid PostgreSQL migration URL/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("local PostgreSQL target rejects unsupported URL protocols and routing options", () => {
  assert.throws(
    () => resolveLocalPostgresTarget({ DATABASE_URL: "mysql://localhost/plants" }),
    /Unsupported PostgreSQL migration URL protocol/,
  );
  for (const option of ["host", "hostaddr", "service"]) {
    assert.throws(
      () =>
        resolveLocalPostgresTarget({
          DATABASE_URL: `postgresql://localhost/plants?${option}=other`,
        }),
      /Unsupported PostgreSQL migration URL override/,
    );
  }
});

test("local PostgreSQL target rejects environment routing overrides", () => {
  for (const override of ["PGHOSTADDR", "PGSERVICE"]) {
    assert.throws(
      () =>
        resolveLocalPostgresTarget({
          DB_HOST: "localhost",
          [override]: "remote-target",
        }),
      /Unsupported PostgreSQL migration connection override/,
    );
  }
});

test("local PostgreSQL target errors never reveal URL credentials", () => {
  const secret = "do-not-disclose";
  assert.throws(
    () =>
      resolveLocalPostgresTarget({
        DATABASE_URL: `postgresql://private-user:${secret}@remote.invalid/plants`,
      }),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes("private-user"), false);
      return true;
    },
  );
});

test("backup uses a temporary custom archive, validates it, then promotes it", (t) => {
  const directory = temporaryDirectory(t);
  const destination = join(directory, "complete.dump");
  const calls = [];
  let temporaryDuringValidation;
  const result = backupPostgres(destination, {
    settings: {
      DATABASE_URL: "postgresql://test-user:test-password@localhost:5432/plants",
    },
    schemas: [],
    run(binary, args, options) {
      calls.push({ binary, args, options });
      if (binary === "pg_dump") {
        temporaryDuringValidation = archivePath(args);
        assert.match(basename(temporaryDuringValidation), /\.partial$/);
        fs.writeFileSync(temporaryDuringValidation, "mock custom archive");
        return { status: 0 };
      }
      assert.equal(binary, "pg_restore");
      assert.deepEqual(args, ["--list", temporaryDuringValidation]);
      assert.equal(fs.existsSync(temporaryDuringValidation), true);
      assert.equal(fs.existsSync(destination), false);
      return { status: 0 };
    },
  });

  assert.deepEqual(calls[0].args.slice(0, 3), [
    "--format=custom",
    "--no-password",
    "--file",
  ]);
  assert.equal(calls[0].args.includes("--schema"), false);
  assert.equal(
    JSON.stringify(calls[0].args).includes("test-password"),
    false,
  );
  assert.equal(result.archiveValidated, true);
  assert.equal(result.restorationTested, false);
  assert.equal(fs.readFileSync(destination, "utf8"), "mock custom archive");
  assert.equal(fs.existsSync(temporaryDuringValidation), false);
});

test("schema-filtered backups remain available to other callers", (t) => {
  const directory = temporaryDirectory(t);
  const calls = [];
  backupPostgres(join(directory, "filtered.dump"), {
    settings: { DB_HOST: "localhost" },
    schemas: ["plant_auth"],
    run(binary, args) {
      calls.push({ binary, args });
      if (binary === "pg_dump")
        fs.writeFileSync(archivePath(args), "mock archive");
      return { status: 0 };
    },
  });
  assert.ok(calls[0].args.includes("--schema"));
  assert.ok(calls[0].args.includes("plant_auth"));
});

test("non-zero dump exit and process errors remove the temporary archive", (t) => {
  const directory = temporaryDirectory(t);
  for (const [name, failure] of [
    ["nonzero", { status: 2 }],
    ["process-error", { error: Error("mock process error"), status: null }],
  ]) {
    let temporary;
    assert.throws(
      () =>
        backupPostgres(join(directory, `failure-${name}.dump`), {
          settings: { DB_HOST: "localhost" },
          schemas: [],
          run(_binary, args) {
            temporary = archivePath(args);
            return failure;
          },
        }),
      /PostgreSQL backup failed/,
    );
    assert.equal(fs.existsSync(temporary), false);
  }
});

test("missing and empty dump archives are rejected and cleaned up", (t) => {
  const directory = temporaryDirectory(t);
  for (const mode of ["missing", "empty"]) {
    let temporary;
    assert.throws(
      () =>
        backupPostgres(join(directory, `${mode}.dump`), {
          settings: { DB_HOST: "localhost" },
          schemas: [],
          run(binary, args) {
            if (binary === "pg_dump") {
              temporary = archivePath(args);
              if (mode === "missing") fs.unlinkSync(temporary);
            }
            return { status: 0 };
          },
        }),
      /archive file was not created/,
    );
    assert.equal(fs.existsSync(temporary), false);
  }
});

test("restore-list failure removes the temporary archive", (t) => {
  const directory = temporaryDirectory(t);
  let temporary;
  assert.throws(
    () =>
      backupPostgres(join(directory, "invalid.dump"), {
        settings: { DB_HOST: "localhost" },
        schemas: [],
        run(binary, args) {
          if (binary === "pg_dump") {
            temporary = archivePath(args);
            fs.writeFileSync(temporary, "not a valid archive");
            return { status: 0 };
          }
          return { status: 1 };
        },
      }),
    /archive validation failed/,
  );
  assert.equal(fs.existsSync(temporary), false);
});

test("existing backup destinations are never overwritten", (t) => {
  const directory = temporaryDirectory(t);
  const destination = join(directory, "existing.dump");
  fs.writeFileSync(destination, "previous valid backup");
  let processCalls = 0;
  assert.throws(
    () =>
      backupPostgres(destination, {
        schemas: [],
        run() {
          processCalls++;
          return { status: 0 };
        },
      }),
    /Refusing to overwrite an existing backup/,
  );
  assert.equal(processCalls, 0);
  assert.equal(fs.readFileSync(destination, "utf8"), "previous valid backup");
});

test("backup promotion does not overwrite a destination created during validation", (t) => {
  const directory = temporaryDirectory(t);
  const destination = join(directory, "racing.dump");
  let temporary;
  assert.throws(
    () =>
      backupPostgres(destination, {
        settings: { DB_HOST: "localhost" },
        schemas: [],
        run(binary, args) {
          if (binary === "pg_dump") {
            temporary = archivePath(args);
            fs.writeFileSync(temporary, "validated archive");
          } else {
            fs.writeFileSync(destination, "another backup");
          }
          return { status: 0 };
        },
      }),
    /Refusing to overwrite an existing backup/,
  );
  assert.equal(fs.readFileSync(destination, "utf8"), "another backup");
  assert.equal(fs.existsSync(temporary), false);
});

test("temporary filename collisions retry without taking over the existing path", (t) => {
  const directory = temporaryDirectory(t);
  const openedPaths = [];
  const fileSystem = makeFileSystem({
    openSync(path, flags, mode) {
      openedPaths.push(path);
      if (openedPaths.length === 1) {
        fs.writeFileSync(path, "another attempt's temporary file");
        const error = Error("simulated collision");
        error.code = "EEXIST";
        throw error;
      }
      return fs.openSync(path, flags, mode);
    },
  });
  backupPostgres(join(directory, "collision.dump"), {
    settings: { DB_HOST: "localhost" },
    schemas: [],
    fileSystem,
    run(binary, args) {
      if (binary === "pg_dump")
        fs.writeFileSync(archivePath(args), "mock archive");
      return { status: 0 };
    },
  });
  assert.equal(openedPaths.length, 2);
  assert.notEqual(openedPaths[0], openedPaths[1]);
  assert.equal(fs.readFileSync(openedPaths[0], "utf8"), "another attempt's temporary file");
  assert.equal(fs.existsSync(openedPaths[1]), false);
});

test("cleanup ignores ENOENT and reports other cleanup errors with the backup error", (t) => {
  const directory = temporaryDirectory(t);
  const missingFileSystem = makeFileSystem({
    unlinkSync(path) {
      fs.unlinkSync(path);
      const error = Error("already absent");
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.throws(
    () =>
      backupPostgres(join(directory, "absent.dump"), {
        settings: { DB_HOST: "localhost" },
        schemas: [],
        fileSystem: missingFileSystem,
        run: () => ({ status: 1 }),
      }),
    (error) => {
      assert.match(error.message, /PostgreSQL backup failed/);
      assert.equal(error.message.includes("cleanup also failed"), false);
      return true;
    },
  );

  const failedCleanupFileSystem = makeFileSystem({
    unlinkSync() {
      const error = Error("cleanup denied");
      error.code = "EACCES";
      throw error;
    },
  });
  assert.throws(
    () =>
      backupPostgres(join(directory, "cleanup-failure.dump"), {
        settings: { DB_HOST: "localhost" },
        schemas: [],
        fileSystem: failedCleanupFileSystem,
        run: () => ({ status: 1 }),
      }),
    (error) => {
      assert.match(error.message, /PostgreSQL backup failed/);
      assert.match(error.message, /Temporary archive cleanup also failed/);
      return true;
    },
  );
});

test("migration rejects remote targets before creating a pool", async () => {
  let poolsCreated = 0;
  await assert.rejects(
    runMigration({
      env: localEnvironment({
        DATABASE_URL: "postgresql://user:secret@remote.invalid/plants",
      }),
      createPool() {
        poolsCreated++;
        throw Error("pool must not be created");
      },
    }),
    /restricted to local hosts/,
  );
  assert.equal(poolsCreated, 0);
});

test("migration backs up before BEGIN and applies SQL files in the required order", async () => {
  const events = [];
  const filesRead = [];
  const mock = runnerMock({ qrState: { plant_count: 2 } });
  const { client } = mock;
  const originalRelease = client.release;
  client.release = () => { events.push("release"); originalRelease(); };
  const originalQuery = client.query;
  client.query = async (sql, params) => {
    events.push(`query:${sql}`);
    return originalQuery(sql, params);
  };
  let poolEnvironment;
  let backupOptions;
  const result = await runMigration({
    env: localEnvironment({ PGHOST: "remote.invalid" }),
    backupFile: "mock-backup.dump",
    createPool(env) {
      poolEnvironment = env;
      events.push("create-pool");
      return {
        async connect() {
          events.push("connect");
          return client;
        },
        async end() {
          events.push("pool-end");
        },
      };
    },
    createBackup(_path, options) {
      backupOptions = options;
      events.push("backup");
    },
    readFile(path) {
      const file = basename(path);
      filesRead.push(file);
      events.push(`read:${file}`);
      return file;
    },
  });

  assert.equal(result, undefined);
  assert.equal(poolEnvironment.DB_HOST, "localhost");
  assert.equal(poolEnvironment.PGHOST, "localhost");
  assert.equal(backupOptions.settings, poolEnvironment);
  assert.equal(backupOptions.schemas.length, 0);
  assert.equal(backupOptions.connection, undefined);
  assert.ok(events.indexOf("backup") < events.indexOf("query:BEGIN"));
  assert.ok(events.indexOf("backup") < events.indexOf("read:schema.postgres.sql"));
  assert.deepEqual(filesRead, [
    "schema.postgres.sql", "014-move-qr-code-to-plant-app.sql",
    "003-plant-qr-inventory.sql", "015-local-qr-only-move.sql",
  ]);
  assert.deepEqual(
    mock.statements.filter((sql) => filesRead.includes(sql)),
    filesRead.slice(0, 3),
  );
});

test("migration history prevents replay on repeat runs", async () => {
  const mock = runnerMock({ qrState: { plant_count: 2 } });
  const filesRead = [];
  const options = {
    env: localEnvironment(),
    createPool: mock.createPool,
    createBackup() {},
    readFile(path) {
      const file = basename(path);
      filesRead.push(file);
      return file;
    },
  };

  await runMigration(options);
  await runMigration(options);

  assert.deepEqual([...mock.records.keys()].sort(), [
    "003-plant-qr-inventory.sql",
    "014-move-qr-code-to-plant-app.sql",
  ]);
  assert.deepEqual(filesRead, [
    "schema.postgres.sql",
    "014-move-qr-code-to-plant-app.sql",
    "003-plant-qr-inventory.sql",
    "015-local-qr-only-move.sql",
    "schema.postgres.sql",
    "014-move-qr-code-to-plant-app.sql",
    "003-plant-qr-inventory.sql",
    "015-local-qr-only-move.sql",
  ]);
  assert.equal(
    mock.statements.filter((sql) => sql === "014-move-qr-code-to-plant-app.sql").length,
    1,
  );
  assert.equal(
    mock.statements.filter((sql) => sql === "003-plant-qr-inventory.sql").length,
    1,
  );
});

test("complete migration 015 catalog recognizes 015 and supersedes 014 without execution", async () => {
  const mock = runnerMock({
    catalog: {
      source_absent: true,
      destination_present: true,
      regular_table: true,
      reviewed_columns: true,
      reviewed_defaults: true,
      reviewed_indexes: true,
      reviewed_constraints: true,
      reviewed_incoming_foreign_keys: true,
      sequence_owned_in_plant_app: true,
    },
    qrState: { plant_count: 1, matched_count: 1 },
  });
  const filesRead = [];
  await runMigration({
    env: localEnvironment(),
    createPool: mock.createPool,
    createBackup() {},
    readFile(path) {
      const file = basename(path);
      filesRead.push(file);
      return file;
    },
  });
  assert.equal(mock.records.get("015-local-qr-only-move.sql").resolution, "recognized");
  assert.equal(mock.records.get("015-local-qr-only-move.sql").executed_at, null);
  assert.equal(mock.records.get("014-move-qr-code-to-plant-app.sql").resolution, "superseded");
  assert.equal(mock.records.get("014-move-qr-code-to-plant-app.sql").superseded_by, "015-local-qr-only-move.sql");
  assert.equal(mock.statements.includes("014-move-qr-code-to-plant-app.sql"), false);
  assert.equal(mock.statements.includes("003-plant-qr-inventory.sql"), false);
});

test("recorded 015 history prevents 014 replay after a later QR schema change", async () => {
  const mock = runnerMock({
    catalog: { source_absent: true, destination_present: true },
    ledger: [
      {
        migration_name: "015-local-qr-only-move.sql",
        migration_checksum: migrationState.checksum("015-local-qr-only-move.sql"),
        resolution: "recognized", executed_at: null, recognized_at: new Date(), superseded_by: null,
      },
      {
        migration_name: "014-move-qr-code-to-plant-app.sql",
        migration_checksum: migrationState.checksum("014-move-qr-code-to-plant-app.sql"),
        resolution: "superseded", executed_at: null, recognized_at: new Date(),
        superseded_by: "015-local-qr-only-move.sql",
      },
      {
        migration_name: "003-plant-qr-inventory.sql",
        migration_checksum: migrationState.checksum("003-plant-qr-inventory.sql"),
        resolution: "executed", executed_at: new Date(), recognized_at: null, superseded_by: null,
      },
    ],
  });
  await runMigration({
    env: localEnvironment(), createPool: mock.createPool, createBackup() {},
    readFile(path) { return basename(path); },
  });
  assert.equal(mock.statements.includes("014-move-qr-code-to-plant-app.sql"), false);
  assert.equal(mock.statements.includes("003-plant-qr-inventory.sql"), false);
  assert.equal(mock.statements.includes("COMMIT"), true);
});

test("unledgered but complete migration 003 is recognized, not replayed", async () => {
  const mock = runnerMock({
    catalog: {
      source_absent: true, destination_present: true, regular_table: true,
      reviewed_columns: true, reviewed_defaults: true, reviewed_indexes: true,
      reviewed_constraints: true, reviewed_incoming_foreign_keys: true,
      sequence_owned_in_plant_app: true,
    },
    qrState: { plant_count: 2, matched_count: 2 },
  });
  await runMigration({
    env: localEnvironment(), createPool: mock.createPool, createBackup() {},
    readFile(path) { return basename(path); },
  });
  const row = mock.records.get("003-plant-qr-inventory.sql");
  assert.equal(row.resolution, "recognized");
  assert.equal(row.executed_at, null);
  assert.equal(row.recognized_at instanceof Date, true);
  assert.equal(mock.statements.includes("003-plant-qr-inventory.sql"), false);
});

test("unledgered and clearly unapplied migration 003 executes once", async () => {
  const mock = runnerMock({ qrState: { plant_count: 2, matched_count: 0 } });
  await runMigration({
    env: localEnvironment(), createPool: mock.createPool, createBackup() {},
    readFile(path) { return basename(path); },
  });
  const row = mock.records.get("003-plant-qr-inventory.sql");
  assert.equal(row.resolution, "executed");
  assert.equal(row.executed_at instanceof Date, true);
  assert.equal(row.recognized_at, null);
  assert.equal(mock.statements.filter((sql) => sql === "003-plant-qr-inventory.sql").length, 1);
});

test("ambiguous unledgered migration 003 state rolls back and stops for review", async () => {
  const mock = runnerMock({ qrState: { plant_count: 3, matched_count: 1 } });
  await assert.rejects(runMigration({
    env: localEnvironment(), createPool: mock.createPool, createBackup() {},
    readFile(path) { return basename(path); },
  }), /Migration 003 QR inventory state is partial or inconsistent/);
  assert.equal(mock.statements.includes("ROLLBACK"), true);
  assert.equal(mock.statements.includes("COMMIT"), false);
  assert.equal(mock.statements.includes("003-plant-qr-inventory.sql"), false);
});

test("legacy ledger rows without checksums stop before migration SQL", async () => {
  const mock = runnerMock({ ledger: [{
    migration_name: "014-move-qr-code-to-plant-app.sql",
    migration_checksum: null,
    resolution: "executed",
    executed_at: new Date(),
    recognized_at: null,
    superseded_by: null,
  }] });
  await assert.rejects(runMigration({
    env: localEnvironment(), createPool: mock.createPool, createBackup() {},
    readFile(path) { return basename(path); },
  }), /Migration history checksum needs operator review/);
  assert.equal(mock.statements.includes("014-move-qr-code-to-plant-app.sql"), false);
  assert.equal(mock.statements.includes("ROLLBACK"), true);
});

test("backup failure prevents BEGIN and all migration SQL", async () => {
  const statements = [];
  let filesRead = 0;
  const client = {
    async query(sql) {
      statements.push(sql);
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    runMigration({
      env: localEnvironment(),
      createPool() {
        return {
          async connect() {
            return client;
          },
          async end() {},
        };
      },
      createBackup() {
        throw Error("mock backup failure");
      },
      readFile() {
        filesRead++;
        return "";
      },
    }),
    /mock backup failure/,
  );
  assert.equal(statements.includes("BEGIN"), false);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(filesRead, 0);
});

test("migration rolls back failures after BEGIN", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql === "SELECT pg_advisory_xact_lock(87423901)")
        throw Error("mock post-BEGIN failure");
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    runMigration({
      env: localEnvironment(),
      createPool() {
        return {
          async connect() {
            return client;
          },
          async end() {},
        };
      },
      createBackup() {},
      readFile() {
        return "";
      },
    }),
    /mock post-BEGIN failure/,
  );
  assert.equal(statements.includes("BEGIN"), true);
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(statements.includes("COMMIT"), false);
});

test("QR-only runner validates the exact local database before creating a pool", async () => {
  for (const env of [
    localQrEnvironment({
      DATABASE_URL: "postgresql://user:secret@remote.invalid/plant_conservation_dev",
    }),
    localQrEnvironment({ DB_NAME: "other_database" }),
    localQrEnvironment({
      DATABASE_URL: "postgresql://user:secret@localhost/other_database",
    }),
  ]) {
    let poolsCreated = 0;
    await assert.rejects(
      runQrOnlyMigration({
        env,
        createPool() {
          poolsCreated++;
          throw Error("pool must not be created");
        },
      }),
    );
    assert.equal(poolsCreated, 0);
  }
});

test("QR-only runner backs up first and executes only the local QR move", async () => {
  const events = [];
  const filesRead = [];
  const statements = [];
  let poolEnvironment;
  let backupOptions;
  const client = {
    async query(sql) {
      events.push(`query:${sql}`);
      statements.push(sql);
      if (sql.includes("AS source_exists"))
        return {
          rows: [{
            source_exists: true,
            schema_exists: true,
            can_move: true,
            can_create: true,
          }],
        };
      return { rows: [] };
    },
    release() {
      events.push("release");
    },
  };
  await runQrOnlyMigration({
    env: localQrEnvironment({ PGHOST: "remote.invalid" }),
    backupFile: "mock-local-qr-backup.dump",
    createPool(env) {
      poolEnvironment = env;
      events.push("create-pool");
      return {
        async connect() {
          events.push("connect");
          return client;
        },
        async end() {
          events.push("pool-end");
        },
      };
    },
    async createBackup(_path, options) {
      backupOptions = options;
      events.push("backup");
    },
    readFile(path) {
      const file = basename(path);
      filesRead.push(file);
      events.push(`read:${file}`);
      return "BEGIN;\nSELECT local_qr_move;\nCOMMIT;";
    },
  });

  assert.equal(poolEnvironment.DB_HOST, "localhost");
  assert.equal(poolEnvironment.PGHOST, "localhost");
  assert.equal(poolEnvironment.PLANT_PG_SCHEMA, "plant_app");
  assert.equal(backupOptions.settings, poolEnvironment);
  assert.deepEqual(backupOptions.schemas, []);
  assert.equal(backupOptions.connection, undefined);
  assert.ok(events.indexOf("query:" + statements[0]) < events.indexOf("backup"));
  assert.ok(events.indexOf("backup") < events.indexOf("query:BEGIN"));
  assert.deepEqual(filesRead, ["015-local-qr-only-move.sql"]);
  assert.ok(statements[0].includes("AS source_exists"));
  assert.deepEqual(statements.slice(1), [
    "BEGIN",
    "SELECT pg_advisory_xact_lock(87423902)",
    "SELECT local_qr_move;",
    "COMMIT",
  ]);
});

test("QR-only runner rejects missing move or schema privileges before backup", async () => {
  for (const [permissions, message] of [
    [
      { source_exists: true, schema_exists: true, can_move: false, can_create: true },
      /effective ownership rights on public\.qr_code/,
    ],
    [
      { source_exists: true, schema_exists: true, can_move: true, can_create: false },
      /requires CREATE privilege on plant_app/,
    ],
  ]) {
    let backupAttempted = false;
    const statements = [];
    const client = {
      async query(sql) {
        statements.push(sql);
        return { rows: [permissions] };
      },
      release() {},
    };

    await assert.rejects(
      runQrOnlyMigration({
        env: localQrEnvironment(),
        createPool() {
          return {
            async connect() { return client; },
            async end() {},
          };
        },
        async createBackup() { backupAttempted = true; },
      }),
      message,
    );
    assert.equal(backupAttempted, false);
    assert.equal(statements.length, 1);
    assert.ok(statements[0].includes("pg_has_role"));
    assert.ok(statements[0].includes("has_schema_privilege"));
  }
});

test("QR-only backup failure prevents BEGIN and reading migration SQL", async () => {
  const statements = [];
  let filesRead = 0;
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("AS source_exists"))
        return {
          rows: [{
            source_exists: true,
            schema_exists: true,
            can_move: true,
            can_create: true,
          }],
        };
      return { rows: [] };
    },
    release() {},
  };
  await assert.rejects(
    runQrOnlyMigration({
      env: localQrEnvironment(),
      createPool() {
        return {
          async connect() {
            return client;
          },
          async end() {},
        };
      },
      async createBackup() {
        throw Error("mock local backup failure");
      },
      readFile() {
        filesRead++;
        return "";
      },
    }),
    /mock local backup failure/,
  );
  assert.equal(statements.length, 1);
  assert.ok(statements[0].includes("AS source_exists"));
  assert.equal(statements.includes("BEGIN"), false);
  assert.equal(statements.includes("ROLLBACK"), false);
  assert.equal(filesRead, 0);
});
