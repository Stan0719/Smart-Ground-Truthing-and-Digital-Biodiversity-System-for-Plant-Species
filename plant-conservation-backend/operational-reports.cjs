"use strict";
const { reportPeriod } = require("./report-period.cjs");
const categories = new Set(["observations", "threats", "iot"]);
const statuses = ["Pending Review", "Approved", "Rejected", "Correction Required", "Flagged"];
const measurements = Object.freeze({ temperature: "°C", humidity: "%", soilMoisture: "raw", rainfall: "raw", sound: "raw", movement: "0/1" });
const count = value => Number(value);
const instant = value => value == null ? null : new Date(value).toISOString();
function options(category, query) {
  if (!categories.has(category)) throw Object.assign(Error("Unsupported report category."), { status: 400 });
  const allowed = category === "iot" ? ["period", "start", "end", "device", "measurement"] : ["period", "start", "end"];
  if (Object.keys(query).some(key => !allowed.includes(key))) throw Object.assign(Error("Unsupported report parameter."), { status: 400 });
  const { device, measurement = "temperature", ...period } = query;
  if (category === "iot" && ((device !== undefined && (typeof device !== "string" || !device.trim() || device.length > 200)) || typeof measurement !== "string" || !Object.hasOwn(measurements, measurement))) throw Object.assign(Error("Invalid device or measurement."), { status: 400 });
  return { scope: reportPeriod(period), device, measurement };
}
async function generateOperationalReport(pool, category, query) {
  const { scope, device, measurement } = options(category, query);
  const args = [scope.startInclusive, scope.endExclusive];
  const base = { category, generatedAt: new Date().toISOString(), scope };
  if (category === "observations") {
    // Current review status of non-draft records CREATED in the period. No joins
    // to reviews/receipts: initial, subsequent and legacy origins count once.
    const bucket = scope.startDate && (Date.parse(scope.endDate) - Date.parse(scope.startDate)) / 86400000 <= 120 ? "week" : "month";
    const result = await pool.query(`SELECT to_char(date_trunc($3::text,created_at AT TIME ZONE 'Asia/Kuala_Lumpur'),'YYYY-MM-DD') AS period,status,count(*) AS count
      FROM plant_observation WHERE status <> 'Draft' AND ($1::timestamptz IS NULL OR created_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
      GROUP BY 1,status ORDER BY 1,status`, [...args, bucket]);
    const periods = [...new Set(result.rows.map(row => row.period))];
    const rows = periods.map(period => {
      const values = statuses.map(status => count(result.rows.find(row => row.period === period && row.status === status)?.count || 0));
      return [period, values.reduce((a, b) => a + b, 0), ...values];
    });
    const totals = statuses.map((_, index) => rows.reduce((sum, row) => sum + row[index + 2], 0));
    return { ...base, basis: "observationScope", bucket, columns: ["period", "totalObservations", ...statuses], rows,
      statistics: [{ key: "totalObservations", value: totals.reduce((a, b) => a + b, 0) }, ...statuses.map((key, index) => ({ key, value: totals[index] }))],
      chart: { kind: "stacked", labels: periods, unit: "count", series: statuses.map((key, index) => ({ key, values: rows.map(row => row[index + 2]) })) } };
  }
  if (category === "threats") {
    // Only established device -> plant -> species links; no identity/evidence/GPS.
    const { rows: source } = await pool.query(`SELECT a.metric,a.status,a.created_at,p.plant_id::text,s.scientific_name
      FROM threat_alert_history a LEFT JOIN iot_device d ON d.id=a.device_id LEFT JOIN plant_record p ON p.plant_id=d.plant_id LEFT JOIN species s ON s.species_id=p.species_id
      WHERE ($1::timestamptz IS NULL OR a.created_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR a.created_at < $2::timestamptz) ORDER BY a.created_at,a.id`, args);
    const counts = new Map();
    for (const row of source) counts.set(row.metric, (counts.get(row.metric) || 0) + 1);
    const distribution = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { ...base, basis: "threatScope", columns: ["category", "severity", "status", "devicePlant", "species", "createdAt"],
      rows: source.map(row => [row.metric, null, row.status, row.plant_id == null ? null : `PL${row.plant_id.padStart(3, "0")}`, row.scientific_name, instant(row.created_at)]),
      statistics: [{ key: "totalIncidents", value: source.length }, { key: "unresolved", value: source.filter(row => row.status !== "Resolved").length }, { key: "Resolved", value: source.filter(row => row.status === "Resolved").length }],
      chart: { kind: "horizontal", labels: distribution.map(row => row[0]), unit: "count", series: [{ key: "totalIncidents", values: distribution.map(row => row[1]) }] } };
  }
  // A single selected device and measurement; every persisted reading is retained,
  // including null values for missing/invalid measurements. Never turn absence into 0.
  const devices = (await pool.query(`SELECT DISTINCT d.id,d.name FROM iot_device d JOIN sensor_reading r ON r.device_id=d.id WHERE ($1::timestamptz IS NULL OR r.created_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR r.created_at < $2::timestamptz) ORDER BY d.name,d.id`, args)).rows;
  if (device && !devices.some(item => item.id === device)) throw Object.assign(Error("Device has no readings in this reporting period."), { status: 400 });
  const selectedDevice = device || devices[0]?.id || null;
  const source = selectedDevice == null ? [] : (await pool.query(`SELECT r.created_at,r."values" -> $4::text AS value,d.name,d.id FROM sensor_reading r JOIN iot_device d ON d.id=r.device_id
    WHERE ($1::timestamptz IS NULL OR r.created_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR r.created_at < $2::timestamptz) AND r.device_id=$3 ORDER BY r.created_at,r.id`, [...args, selectedDevice, measurement])).rows;
  const values = source.map(row => typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null);
  const numeric = values.filter(value => value !== null);
  const extrema = numeric.reduce((state, value, index) => ({ min: Math.min(state.min, value), max: Math.max(state.max, value), mean: state.mean * (index / (index + 1)) + value / (index + 1) }), { min: Infinity, max: -Infinity, mean: 0 });
  const unit = measurements[measurement];
  return { ...base, basis: "iotScope", devices, device: selectedDevice, measurement, measurements: Object.keys(measurements),
    columns: ["recordedAt", "device", "measurement", "value", "unit"], rows: source.map((row, index) => [instant(row.created_at), row.name, measurement, values[index], unit]),
    statistics: [{ key: "devicesWithReadings", value: devices.length }, { key: "totalReadings", value: source.length }, { key: "latestReading", value: instant(source.at(-1)?.created_at) }, { key: "minimum", value: numeric.length ? extrema.min : null }, { key: "average", value: numeric.length ? extrema.mean : null }, { key: "maximum", value: numeric.length ? extrema.max : null }],
    chart: { kind: "line", labels: source.map(row => instant(row.created_at)), unit, series: [{ key: measurement, values }] } };
}
function mountOperationalReports(app, { pool, allow }) {
  app.get("/api/reports/:category", allow("reports.read"), async (req, res) => {
    let client;
    try {
      options(req.params.category, req.query);
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const report = await generateOperationalReport(client, req.params.category, req.query);
      await client.query("COMMIT");
      res.json(report);
    }
    catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      if (["42P01", "42703"].includes(error.code)) return res.status(503).json({ error: "Report data source is unavailable." });
      throw error;
    } finally { client?.release(); }
  });
}
module.exports = { mountOperationalReports, generateOperationalReport, options };
