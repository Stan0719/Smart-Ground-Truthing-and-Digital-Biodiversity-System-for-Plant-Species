import test from "node:test";
import assert from "node:assert/strict";
import { inspectStorage, verifyNamespace } from "./storage-readiness.mjs";
import { testDatabase } from "../web/server/test-postgres.mjs";
test("PostgreSQL storage configuration rejects retired SQLite overrides and shared private schemas", () => {
  const root = "nonexistent-test-root",
    env = { DATABASE_URL: "postgresql://u:p@localhost/plants" };
  assert.ok(Object.values(inspectStorage({ root, env })).every(Boolean));
  assert.equal(
    inspectStorage({ root, env: { ...env, AUTH_DB: "old.sqlite" } })
      .sqliteRuntimeDisabled,
    false,
  );
  assert.equal(
    inspectStorage({ root, env: { ...env, FACE_PG_SCHEMA: "plant_auth" } })
      .separateAccountStorage,
    false,
  );
  assert.equal(
    inspectStorage({ root, env: {} }).postgresPlantConfigured,
    false,
  );
});
test("live PostgreSQL schema verification detects missing tables and public grants", async () => {
  const db = await testDatabase();
  try {
    assert.equal(
      await verifyNamespace(db, "plant_auth", ["users", "sessions"]),
      true,
    );
    assert.equal(
      await verifyNamespace(db, "plant_auth", ["missing_table"]),
      false,
    );
    await db.exec("GRANT USAGE ON SCHEMA plant_auth TO PUBLIC");
    assert.equal(await verifyNamespace(db, "plant_auth", ["users"]), false);
  } finally {
    await db.close();
  }
});
