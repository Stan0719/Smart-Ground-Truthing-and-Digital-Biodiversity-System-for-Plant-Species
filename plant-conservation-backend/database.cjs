"use strict";
// Connections only: schema changes must be reviewed and applied separately.
const { Pool } = require("pg");
const LOCAL_POSTGRES_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const UNSUPPORTED_URL_TARGET_OPTIONS = new Set([
  "host",
  "hostaddr",
  "service",
  "port",
  "database",
  "dbname",
  "user",
  "password",
]);

function resolveLocalPostgresTarget(env) {
  if (!env || typeof env !== "object")
    throw Error("Invalid PostgreSQL migration target configuration.");
  if (env.PGHOSTADDR || env.PGSERVICE)
    throw Error("Unsupported PostgreSQL migration connection override.");

  let host;
  if (Object.prototype.hasOwnProperty.call(env, "DATABASE_URL")) {
    if (
      typeof env.DATABASE_URL !== "string" ||
      env.DATABASE_URL.trim() === ""
    )
      throw Error("Invalid PostgreSQL migration URL.");
    let url;
    try {
      url = new URL(env.DATABASE_URL);
    } catch {
      throw Error("Invalid PostgreSQL migration URL.");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw Error("Unsupported PostgreSQL migration URL protocol.");
    if (env.DATABASE_URL.includes("#"))
      throw Error("Unsupported PostgreSQL migration URL fragment.");
    if ([...url.searchParams.keys()].some((key) =>
      UNSUPPORTED_URL_TARGET_OPTIONS.has(key.toLowerCase()),
    ))
      throw Error("Unsupported PostgreSQL migration URL override.");
    host = url.hostname;
  } else {
    host = env.DB_HOST || env.PGHOST;
  }

  if (typeof host !== "string")
    throw Error("PostgreSQL migration host is required.");
  host = host.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]"))
    host = host.slice(1, -1);
  if (!LOCAL_POSTGRES_HOSTS.has(host))
    throw Error("PostgreSQL migrations are restricted to local hosts.");
  return { host };
}

function configured(env = process.env) {
  return Boolean(
    env.DATABASE_URL ||
    ((env.DB_HOST || env.PGHOST) &&
      (env.DB_NAME || env.PGDATABASE) &&
      (env.DB_USER || env.PGUSER)),
  );
}
function poolFromEnvironment(env = process.env) {
  if (!configured(env))
    throw Object.assign(Error("PostgreSQL configuration is missing."), {
      code: "DB_NOT_CONFIGURED",
    });
  const config = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.DB_HOST || env.PGHOST,
        port: Number(env.DB_PORT || env.PGPORT || 5432),
        database: env.DB_NAME || env.PGDATABASE,
        user: env.DB_USER || env.PGUSER,
        password: env.DB_PASSWORD || env.PGPASSWORD,
      };
  // Remote databases require verified TLS. Local development can remain loopback.
  const host = env.DATABASE_URL
    ? new URL(env.DATABASE_URL).hostname
    : config.host;
  if (
    env.DATABASE_URL &&
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)
  ) {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.set("sslmode", "verify-full");
    if (env.PGSSLROOTCERT)
      url.searchParams.set("sslrootcert", env.PGSSLROOTCERT);
    config.connectionString = url.toString();
  }
  const ssl = env.PGSSLROOTCERT
    ? {
        rejectUnauthorized: true,
        ca: require("node:fs").readFileSync(env.PGSSLROOTCERT, "utf8"),
      }
    : !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)
      ? { rejectUnauthorized: true }
      : undefined;
  const schema = env.PLANT_PG_SCHEMA || "public";
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
    ["auth", "storage", "extensions", "information_schema"].includes(schema) ||
    schema.startsWith("pg_")
  )
    throw Error("Invalid plant schema.");
  const pool = new Pool({
    ...config,
    ...(ssl ? { ssl } : {}),
    connectionTimeoutMillis: 10000,
  });
  pool.on("error", (error) =>
    console.error(
      "Plant database connection failed:",
      error.code ?? error.name,
    ),
  );
  return scopedPool(pool, schema);
}
function scopedPool(pool, schema) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw Error("Invalid plant schema.");
  const setPath = (client) =>
    client.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
  return {
    async query(sql, values = []) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setPath(client);
        const result = await client.query(sql, values);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values = []) {
          const result = await client.query(sql, values);
          if (/^BEGIN\b/i.test(sql.trim())) await setPath(client);
          return result;
        },
        release() {
          client.release();
        },
      };
    },
    end: () => pool.end(),
  };
}
function connectionFailure() {
  return "PostgreSQL unavailable. Check server configuration and connectivity.";
}
module.exports = {
  configured,
  poolFromEnvironment,
  resolveLocalPostgresTarget,
  connectionFailure,
  scopedPool,
};
