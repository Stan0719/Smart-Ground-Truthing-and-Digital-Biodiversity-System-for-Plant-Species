"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm, unlink } = require("node:fs/promises");
const { tmpdir } = require("node:os"), { join } = require("node:path");
const { once } = require("node:events");
const { createPlantApp } = require("../server.js");
const { hash } = require("../domain.cjs");

test("camera clips reuse existing alert columns, enforce device/session boundaries, and stream seekable clips", async t => {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  t.after(() => pool.end());
  await pool.query(`CREATE TABLE plant_record(plant_id BIGINT PRIMARY KEY);
    CREATE TABLE iot_device(id TEXT PRIMARY KEY,plant_id BIGINT,device_type TEXT,status TEXT,key_hash TEXT);
    CREATE TABLE sensor_reading(id TEXT PRIMARY KEY,device_id TEXT REFERENCES iot_device(id),"values" JSONB,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE threat_alert_history(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES iot_device(id),
      reading_id TEXT REFERENCES sensor_reading(id),metric TEXT NOT NULL,value DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Reviewing','Resolved')),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      camera_id TEXT REFERENCES iot_device(id),video_path TEXT,detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE threat_response(id TEXT PRIMARY KEY,alert_id TEXT REFERENCES threat_alert_history(id),officer_subject TEXT,note TEXT,status TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO plant_record VALUES(42),(43);`);
  const root = await mkdtemp(join(tmpdir(), "plant-clips-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = "a".repeat(64), otherKey = "b".repeat(64), id = "c".repeat(32);
  for (const [device, plant, type, secret] of [["camera", 42, "Camera", key], ["other", 43, "Camera", otherKey], ["sensor", 42, "Sensor", otherKey], ["other-sensor", 43, "Sensor", otherKey]])
    await pool.query("INSERT INTO iot_device VALUES($1,$2,$3,'Active',$4)", [device, plant, type, hash(secret)]);
  await pool.query("INSERT INTO sensor_reading(id,device_id) VALUES('trigger-reading','sensor')");
  await pool.query("INSERT INTO sensor_reading(id,device_id) VALUES('other-reading','other-sensor')");
  await pool.query("INSERT INTO threat_alert_history(id,device_id,metric,value) VALUES('existing-sensor-alert','sensor','temperature',31)");
  const existingSchema = (await pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,column_name")).rows;
  const users = new Map([...["Administrator", "Conservation Officer", "Botanist", "Visitor"].map((role, i) => [String(i + 1).repeat(64), {
    id: role, role, status: "Active", mustChangePassword: false,
  }]), ["5".repeat(64), { id: "inactive", role: "Conservation Officer", status: "Inactive", mustChangePassword: false }]]);
  const app = createPlantApp({ pool, recordingsRoot: root, auth: { session: async token => users.get(token), event: async () => {} } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const event = { eventId: id, plantId: "42", eventType: "possible_plant_contact", title: "Possible contact",
    description: "Contact plus fresh MPU movement", detectedAt: "2026-11-13T01:00:00Z",
    recordingStartedAt: "2026-11-13T01:00:00Z", recordingEndedAt: null, recordingStatus: "recording", readingId: "trigger-reading" };
  const send = (body = event, device = "camera", secret = key) => fetch(base + "/device/camera-events", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Device " + secret, "X-Camera-ID": device },
    body: JSON.stringify(body),
  });
  const get = (path = "/camera-events", token = "2".repeat(64), headers = {}, method = "GET") =>
    fetch(base + path, { method, headers: { ...(token ? { Cookie: "niah_session=" + token } : {}), ...headers } });
  assert.equal((await send(event, "camera", otherKey)).status, 401);
  assert.equal((await send(event, "sensor", otherKey)).status, 403);
  assert.equal((await send({ ...event, plantId: "43" })).status, 403);
  assert.equal((await send({ ...event, clip_filename: "../secret.mp4" })).status, 400);
  assert.equal((await send({ ...event, recordingStartedAt: "bad" })).status, 400);
  assert.equal((await send({ ...event, readingId: "missing-reading" })).status, 403);
  assert.equal((await send({ ...event, readingId: "other-reading" })).status, 403);
  // Simulate the same local metadata written by the camera, not additional DB columns.
  const sidecar = data => writeFile(join(root, id + ".json"), JSON.stringify({ ...data, cameraId: "camera" }));
  await sidecar(event);
  assert.equal((await send()).status, 201);
  assert.equal((await send()).status, 201);
  assert.equal((await pool.query("SELECT COUNT(*) AS count FROM threat_alert_history WHERE camera_id IS NOT NULL")).rows[0].count, 1);
  const stored = (await pool.query("SELECT * FROM threat_alert_history WHERE id=$1", [id])).rows[0];
  assert.equal(stored.device_id, "sensor"); assert.equal(stored.reading_id, "trigger-reading");
  assert.equal(stored.camera_id, "camera"); assert.equal(stored.video_path, null);
  assert.equal(stored.metric, "possible_plant_contact"); assert.equal(stored.value, 1);
  assert.equal((await send({ ...event, plantId: "43", readingId: null }, "other", otherKey)).status, 409);
  const path = `/camera-events/${id}/video`;
  for (const token of [null, "3".repeat(64), "4".repeat(64), "5".repeat(64)]) {
    assert.ok([401, 403].includes((await get("/camera-events", token)).status));
    assert.ok([401, 403].includes((await get(path, token, { Range: "bytes=0-3" })).status));
  }
  assert.equal((await get(path)).status, 409);
  const ready = { ...event, recordingEndedAt: "2026-11-13T01:00:12Z", recordingStatus: "ready" };
  assert.equal((await send(ready)).status, 404);
  assert.equal((await (await get()).json()).events[0].recordingStatus, "recording");
  assert.equal((await send({ ...ready, recordingStatus: "processing" })).status, 201);
  await sidecar({ ...ready, recordingStatus: "processing" });
  assert.equal((await (await get()).json()).events[0].recordingStatus, "processing");
  const video = Buffer.from("synthetic-video-byte-range-test");
  await writeFile(join(root, id + ".mp4"), video);
  await sidecar(ready);
  assert.equal((await send(ready)).status, 201);
  assert.equal((await send(ready)).status, 201);
  assert.equal((await send()).status, 201); // delayed recording snapshot cannot downgrade ready
  assert.equal((await send({ ...ready, detectedAt: "2026-11-13T01:00:01Z", recordingStartedAt: "2026-11-13T01:00:01Z" })).status, 409);
  await pool.query("UPDATE threat_alert_history SET status='Reviewing' WHERE id=$1", [id]);
  await pool.query("INSERT INTO threat_response(id,alert_id,officer_subject,note,status) VALUES('response',$1,'officer','Investigated','Reviewing')", [id]);
  assert.equal((await send(ready)).status, 201);
  const list = await (await get()).json();
  assert.equal(list.events.length, 1); assert.equal(list.hasMore, false);
  assert.equal(list.events[0].recordingStatus, "ready");
  assert.equal(list.events[0].videoUrl, `/api/data/camera-events/${id}/video`);
  assert.equal(list.events[0].durationSeconds, 12);
  assert.equal(list.events[0].plantId, "42");
  assert.equal(list.events[0].status, "Reviewing");
  assert.equal((await pool.query("SELECT video_path FROM threat_alert_history WHERE id=$1", [id])).rows[0].video_path, id + ".mp4");
  assert.equal((await pool.query("SELECT note FROM threat_response WHERE alert_id=$1", [id])).rows[0].note, "Investigated");
  assert.equal((await pool.query("SELECT value FROM threat_alert_history WHERE id='existing-sensor-alert'")).rows[0].value, 31);
  const canonical = await (await get("/alerts")).json();
  assert.ok(canonical.alerts.some(alert => alert.id === id && alert.video_path === id + ".mp4"));
  assert.ok(!JSON.stringify(list).includes(root));
  for (const token of ["1".repeat(64), "2".repeat(64)]) {
    const partial = await get(path, token, { Range: "bytes=0-3" });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 0-3/${video.length}`);
    assert.equal(partial.headers.get("cache-control"), "no-store");
    assert.equal(partial.headers.get("content-type"), "video/mp4");
    assert.equal(await partial.text(), video.subarray(0, 4).toString());
  }
  const suffix = await get(path, undefined, { Range: "bytes=-4" });
  assert.equal(suffix.status, 206); assert.equal(await suffix.text(), video.subarray(-4).toString());
  assert.equal((await get(path, undefined, { Range: "bytes=9999-" })).status, 416);
  const head = await get(path, undefined, {}, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), String(video.length));
  assert.equal((await get("/camera-events/not-a-valid-id/video")).status, 400);
  assert.equal((await get(`/camera-events/${"d".repeat(32)}/video`)).status, 404);
  // The existing video_path is sufficient even if optional local display metadata is gone.
  await unlink(join(root, id + ".json"));
  const withoutMetadata = (await (await get()).json()).events[0];
  assert.equal(withoutMetadata.recordingStatus, "ready"); assert.equal(withoutMetadata.durationSeconds, undefined);
  await pool.query("UPDATE threat_alert_history SET video_path='../private.mp4' WHERE id=$1", [id]);
  assert.equal((await get(path)).status, 409);
  await pool.query("UPDATE threat_alert_history SET video_path=$2 WHERE id=$1", [id, id + ".mp4"]);
  await unlink(join(root, id + ".mp4"));
  assert.equal((await get(path)).status, 404);
  const unlinkedId = "e".repeat(32);
  assert.equal((await send({ ...event, eventId: unlinkedId, readingId: null })).status, 201);
  const unlinked = (await pool.query("SELECT device_id,reading_id FROM threat_alert_history WHERE id=$1", [unlinkedId])).rows[0];
  assert.equal(unlinked.device_id, "camera"); assert.equal(unlinked.reading_id, null);
  assert.equal((await pool.query("SELECT to_regclass('camera_event') AS name")).rows[0].name, null);
  assert.deepEqual((await pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,column_name")).rows, existingSchema);
});
