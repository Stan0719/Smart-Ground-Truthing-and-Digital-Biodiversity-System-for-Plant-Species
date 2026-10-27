"use strict";
const { randomBytes, randomUUID } = require("node:crypto");
const {
  transaction,
  audit,
  subject,
  fail,
  text,
  hash,
} = require("./domain.cjs");
const metrics = [
  "temperature",
  "humidity",
  "soilMoisture",
  "movement",
  "rainfall",
  "sound",
];
function thresholds(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !metrics.includes(k))
  )
    fail(400, "Invalid thresholds.");
  for (const v of Object.values(value))
    if (typeof v !== "number" || !Number.isFinite(v))
      fail(400, "Thresholds must be finite numbers.");
  return value;
}
function mountDeviceIngestion(app, { pool }) {
  app.post("/api/device/readings", async (req, res) => {
    const match = /^Device ([a-f0-9]{64})$/.exec(
      req.headers.authorization || "",
    );
    if (!match) fail(401, "Device authentication required.");
    const b = req.body;
    thresholds(b.values);
    if (b.client_key !== undefined) text(b.client_key, 100);
    for (const [metric, value] of Object.entries(b.values)) {
      if (metric === "humidity" && (value < 0 || value > 100))
        fail(400, "Humidity must be a percentage from 0 to 100.");
      if (metric === "temperature" && value < -273.15)
        fail(400, "Temperature must be degrees Celsius above absolute zero.");
      if (["soilMoisture", "rainfall", "sound"].includes(metric) && value < 0)
        fail(400, "Raw sensor readings must be nonnegative.");
      if (metric === "movement" && ![0, 1].includes(value))
        fail(400, "Movement must be 0 or 1.");
    }
    if (!Object.keys(b.values).length)
      fail(400, "At least one reading is required.");
    await transaction(pool, async (c) => {
      const device = (
        await c.query(
          "SELECT * FROM iot_device WHERE id=$1 AND key_hash=$2 AND status='Active' FOR UPDATE",
          [b.device_id, hash(match[1])],
        )
      ).rows[0];
      if (!device) fail(401, "Device authentication failed.");
      if (b.client_key) {
        const previous = (
          await c.query(
            'SELECT r."values" FROM iot_ingestion_receipt i JOIN sensor_reading r ON r.id=i.reading_id WHERE i.device_id=$1 AND i.client_key=$2',
            [device.id, b.client_key],
          )
        ).rows[0];
        if (previous) {
          if (
            metrics.some(
              (metric) => previous.values[metric] !== b.values[metric],
            )
          )
            fail(409, "Reading key already belongs to a different payload.");
          return;
        }
      }
      if (
        device.last_seen &&
        Date.now() - new Date(device.last_seen).getTime() < 1000
      )
        fail(429, "Device rate limit exceeded.");
      const reading = randomUUID();
      await c.query(
        'INSERT INTO sensor_reading(id,device_id,"values") VALUES($1,$2,$3)',
        [reading, device.id, b.values],
      );
      if (b.client_key)
        await c.query(
          "INSERT INTO iot_ingestion_receipt(device_id,client_key,reading_id) VALUES($1,$2,$3)",
          [device.id, b.client_key, reading],
        );
      await c.query(
        "UPDATE iot_device SET last_seen=CURRENT_TIMESTAMP WHERE id=$1",
        [device.id],
      );
      for (const metric of metrics)
        if (
          b.values[metric] !== undefined &&
          device.thresholds[metric] !== undefined &&
          b.values[metric] > device.thresholds[metric]
        )
          await c.query(
            "INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), device.id, reading, metric, b.values[metric]],
          );
    });
    res.status(201).json({ recorded: true });
  });
}
function mountIoT(app, { pool, allow }) {
  app.get("/api/devices", allow("devices.read"), async (req, res) =>
    res.json({
      devices: (
        await pool.query(
          "SELECT id,name,plant_id,status,thresholds,last_seen FROM iot_device ORDER BY name",
        )
      ).rows,
    }),
  );
  app.post("/api/devices", allow("devices.manage"), async (req, res) => {
    const key = randomBytes(32).toString("hex"),
      deviceId = randomUUID();
    text(req.body.name, 100);
    await transaction(pool, async (c) => {
      await c.query(
        "INSERT INTO iot_device(id,name,plant_id,key_hash) VALUES($1,$2,$3,$4)",
        [deviceId, req.body.name, req.body.plant_id || null, hash(key)],
      );
      await audit(c, req.user, "device_registered", deviceId);
    });
    res.status(201).json({
      id: deviceId,
      provisioningKey: key,
      message: "Store this key on the device. It cannot be read again.",
    });
  });
  app.patch("/api/devices/:id", allow("devices.manage"), async (req, res) => {
    text(req.body.name, 100);
    if (!["Active", "Inactive"].includes(req.body.status))
      fail(400, "Invalid device status.");
    await transaction(pool, async (c) => {
      const result = await c.query(
        "UPDATE iot_device SET name=$1,status=$2 WHERE id=$3 RETURNING id",
        [req.body.name, req.body.status, req.params.id],
      );
      if (!result.rows.length) fail(404, "Device not found.");
      await audit(c, req.user, "device_updated", req.params.id);
    });
    res.json({ updated: true });
  });
  app.patch(
    "/api/devices/:id/thresholds",
    allow("thresholds.manage"),
    async (req, res) => {
      thresholds(req.body.thresholds);
      await transaction(pool, async (c) => {
        const result = await c.query(
          "UPDATE iot_device SET thresholds=$1 WHERE id=$2 RETURNING id",
          [req.body.thresholds, req.params.id],
        );
        if (!result.rows.length) fail(404, "Device not found.");
        await audit(c, req.user, "thresholds_updated", req.params.id);
      });
      res.json({ updated: true });
    },
  );
  app.get("/api/readings", allow("readings.read"), async (req, res) =>
    res.json({
      readings: (
        await pool.query(
          "SELECT * FROM sensor_reading ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
    }),
  );
  app.get("/api/alerts", allow("alerts.read"), async (req, res) =>
    res.json({
      alerts: (
        await pool.query(
          "SELECT * FROM threat_alert_history ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
      responses: (
        await pool.query(
          "SELECT * FROM threat_response ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/alerts/:id/responses",
    allow("responses.manage"),
    async (req, res) => {
      const note = text(req.body.note);
      if (!["Reviewing", "Resolved"].includes(req.body.status))
        fail(400, "Invalid response status.");
      await transaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT status FROM threat_alert_history WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row) fail(404, "Alert not found.");
        if (row.status === "Resolved") fail(409, "Alert is already resolved.");
        await c.query(
          "INSERT INTO threat_response(id,alert_id,officer_subject,note,status) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            req.params.id,
            subject(req.user),
            note,
            req.body.status,
          ],
        );
        await c.query("UPDATE threat_alert_history SET status=$1 WHERE id=$2", [
          req.body.status,
          req.params.id,
        ]);
        await audit(c, req.user, "alert_response", req.params.id);
      });
      res.json({ updated: true });
    },
  );
}
module.exports = { mountIoT, mountDeviceIngestion, thresholds };
