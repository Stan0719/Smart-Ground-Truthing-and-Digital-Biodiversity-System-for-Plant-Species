"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { distanceMeters } = require("../plant-similarity.cjs");

test("stored-photo BioCLIP comparison preserves permissions, plant identity and real GPS", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const image = await sharp({ create: { width: 20, height: 20, channels: 3,
    background: { r: 20, g: 140, b: 40 } } }).png().toBuffer();
  const obs = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await pool.query("INSERT INTO species(scientific_name,common_name) VALUES('Synthetic plant','Test plant')");
  await pool.query("INSERT INTO rbac_species_visibility VALUES(1,'protected')");
  for (let n = 1; n <= 10; n++) {
    await pool.query("INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(1,'staff:test',$1,$2)",
      [n === 8 ? "Pending Review" : "Approved", `test-${n}`]);
    const gps = n === 1 ? { latitude: 0, longitude: 0 } :
      n === 2 ? { latitude: 0, longitude: 0.01 } : {};
    await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,'staff:test',$3,$4,$5)",
      [obs(n), n, n === 1 || n === 8 ? "Pending Review" : "Approved", gps, `observation-${n}`]);
    if (n !== 10) await pool.query(
      "INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,'staff:test',$3,$4,$5,'image/jpeg',$6)",
      [`asset-${n}`, n, `plant-${n}:photo:0`, obs(n), ![1, 8, 9].includes(n), image]);
  }
  // An already-approved photo of the query plant must never be its own candidate.
  await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,1,'staff:test','Approved','{}','old-query')", [obs(11)]);
  await pool.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES('self-photo',1,'staff:test','self:photo:0',$1,TRUE,'image/jpeg',$2)", [obs(11), image]);
  await pool.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES('alternate-photo',2,'staff:test','plant-2:photo:1',$1,TRUE,'image/jpeg',$2)", [obs(2), image]);
  await pool.query("INSERT INTO plant_location(plant_id,latitude,longitude) VALUES(4,1,1)");
  const roles = ["Conservation Officer", "Botanist", "Administrator", "Visitor"];
  const tokens = roles.map((_, i) => String(i + 1).repeat(64));
  const auth = { event: async () => {}, session: async (token) => {
    const index = tokens.indexOf(token);
    return index < 0 ? null : { id: "test", role: roles[index], status: "Active", mustChangePassword: false };
  } };
  let mode = "valid", calls = 0, lastPayload;
  const similaritySearch = async (payload) => {
    calls++;
    lastPayload = payload;
    if (mode === "offline") throw Error("Synthetic model outage");
    const matches = payload.references.map((item, index) => ({ id: item.id, similarity: 1 - index / 20 })).reverse();
    if (mode === "bad-id") matches[0].id = "not-an-accessible-asset";
    if (mode === "bad-score") matches[0].similarity = 100;
    return { model: "hf-hub:imageomics/bioclip-2", matches };
  };
  const server = createPlantApp({ auth, pool, similaritySearch }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (id = obs(1), token = tokens[0]) => {
    const response = await fetch(`${base}/api/observations/${encodeURIComponent(id)}/similarity`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test("only officers can analyse photos, including protected plant records", async () => {
    assert.equal((await get(obs(1), null)).status, 401);
    for (const token of tokens.slice(1)) assert.equal((await get(obs(1), token)).status, 403);
    assert.equal(calls, 0);
  });
  await t.test("real SQL selects other approved plants once, not mock IDs or private pending uploads", async () => {
    const result = await get();
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.observationId, obs(1));
    assert.equal(result.body.plantId, "PL001");
    assert.deepEqual(lastPayload.references.map(item => item.id), [2, 3, 4, 5, 6, 7].map(n => `asset-${n}`));
    const photo = await sharp(Buffer.from(lastPayload.query, "base64")).metadata();
    assert.equal(photo.format, "jpeg");
    assert.equal(result.body.candidates.length, 5);
    assert.deepEqual(result.body.candidates.map(item => item.rank), [1, 2, 3, 4, 5]);
    assert.equal(result.body.candidates[0].plantId, "PL002");
    assert.equal(result.body.highestSimilarity, 1);
    assert.ok(Math.abs(result.body.candidates[0].distanceMeters - 1111.9508) < 0.1);
    assert.equal(Object.hasOwn(result.body.candidates[1], "distanceMeters"), false);
    assert.ok(result.body.candidates[2].distanceMeters > 100000);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM business_audit")).rows[0].count, 0);
  });
  await t.test("bad IDs, missing observations/photos and empty reference galleries are explicit errors", async () => {
    const before = calls;
    assert.equal((await get("invalid")).status, 400);
    assert.equal((await get(obs(99))).status, 404);
    assert.equal((await get(obs(10))).status, 422);
    await pool.query("UPDATE plant_asset SET approved=FALSE WHERE plant_id BETWEEN 2 AND 7");
    const empty = await get();
    assert.equal(empty.status, 422);
    assert.match(empty.body.error, /No other approved/);
    assert.equal(calls, before);
    await pool.query("UPDATE plant_asset SET approved=TRUE WHERE plant_id BETWEEN 2 AND 7");
  });
  await t.test("model outages and invalid results never fall back to prototype scores", async () => {
    for (const [failure, expected] of [["offline", 503], ["bad-id", 502], ["bad-score", 502]]) {
      mode = failure;
      const result = await get();
      assert.equal(result.status, expected);
      assert.equal(result.body.candidates, undefined);
    }
    mode = "valid";
  });
  await t.test("invalid stored images fail without running inference", async () => {
    const before = calls;
    await pool.query("UPDATE plant_asset SET content=$1 WHERE id='asset-1'", [Buffer.from("not-an-image")]);
    assert.equal((await get()).status, 422);
    assert.equal(calls, before);
  });
});

test("GPS distance preserves genuine zero and unavailable coordinates", () => {
  assert.equal(distanceMeters([0, 0], [0, 0]), 0);
  assert.equal(distanceMeters(null, [0, 0]), undefined);
});
