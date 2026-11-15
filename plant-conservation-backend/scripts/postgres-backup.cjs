"use strict";
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const defaultFileSystem = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");
function dumpEnvironment(
  settings = process.env,
  connection = settings.DATABASE_URL,
) {
  const env = { ...settings };
  if (connection) {
    const url = new URL(connection);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw Error("Invalid PostgreSQL URL.");
    Object.assign(env, {
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
    });
    if (url.searchParams.has("sslrootcert"))
      env.PGSSLROOTCERT = url.searchParams.get("sslrootcert");
  } else
    Object.assign(env, {
      PGHOST: settings.DB_HOST || settings.PGHOST,
      PGPORT: settings.DB_PORT || settings.PGPORT || "5432",
      PGDATABASE: settings.DB_NAME || settings.PGDATABASE,
      PGUSER: settings.DB_USER || settings.PGUSER,
      PGPASSWORD: settings.DB_PASSWORD || settings.PGPASSWORD,
    });
  env.PGSSLMODE = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    env.PGHOST,
  )
    ? "prefer"
    : "verify-full";
  return env;
}
function backupPostgres(
  file,
  {
    settings = process.env,
    connection = settings.DATABASE_URL,
    scope = "schemas",
    schemas = [settings.PLANT_PG_SCHEMA || "public"],
    run = spawnSync,
    fileSystem = defaultFileSystem,
  } = {},
) {
  if (!["schemas", "database"].includes(scope))
    throw Error("Invalid PostgreSQL backup scope.");
  if (scope === "schemas" && !schemas.every((s) => /^[a-z][a-z0-9_]{0,62}$/.test(s)))
    throw Error("Invalid backup schema.");
  const destination = resolve(file);
  if (fileSystem.existsSync(destination))
    throw Error("Refusing to overwrite an existing backup.");
  fileSystem.mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });

  let temporaryArchive;
  let ownsTemporaryArchive = false;
  let backupError;
  let cleanupError;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      temporaryArchive = join(
        dirname(destination),
        `.${basename(destination)}.${process.pid}.${randomBytes(12).toString("hex")}.partial`,
      );
      let descriptor;
      try {
        descriptor = fileSystem.openSync(temporaryArchive, "wx", 0o600);
        ownsTemporaryArchive = true;
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw Error("Unable to create a temporary PostgreSQL backup archive.");
      }
      fileSystem.closeSync(descriptor);
      break;
    }
    if (!ownsTemporaryArchive)
      throw Error("Unable to create a unique temporary PostgreSQL backup archive.");

    const args = [
      "--format=custom",
      "--no-password",
      "--file",
      temporaryArchive,
      ...(scope === "schemas" ? schemas.flatMap((s) => ["--schema", s]) : []),
    ];
    const dumped = run(settings.PG_DUMP_BINARY || "pg_dump", args, {
      env: dumpEnvironment(settings, connection),
      stdio: "pipe",
      windowsHide: true,
    });
    if (dumped.error || dumped.status !== 0)
      throw Error(
        "PostgreSQL backup failed. Install matching pg_dump and verify private connection settings.",
      );
    if (
      !fileSystem.existsSync(temporaryArchive) ||
      fileSystem.statSync(temporaryArchive).size === 0
    )
      throw Error("PostgreSQL backup failed; the archive file was not created.");
    fileSystem.chmodSync(temporaryArchive, 0o600);
    const verified = run(
      settings.PG_RESTORE_BINARY || "pg_restore",
      ["--list", temporaryArchive],
      { stdio: "pipe", windowsHide: true },
    );
    if (verified.error || verified.status !== 0)
      throw Error("Backup archive validation failed.");

    try {
      fileSystem.linkSync(temporaryArchive, destination);
    } catch (error) {
      if (error.code === "EEXIST")
        throw Error("Refusing to overwrite an existing backup.");
      throw Error("Unable to promote the validated PostgreSQL backup archive.");
    }
  } catch (error) {
    backupError = error;
  }

  if (ownsTemporaryArchive) {
    try {
      fileSystem.unlinkSync(temporaryArchive);
    } catch (error) {
      if (error.code !== "ENOENT") cleanupError = error;
    }
  }
  if (backupError) {
    if (cleanupError)
      throw Error(`${backupError.message} Temporary archive cleanup also failed.`);
    throw backupError;
  }
  if (cleanupError)
    throw Error("Temporary archive cleanup failed after backup promotion.");
  return {
    archiveValidated: true,
    restorationTested: false,
    scope,
    schemas: scope === "schemas" ? schemas : null,
    database: settings.DB_NAME || settings.PGDATABASE || null,
  };
}
module.exports = { backupPostgres, dumpEnvironment };
