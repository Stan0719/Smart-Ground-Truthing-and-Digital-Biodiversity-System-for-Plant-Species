 "use strict";
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  TARGET, assertContainerInspection, assertDatabaseIdentity, assertMovePermissions,
  assertTargetEnvironment, createAndVerifyBackup, extractPreflightOnlySql, parseMode,
  splitTransactionWrappedMigration, verifyBackupListing,
} = require("../scripts/migrate-qr-restore-test.cjs");

const migrationSql = fs.readFileSync(path.resolve(__dirname, "../migrations/015-local-qr-only-move.sql"), "utf8");
const listing = [
  ";     dbname: qr_restore_verification",
  "1; 2615 2200 SCHEMA - public postgres",
  "2; 2615 41000 SCHEMA - plant_app postgres",
  "3; 2615 41001 SCHEMA - plant_auth postgres",
  "4; 2615 41002 SCHEMA - plant_face postgres",
  "5; 1259 42000 TABLE public qr_code postgres",
  "6; 1259 42001 SEQUENCE public qr_code_qr_id_seq postgres",
].join("\n");

test("fixed Docker target rejects DATABASE_URL and PG overrides", () => {
  assert.equal(assertTargetEnvironment({}).container, TARGET.container);
  assert.throws(() => assertTargetEnvironment({ DATABASE_URL: "" }), /DATABASE_URL is forbidden/);
  for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGOPTIONS", "PGSSLMODE"])
    assert.throws(() => assertTargetEnvironment({ [key]: "unexpected" }), new RegExp(key));
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])
    assert.throws(() => assertTargetEnvironment({ [key]: "unexpected" }), new RegExp(key));
});
test("container must be running and healthy", () => {
  assert.doesNotThrow(() => assertContainerInspection("true|healthy"));
  assert.throws(() => assertContainerInspection("false|healthy"), /not running/);
  assert.throws(() => assertContainerInspection("true|starting"), /not healthy/);
});
test("database identity must match fixed database, role and port", () => {
  const row = { current_database: TARGET.database, current_user: TARGET.user, server_port: "5432" };
  assert.doesNotThrow(() => assertDatabaseIdentity(row));
  assert.throws(() => assertDatabaseIdentity({ ...row, current_database: "postgres" }), /database/);
  assert.throws(() => assertDatabaseIdentity({ ...row, current_user: "postgres" }), /role/);
  assert.throws(() => assertDatabaseIdentity({ ...row, server_port: "55434" }), /port/);
});
test("permission preflight requires source, destination and privileges", () => {
  const row = { source_exists: true, schema_exists: true, can_move: true, can_create: true };
  assert.doesNotThrow(() => assertMovePermissions(row));
  assert.throws(() => assertMovePermissions({ ...row, source_exists: false }), /public.qr_code/);
  assert.throws(() => assertMovePermissions({ ...row, can_create: false }), /CREATE/);
});
test("backup archive requires reviewed schemas, QR table and identity sequence", () => {
  assert.doesNotThrow(() => verifyBackupListing(listing));
  assert.doesNotThrow(() => verifyBackupListing(listing.replace("1; 2615 2200 SCHEMA - public postgres\n", "")));
  assert.throws(() => verifyBackupListing(listing.replace("dbname: qr_restore_verification", "dbname: postgres")), /does not identify/);
  assert.throws(() => verifyBackupListing(listing.replace("SCHEMA - plant_face", "SCHEMA - other")), /plant_face/);
  assert.throws(() => verifyBackupListing(listing.replace("TABLE public qr_code", "TABLE public other")), /public.qr_code/);
  assert.throws(() => verifyBackupListing(listing.replace("SEQUENCE public qr_code_qr_id_seq", "SEQUENCE public other_seq")), /qr_code_qr_id_seq/);
});
test("backup creation uses a unique container path and hashes the copied archive", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "qr-backup-runner-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const destination = path.join(folder, "pre-migration.dump");
  const calls = [];
  const result = createAndVerifyBackup({
    backupFile: destination,
    run(args) {
      calls.push(args);
      if (args[0] === "cp") fs.writeFileSync(args[2], "mock archive bytes");
      if (args[0] === "exec" && args[2] === "pg_restore") return listing;
      return "";
    },
  });
  assert.equal(calls[0][2], "test");
  assert.equal(calls[0][3], "!");
  assert.match(calls[0][5], /^\/tmp\/qr-before-migration-/);
  assert.equal(calls[1][2], "pg_dump");
  assert.match(calls[1].at(-1), /^\/tmp\/qr-before-migration-/);
  assert.equal(calls[2][0], "cp");
  assert.equal(calls[3][2], "pg_restore");
  assert.deepEqual(calls[4], ["exec", TARGET.container, "pg_restore", "--exit-on-error", "--file", "/dev/null", calls[4][6]]);
  assert.match(calls[4][6], /^\/tmp\/qr-before-migration-/);
  assert.equal(result.size, Buffer.byteLength("mock archive bytes"));
  assert.equal(result.sha256, createHash("sha256").update("mock archive bytes").digest("hex"));
  assert.equal(fs.readFileSync(destination, "utf8"), "mock archive bytes");
});
test("backup creation refuses to overwrite an existing host archive", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "qr-backup-existing-test-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const destination = path.join(folder, "existing.dump");
  fs.writeFileSync(destination, "keep this backup");
  let invoked = false;
  assert.throws(() => createAndVerifyBackup({ backupFile: destination, run: () => { invoked = true; } }), /Refusing to overwrite/);
  assert.equal(invoked, false);
  assert.equal(fs.readFileSync(destination, "utf8"), "keep this backup");
});
test("transaction parser requires one BEGIN, one DO and one COMMIT", () => {
  const parsed = splitTransactionWrappedMigration(migrationSql);
  assert.match(parsed.body, /DO/);
  assert.throws(() => splitTransactionWrappedMigration(`${migrationSql}\nBEGIN;`), /one BEGIN/);
  assert.doesNotThrow(() => splitTransactionWrappedMigration("BEGIN;\nDO $$ BEGIN RAISE NOTICE 'COMMIT;'; END $$;\nCOMMIT;"));
});
test("preflight SQL excludes the schema move and COMMIT", () => {
  const preflight = extractPreflightOnlySql(splitTransactionWrappedMigration(migrationSql).body);
  assert.match(preflight, /LOCK TABLE public\.qr_code/);
  assert.doesNotMatch(preflight, /ALTER TABLE public\.qr_code SET SCHEMA plant_app/);
  assert.doesNotMatch(preflight, /\bCOMMIT\b/i);
});
test("CLI keeps validation and apply as separate modes", () => {
  assert.equal(parseMode([]), "validate");
  assert.equal(parseMode(["--validate"]), "validate");
  assert.equal(parseMode(["--apply"]), "apply");
  assert.throws(() => parseMode(["--migration", "015"]), /Use no arguments/);
});
