"use strict";
const express = require("express");
const {
  configuredOrigins,
  browserBoundary,
  identity,
  requirePermission,
} = require("./authorization.cjs");
const { mountDomain } = require("./domain.cjs");
const { mountIoT, mountDeviceIngestion } = require("./iot.cjs");
const { mountUploads } = require("./uploads.cjs");
function createPlantApp({ auth, pool, origins = configuredOrigins() }) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ service: "Plant Conservation API", ready: true }),
  );
  app.use(browserBoundary(origins));
  app.use((req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.is("application/json")
    )
      return res.status(415).json({ error: "JSON required." });
    next();
  });
  app.use(express.json({ limit: "6mb" }));
  mountDeviceIngestion(app, { pool });
  app.use(identity(auth));
  const allow = (permission) => requirePermission(auth, permission);
  mountDomain(app, { auth, pool, allow });
  mountUploads(app, { pool, allow });
  mountIoT(app, { pool, allow });
  app.get("/api/db-test", allow("system.read"), async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ connected: true, database: "postgresql" });
  });
  app.get("/api/tables", allow("system.read"), async (_req, res) =>
    res.json({
      tables: (
        await pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name",
        )
      ).rows.map((row) => row.table_name),
    }),
  );
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((error, _req, res, _next) => {
    const status =
      error.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : error.status ||
            (["23505", "23503"].includes(error.code)
              ? 409
              : ["23514", "22P02"].includes(error.code)
                ? 400
                : 503);
    if (status >= 500)
      console.error("Plant API request failed:", error.code ?? error.name);
    res.status(status).json({
      error:
        status >= 500
          ? "Service unavailable. Please try again."
          : status === 413
            ? "Request too large."
            : error.message || "Invalid request.",
    });
  });
  return app;
}
async function start() {
  require("./environment.cjs");
  const { loadServerEnvironment } = await import("../web/server/postgres.mjs");
  loadServerEnvironment();
  const { createAuth } = await import("../web/server/auth.mjs");
  const { poolFromEnvironment } = require("./database.cjs");
  const auth = await createAuth(),
    pool = poolFromEnvironment();
  try {
    await pool.query(
      "SELECT plant_id,registered_subject,rbac_status,qr_token FROM plant_record LIMIT 0",
    );
    await pool.query("SELECT species_id,rbac_data FROM species LIMIT 0");
    await pool.query(
      "SELECT id,owner_subject,revision FROM plant_observation LIMIT 0",
    );
  } catch (error) {
    await Promise.allSettled([auth.db.close(), pool.end()]);
    throw error;
  }
  const app = createPlantApp({ auth, pool });
  const server = app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => console.log("Plant API listening on port " + server.address().port),
  );
  server.on("error", async () => {
    console.error("Plant API startup failed; verify configuration.");
    await Promise.allSettled([auth.db.close(), pool.end()]);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      server.close(async () => {
        await Promise.allSettled([auth.db.close(), pool.end()]);
        process.exit(0);
      }),
    );
}
if (require.main === module)
  start().catch((error) => {
    console.error(
      "Plant API startup failed; verify configuration:",
      error.code ?? error.name,
    );
    process.exitCode = 1;
  });
module.exports = { createPlantApp };
