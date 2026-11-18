"use strict";
const { fail } = require("./domain.cjs");
const metrics = ["temperature", "humidity", "soilMoisture", "movement", "rainfall", "sound"];
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validPlant = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const projection = `a.id AS alert_id,a.device_id,a.camera_id,
 d.id AS verified_device_id,d.device_type,d.plant_id::text AS current_plant_id,p.plant_id::text AS verified_plant_id,
 camera.id AS verified_camera_id,camera.device_type AS camera_type,camera.plant_id::text AS camera_plant_id,
 cp.plant_id::text AS verified_camera_plant_id`;
const joins = `FROM threat_alert_history a
 LEFT JOIN iot_device d ON d.id=a.device_id
 LEFT JOIN plant_record p ON p.plant_id=d.plant_id
 LEFT JOIN iot_device camera ON camera.id=a.camera_id
 LEFT JOIN plant_record cp ON cp.plant_id=camera.plant_id`;

function currentAssignment(row) {
  const result = { state: "unavailable", basis: "current_device_assignment", device_id: row.device_id, plant_id: null };
  if (row.verified_device_id !== row.device_id || !["Sensor", "Camera"].includes(row.device_type)) return result;
  if (row.current_plant_id !== null && (!validPlant(row.current_plant_id) || row.verified_plant_id !== row.current_plant_id)) return result;
  // An alert may reference both a sensor and camera; do not choose between conflicting links.
  if (row.camera_id !== null && (row.verified_camera_id !== row.camera_id || row.camera_type !== "Camera" ||
    row.camera_plant_id !== row.current_plant_id ||
    (row.camera_plant_id !== null && row.verified_camera_plant_id !== row.camera_plant_id))) return result;
  return { ...result, state: row.current_plant_id === null ? "not_linked" : "verified", plant_id: row.current_plant_id };
}
function readingContext(row) {
  const missing = { state: "missing", id: row.reading_id, device_id: null, received_at: null, values: null };
  if (row.verified_device_id !== row.device_id) return { ...missing, state: "missing_device" };
  if (!row.reading_id || row.verified_reading_id !== row.reading_id) return missing;
  if (row.reading_device_id !== row.device_id) return { ...missing, state: "mismatched_device" };
  const values = row.reading_values;
  if (!values || typeof values !== "object" || Array.isArray(values) || metrics.some(metric => Object.hasOwn(values, metric) &&
    (typeof values[metric] !== "number" || !Number.isFinite(values[metric]) ||
      (metric === "humidity" && (values[metric] < 0 || values[metric] > 100)) ||
      (metric === "temperature" && values[metric] < -273.15) ||
      (["soilMoisture", "rainfall", "sound"].includes(metric) && values[metric] < 0) ||
      (metric === "movement" && ![0, 1].includes(values[metric]))))) return { ...missing, state: "invalid_values" };
  if (metrics.includes(row.metric) && (!Object.hasOwn(values, row.metric) || values[row.metric] !== row.value))
    return { ...missing, state: "trigger_mismatch" };
  const received = new Date(row.reading_received_at);
  if (row.reading_received_at == null || !Number.isFinite(received.getTime())) return { ...missing, state: "invalid_values" };
  return { state: "verified", id: row.reading_id, device_id: row.device_id, received_at: received.toISOString(),
    values: Object.fromEntries(metrics.filter(metric => Object.hasOwn(values, metric)).map(metric => [metric, values[metric]])) };
}

function mountAlertContext(app, { pool, allow }) {
  // Lightweight bounded list projection: no per-row HTTP calls or reading/threshold overfetching.
  app.get("/api/alerts/current-assignments", allow("alerts.read"), allow("devices.read"), async (req, res) => {
    if (Object.keys(req.query).some(key => key !== "ids") || typeof req.query.ids !== "string" || req.query.ids.length > 8000) fail(400, "Invalid alert identifiers.");
    const ids = req.query.ids.split(",");
    if (!ids.length || ids.length > 50 || ids.some(id => !validId(id))) fail(400, "Invalid alert identifiers.");
    const rows = (await pool.query(`SELECT ${projection} ${joins} WHERE a.id=ANY($1::text[])`, [[...new Set(ids)]])).rows;
    res.json({ contract_version: 1, assignments: rows.map(row => ({ alert_id: row.alert_id, ...currentAssignment(row) })) });
  });
  app.get("/api/alerts/:id/context", allow("alerts.read"), allow("devices.read"), allow("readings.read"), async (req, res) => {
    if (!validId(req.params.id) || Object.keys(req.query).length) fail(400, "Invalid alert identifier.");
    const row = (await pool.query(`SELECT ${projection},a.reading_id,a.metric,a.value,
      r.id AS verified_reading_id,r.device_id AS reading_device_id,r."values" AS reading_values,r.created_at AS reading_received_at
      ${joins} LEFT JOIN sensor_reading r ON r.id=a.reading_id WHERE a.id=$1`, [req.params.id])).rows[0];
    if (!row) fail(404, "Alert not found.");
    if (!validId(row.alert_id) || !validId(row.device_id) || typeof row.metric !== "string" || typeof row.value !== "number" || !Number.isFinite(row.value))
      fail(503, "Alert context is unavailable.");
    res.json({ contract_version: 1, alert: { id: row.alert_id, device_id: row.device_id, reading_id: row.reading_id, metric: row.metric, value: row.value },
      current_assignment: currentAssignment(row), reading: readingContext(row), historical_threshold: null });
  });
}
module.exports = { mountAlertContext, currentAssignment, readingContext };
