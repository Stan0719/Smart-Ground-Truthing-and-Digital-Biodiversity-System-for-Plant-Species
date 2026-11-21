"use strict";
const { reportPeriod } = require("./report-period.cjs");
const units = Object.freeze({ temperature: "°C", humidity: "%", soilMoisture: "raw", rainfall: "raw", sound: "raw", movement: "0/1" });
const MAX_BUCKETS = 520, MAX_BYTES = 1048576;
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, reportCode: code }); };
function options(query, now = new Date()) {
  const allowed = new Set(["contractVersion", "device", "measurement", "period", "start", "end", "interval", "startAt", "endAt"]);
  if (Object.entries(query).some(([key, value]) => !allowed.has(key) || typeof value !== "string")) fail(400, "IOT_REPORT_PARAMETERS", "Unsupported or repeated report parameter.");
  const { contractVersion, device, measurement = "temperature", interval = "auto", startAt, endAt, ...period } = query;
  if (contractVersion !== "1" || !device || !device.trim() || device.length > 200 || !Object.hasOwn(units, measurement) || !["auto", "hour", "day", "week"].includes(interval)) fail(400, "IOT_REPORT_PARAMETERS", "Invalid version, device, measurement or interval.");
  if ((startAt === undefined) !== (endAt === undefined)) fail(400, "IOT_REPORT_PARAMETERS", "Both exact range timestamps are required.");
  const scope = reportPeriod(period, now);
  let range = null;
  if (startAt !== undefined) {
    const validInstant = value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (!validInstant(startAt) || !validInstant(endAt) || Date.parse(startAt) >= Date.parse(endAt)) fail(400, "IOT_REPORT_PARAMETERS", "Invalid exact range timestamps.");
    if (Date.parse(endAt) - Date.parse(startAt) > 36600 * 86400000) fail(422, "IOT_REPORT_RANGE_LIMIT", "Effective report range exceeds 100 years.");
    if (scope.startInclusive && Date.parse(startAt) < Date.parse(scope.startInclusive) || scope.endExclusive && Date.parse(endAt) > Date.parse(scope.endExclusive)) fail(400, "IOT_REPORT_PARAMETERS", "Exact range must remain within the selected reporting period.");
    range = { startAt, endAt };
  }
  return { device, measurement, interval, scope, range };
}
const iso = value => value == null ? null : new Date(value).toISOString();
// PostgreSQL classifies JSON types before converting numeric values. Numeric
// aggregation avoids intermediate float overflow; only finite API numbers leave SQL.
const classified = `SELECT id,created_at,
  CASE WHEN $4 = 'movement' THEN
    CASE WHEN "values" -> $4 IN ('0'::jsonb, '1'::jsonb)
      THEN ("values" ->> $4)::numeric END
  WHEN jsonb_typeof("values" -> $4) = 'number' THEN
    CASE WHEN abs(("values" ->> $4)::numeric) <= 1.7976931348623157e308::numeric
      THEN ("values" ->> $4)::numeric END END AS value,
  (NOT ("values" ? $4) OR "values" -> $4 = 'null'::jsonb) AS absent
  FROM sensor_reading WHERE device_id=$1
    AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
    AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)`;
const counts = `count(*) AS received, count(value) AS valid,
  count(*) FILTER (WHERE absent) AS absent,
  count(*) FILTER (WHERE value IS NULL AND NOT absent) AS invalid,
  avg(value) AS average, min(value) AS minimum, max(value) AS maximum,
  count(*) FILTER (WHERE $4 = 'movement' AND value = 1) AS detected,
  count(*) FILTER (WHERE $4 = 'movement' AND value = 0) AS no_movement`;
function stats(row, measurement) {
  const result = {};
  for (const [key, column] of Object.entries({ receivedRows: "received", validMeasurements: "valid", absentOrNullMeasurements: "absent", invalidMeasurements: "invalid" })) {
    const value = Number(row[column]);
    if (!Number.isSafeInteger(value) || value < 0) fail(503, "IOT_REPORT_NUMERIC_RANGE", "Report count exceeds supported range.");
    result[key] = value;
  }
  result.missingMeasurements = result.absentOrNullMeasurements + result.invalidMeasurements;
  if (!Number.isSafeInteger(result.missingMeasurements) || result.receivedRows !== result.validMeasurements + result.missingMeasurements)
    fail(503, "IOT_REPORT_COUNT_MISMATCH", "Report counts are inconsistent.");
  if (measurement === "movement") {
    result.detectedSampleCount = Number(row.detected);
    result.noMovementSampleCount = Number(row.no_movement);
    if (![result.detectedSampleCount, result.noMovementSampleCount].every(value => Number.isSafeInteger(value) && value >= 0) || result.validMeasurements !== result.detectedSampleCount + result.noMovementSampleCount)
      fail(503, "IOT_REPORT_COUNT_MISMATCH", "Movement counts are inconsistent.");
  }
  for (const key of ["average", "minimum", "maximum"]) {
    result[key] = row[key] == null ? null : Number(row[key]);
    if (result[key] !== null && !Number.isFinite(result[key])) fail(503, "IOT_REPORT_NUMERIC_RANGE", "Report value exceeds supported range.");
  }
  return result;
}
async function generateIoTSummary(client, query, now = new Date()) {
  const config = options(query, now), { device, measurement, scope, range } = config;
  const identity = (await client.query("SELECT id,name,thresholds FROM iot_device WHERE id=$1", [device])).rows[0];
  if (!identity) fail(404, "IOT_REPORT_DEVICE_NOT_FOUND", "Device not found.");
  const queryStart = range?.startAt ?? scope.startInclusive, queryEnd = range?.endAt ?? scope.endExclusive;
  const args = [device, queryStart, queryEnd, measurement];
  const total = (await client.query(`WITH source AS (${classified}) SELECT ${counts},
    min(created_at) AS first_received, max(created_at) AS last_received,
    min(created_at) FILTER (WHERE value IS NOT NULL) AS first_valid,
    max(created_at) FILTER (WHERE value IS NOT NULL) AS last_valid,
    ((array_agg(created_at ORDER BY created_at DESC,id DESC) FILTER (WHERE value IS NOT NULL)))[1] AS latest_recorded_at,
    ((array_agg(value ORDER BY created_at DESC,id DESC) FILTER (WHERE value IS NOT NULL)))[1] AS latest_value FROM source`, args)).rows[0];
  let start = range?.startAt ?? scope.startInclusive, end = range?.endAt ?? scope.endExclusive;
  if (!range && scope.period === "all-time" && total.first_received) {
    const bounds = (await client.query(`SELECT
      (date_trunc('day',$1::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur') AS start,
      ((date_trunc('day',$2::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur') + interval '1 day') AT TIME ZONE 'Asia/Kuala_Lumpur') AS finish`, [total.first_received, total.last_received])).rows[0];
    start = iso(bounds.start); end = iso(bounds.finish);
  }
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86400000 : 0;
  if (days > 36600) fail(422, "IOT_REPORT_RANGE_LIMIT", "Effective report range exceeds 100 years.");
  const interval = config.interval === "auto" ? (days <= 0.125 ? "minute" : days <= 7 ? "hour" : days <= 366 ? "day" : "week") : config.interval;
  let buckets = [], step = 1;
  if (start && end) {
    // Count bucket boundaries before generating them. No unbounded series is built.
    const bounds = (await client.query(`SELECT
      (date_trunc($2::text,$1::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur') AS anchor`, [start, interval])).rows[0];
    const anchor = iso(bounds.anchor), width = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[interval];
    const count = Math.ceil((Date.parse(end) - Date.parse(anchor)) / width);
    if (count > MAX_BUCKETS && config.interval !== "auto") fail(422, "IOT_REPORT_BUCKET_LIMIT", "Requested interval exceeds 520 buckets; use auto or a coarser interval.");
    step = Math.max(1, Math.ceil(count / MAX_BUCKETS));
    const result = await client.query(`WITH source AS (${classified}), grouped AS (
      SELECT floor(extract(epoch FROM (created_at-$5::timestamptz)) / $6)::integer AS bucket, ${counts}
      FROM source GROUP BY 1
    ) SELECT greatest($2::timestamptz,$5::timestamptz + n * $6 * interval '1 second') AS start,
      least($3::timestamptz,$5::timestamptz + (n+1) * $6 * interval '1 second') AS finish,
      coalesce(g.received,0) AS received,coalesce(g.valid,0) AS valid,
      coalesce(g.absent,0) AS absent,coalesce(g.invalid,0) AS invalid,g.average,g.minimum,g.maximum,
      coalesce(g.detected,0) AS detected,coalesce(g.no_movement,0) AS no_movement
      FROM generate_series(0,$7::integer-1) n LEFT JOIN grouped g ON g.bucket=n ORDER BY n`,
    [device, start, end, measurement, anchor, width * step / 1000, Math.ceil(count / step)]);
    buckets = result.rows.map(row => ({ startInclusive: iso(row.start), endExclusive: iso(row.finish), ...stats(row, measurement) }));
  }
  return {
    contractVersion: 1, category: "iot", generatedAt: now.toISOString(), device: { id: identity.id, name: identity.name },
    temperatureThreshold: measurement === "temperature" && Number.isFinite(identity.thresholds?.temperature) ? identity.thresholds.temperature : null,
    latestReading: total.latest_recorded_at && Number.isFinite(Number(total.latest_value)) ? { recordedAt: iso(total.latest_recorded_at), value: Number(total.latest_value) } : null,
    measurement: { key: measurement, unit: units[measurement] },
    scope: { ...scope, timestampBasis: "sensor_reading.created_at", asOf: now.toISOString(), effectiveStartInclusive: start, effectiveEndExclusive: end },
    aggregation: { interval, step, maximumBuckets: MAX_BUCKETS, bucketCount: buckets.length, emptyBucketsIncluded: true },
    summary: stats(total, measurement), observedSpan: { firstReceivedAt: iso(total.first_received), lastReceivedAt: iso(total.last_received), firstValidAt: iso(total.first_valid), lastValidAt: iso(total.last_valid) },
    buckets, limitations: ["receipt_time_not_capture_time", "missing_counts_apply_to_received_rows", "expected_sampling_schedule_unavailable", "availability_not_calculated", "sample_weighted_average", ...(units[measurement] === "raw" ? ["uncalibrated_raw_units"] : [])], complete: true,
  };
}
function mountIoTSummaryReport(app, { pool, allow }) {
  app.get("/api/reports/iot-summary", allow("reports.read"), async (req, res) => {
    let client;
    try {
      options(req.query);
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const report = await generateIoTSummary(client, req.query);
      const body = JSON.stringify(report);
      if (Buffer.byteLength(body) > MAX_BYTES) fail(422, "IOT_REPORT_RESPONSE_LIMIT", "Report exceeds response size limit.");
      await client.query("COMMIT");
      res.type("json").send(body);
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      const code = error.reportCode || (error.code === "57014" ? "IOT_REPORT_TIMEOUT" : "IOT_REPORT_UNAVAILABLE");
      res.status(error.status || 503).json({ error: { code, message: error.reportCode ? error.message : "IoT summary report unavailable." } });
    } finally { client?.release(); }
  });
}
module.exports = { options, generateIoTSummary, mountIoTSummaryReport };
