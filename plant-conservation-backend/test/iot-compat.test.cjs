"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  express = require("express");
const { identity, requirePermission } = require("../authorization.cjs"),
  { mountIoT } = require("../iot.cjs");

test("legacy IoT routes preserve response contracts and enforce permissions", async (t) => {
  const tokens = {},
    sessions = new Map();
  for (const [index, role] of [
    "Administrator",
    "Conservation Officer",
    "Botanist",
    "Visitor",
  ].entries()) {
    const token = String(index + 1).padStart(64, "0");
    tokens[role] = token;
    sessions.set(token, {
      id: role,
      role,
      status: "Active",
      mustChangePassword: false,
    });
  }
  const auth = {
    async session(token) {
      return sessions.get(token) || null;
    },
    async event() {},
  };

  const sensor = {
      sensor_id: "7",
      device_name: "Canopy sensor",
      device_type: "environmental",
      serial_number: null,
      location_description: null,
      status: "active",
    },
    reading = {
      reading_id: "21",
      plant_id: "4",
      temperature_c: "25.5",
      humidity: "70",
      soil_moisture: null,
      rainfall_mm: null,
      motion_detected: false,
      gps_latitude: null,
      gps_longitude: null,
      recorded_at: "2026-10-27T00:00:00.000Z",
    },
    alert = {
      alert_id: "3",
      plant_id: "4",
      reading_id: null,
      sensor_id: null,
      device_name: null,
      alert_type: "manual",
      severity: "medium",
      confidence: null,
      description: null,
      image_path: null,
      status: "open",
      created_at: "2026-10-27T00:00:00.000Z",
      resolved_by: null,
      resolved_at: null,
      scientific_name: "Test species",
      common_name: null,
    };
  const queries = [];
  let emptyLists = false;
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM public.sensor_device AS d"))
        return {
          rows: emptyLists
            ? []
            : [{ ...sensor, installed_at: null, latest_reading: null }],
        };
      if (sql.includes("FROM public.sensor_device"))
        return {
          rows: values[0] === "999" ? [] : [{ ...sensor, sensor_id: values[0] }],
        };
      if (sql.includes("FROM public.sensor_reading"))
        return { rows: emptyLists ? [] : [reading] };
      if (sql.includes("FROM public.threat_alert AS a"))
        return { rows: emptyLists ? [] : [alert] };
      throw new Error("Unexpected SQL in compatibility route test.");
    },
  };
  const app = express();
  app.use(identity(auth));
  mountIoT(app, {
    pool,
    allow: (permission) => requirePermission(auth, permission),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, role) {
    return fetch(base + path, {
      headers: {
        ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
      },
    });
  }

  const routes = [
    "/api/iot/devices",
    "/api/iot/sensors/7/readings",
    "/api/iot/alerts",
  ];
  for (const path of routes) {
    for (const [role, expected] of [
      [undefined, 401],
      ["Visitor", 403],
      ["Botanist", 403],
    ]) {
      const before = queries.length,
        response = await call(path, role);
      assert.equal(response.status, expected, `${role || "Guest"} ${path}`);
      assert.equal(queries.length, before, "Denied request queried the database");
    }
  }

  for (const role of ["Administrator", "Conservation Officer"]) {
    const devicesResponse = await call("/api/iot/devices", role),
      devices = await devicesResponse.json();
    assert.equal(devicesResponse.status, 200);
    assert.deepEqual(Object.keys(devices).sort(), ["count", "devices", "message"]);
    assert.equal(devices.count, 1);
    assert.deepEqual(Object.keys(devices.devices[0]).sort(), [
      "device_name",
      "device_type",
      "installed_at",
      "latest_reading",
      "location_description",
      "sensor_id",
      "serial_number",
      "status",
    ]);
    assert.equal(devices.devices[0].status, "active");
    assert.equal(devices.devices[0].latest_reading, null);

    const historyResponse = await call(
        "/api/iot/sensors/9223372036854775807/readings",
        role,
      ),
      history = await historyResponse.json();
    assert.equal(historyResponse.status, 200);
    assert.deepEqual(Object.keys(history).sort(), [
      "count",
      "message",
      "readings",
      "sensor",
    ]);
    assert.equal(history.sensor.sensor_id, "9223372036854775807");
    assert.deepEqual(Object.keys(history.sensor).sort(), [
      "device_name",
      "device_type",
      "location_description",
      "sensor_id",
      "serial_number",
      "status",
    ]);
    assert.equal(history.count, 1);
    assert.equal(history.readings[0].reading_id, "21");
    assert.deepEqual(Object.keys(history.readings[0]).sort(), [
      "gps_latitude",
      "gps_longitude",
      "humidity",
      "motion_detected",
      "plant_id",
      "rainfall_mm",
      "reading_id",
      "recorded_at",
      "soil_moisture",
      "temperature_c",
    ]);

    const alertsResponse = await call("/api/iot/alerts", role),
      alerts = await alertsResponse.json();
    assert.equal(alertsResponse.status, 200);
    assert.deepEqual(Object.keys(alerts).sort(), ["alerts", "count", "message"]);
    assert.equal(alerts.count, 1);
    assert.deepEqual(Object.keys(alerts.alerts[0]).sort(), [
      "alert_id",
      "alert_type",
      "common_name",
      "confidence",
      "created_at",
      "description",
      "device_name",
      "image_path",
      "plant_id",
      "reading_id",
      "resolved_at",
      "resolved_by",
      "scientific_name",
      "sensor_id",
      "severity",
      "status",
    ]);
    assert.equal(alerts.alerts[0].sensor_id, null);
    assert.equal(alerts.alerts[0].device_name, null);
  }

  const sensorQuery = queries.find(
    ({ sql, values }) =>
      sql.includes("FROM public.sensor_device") &&
      sql.includes("WHERE sensor_id=$1") &&
      values[0] === "9223372036854775807",
  );
  assert.ok(sensorQuery, "sensor lookup binds the bigint ID");
  assert.ok(!sensorQuery.sql.includes("9223372036854775807"));
  const readingsQuery = queries.find(
    ({ sql, values }) =>
      sql.includes("FROM public.sensor_reading") &&
      values[0] === "9223372036854775807",
  );
  assert.ok(readingsQuery, "reading lookup binds the bigint ID");
  assert.match(readingsQuery.sql, /ORDER BY recorded_at DESC,reading_id DESC/);

  for (const invalid of [
    "0",
    "-1",
    "abc",
    "1.5",
    "9223372036854775808",
    "1%27%20OR%201%3D1--",
  ]) {
    const before = queries.length,
      response = await call(
        `/api/iot/sensors/${invalid}/readings`,
        "Administrator",
      );
    assert.equal(response.status, 400, invalid);
    assert.equal(queries.length, before, "Invalid ID queried the database");
  }
  assert.equal(
    (await call("/api/iot/sensors/999/readings", "Administrator")).status,
    404,
  );

  emptyLists = true;
  for (const [path, key] of [
    ["/api/iot/devices", "devices"],
    ["/api/iot/alerts", "alerts"],
  ]) {
    const response = await call(path, "Administrator"),
      body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body[key], []);
    assert.equal(body.count, 0);
  }
  const emptyHistoryResponse = await call(
      "/api/iot/sensors/7/readings",
      "Administrator",
    ),
    emptyHistory = await emptyHistoryResponse.json();
  assert.equal(emptyHistoryResponse.status, 200);
  assert.deepEqual(emptyHistory.readings, []);
  assert.equal(emptyHistory.count, 0);
});
