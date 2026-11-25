"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createPlantDatabase, installIoTLiveReadingAggregates } = require("./postgres-fixture.cjs");
const { generateIoTSummary: generate, options, mountIoTSummaryReport } = require("../iot-summary-report.cjs");
const { createPlantApp } = require("../server.js");
const base = { contractVersion: "1", device: "sensor", period: "custom", start: "2026-11-01", end: "2026-11-01" };
const now = new Date("2026-11-15T04:00:00Z");

test("strict version, device, measurement, interval and calendar validation", () => {
  for (const patch of [{ contractVersion: undefined }, { contractVersion: "2" }, { device: "" }, { device: ["sensor"] }, { measurement: "__proto__" }, { interval: "minute" }, { start: "2026-02-30" }, { end: "2026-10-01" }, { limit: "1" }, { period: "last-7-days" }]) assert.throws(() => options({ ...base, ...patch }, now));
  assert.equal(options(base, now).measurement, "temperature");
  for (const period of ["all-time", "this-month", "last-month"]) assert.equal(options({ contractVersion: "1", device: "sensor", period }, now).scope.period, period);
});

test("PostgreSQL aggregation filters, gaps, types, extrema and sample-weighted mean", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await installIoTLiveReadingAggregates(db);
  await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('sensor','Sensor one','fixture'),('other','Other','fixture'),('empty','Empty','fixture')");
  const insert = async (id, at, values, device = "sensor") => db.query('INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES($1,$2,$3,$4)', [id, device, JSON.stringify(values), at]);
  await insert("before", "2026-10-31T15:59:59Z", { temperature: 999 });
  await insert("zero", "2026-10-31T16:00:00Z", { temperature: 0 });
  await insert("negative", "2026-10-31T16:05:00Z", { temperature: -10 });
  await insert("high", "2026-10-31T18:00:00Z", { temperature: 40 });
  await insert("absent", "2026-10-31T18:01:00Z", {});
  await insert("null", "2026-10-31T18:02:00Z", { temperature: null });
  await insert("string", "2026-10-31T18:03:00Z", { temperature: "30" });
  await insert("boolean", "2026-10-31T18:04:00Z", { temperature: true });
  await insert("object", "2026-10-31T18:05:00Z", { temperature: {} });
  await db.query(`INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES('overflow','sensor','{"temperature":1e309}','2026-10-31T18:06:00Z')`);
  await insert("end", "2026-11-01T16:00:00Z", { temperature: 800 });
  await insert("other", "2026-10-31T16:00:00Z", { temperature: 700 }, "other");
  const report = await generate(db, base, now);
  assert.equal(report.scope.startInclusive, "2026-10-31T16:00:00.000Z");
  assert.equal(report.scope.endExclusive, "2026-11-01T16:00:00.000Z");
  assert.equal(report.aggregation.bucketCount, 24);
  assert.deepEqual(report.summary, { receivedRows: 9, validMeasurements: 3, absentOrNullMeasurements: 2, invalidMeasurements: 4, missingMeasurements: 6, average: 10, minimum: -10, maximum: 40 });
  assert.equal(report.buckets[0].average, -5);
  assert.equal(report.buckets[1].receivedRows, 0); assert.equal(report.buckets[1].average, null);
  assert.equal(report.buckets[2].average, 40);
  assert.equal(report.observedSpan.firstReceivedAt, "2026-10-31T16:00:00.000Z");
  assert.equal(report.observedSpan.lastValidAt, "2026-10-31T18:00:00.000Z");
  assert.deepEqual(report.latestReading, { recordedAt: "2026-10-31T18:00:00.000Z", value: 40 });
  const exact = await generate(db, { ...base, startAt: "2026-10-31T16:00:00.000Z", endAt: "2026-10-31T16:06:00.000Z" }, now);
  assert.equal(exact.aggregation.interval, "minute"); assert.equal(exact.buckets.length, 6);
  assert.equal(exact.summary.validMeasurements, 2); assert.deepEqual(exact.latestReading, { recordedAt: "2026-10-31T16:05:00.000Z", value: -10 });
  assert.equal(exact.scope.effectiveStartInclusive, "2026-10-31T16:00:00.000Z"); assert.equal(exact.scope.effectiveEndExclusive, "2026-10-31T16:06:00.000Z");
  for (const key of ["receivedRows", "validMeasurements", "missingMeasurements", "absentOrNullMeasurements", "invalidMeasurements"]) assert.equal(report.summary[key], report.buckets.reduce((n, row) => n + row[key], 0));
  for (const row of report.buckets) assert.equal(row.receivedRows, row.validMeasurements + row.missingMeasurements);
  const humidity = await generate(db, { ...base, measurement: "humidity" }, now);
  assert.equal(humidity.summary.validMeasurements, 0); assert.equal(humidity.summary.average, null);
  const empty = await generate(db, { ...base, device: "empty" }, now);
  assert.equal(empty.summary.receivedRows, 0); assert.equal(empty.observedSpan.firstReceivedAt, null); assert.equal(empty.buckets.length, 24);
  const daily = await generate(db, { ...base, end: "2026-11-08" }, now);
  assert.equal(daily.aggregation.interval, "day"); assert.equal(daily.buckets.length, 8);
  const weekly = await generate(db, { ...base, end: "2028-11-01" }, now);
  assert.equal(weekly.aggregation.interval, "week"); assert.ok(weekly.buckets.length <= 520);
  assert.equal(weekly.buckets[0].startInclusive, report.scope.startInclusive);
  assert.equal(weekly.buckets[0].endExclusive, "2026-11-01T16:00:00.000Z");
  await assert.rejects(generate(db, { ...base, interval: "hour", end: "2026-12-01" }, now), e => e.reportCode === "IOT_REPORT_BUCKET_LIMIT");
  const long = await generate(db, { ...base, start: "2000-01-01", end: "2099-12-31" }, now);
  assert.ok(long.aggregation.step > 1); assert.ok(long.buckets.length <= 520);
  const all = await generate(db, { contractVersion: "1", device: "sensor" }, now);
  assert.equal(all.scope.startInclusive, null); assert.equal(all.summary.receivedRows, 11);
  assert.equal(all.scope.effectiveStartInclusive, "2026-10-30T16:00:00.000Z");
  assert.equal(all.scope.effectiveEndExclusive, "2026-11-02T16:00:00.000Z");
  const emptyAll = await generate(db, { contractVersion: "1", device: "empty" }, now);
  assert.equal(emptyAll.buckets.length, 0); assert.equal(emptyAll.summary.average, null);
  await assert.rejects(generate(db, { ...base, device: "missing" }, now), e => e.status === 404);
});

test("summary HTTP route precedes category route and retains authorization", async t => {
  let role = null, calls = 0;
  const pool = { connect: async () => { calls++; throw Error("storage unavailable"); } };
  const auth = { session: async () => role ? { id: "actor", role, status: "Active", mustChangePassword: false } : null, event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/reports/iot-summary?${new URLSearchParams(base)}`;
  for (const candidate of [null, "Botanist", "Administrator", "Visitor"]) {
    role = candidate;
    for (const suffix of ["", "&measurement=movement"]) assert.equal((await fetch(url + suffix, { headers: role ? { Authorization: `Bearer ${"a".repeat(64)}` } : {} })).status, role ? 403 : 401);
  }
  assert.equal(calls, 0);
  role = "Conservation Officer";
  let response = await fetch(url, { headers: { Authorization: `Bearer ${"a".repeat(64)}` } });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, "IOT_REPORT_UNAVAILABLE"); assert.equal(calls, 1);
  response = await fetch(url + "&device=duplicate", { headers: { Authorization: `Bearer ${"a".repeat(64)}` } });
  assert.equal(response.status, 400); assert.equal(calls, 1);
  const vite = readFileSync(join(__dirname, "../../web/vite.config.ts"), "utf8");
  assert.match(vite, /'\/api\/data'/); assert.match(vite, /path\.replace\(\/\^\\\/api\\\/data\/, '\/api'\)/);
});

test("Movement counts exact binary samples, rejects invalid historical values and preserves v1 compatibility", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await installIoTLiveReadingAggregates(db);
  await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('sensor','Sensor one','fixture'),('empty','Empty','fixture')");
  let id = 0;
  const insert = async (values, at) => db.query('INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES($1,\'sensor\',$2,$3)', [String(++id), JSON.stringify(values), at]);
  for (const value of [0, 0]) await insert({ movement: value }, '2026-10-31T16:00:00Z');
  for (const value of [1, 1]) await insert({ movement: value }, '2026-10-31T17:00:00Z');
  for (const value of [0, 1, 1]) await insert({ movement: value }, '2026-10-31T18:00:00Z');
  for (const value of [2, -1, 0.5, '1', '0', true, false, [], {}]) await insert({ movement: value }, '2026-10-31T19:00:00Z');
  await insert({}, '2026-10-31T19:00:00Z'); await insert({ movement: null }, '2026-10-31T19:00:00Z');
  await insert({ movement: 1 }, '2026-10-31T15:59:59Z');
  await insert({ movement: 1 }, '2026-11-01T16:00:00Z');
  const report = await generate(db, { ...base, measurement: 'movement' }, now);
  assert.equal(report.contractVersion, 1); assert.equal(report.summary.receivedRows, 18);
  assert.equal(report.summary.validMeasurements, 7); assert.equal(report.summary.detectedSampleCount, 4);
  assert.equal(report.summary.noMovementSampleCount, 3); assert.equal(report.summary.invalidMeasurements, 9);
  assert.equal(report.summary.absentOrNullMeasurements, 2); assert.equal(report.summary.missingMeasurements, 11);
  assert.equal(report.summary.average, 4 / 7); assert.equal(report.summary.minimum, 0); assert.equal(report.summary.maximum, 1);
  for (const [index, detected, stationary] of [[0, 0, 2], [1, 2, 0], [2, 2, 1], [3, 0, 0], [4, 0, 0]]) {
    const bucket = report.buckets[index];
    assert.equal(bucket.detectedSampleCount, detected); assert.equal(bucket.noMovementSampleCount, stationary);
    if (index === 0) assert.equal(bucket.average, 0);
    if (index === 1) assert.equal(bucket.average, 1);
    if (index >= 3) assert.equal(bucket.average, null);
  }
  assert.equal(report.buckets[3].receivedRows, 11); assert.equal(report.buckets[4].receivedRows, 0);
  assert.equal(report.buckets[0].startInclusive, '2026-10-31T16:00:00.000Z');
  for (const row of [report.summary, ...report.buckets]) {
    assert.equal(row.validMeasurements, row.detectedSampleCount + row.noMovementSampleCount);
    assert.equal(row.receivedRows, row.validMeasurements + row.missingMeasurements);
    assert.equal(row.missingMeasurements, row.absentOrNullMeasurements + row.invalidMeasurements);
  }
  for (const key of ['detectedSampleCount', 'noMovementSampleCount']) assert.equal(report.summary[key], report.buckets.reduce((sum, bucket) => sum + bucket[key], 0));
  const all = await generate(db, { contractVersion: '1', device: 'sensor', measurement: 'movement' }, now);
  assert.equal(all.summary.detectedSampleCount, 6);
  const daily = await generate(db, { ...base, interval: 'day', measurement: 'movement' }, now);
  const weekly = await generate(db, { ...base, interval: 'week', measurement: 'movement' }, now);
  for (const r of [daily, weekly]) { assert.equal(r.buckets[0].detectedSampleCount, 4); assert.equal(r.summary.noMovementSampleCount, 3); }
  const empty = await generate(db, { contractVersion: '1', device: 'empty', measurement: 'movement' }, now);
  assert.equal(empty.summary.detectedSampleCount, 0); assert.equal(empty.summary.noMovementSampleCount, 0); assert.equal(empty.summary.average, null);

  // Other metrics keep their generic numeric classification, including historical
  // nonbinary/negative values. No Movement fields leak into their responses.
  for (const measurement of ['temperature', 'humidity', 'soilMoisture', 'rainfall', 'sound']) {
    await insert({ [measurement]: -2 }, '2026-10-31T20:00:00Z');
    const r = await generate(db, { ...base, measurement }, now);
    assert.equal(r.summary.minimum, -2); assert.equal(r.summary.validMeasurements, 1);
    assert.ok(!Object.hasOwn(r.summary, 'detectedSampleCount'));
    assert.ok(r.buckets.every(b => !Object.hasOwn(b, 'noMovementSampleCount')));
  }

  // Exercise the checked-out frontend validator without altering UI or reading
  // environment files. Additional v1 fields are accepted by this actual consumer.
  const ts = require('../../web/node_modules/typescript');
  const vm = require('node:vm'), consumer = { exports: {}, require: () => ({}) };
  const source = readFileSync(join(__dirname, '../../web/src/services/iotReporting.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, consumer);
  assert.equal(consumer.exports.validIoTSummary(report, { period: 'custom', start: base.start, end: base.end }, 'sensor', 'movement'), true);
});

test("timeout rolls back, releases connection and does not disclose SQL", async () => {
  let handler, released = false; const sql = [];
  mountIoTSummaryReport({ get(_path, _permission, fn) { handler = fn; } }, { allow: value => value, pool: { connect: async () => ({ query: async text => { sql.push(text); if (text.startsWith("SELECT")) throw Object.assign(Error("private SQL"), { code: "57014" }); return { rows: [] }; }, release() { released = true; } }) } });
  let status, body;
  await handler({ query: base }, { status(value) { status = value; return this; }, json(value) { body = value; } });
  assert.equal(status, 503); assert.equal(body.error.code, "IOT_REPORT_TIMEOUT"); assert.ok(sql.includes("ROLLBACK")); assert.ok(released); assert.doesNotMatch(JSON.stringify(body), /private SQL/);
});

test("authorized HTTP summary uses a read-only transaction and returns bounded complete JSON", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await installIoTLiveReadingAggregates(db);
  await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('sensor','Sensor one','fixture')");
  await db.query(`INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES('one','sensor','{"temperature":0}','2026-10-31T16:00:00Z')`);
  const statements = [];
  const pool = { async connect() { const client = await db.connect(); return { query(sql, params) { statements.push(sql); return client.query(sql, params); }, release() { client.release(); } }; } };
  const auth = { session: async () => ({ id: "officer", role: "Conservation Officer", status: "Active", mustChangePassword: false }), event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/iot-summary?${new URLSearchParams(base)}`, { headers: { Authorization: `Bearer ${"a".repeat(64)}` } });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.contractVersion, 1); assert.equal(body.complete, true); assert.equal(body.summary.average, 0);
  assert.equal(body.buckets.length, 24); assert.ok(JSON.stringify(body).length < 1048576);
  assert.ok(statements.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.ok(statements.includes("SET LOCAL statement_timeout = '15s'")); assert.ok(statements.includes("COMMIT"));
});


test("summary compatibility preserves raw history and native weighted windows without fabricating readings", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await installIoTLiveReadingAggregates(db);
  await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('compat','Compatible sensor','synthetic')");
  await db.query(`INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES
    ('raw-compat','compat','{"temperature":0,"movement":1}','2026-11-01T00:04Z')`);
  await db.query(`INSERT INTO iot_reading_aggregate(device_id,bucket_start,bucket_end,sample_count,metrics) VALUES
    ('compat','2026-11-01T00:10Z','2026-11-01T00:20Z',4,
      '{"temperature":{"count":3,"sum":90,"min":10,"max":50},"movement":{"count":4,"sum":2,"min":0,"max":1}}')`);
  await db.query(`INSERT INTO iot_reading_checkpoint(device_id,bucket_start,last_observed_at,sample_count,metrics) VALUES
    ('compat','2026-11-01T00:20Z','2026-11-01T00:27Z',2,
      '{"temperature":{"count":2,"sum":80,"min":35,"max":45}}')`);
  const q = { contractVersion:'1',device:'compat',measurement:'temperature',period:'custom',start:'2026-11-01',end:'2026-11-01',interval:'auto',startAt:'2026-11-01T00:03:00.000Z',endAt:'2026-11-01T00:30:00.000Z' };
  let r = await generate(db,q);
  assert.equal(r.summary.receivedRows,7); assert.equal(r.summary.validMeasurements,6);
  assert.equal(r.summary.average,170/6); assert.equal(r.summary.minimum,0); assert.equal(r.summary.maximum,50);
  assert.equal(r.latestReading,null); assert.equal(r.observedSpan.firstReceivedAt,null);
  assert.equal(r.scope.timestampBasis,'mixed_raw_and_aggregate_windows');
  assert.equal(r.aggregation.interval,'minute'); assert.equal(r.aggregation.step,10);
  assert.deepEqual(r.buckets.map(b=>b.validMeasurements),[1,3,2]);
  assert.equal(r.buckets[0].startInclusive,q.startAt);assert.equal(r.buckets.at(-1).endExclusive,q.endAt);
  assert.equal(r.coverage.aggregateSamples,6);assert.equal(r.coverage.omittedPartialSamples,0);
  assert.ok(r.limitations.includes('aggregate_windows_not_individual_readings'));
  // Never allocate a fraction of a completed window into a selected minute range.
  r = await generate(db,{...q,startAt:'2026-11-01T00:15:00.000Z',endAt:'2026-11-01T00:25:00.000Z'});
  assert.equal(r.summary.receivedRows,0);assert.equal(r.summary.average,null);
  assert.equal(r.coverage.omittedPartialSamples,6);assert.equal(r.latestReading,null);
  assert.ok(r.limitations.includes('partial_aggregate_windows_excluded'));
  // Sum/count does not prove binary Movement counts: keep real raw evidence only.
  r = await generate(db,{...q,measurement:'movement'});
  assert.equal(r.summary.detectedSampleCount,1);assert.equal(r.summary.receivedRows,1);
  assert.equal(r.coverage.omittedMovementSamples,6);
  assert.ok(r.limitations.includes('aggregate_movement_counts_unavailable'));
  // Ignore a stale checkpoint already represented by a completed window.
  await db.query("UPDATE iot_reading_checkpoint SET bucket_start='2026-11-01T00:10Z' WHERE device_id='compat'");
  r = await generate(db,q);assert.equal(r.summary.receivedRows,5);assert.equal(r.coverage.aggregateSamples,4);
  const history = await db.query("SELECT count(*)::int AS n FROM sensor_reading WHERE device_id='compat'");
  assert.equal(history.rows[0].n,1,'reporting never creates raw readings');
  await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('only-summary','Checkpoint only','synthetic')");
  await db.query(`INSERT INTO iot_reading_checkpoint(device_id,bucket_start,last_observed_at,sample_count,metrics)
    VALUES('only-summary','2026-11-01T01:00Z','2026-11-01T01:07Z',2,'{"temperature":{"count":2,"sum":6,"min":0,"max":6}}')`);
  r = await generate(db,{contractVersion:'1',device:'only-summary',period:'all-time'});
  assert.equal(r.summary.receivedRows,2);assert.equal(r.summary.average,3);
  assert.equal(r.summary.minimum,0);assert.equal(r.summary.maximum,6);
  assert.equal(r.latestReading,null);assert.ok(r.buckets.some(b=>b.validMeasurements===2));
  const latest = await db.query("SELECT count(*)::int AS n FROM sensor_reading WHERE device_id='only-summary'");
  assert.equal(latest.rows[0].n,0);

});
