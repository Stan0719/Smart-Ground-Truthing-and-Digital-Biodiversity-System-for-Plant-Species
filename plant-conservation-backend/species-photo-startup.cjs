"use strict";
// Private, opt-in startup inspection. No environment loader, pool factory or DDL.
const { inspectPhotoSchema } = require("./species-photo-readiness.cjs");
const domain = require("./domain.cjs");
const uploads = require("./uploads.cjs");
const gallery = require("./species-gallery.cjs");

const unknown = () => ({ status: "UNKNOWN" });
// Only expected non-secret values can enter logs. Unexpected values are redacted,
// including role/schema names that could contain project identifiers.
function expectedValue(actual, expected) {
  if (typeof actual !== "string" || !actual.length) return unknown();
  return actual === expected
    ? { status: "VERIFIED", value: expected }
    : { status: "FAILED", value: "REDACTED_UNEXPECTED_VALUE" };
}
function readerVersion(readers) {
  try {
    if (!readers.domain || !readers.uploads || !readers.membershipSql)
      return unknown();
    const compatible = [readers.domain, readers.uploads].every(
      (reader) => reader.version === 1 &&
        reader.membershipSql === readers.membershipSql,
    ) && ["species_image_collection", "species_image_reference", "removed_at IS NULL"]
      .every((fragment) => readers.membershipSql().includes(fragment));
    return compatible
      ? { status: "VERIFIED", value: "membership-aware-v1" }
      : { status: "FAILED" };
  } catch {
    return unknown();
  }
}

async function inspectSpeciesPhotoStartup({
  pool,
  writesEnabled,
  readers = {
    domain: domain.speciesImageReader,
    uploads: uploads.speciesImageReader,
    membershipSql: gallery.membershipSql,
  },
}) {
  const report = {
    currentUser: unknown(),
    sessionUser: unknown(),
    configuredSchema: expectedValue(pool.schema, "plant_app"),
    effectiveSchema: unknown(),
    searchPath: unknown(),
    readOnlyTransaction: unknown(),
    readers: readerVersion(readers),
    managementWritesDisabled: typeof writesEnabled === "boolean"
      ? { status: writesEnabled ? "FAILED" : "VERIFIED", value: !writesEnabled }
      : unknown(),
  };
  let client;
  try {
    client = await pool.connect();
    // The existing scoped wrapper sets SET LOCAL search_path after this BEGIN.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const row = (await client.query(`SELECT current_user AS current_user,
      session_user AS session_user,current_schema() AS effective_schema,
      current_setting('search_path') AS search_path,
      current_schemas(false)::text[] AS schemas,
      current_setting('transaction_read_only') AS read_only`)).rows[0];
    await client.query("COMMIT");
    if (row) {
      report.currentUser = expectedValue(row.current_user, "postgres");
      report.sessionUser = expectedValue(row.session_user, "postgres");
      report.effectiveSchema = expectedValue(row.effective_schema, "plant_app");
      const pathMatches = typeof row.search_path === "string" &&
        /^\s*(?:plant_app|"plant_app")\s*,\s*(?:pg_catalog|"pg_catalog")\s*$/.test(row.search_path) &&
        Array.isArray(row.schemas) && row.schemas.length === 2 &&
        row.schemas[0] === "plant_app" && row.schemas[1] === "pg_catalog";
      report.searchPath = row.search_path == null ? unknown() : pathMatches
        ? { status: "VERIFIED", value: row.search_path }
        : { status: "FAILED", value: "REDACTED_UNEXPECTED_VALUE" };
      report.readOnlyTransaction = expectedValue(row.read_only, "on");
    }
  } catch {
    // Never include driver errors, SQL details, environment or connection objects.
    if (client) await client.query("ROLLBACK").catch(() => {});
  } finally {
    if (client) client.release();
  }
  const startupVerified = Object.values(report).every(
    (item) => item.status === "VERIFIED",
  );
  report.readerStartup = { status: startupVerified ? "VERIFIED" : "FAILED" };
  report.photoSchema = unknown();
  if (startupVerified) {
    // Sequential checkout of the SAME supplied pool, not another pool. Its
    // existing inspector owns a separate metadata-only read-only transaction.
    try {
      const schema = await inspectPhotoSchema(pool);
      const allowed = new Set([
        "verified-applied", "verified-absent", "partially-present", "not-verified",
      ]);
      const migration014 = allowed.has(schema.migration014)
        ? schema.migration014 : "not-verified";
      const migration015 = allowed.has(schema.migration015)
        ? schema.migration015 : "not-verified";
      report.photoSchema = {
        status: schema.schemaReady === true ? "VERIFIED"
          : migration014 === "not-verified" || migration015 === "not-verified"
            || (migration014 === "verified-absent" && migration015 === "verified-absent")
            ? "UNKNOWN" : "FAILED",
        migration014,
        migration015,
      };
    } catch {
      // Connection acquisition can fail before the inspector's own try block.
    }
  }
  return report;
}

async function verifySpeciesPhotoStartup({ enabled = false, log = console.log, ...options }) {
  if (!enabled) return null;
  const report = await inspectSpeciesPhotoStartup(options);
  log("Species photo startup check:", JSON.stringify(report));
  if (report.readerStartup.status !== "VERIFIED")
    throw Object.assign(Error("Species photo startup check failed."), {
      code: "PHOTO_STARTUP_CHECK_FAILED",
    });
  return report;
}
module.exports = { inspectSpeciesPhotoStartup, verifySpeciesPhotoStartup };
