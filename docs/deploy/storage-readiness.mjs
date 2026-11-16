// Configuration checks never substitute for a live PostgreSQL/schema check.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { connectAuth } from "../web/server/postgres.mjs";
export function storageSettings({ root, env = process.env }) {
  const read = (path) =>
    existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return {
    ...read(resolve(root, "plant-conservation-backend/.env")),
    ...read(resolve(root, "web/.env.server")),
    ...env,
  };
}
export function inspectStorage(options) {
  const settings = storageSettings(options);
  const configured = Boolean(
    settings.DATABASE_URL ||
    (settings.DB_HOST && settings.DB_NAME && settings.DB_USER),
  );
  const auth = settings.AUTH_PG_SCHEMA || "plant_auth",
    face = settings.FACE_PG_SCHEMA || "plant_face";
  return {
    postgresPlantConfigured: configured,
    postgresAuthenticationConfigured: Boolean(
      settings.AUTH_DATABASE_URL || configured,
    ),
    postgresFaceConfigured: Boolean(
      settings.FACE_DATABASE_URL || settings.DATABASE_URL,
    ),
    separateAccountStorage:
      /^[a-z][a-z0-9_]{0,62}$/.test(auth) &&
      /^[a-z][a-z0-9_]{0,62}$/.test(face) &&
      auth !== face &&
      ![auth, face].some(
        (s) =>
          [
            "public",
            "auth",
            "storage",
            "extensions",
            "information_schema",
          ].includes(s) || s.startsWith("pg_"),
      ),
    sqliteRuntimeDisabled:
      !settings.PLANT_DB && !settings.AUTH_DB && !settings.FACE_DB,
  };
}
export async function verifyNamespace(
  db,
  schema,
  tables,
  { privateSchema = true } = {},
) {
  const namespace = await db
    .prepare("SELECT to_regnamespace(?) IS NOT NULL AS present")
    .get(schema);
  if (!namespace.present) return false;
  for (const table of tables) {
    if (
      !(
        await db
          .prepare("SELECT to_regclass(?) IS NOT NULL AS present")
          .get(schema + "." + table)
      ).present
    )
      return false;
  }
  if (privateSchema) {
    const row = await db
      .prepare(
        "SELECT NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname=? AND a.grantee=0 AND a.privilege_type='USAGE') AS private",
      )
      .get(schema);
    if (!row.private) return false;
    for (const role of ["anon", "authenticated"])
      if (await db.prepare("SELECT 1 FROM pg_roles WHERE rolname=?").get(role))
        if (
          (
            await db
              .prepare("SELECT has_schema_privilege(?,?,?) AS exposed")
              .get(role, schema, "USAGE")
          ).exposed
        )
          return false;
  }
  return true;
}
export async function verifyStorage(options) {
  const env = storageSettings(options),
    checks = {
      plantStorage: false,
      authenticationStorage: false,
      faceStorage: false,
    };
  for (const [key, url, schema, tables, privateSchema] of [
    [
      "plantStorage",
      env.DATABASE_URL,
      env.PLANT_PG_SCHEMA || "public",
      ["species", "plant_record", "plant_observation", "iot_device"],
      Boolean(env.PLANT_PG_SCHEMA && env.PLANT_PG_SCHEMA!=="public"),
    ],
    [
      "authenticationStorage",
      env.AUTH_DATABASE_URL || env.DATABASE_URL,
      env.AUTH_PG_SCHEMA || "plant_auth",
      ["users", "visitors", "sessions", "password_resets", "schema_migrations"],
      true,
    ],
    [
      "faceStorage",
      env.FACE_DATABASE_URL || env.DATABASE_URL,
      env.FACE_PG_SCHEMA || "plant_face",
      ["accounts", "challenges", "real_face_templates"],
      true,
    ],
  ]) {
    let db;
    try {
      db = connectAuth({
        ...env,
        AUTH_DATABASE_URL: url,
        AUTH_PG_SCHEMA: privateSchema ? schema : "plant_auth",
      });
      checks[key] = await verifyNamespace(db, schema, tables, {
        privateSchema,
      });
    } catch {
      checks[key] = false;
    } finally {
      await db?.close();
    }
  }
  return checks;
}
