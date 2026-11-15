 "use strict";
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve, dirname } = require("node:path");

const TARGET = Object.freeze({
  container: "qr-backup-restore-verification",
  database: "qr_restore_verification",
  user: "supabase_admin",
  serverPort: 5432,
  advisoryLock: 87423902,
});
const DOCKER = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const DOCKER_HOST = "npipe:////./pipe/docker_engine";
const MIGRATION_PATH = resolve(__dirname, "../migrations/015-local-qr-only-move.sql");

function assertTargetEnvironment(env) {
  if (Object.keys(env).some((n) => n.toUpperCase() === "DATABASE_URL"))
    throw Error("DATABASE_URL is forbidden for the local QR restore runner.");
  for (const n of Object.keys(env)) if (/^PG[A-Z0-9_]*$/i.test(n))
    throw Error(`${n.toUpperCase()} environment override is forbidden for the Docker-based local QR runner.`);
  for (const n of Object.keys(env)) if (/^DOCKER_[A-Z0-9_]*$/i.test(n))
    throw Error(`${n.toUpperCase()} environment override is forbidden for the fixed local Docker engine.`);
  return { ...TARGET };
}
function skipSqlTrivia(sql, offset) {
  let i = offset;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith("--", i)) { const n = sql.indexOf("\n", i + 2); i = n < 0 ? sql.length : n + 1; continue; }
    if (sql.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw Error("Unterminated SQL comment in migration.");
      continue;
    }
    break;
  }
  return i;
}
function scanTopLevelStatements(sql) {
  const statements = []; let i = 0, tokens = [], start = null;
  while (i < sql.length) {
    i = skipSqlTrivia(sql, i); if (i >= sql.length) break;
    if (start === null) start = i;
    const c = sql[i];
    if (c === "'" || c === '"') {
      const quote = c; i++; let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) i += 2;
          else { i++; closed = true; break; }
        } else if (quote === "'" && sql[i] === "\\" && i + 1 < sql.length) i += 2;
        else i++;
      }
      if (!closed) throw Error("Unterminated quoted SQL value in migration.");
      tokens.push(quote === "'" ? "STRING" : "IDENTIFIER"); continue;
    }
    if (c === "$") {
      const d = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (d) {
        const end = sql.indexOf(d, i + d.length);
        if (end < 0) throw Error("Unterminated dollar-quoted SQL in migration.");
        i = end + d.length; tokens.push("DOLLAR_STRING"); continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const w = sql.slice(i).match(/^[A-Za-z_][A-Za-z_0-9$]*/)[0];
      tokens.push(w.toUpperCase()); i += w.length; continue;
    }
    if (c === ";") { statements.push({ tokens, start, end: i + 1 }); tokens = []; start = null; i++; continue; }
    tokens.push(c); i++;
  }
  if (tokens.length) throw Error("Migration has an unterminated top-level statement.");
  return statements;
}
function splitTransactionWrappedMigration(sql) {
  const s = scanTopLevelStatements(sql);
  const b = s.filter(x => x.tokens.length === 1 && x.tokens[0] === "BEGIN");
  const c = s.filter(x => x.tokens.length === 1 && x.tokens[0] === "COMMIT");
  if (b.length !== 1 || c.length !== 1 || s.length !== 3 || s[0] !== b[0] ||
      s[2] !== c[0] || s[1].tokens[0] !== "DO" || b[0].end > s[1].start || s[1].end > c[0].start)
    throw Error("Migration must contain one BEGIN, one DO block, and one COMMIT.");
  const body = sql.slice(b[0].end, c[0].start);
  if (!body.includes("DO")) throw Error("Migration body is missing its DO block.");
  return { body };
}
function extractPreflightOnlySql(body) {
  const marker = /^\s{4}ALTER TABLE public\.qr_code SET SCHEMA plant_app;\s*$/gm;
  const matches = [...body.matchAll(marker)];
  if (matches.length !== 1) throw Error("Expected exactly one QR schema-move statement in migration 015.");
  const prefix = body.slice(0, matches[0].index);
  if (!/^\s*DO\s+\$\$/.test(prefix)) throw Error("Migration preflight is not the expected DO block.");
  if (/^\s*(?:ALTER|CREATE|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/im.test(prefix))
    throw Error("Preflight section contains an unexpected persistent SQL statement.");
  return `${prefix}\n  END;\n  $$;`;
}
function assertContainerInspection(output) {
  const [running, health] = String(output).trim().split("|");
  if (running !== "true") throw Error("The fixed local Docker container is not running.");
  if (health !== "healthy") throw Error("The fixed local Docker container is not healthy.");
}
function assertDatabaseIdentity(row) {
  if (!row || row.current_database !== TARGET.database) throw Error("Connected database does not match the fixed local restore target.");
  if (row.current_user !== TARGET.user) throw Error("Connected role does not match the fixed local migration role.");
  if (Number(row.server_port) !== TARGET.serverPort) throw Error("PostgreSQL server port does not match the fixed local container port.");
}
function assertMovePermissions(row) {
  if (!row?.source_exists) throw Error("public.qr_code is missing from the local restore database.");
  if (!row.schema_exists) throw Error("plant_app schema is missing from the local restore database.");
  if (!row.can_move) throw Error("Migration role lacks effective ownership rights on public.qr_code.");
  if (!row.can_create) throw Error("Migration role lacks CREATE on plant_app.");
}
function runDocker(args) {
  const r = spawnSync(DOCKER, ["--host", DOCKER_HOST, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`Docker command failed: ${(r.stderr || r.stdout || `exit ${r.status}`).trim()}`);
  return r.stdout || "";
}
function psqlArgs() {
  return ["exec", "-i", TARGET.container, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", TARGET.user, "-d", TARGET.database, "-A", "-t", "-F", "|"];
}
function queryJson(sql, run = runDocker) {
  const output = run(psqlArgs().concat(["-c", sql]));
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw Error("PostgreSQL returned no result for an identity/preflight query.");
  return JSON.parse(line);
}
function inspectContainer(run = runDocker) {
  const output = run(["inspect", "--format", "{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}", TARGET.container]);
  assertContainerInspection(output);
}
function getDatabaseIdentity(run = runDocker) {
  const row = queryJson("SELECT json_build_object('current_database', current_database(), 'current_user', current_user, 'server_port', current_setting('port'))::text;", run);
  assertDatabaseIdentity(row); return row;
}
const PERMISSION_PREFLIGHT = `
SELECT json_build_object(
 'source_exists', to_regclass('public.qr_code') IS NOT NULL,
 'schema_exists', to_regnamespace('plant_app') IS NOT NULL,
 'can_move', COALESCE((
   SELECT r.rolsuper OR c.relowner = r.oid OR pg_has_role(current_user, c.relowner, 'USAGE')
   FROM pg_class c JOIN pg_roles r ON r.rolname = current_user
   WHERE c.oid = to_regclass('public.qr_code')
 ), false),
 'can_create', CASE WHEN to_regnamespace('plant_app') IS NULL THEN false
   ELSE has_schema_privilege(current_user, to_regnamespace('plant_app'), 'CREATE') END
)::text;`;
function verifyBackupListing(listing) {
  if (!/^;\s*dbname:\s*qr_restore_verification\s*$/mi.test(listing))
    throw Error("Local database backup archive does not identify qr_restore_verification.");
  // PostgreSQL may omit a standalone TOC entry for its built-in public schema.
  // The required public.qr_code relation and sequence entries below establish
  // that the relevant public objects are present in the archive.
  for (const schema of ["plant_app", "plant_auth", "plant_face"]) {
    const re = new RegExp(`^\\s*\\d+;\\s+\\d+\\s+\\d+\\s+SCHEMA\\s+-\\s+${schema}(?:\\s|$)`, "m");
    if (!re.test(listing)) throw Error(`Local database backup is missing expected schema ${schema}.`);
  }
  const required = [
    [/^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+public\s+qr_code(?:\s|$)/m, "public.qr_code"],
    [/^\s*\d+;\s+\d+\s+\d+\s+SEQUENCE\s+public\s+qr_code_qr_id_seq(?:\s|$)/m, "public.qr_code_qr_id_seq"],
  ];
  for (const [re, label] of required) if (!re.test(listing)) throw Error(`Local database backup is missing expected object ${label}.`);
}
function defaultBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const token = randomBytes(6).toString("hex");
  return resolve(__dirname, "../backups", `before-qr-restore-test-${stamp}-${token}.dump`);
}
function createAndVerifyBackup({ backupFile, run = runDocker }) {
  const backupPath = resolve(backupFile);
  if (fs.existsSync(backupPath)) throw Error("Refusing to overwrite an existing backup file.");
  fs.mkdirSync(dirname(backupPath), { recursive: true });
  const token = `${process.pid}_${randomBytes(12).toString("hex")}`;
  const containerFile = `/tmp/qr-before-migration-${token}.dump`;
  run(["exec", TARGET.container, "test", "!", "-e", containerFile]);
  run(["exec", TARGET.container, "pg_dump", "-U", TARGET.user, "-d", TARGET.database, "-Fc", "-f", containerFile]);
  run(["cp", `${TARGET.container}:${containerFile}`, backupPath]);
  try {
    const listing = run(["exec", TARGET.container, "pg_restore", "--list", containerFile]);
    verifyBackupListing(listing);
    // Decode every archive entry to the container's null device. This checks
    // the full custom archive without restoring or changing database objects.
    run(["exec", TARGET.container, "pg_restore", "--exit-on-error", "--file", "/dev/null", containerFile]);
  } catch (error) {
    throw Error(`Backup was created at ${backupPath}, but archive verification failed: ${error.message}`);
  }
  const stat = fs.statSync(backupPath);
  if (!stat.isFile() || stat.size <= 0) throw Error("Local database backup is missing or empty.");
  return { path: backupPath, size: stat.size, sha256: createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex") };
}
async function runLocalQrRestoreTest({ mode = "validate", env = process.env, run = runDocker, readFile = fs.readFileSync, backupFile = defaultBackupPath() } = {}) {
  if (!["validate", "apply"].includes(mode)) throw Error("Mode must be validate or apply.");
  assertTargetEnvironment(env);
  const { body } = splitTransactionWrappedMigration(readFile(MIGRATION_PATH, "utf8"));
  const preflight = extractPreflightOnlySql(body);
  inspectContainer(run);
  getDatabaseIdentity(run);
  assertMovePermissions(queryJson(PERMISSION_PREFLIGHT, run));
  const validateSql = ["BEGIN;", `SELECT pg_advisory_xact_lock(${TARGET.advisoryLock});`, preflight, "ROLLBACK;"].join("\n");
  run(psqlArgs().concat(["-c", validateSql]));
  if (mode === "validate") return { mode, target: { ...TARGET }, migration: "015-local-qr-only-move.sql" };

  const backup = createAndVerifyBackup({ backupFile, run });
  console.log(`Verified complete local Docker database backup: ${backup.path}\nSize: ${backup.size} bytes\nSHA256: ${backup.sha256}`);
  const applySql = ["BEGIN;", `SELECT pg_advisory_xact_lock(${TARGET.advisoryLock});`, body, "COMMIT;"].join("\n");
  run(psqlArgs().concat(["-c", applySql]));
  return { mode, target: { ...TARGET }, migration: "015-local-qr-only-move.sql", backup };
}
function parseMode(argv) {
  if (!argv.length || (argv.length === 1 && argv[0] === "--validate")) return "validate";
  if (argv.length === 1 && argv[0] === "--apply") return "apply";
  throw Error("Use no arguments or --validate for checks; --apply is the separate apply mode.");
}
async function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  try {
    await runLocalQrRestoreTest({ mode });
    console.log(mode === "validate" ? "Local Docker target and migration preflight validated; no migration was applied." :
      "Local QR migration completed on the fixed Docker test database.");
  } catch (e) {
    console.error(`Local QR Docker runner failed: ${e.message}`); process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = {
  TARGET, PERMISSION_PREFLIGHT, assertContainerInspection, assertDatabaseIdentity,
  assertMovePermissions, assertTargetEnvironment, extractPreflightOnlySql,
  createAndVerifyBackup, parseMode, runLocalQrRestoreTest,
  splitTransactionWrappedMigration, verifyBackupListing,
};
