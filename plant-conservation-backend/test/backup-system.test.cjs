"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs"),
  { tmpdir } = require("node:os"),
  { join } = require("node:path");
const {
  backupPostgres,
  dumpEnvironment,
} = require("../scripts/postgres-backup.cjs");
test("PostgreSQL backup passes passwords through child environment, validates archive, and never claims restoration", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "postgres-backup-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const calls = [];
  const settings = {
    DATABASE_URL:
      "postgresql://app:private%40password@example.invalid:5432/plants",
  };
  const result = backupPostgres(join(folder, "backup.dump"), {
    settings,
    schemas: ["plant_auth"],
    run: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(result.archiveValidated, true);
  assert.equal(result.restorationTested, false);
  assert.equal(calls[0][2].env.PGPASSWORD, "private@password");
  assert.equal(calls[0][2].env.PGSSLMODE, "verify-full");
  assert.ok(!JSON.stringify(calls[0][1]).includes("private@password"));
  assert.equal(calls[1][0], "pg_restore");
  assert.equal(calls[1][1][0], "--list");
});
test("failed PostgreSQL dump never reports a verified backup", () => {
  assert.throws(
    () =>
      backupPostgres("unused.dump", {
        settings: { DATABASE_URL: "postgresql://u:p@localhost/db" },
        run: () => ({ status: 1 }),
      }),
    /backup failed/,
  );
  assert.equal(
    dumpEnvironment({
      DB_HOST: "localhost",
      DB_NAME: "plants",
      DB_USER: "app",
      DB_PASSWORD: "private",
    }).PGDATABASE,
    "plants",
  );
});
