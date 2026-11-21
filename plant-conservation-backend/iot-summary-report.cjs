"use strict";
const { reportPeriod } = require("./report-period.cjs");
const { range: thresholdRange } = require('./sensor-thresholds.cjs');
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
const rawClassified = `SELECT id,created_at,
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
// Aggregate statistics are evidence at their native window resolution, not readings.
// Completed windows take precedence over an already-flushed checkpoint.
const windows = `SELECT bucket_start,bucket_end AS window_end,sample_count,metrics,false AS checkpoint
  FROM iot_reading_aggregate WHERE device_id=$1
  UNION ALL SELECT c.bucket_start,c.last_observed_at,c.sample_count,c.metrics,true
  FROM iot_reading_checkpoint c WHERE c.device_id=$1 AND c.sample_count>0
    AND NOT EXISTS (SELECT 1 FROM iot_reading_aggregate a WHERE a.device_id=c.device_id AND a.bucket_start=c.bucket_start)`;
const covered = `($2::timestamptz IS NULL OR bucket_start >= $2::timestamptz)
  AND ($3::timestamptz IS NULL OR CASE WHEN checkpoint THEN window_end < $3::timestamptz ELSE window_end <= $3::timestamptz END)`;
const classified = `WITH raw AS (${rawClassified}), windows AS (${windows})
  SELECT id,created_at,created_at AS observed_end,value,absent,false AS aggregate,
    1::bigint AS received_count,(value IS NOT NULL)::integer AS valid_count,
    absent::integer AS absent_count,(value IS NULL AND NOT absent)::integer AS invalid_count,
    value AS total_value,value AS min_value,value AS max_value,
    ($4='movement' AND value=1)::integer AS detected_count,
    ($4='movement' AND value=0)::integer AS no_movement_count FROM raw
  UNION ALL SELECT 'window:'||bucket_start::text,bucket_start,window_end,NULL::numeric,false,true,
    sample_count,coalesce((metrics->$4->>'count')::bigint,0),
    sample_count-coalesce((metrics->$4->>'count')::bigint,0),0,
    (metrics->$4->>'sum')::numeric,(metrics->$4->>'min')::numeric,(metrics->$4->>'max')::numeric,0,0
  FROM windows WHERE ${covered} AND $4<>'movement'`;
const counts = `coalesce(sum(received_count),0) AS received,coalesce(sum(valid_count),0) AS valid,
  coalesce(sum(absent_count),0) AS absent,coalesce(sum(invalid_count),0) AS invalid,
  sum(total_value)/nullif(sum(valid_count),0) AS average,min(min_value) AS minimum,max(max_value) AS maximum,
  coalesce(sum(detected_count),0) AS detected,coalesce(sum(no_movement_count),0) AS no_movement`;
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
  const coverage = (await client.query(`WITH windows AS (${windows}) SELECT
    coalesce(sum(sample_count) FILTER (WHERE ${covered} AND $4<>'movement'),0) AS aggregate_samples,
    coalesce(sum(sample_count) FILTER (WHERE NOT (${covered})),0) AS partial_samples,
    coalesce(sum(sample_count) FILTER (WHERE ${covered} AND $4='movement'),0) AS movement_samples,
    max(window_end) AS last_window FROM windows
    WHERE ($2::timestamptz IS NULL OR CASE WHEN checkpoint THEN window_end >= $2::timestamptz ELSE window_end > $2::timestamptz END)
      AND ($3::timestamptz IS NULL OR bucket_start < $3::timestamptz)`,args)).rows[0];
  const aggregateSamples = Number(coverage.aggregate_samples), partialSamples = Number(coverage.partial_samples), movementSamples = Number(coverage.movement_samples);
  if (![aggregateSamples,partialSamples,movementSamples].every(n=>Number.isSafeInteger(n)&&n>=0)) fail(503,"IOT_REPORT_COUNT_MISMATCH","Report coverage is inconsistent.");
  const hasWindows = !!coverage.last_window;
  const total = (await client.query(`WITH source AS (${classified}) SELECT ${counts},
    min(created_at) AS first_received, max(observed_end) AS last_received,
    min(created_at) FILTER (WHERE valid_count>0) AS first_valid,
    max(observed_end) FILTER (WHERE valid_count>0) AS last_valid,
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
      (date_trunc($2::text,$1::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur') AS anchor`, [start, hasWindows && interval === "minute" ? "hour" : interval])).rows[0];
    const anchor = iso(bounds.anchor), width = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[interval];
    const count = Math.ceil((Date.parse(end) - Date.parse(anchor)) / width);
    if (count > MAX_BUCKETS && config.interval !== "auto") fail(422, "IOT_REPORT_BUCKET_LIMIT", "Requested interval exceeds 520 buckets; use auto or a coarser interval.");
    step = Math.max(1, Math.ceil(count / MAX_BUCKETS));
    if (hasWindows && interval === "minute") step = Math.max(10,Math.ceil(step/10)*10);
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
    temperatureThreshold: measurement === "temperature" ? thresholdRange(identity.thresholds?.temperature)?.max ?? null : null,
    latestReading: total.latest_recorded_at && (!coverage.last_window || Date.parse(coverage.last_window)<Date.parse(total.latest_recorded_at)) && Number.isFinite(Number(total.latest_value)) ? { recordedAt: iso(total.latest_recorded_at), value: Number(total.latest_value) } : null,
    measurement: { key: measurement, unit: units[measurement] },
    scope: { ...scope, timestampBasis: hasWindows ? "mixed_raw_and_aggregate_windows" : "sensor_reading.created_at", asOf: now.toISOString(), effectiveStartInclusive: start, effectiveEndExclusive: end },
    aggregation: { interval, step, maximumBuckets: MAX_BUCKETS, bucketCount: buckets.length, emptyBucketsIncluded: true },
    summary: stats(total, measurement), observedSpan: { firstReceivedAt: hasWindows ? null : iso(total.first_received), lastReceivedAt: hasWindows ? null : iso(total.last_received), firstValidAt: hasWindows ? null : iso(total.first_valid), lastValidAt: hasWindows ? null : iso(total.last_valid) },
    coverage: { aggregateSamples, omittedPartialSamples: partialSamples, omittedMovementSamples: movementSamples, nativeResolutionMinutes: hasWindows ? 10 : null },
    buckets, limitations: [...(hasWindows ? ["aggregate_windows_not_individual_readings", "aggregate_observed_span_unavailable"] : []), ...(partialSamples ? ["partial_aggregate_windows_excluded"] : []), ...(movementSamples ? ["aggregate_movement_counts_unavailable"] : []),"receipt_time_not_capture_time", "missing_counts_apply_to_received_rows", "expected_sampling_schedule_unavailable", "availability_not_calculated", "sample_weighted_average", ...(units[measurement] === "raw" ? ["uncalibrated_raw_units"] : [])], complete: true,
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
