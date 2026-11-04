"use strict";

const {
  EXPECTED_PROJECT_REF,
  PreflightError,
  parseTarget,
  verifyReadOnlyPrivileges,
  inspectRbacCatalog,
  inspectRbacRows,
  sanitizeError,
} = require("./rbac-preflight.cjs");

function parseArguments(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 2 ||
    args[0] !== "--project-ref" ||
    args[1] !== EXPECTED_PROJECT_REF
  ) throw new PreflightError("TARGET_MISMATCH", "Pass the exact approved project reference.");
  return args[1];
}

async function runPreflight({ args, env = process.env, PoolClass } = {}) {
  const projectRef = parseArguments(args);
  const config = parseTarget(env?.RBAC_PREFLIGHT_DATABASE_URL, projectRef);
  const Pool = PoolClass || require("pg").Pool;
  const pool = new Pool(config);
  // Prevent an idle-pool error event from printing a raw driver error.
  pool.on?.("error", () => {});
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const catalog = await inspectRbacCatalog(client);
    const boundary = await verifyReadOnlyPrivileges(client);
    if (!boundary.ok) {
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        target: { projectRef, endpointType: config.endpointType, tls: "certificate-and-hostname-verified" },
        status: "BLOCKED_INCOMPLETE",
        inspectionComplete: false,
        readOnlyPrivilegesVerified: false,
        privilegeBoundaryFailures: boundary.failures,
        dataReadSkipped: "RBAC rows were not read because the required privilege boundary failed.",
        ...catalog,
      };
    }
    const findings = await inspectRbacRows(client, catalog);
    await client.query("COMMIT");
    transactionOpen = false;
    return {
      target: { projectRef, endpointType: config.endpointType, tls: "certificate-and-hostname-verified" },
      status: findings.dataReadSkipped ? "BLOCKED_INCOMPLETE" : "COMPLETE",
      inspectionComplete: !findings.dataReadSkipped,
      readOnlyPrivilegesVerified: true,
      ...findings,
    };
  } catch (error) {
    if (client && transactionOpen)
      await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  try {
    const report = await runPreflight({ args, env, PoolClass: dependencies.PoolClass });
    (dependencies.stdout || process.stdout).write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "COMPLETE") process.exitCode = 2;
  } catch (error) {
    (dependencies.stderr || process.stderr).write(`${JSON.stringify(sanitizeError(error))}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArguments, runPreflight, main };
