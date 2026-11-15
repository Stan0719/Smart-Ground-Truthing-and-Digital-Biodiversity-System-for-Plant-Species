"use strict";
// All databases are disposable PGlite; startup wiring uses injected doubles.
// Never loads environment files, opens live connections or runs server.start().
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { useVerifiedPhotoKeyTypes } = require("./species-photo-bigint-fixture.cjs");
const { scopedPool } = require("../database.cjs");
const { inspectSpeciesPhotoStartup, verifySpeciesPhotoStartup } = require("../species-photo-startup.cjs");
const domain = require("../domain.cjs");
const uploads = require("../uploads.cjs");
const gallery = require("../species-gallery.cjs");
const { types } = require("pg");
const migration = (name) => readFileSync(join(__dirname, "../migrations", name), "utf8");

test("private startup inspection uses the supplied scoped pool, not SQL Editor state", async (t) => {
  const raw = await createPlantDatabase();
  t.after(() => raw.end());
  await raw.query("CREATE SCHEMA plant_app; SET search_path TO plant_app,pg_catalog;");
  await raw.query(readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"));
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql",
    "008-record-change-submissions.sql", "009-record-version-history.sql"])
    await raw.query(migration(name));
  await useVerifiedPhotoKeyTypes(raw);
  await raw.query("INSERT INTO species(scientific_name) VALUES('Unchanged')");
  const statements = [];
  let checkouts = 0, releases = 0;
  const pool = scopedPool({
    async connect() {
      checkouts++;
      const c = await raw.connect();
      return {
        async query(sql, args) {
          statements.push(sql);
          const result = await c.query(sql, args);
          const field = result.fields?.find((item) => item.name === "schemas");
          if (!field) return result;
          // PGlite decodes name[] as an array, unlike the installed pg driver.
          // Reproduce pg's text-protocol decoding using the actual result OID.
          return { ...result, rows: result.rows.map((row) => ({ ...row,
            schemas: types.getTypeParser(field.dataTypeID, "text")(
              `{${row.schemas.join(",")}}`,
            ),
          })) };
        },
        release() { releases++; c.release(); },
      };
    },
    end: () => assert.fail("diagnostic must not close the application pool"),
  }, "plant_app");
  assert.equal(pool.schema, "plant_app");
  assert.throws(() => { pool.schema = "public"; }, TypeError);
  await raw.query("SET search_path TO public,pg_catalog");

  const absent = await inspectSpeciesPhotoStartup({ pool, writesEnabled: false });
  for (const field of ["currentUser", "sessionUser", "configuredSchema", "effectiveSchema",
    "searchPath", "readOnlyTransaction", "readers", "managementWritesDisabled", "readerStartup"])
    assert.equal(absent[field].status, "VERIFIED", JSON.stringify(absent));
  assert.equal(absent.currentUser.value, "postgres");
  assert.equal(absent.sessionUser.value, "postgres");
  assert.equal(absent.effectiveSchema.value, "plant_app");
  assert.equal(absent.readers.value, "membership-aware-v1");
  assert.equal(absent.photoSchema.status, "UNKNOWN");
  assert.equal(absent.photoSchema.migration014, "verified-absent");
  assert.equal(checkouts, 2);
  assert.equal(releases, checkouts);
  assert.equal((await raw.query("SELECT current_schema() AS schema")).rows[0].schema, "public");

  await raw.query("SET search_path TO plant_app,pg_catalog");
  await raw.query(migration("014-species-image-gallery.sql"));
  const partial = await inspectSpeciesPhotoStartup({ pool, writesEnabled: false });
  assert.equal(partial.readerStartup.status, "VERIFIED");
  assert.equal(partial.photoSchema.status, "FAILED");
  await raw.query(migration("015-species-photo-roles.sql"));
  const logs = [];
  const ready = await verifySpeciesPhotoStartup({ enabled: true, pool, writesEnabled: false,
    log: (...args) => logs.push(args) });
  assert.equal(ready.photoSchema.status, "VERIFIED", JSON.stringify(ready));
  assert.equal(ready.photoSchema.migration014, "verified-applied");
  assert.equal(ready.photoSchema.migration015, "verified-applied");
  assert.equal(logs.length, 1);
  assert.equal(releases, checkouts);
  assert.ok(statements.every((sql) => /^(BEGIN\b|SET LOCAL search_path\b|SELECT\b|COMMIT\b|ROLLBACK\b)/i.test(sql.trim())));
  assert.equal(statements.filter((sql) => /^BEGIN\b/i.test(sql)).length, 6);
  assert.ok(statements.filter((sql) => /^BEGIN\b/i.test(sql)).every((sql) => /READ ONLY$/.test(sql)));
  assert.deepEqual((await raw.query("SELECT scientific_name FROM plant_app.species")).rows,
    [{ scientific_name: "Unchanged" }]);
  assert.equal((await raw.query("SELECT count(*)::text AS n FROM plant_app.species_image_collection")).rows[0].n, "0");
});

const identity = {
  current_user: "postgres", session_user: "postgres", effective_schema: "plant_app",
  search_path: '"plant_app", pg_catalog', schemas: ["plant_app", "pg_catalog"], read_only: "on",
};

test("installed pg decoder distinguishes name[] from text[] without opening a connection", () => {
  const wireValue = "{plant_app,pg_catalog}";
  assert.equal(types.getTypeParser(1003, "text")(wireValue), wireValue);
  assert.deepEqual(types.getTypeParser(1009, "text")(wireValue), ["plant_app", "pg_catalog"]);
});
function identityPool(row = identity, schema = "plant_app") {
  let released = false;
  return {
    schema,
    async connect() {
      return { query: async () => ({ rows: [row] }), release: () => { released = true; } };
    },
    get released() { return released; },
  };
}

test("only the two expected schemas pass, allowing balanced quotes and surrounding whitespace", async () => {
  for (const search_path of [
    "plant_app,pg_catalog",
    "plant_app, pg_catalog",
    '"plant_app", pg_catalog',
    '"plant_app", "pg_catalog"',
    ' \t"plant_app" \t,\n "pg_catalog"  ',
  ]) {
    const report = await inspectSpeciesPhotoStartup({
      pool: identityPool({ ...identity, search_path }), writesEnabled: false,
    });
    assert.equal(report.searchPath.status, "VERIFIED", JSON.stringify(search_path));
    assert.equal(report.readerStartup.status, "VERIFIED");
  }
  for (const row of [
    { search_path: "public, pg_catalog", schemas: ["public", "pg_catalog"] },
    { search_path: "pg_catalog, plant_app", schemas: ["pg_catalog", "plant_app"] },
    { search_path: "plant_app, plant_app", schemas: ["plant_app", "plant_app"] },
    { search_path: "plant_app, pg_catalog, public", schemas: ["plant_app", "pg_catalog", "public"] },
    // Unresolved names can disappear from current_schemas: check the raw path too.
    { search_path: "plant_app, missing_schema, pg_catalog" },
    { search_path: '"$user", plant_app, pg_catalog' },
    { search_path: "plant_app, pg_catalog," },
    { search_path: '"plant_app, pg_catalog' },
    { search_path: 'plant_app", pg_catalog' },
    { search_path: '"plant_app", "pg_catalog' },
    { search_path: '"PLANT_APP", pg_catalog', schemas: ["PLANT_APP", "pg_catalog"] },
    { search_path: "plant_app, pg_catalog; SELECT 1" },
    { schemas: ["plant_app", "pg_catalog", "unexpected"] },
    { schemas: ["public", "pg_catalog"] },
    { schemas: "{plant_app,pg_catalog}" },
    { schemas: null },
  ]) {
    const report = await inspectSpeciesPhotoStartup({
      pool: identityPool({ ...identity, ...row }), writesEnabled: false,
    });
    assert.equal(report.searchPath.status, "FAILED", JSON.stringify(row));
    assert.equal(report.readerStartup.status, "FAILED");
    assert.equal(report.photoSchema.status, "UNKNOWN");
  }
});

test("disabled diagnostic does not query or log; failures never log connection details", async () => {
  assert.equal(await verifySpeciesPhotoStartup({
    pool: { connect: () => assert.fail("disabled check must not acquire a client") },
    log: () => assert.fail("disabled check must not log"),
  }), null);
  const secret = "postgresql://secret-user:secret-password@private-host/project-token";
  const logs = [];
  await assert.rejects(verifySpeciesPhotoStartup({ enabled: true,
    pool: { schema: "plant_app", connect: async () => { throw Error(secret); } },
    writesEnabled: false, log: (...args) => logs.push(args),
  }), { code: "PHOTO_STARTUP_CHECK_FAILED" });
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify(logs).includes(secret));
  const report = JSON.parse(logs[0][1]);
  assert.equal(report.currentUser.status, "UNKNOWN");
  assert.equal(report.readerStartup.status, "FAILED");
  assert.equal(report.photoSchema.status, "UNKNOWN");
});

test("schema, role, transaction and loaded-reader mismatches fail closed and redact unexpected values", async () => {
  const secret = "project-sensitive-unexpected-value";
  const cases = [
    ["currentUser", { ...identity, current_user: secret }],
    ["sessionUser", { ...identity, session_user: secret }],
    ["effectiveSchema", { ...identity, effective_schema: "public" }],
    ["searchPath", { ...identity, search_path: secret, schemas: ["public"] }],
    ["readOnlyTransaction", { ...identity, read_only: "off" }],
  ];
  for (const [field, row] of cases) {
    const pool = identityPool(row);
    const report = await inspectSpeciesPhotoStartup({ pool, writesEnabled: false });
    assert.equal(report[field].status, "FAILED");
    assert.equal(report.readerStartup.status, "FAILED");
    assert.ok(!JSON.stringify(report).includes(secret));
    assert.equal(pool.released, true);
  }
  const badSchema = await inspectSpeciesPhotoStartup({ pool: identityPool(identity, secret), writesEnabled: false });
  assert.equal(badSchema.configuredSchema.status, "FAILED");
  assert.ok(!JSON.stringify(badSchema).includes(secret));
  const incompatible = await inspectSpeciesPhotoStartup({ pool: identityPool(), writesEnabled: false,
    readers: { domain: domain.speciesImageReader, uploads: { ...uploads.speciesImageReader, version: 0 }, membershipSql: gallery.membershipSql } });
  assert.equal(incompatible.readers.status, "FAILED");
  const missing = await inspectSpeciesPhotoStartup({ pool: identityPool(), writesEnabled: false, readers: {} });
  assert.equal(missing.readers.status, "UNKNOWN");
  const wrongHelper = await inspectSpeciesPhotoStartup({ pool: identityPool(), writesEnabled: false,
    readers: { domain: domain.speciesImageReader, uploads: uploads.speciesImageReader, membershipSql: () => "TRUE" } });
  assert.equal(wrongHelper.readers.status, "FAILED");
  const enabled = await inspectSpeciesPhotoStartup({ pool: identityPool(), writesEnabled: true });
  assert.equal(enabled.managementWritesDisabled.status, "FAILED");
  assert.equal(enabled.readerStartup.status, "FAILED");
});

test("transaction failures roll back and release without leaking the error", async () => {
  const statements = [];
  let released = false;
  const report = await inspectSpeciesPhotoStartup({ writesEnabled: false, pool: {
    schema: "plant_app", connect: async () => ({
      async query(sql) {
        statements.push(sql);
        if (sql.startsWith("SELECT")) throw Error("private-connection-error");
        return { rows: [] };
      },
      release() { released = true; },
    }),
  } });
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(released, true);
  assert.equal(report.currentUser.status, "UNKNOWN");
  assert.ok(!JSON.stringify(report).includes("private-connection-error"));
});

test("metadata checkout failure stays UNKNOWN without leaking details or blocking reader deployment", async () => {
  let checkouts = 0;
  const logs = [];
  const identityClient = identityPool();
  const report = await verifySpeciesPhotoStartup({ enabled: true, writesEnabled: false,
    pool: { schema: "plant_app", async connect() {
      if (++checkouts === 1) return identityClient.connect();
      throw Error("private-metadata-connection-detail");
    } },
    log: (...args) => logs.push(args),
  });
  assert.equal(checkouts, 2);
  assert.equal(identityClient.released, true);
  assert.equal(report.readerStartup.status, "VERIFIED");
  assert.equal(report.photoSchema.status, "UNKNOWN");
  assert.ok(!JSON.stringify(logs).includes("private-metadata-connection-detail"));
});

test("production startup opts in before listening and closes existing resources on diagnostic failure", async () => {
  const source = readFileSync(join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("  const speciesPhotoWritesEnabled = speciesPhotoWritesRequested();", source.indexOf("async function start()"));
  assert.ok(start >= 0);
  const code = source.slice(start, source.indexOf("  const officerNotifications =", start));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const enabled of [false, true]) {
    const events = [];
    const pool = { query: async () => events.push("preflight"), end: async () => events.push("pool-closed") };
    const auth = { db: { close: async () => events.push("auth-closed") } };
    const run = new AsyncFunction("auth", "pool", "process", "require", "speciesPhotoWritesRequested", code);
    const result = run(auth, pool, { argv: enabled ? ["--verify-species-photo-startup"] : [] }, () => ({
      verifySpeciesPhotoStartup: async (options) => {
        assert.equal(options.pool, pool);
        assert.equal(options.writesEnabled, false);
        events.push("diagnostic");
        throw Object.assign(Error("Expected offline failure"), { code: "PHOTO_STARTUP_CHECK_FAILED" });
      },
    }), () => false);
    if (enabled) {
      await assert.rejects(result, { code: "PHOTO_STARTUP_CHECK_FAILED" });
      assert.deepEqual(events, ["diagnostic", "auth-closed", "pool-closed"]);
    } else {
      await result;
      assert.deepEqual(events, ["preflight", "preflight", "preflight", "preflight"]);
    }
  }
});
