"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("detail visibility, observation ownership, latest readings and bounded device history", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const roles = {
    bot: "Botanist",
    other: "Botanist",
    officer: "Conservation Officer",
    admin: "Administrator",
    visitor: "Visitor",
  };
  const tokens = Object.fromEntries(
    Object.keys(roles).map((key, i) => [key, String(i + 1).repeat(64)]),
  );
  const auth = {
    session: async (token) => {
      const key = Object.keys(tokens).find((key) => tokens[key] === token);
      return key
        ? {
            id: key,
            role: roles[key],
            status: "Active",
            mustChangePassword: false,
          }
        : null;
    },
    event: async () => {},
  };
  await pool.query(
    "INSERT INTO species(scientific_name) VALUES('Public'),('Protected')",
  );
  await pool.query(
    "INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'protected')",
  );
  await pool.query(
    "INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(1,'staff:bot','Approved','a'),(1,'staff:bot','Pending Review','b'),(2,'staff:bot','Approved','c')",
  );
  await pool.query(
    "INSERT INTO plant_location(plant_id,latitude,longitude) VALUES(1,1,2)",
  );
  await pool.query(
    "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('1',1,'staff:bot','Draft','{}','a'),('2',3,'staff:bot','Draft','{}','b')",
  );
  const device = "11111111-1111-4111-8111-111111111111";
  const empty = "22222222-2222-4222-8222-222222222222";
  const missing = "33333333-3333-4333-8333-333333333333";
  await pool.query(
    "INSERT INTO iot_device(id,name,key_hash) VALUES($1,'A','hidden'),($2,'B','hidden')",
    [device, empty],
  );
  await pool.query(
    "INSERT INTO sensor_reading(id,device_id,\"values\",created_at) VALUES('a',$1,'{\"temperature\":10}','2026-01-01'),('b',$1,'{\"temperature\":20}','2026-01-02'),('c',$1,'{\"temperature\":30}','2026-01-02')",
    [device],
  );
  const server = createPlantApp({ auth, pool, origins: new Set() }).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const call = async (path, role) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      { headers: role ? { Authorization: `Bearer ${tokens[role]}` } : {} },
    );
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await call("/plants/1")).status, 200);
  assert.equal((await call("/plants/1")).data.plant.latitude, undefined);
  assert.equal((await call("/plants/1", "bot")).data.plant.latitude, 1);
  assert.equal((await call("/plants/2")).status, 404);
  assert.equal((await call("/plants/2", "other")).status, 404);
  assert.equal((await call("/plants/2", "bot")).status, 200);
  for (const path of ["/plants/3", "/observations/2"]) {
    assert.equal((await call(path, "bot")).status, 404);
    assert.equal((await call(path, "officer")).status, 200);
  }
  assert.equal((await call("/observations/1")).status, 401);
  assert.equal((await call("/observations/1", "visitor")).status, 403);
  assert.equal((await call("/observations/1", "other")).status, 404);
  assert.equal((await call("/observations/1", "bot")).data.observation.id, "1");
  for (const path of [
    "/plants/0",
    "/plants/2147483648",
    "/plants/bad",
    "/observations/bad",
  ])
    assert.equal((await call(path, "bot")).status, 400);
  for (const path of ["/plants/999", "/observations/999"])
    assert.equal((await call(path, "bot")).status, 404);
  for (const path of ["/devices", `/devices/${device}/readings`]) {
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, "bot")).status, 403);
    assert.equal((await call(path, "visitor")).status, 403);
  }
  const devices = (await call("/devices", "officer")).data.devices;
  assert.equal(devices[0].latest_reading.id, "c");
  assert.equal(devices[1].latest_reading, null);
  assert.equal(devices[0].key_hash, undefined);
  const history = (suffix) =>
    call(`/devices/${device}/readings${suffix}`, "admin");
  const first = (await history("?limit=2")).data;
  assert.deepEqual(
    first.readings.map((r) => r.id),
    ["c", "b"],
  );
  assert.equal(first.hasMore, true);
  const second = (await history("?limit=2&page=2")).data;
  assert.deepEqual(
    second.readings.map((r) => r.id),
    ["a"],
  );
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    (await call(`/devices/${empty}/readings`, "officer")).data.readings,
    [],
  );
  assert.equal(
    (await call(`/devices/${missing}/readings`, "admin")).status,
    404,
  );
  assert.equal((await call("/devices/bad/readings", "admin")).status, 400);
  for (const suffix of [
    "?limit=101",
    "?limit=0",
    "?page=-1",
    "?page=10001",
    "?limit=1&limit=2",
    "?page=1.5",
  ])
    assert.equal((await history(suffix)).status, 400);
});
