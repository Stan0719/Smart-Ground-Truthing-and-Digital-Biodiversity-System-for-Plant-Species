"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { createPlantApp } = require("../server.js");

const token = "a".repeat(64);
const officer = { id: "officer-1", role: "Conservation Officer", status: "Active", mustChangePassword: false };

async function withServer(t, pool, auth = { session: async () => null, event: async () => {} }) {
  const server = createPlantApp({ pool, auth, origins: new Set(["http://localhost:5173"]) }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function sampleSpecies() {
  return { id: "19", scientific_name: "Nepenthes rafflesiana", common_name: "Tropical pitcher plant", description: "Very small but fragile", habitat: "Flat landscape", cultural_significance: "", total: 1 };
}

test("global search returns visible species and pages, uses bound query parameters, and excludes observations for public users", async (t) => {
  const calls = [];
  const pool = { async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes("FROM species s")) return { rows: [sampleSpecies()] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [] };
    throw Error(`Unexpected public search query: ${sql.slice(0, 50)}`);
  } };
  const base = await withServer(t, pool);
  const query = "Nepenthes";
  const response = await fetch(`${base}/api/global-search?q=${encodeURIComponent(query)}&locale=en`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.species[0].path, "/species/19");
  assert.deepEqual(body.results.observations, []);
  assert.deepEqual(body.results.pages, []);
  const speciesCall = calls.find(({ sql }) => sql.includes("FROM species s"));
  assert.ok(speciesCall.values.includes(query.toLocaleLowerCase()));
  assert.deepEqual(speciesCall.values[0], ["public"]);
  assert.doesNotMatch(speciesCall.sql, /Nepenthes|OR 1=1/);
  await fetch(`${base}/api/global-search?q=${encodeURIComponent("%' OR 1=1 --")}&locale=en`);
  assert.ok(calls.some(({ values }) => values.includes("%' or 1=1 --")));
});

test("global search returns officer-authorized observation hits and restricted destination pages", async (t) => {
  const calls = [];
  const pool = { async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes("FROM plant_translation_cache c")) return { rows: [] };
    if (sql.includes("FROM species s")) return { rows: [] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [] };
    if (sql.includes("FROM plant_observation o JOIN plant_record p")) return { rows: [{ id: "obs-9", plant_id: "32", plant_scientific_name: "Calamus manan", scientific_name: "Calamus manan", common_name: "Rattan palm", morphology: "Tall stem", notes: "Field observation", total: 1 }] };
    if (sql.includes("FROM threat_alert_history a")) return { rows: [{ id: "alert-3", device_id: "sensor-2", metric: "movement", value: 1, status: "New", video_path: "private/video.mp4", total: 1 }] };
    throw Error(`Unexpected officer search query: ${sql.slice(0, 50)}`);
  } };
  const base = await withServer(t, pool, { session: async (value) => value === token ? officer : null, event: async () => {} });
  const response = await fetch(`${base}/api/global-search?q=observation&locale=ms`, { headers: { Cookie: `niah_session=${token}` } });
  assert.equal(response.status, 200, JSON.stringify(calls.map(({ sql }) => sql.slice(0, 90))));
  const body = await response.json();
  assert.equal(body.results.observations[0].path, "/conservation/observations?observation=obs-9");
  assert.equal(body.results.alerts[0].path, "/conservation/alerts?alert=alert-3");
  assert.doesNotMatch(JSON.stringify(body.results.alerts), /private\/video\.mp4|video_path/);
  assert.ok(body.results.pages.some((page) => page.path === "/conservation/observations"));
  const observationCall = calls.find(({ sql }) => sql.includes("FROM plant_observation o JOIN plant_record p"));
  assert.equal(observationCall.values[0], true);
  assert.deepEqual(observationCall.values[2], ["public", "internal", "protected"]);
});

test("global search rejects bearer requests and never runs database search for them", async (t) => {
  let queryCount = 0;
  const pool = { async query() { queryCount++; return { rows: [] }; } };
  const base = await withServer(t, pool, { session: async (value) => value === token ? officer : null, event: async () => {} });
  const response = await fetch(`${base}/api/global-search?q=plant`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 403);
  assert.equal(queryCount, 0);
});

test("public plant results contain only authorized searchable fields and use the plant detail route", async (t) => {
  const calls = [];
  const pool = { async query(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes("FROM species s")) return { rows: [] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [{ id: "32", plant_scientific_name: "Calamus manan", scientific_name: "Calamus manan", common_name: "Rattan palm", morphology: "Climbing palm", zone: "Zone A", latitude: 3.12, longitude: 113.45, total: 1 }] };
    throw Error(`Unexpected plant search query: ${sql.slice(0, 50)}`);
  } };
  const base = await withServer(t, pool);
  const response = await fetch(`${base}/api/global-search?q=PL032&locale=en`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.counts.plants, 1);
  assert.equal(body.results.plants[0].path, "/plant/32");
  assert.doesNotMatch(JSON.stringify(body.results.plants), /latitude|longitude|Zone A/);
  const call = calls.find(({ sql }) => sql.includes("FROM plant_record p JOIN species s"));
  assert.deepEqual(call.values[0], ["public"]);
});

test("admin page results use the authenticated role; public page searches do not disclose admin routes", async (t) => {
  const pool = { async query(sql) {
    if (sql.includes("FROM species s")) return { rows: [] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [] };
    if (sql.includes("FROM threat_alert_history a")) return { rows: [] };
    throw Error(`Unexpected page-only search query: ${sql.slice(0, 50)}`);
  } };
  const base = await withServer(t, pool, { session: async (value) => value === token ? { ...officer, role: "Administrator" } : null, event: async () => {} });
  const admin = await fetch(`${base}/api/global-search?q=users`, { headers: { Cookie: `niah_session=${token}` } });
  assert.equal(admin.status, 200);
  const adminBody = await admin.json();
  assert.ok(adminBody.results.pages.some((page) => page.path === "/admin/users"));
  assert.ok(!adminBody.results.pages.some((page) => page.path.startsWith("/conservation/")));
  const publicResponse = await fetch(`${base}/api/global-search?q=users`);
  const publicBody = await publicResponse.json();
  assert.ok(!publicBody.results.pages.some((page) => page.path.startsWith("/admin/")));
});

test("short and unmatched public queries return empty results without exposing protected content", async (t) => {
  const calls = [];
  const pool = { async query(sql, values = []) { calls.push({ sql, values }); return { rows: [] }; } };
  const base = await withServer(t, pool);
  const short = await (await fetch(`${base}/api/global-search?q=x`)).json();
  assert.deepEqual(short.results.species, []);
  assert.equal(calls.length, 0);
  const empty = await (await fetch(`${base}/api/global-search?q=zzqx`)).json();
  assert.deepEqual(empty.results.species, []);
  assert.deepEqual(empty.results.plants, []);
  assert.equal(calls.length, 2);
  await fetch(`${base}/api/global-search?q=1`);
  assert.equal(calls.length, 4);
  assert.ok(calls.some(({ values }) => values.includes("1") && values.at(-1) === true));
});

test("global search can match only a current, hash-valid translated species cache entry", async (t) => {
  const source = "Tropical pitcher plant";
  const sourceHash = createHash("sha256").update(source, "utf8").digest("hex");
  const pool = { async query(sql) {
    if (sql.includes("FROM plant_translation_cache c")) return { rows: [{ record_id: "19", field_name: "commonName", source_hash: sourceHash, translated_text: "Pokok periuk kera" }] };
    if (sql.includes("FROM species s")) return { rows: [sampleSpecies()] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [] };
    throw Error(`Unexpected cache search query: ${sql.slice(0, 50)}`);
  } };
  const base = await withServer(t, pool);
  const response = await fetch(`${base}/api/global-search?q=periuk&locale=ms`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.species[0].title, "Nepenthes rafflesiana - Pokok periuk kera");

  const stalePool = { async query(sql) {
    if (sql.includes("FROM plant_translation_cache c")) return { rows: [{ record_id: "19", field_name: "commonName", source_hash: "0".repeat(64), translated_text: "Stale hidden name" }] };
    if (sql.includes("FROM species s")) return { rows: [sampleSpecies()] };
    if (sql.includes("FROM plant_record p JOIN species s")) return { rows: [] };
    throw Error(`Unexpected stale search query: ${sql.slice(0, 50)}`);
  } };
  const staleBase = await withServer(t, stalePool);
  const staleResponse = await fetch(`${staleBase}/api/global-search?q=periuk&locale=ms`);
  assert.equal(staleResponse.status, 200);
  assert.deepEqual((await staleResponse.json()).results.species, []);
});
