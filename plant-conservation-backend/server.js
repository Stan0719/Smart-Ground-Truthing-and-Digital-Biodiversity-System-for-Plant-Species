"use strict";
const express = require("express");
const { createServer } = require("node:http");
const {
  configuredOrigins,
  browserBoundary,
  identity,
  requirePermission,
} = require("./authorization.cjs");
const { mountDomain } = require("./domain.cjs");
const { mountIoT, mountDeviceIngestion } = require("./iot.cjs");
const { mountUploads } = require("./uploads.cjs");
const { mountPlantGallery } = require("./plant-gallery.cjs");
const { mountPlantSubmissions } = require("./plant-submissions.cjs");
const { mountRecordChanges } = require("./record-changes.cjs");
const { mountRecordVersionHistory } = require("./record-version-history.cjs");
const { mountStaffNotifications } = require("./staff-notifications.cjs");
const { createOfficerNotificationDelivery } = require("./officer-notification-delivery.cjs");
function createPlantApp({ auth, pool, origins = configuredOrigins(), officerNotifications = null }) {
  const app = express();
  app.disable("x-powered-by");
  // Do not generate ETags for uncached, authenticated JSON reads.
  app.disable("etag");
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
  app.use("/api/plant-submissions", express.json({ limit: "64mb" }));
  app.use("/api/my-plants", express.json({ limit: "64mb" }));
  app.use("/api/my-species-requests", express.json({ limit: "8mb" }));
  app.use("/api/record-changes", express.json({ limit: "64mb" }));
  app.use(express.json({ limit: "6mb" }));
  mountDeviceIngestion(app, { pool });
  app.use(identity(auth));
  const allow = (permission) => requirePermission(auth, permission);
  mountStaffNotifications(app, { pool });
  mountDomain(app, { auth, pool, allow, officerNotifications });
  mountPlantSubmissions(app, { pool, allow, officerNotifications });
  mountRecordChanges(app, { pool, allow });
  mountRecordVersionHistory(app, { pool, allow });
  mountUploads(app, { pool, allow });
  mountPlantGallery(app, { pool, allow });
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
    if (["42P01", "42703"].includes(error.code))
      return res.status(503).json({ error: "Plant database setup is incomplete. Apply the supplied Add Plant migrations and restart the plant API." });
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
    if (error.code === "23503")
      console.error("Plant API foreign key violation:", JSON.stringify({
        code: error.code,
        schema: error.schema,
        table: error.table,
        constraint: error.constraint,
      }));
    if (status >= 500)
      console.error("Plant API request failed:", error.code ?? error.name);
    res.status(status).json({
      error:
        status >= 500
          ? "Service unavailable. Please try again."
          : status === 413
            ? "Request too large."
            : ({
                "23505": "Record already exists.",
                "23503": "Related record is unavailable.",
                "23514": "Invalid record values.",
                "22P02": "Invalid record values.",
              })[error.code] || (error instanceof SyntaxError
                ? "Invalid request."
                : error.message || "Invalid request."),
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
    await pool.query("SELECT qr_id,qr_code,plant_id,status FROM public.qr_code LIMIT 0");
    await pool.query(
      "SELECT id,owner_subject,revision FROM plant_observation LIMIT 0",
    );
  } catch (error) {
    await Promise.allSettled([auth.db.close(), pool.end()]);
    throw error;
  }
  const officerNotifications = createOfficerNotificationDelivery({ pool, auth });
  const app = createPlantApp({ auth, pool, officerNotifications });
  const server = createServer(app);
  const port = Number(process.env.PORT || 3000);
  server.once("listening", () => {
    console.log("Plant API listening on port " + server.address().port);
    officerNotifications.start();
  });
  server.on("error", async (error) => {
    console.error(
      "Plant API startup failed:",
      error.code ?? error.name,
      ...(error.code === "EADDRINUSE" ? [`Port ${port} is already in use. Stop the existing plant API before starting another instance.`] : []),
    );
    await Promise.allSettled([auth.db.close(), pool.end()]);
    process.exitCode = 1;
  });
  server.listen(port, process.env.HOST || "127.0.0.1");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      server.close(async () => {
        await officerNotifications.stop();
        await Promise.allSettled([auth.db.close(), pool.end()]);
        process.exit(0);
      }),
    );
}
if (require.main === module)
  start().catch((error) => {
    console.error(
      "Plant API startup failed; verify configuration:"
    );
    // Driver messages/stacks may contain connection strings or credentials.
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code : "STARTUP_FAILURE";
    console.error("Startup error code:", code);
    process.exitCode = 1;
  });
module.exports = { createPlantApp };
