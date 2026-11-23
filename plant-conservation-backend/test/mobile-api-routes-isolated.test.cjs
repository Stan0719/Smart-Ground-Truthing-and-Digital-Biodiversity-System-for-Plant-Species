"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const express = require("express");
const sharp = require("sharp");
const ts = require("../../mobileapp/node_modules/typescript");
const { createMobileTestDatabase } = require("./mobile-postgres-fixture.cjs");

// The production policy module is outside this test's permitted scope. This
// stub is deliberately limited to route/SQL testing, not RBAC verification.
const policy = {
  permitted: (user, permission) => permission === "plants.public.read" || Boolean(user?.role === "Botanist" && [
    "plants.catalogue.read", "plants.scientific.read", "observations.create", "observations.edit.own", "plants.create",
  ].includes(permission)),
  canReadScientificCatalogue: (user) => user?.role === "Botanist",
  catalogueVisibilityFor: () => ["public"],
  visibilityFor: () => ["public"],
  projectGps: (value) => value,
  projectApprovedPlantGps: (value) => value,
  projectSpecies: (value) => value,
  assertEdit: () => {},
  assertReview: () => {},
};
const originalLoad = Module._load;
const cachedBefore = new Set(Object.keys(require.cache));
Module._load = function (request, parent, isMain) {
  if (request === "../shared/rbac.cjs") return policy;
  return originalLoad.call(this, request, parent, isMain);
};
let mountDomain, mountRecordChanges, mountPlantSubmissions, mountObservationEdits, identity, requirePermission;
try {
  ({ mountDomain } = require("../domain.cjs"));
  ({ mountRecordChanges } = require("../record-changes.cjs"));
  ({ mountPlantSubmissions } = require("../plant-submissions.cjs"));
  ({ mountObservationEdits } = require("../observation-edits.cjs"));
  ({ identity, requirePermission } = require("../authorization.cjs"));
} finally {
  Module._load = originalLoad;
  // Keep the synthetic policy out of later tests if this file is run in a
  // shared Node test process. The mounted functions above retain references.
  for (const key of Object.keys(require.cache)) {
    if (!cachedBefore.has(key) && key.startsWith(__dirname.slice(0, -5))) delete require.cache[key];
  }
}

const BOTANIST_TOKEN = "a".repeat(64);
const OTHER_BOTANIST_TOKEN = "d".repeat(64);
async function createHarness(t) {
  const db = await createMobileTestDatabase();
  const pool = {
    query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} }),
  };
  const auth = {
    session: async (token) => token === BOTANIST_TOKEN ? { id: "botanist-one", role: "Botanist" }
      : token === OTHER_BOTANIST_TOKEN ? { id: "botanist-two", role: "Botanist" } : null,
    event: async () => {},
  };
  const app = express();
  app.use("/api/plant-submissions", express.json({ limit: "64mb" }));
  app.use(express.json({ limit: "6mb" }));
  app.use(identity(auth));
  mountDomain(app, { pool, auth, allow: (permission) => requirePermission(auth, permission) });
  mountRecordChanges(app, { pool, allow: (permission) => requirePermission(auth, permission) });
  mountPlantSubmissions(app, { pool, allow: (permission) => requirePermission(auth, permission) });
  mountObservationEdits(app, { pool, allow: (permission) => requirePermission(auth, permission) });
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { token, method = "GET", body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, request, base };
}

function mobileClient(base, fetchImpl = fetch) {
  const source = readFileSync(join(__dirname, "../../mobileapp/utils/plantApi.js"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mobileModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "AbortSignal", "__DEV__", code)(
    (name) => {
      if (name === "./faceSession") return { faceSession: { withToken: async (callback) =>
        callback(BOTANIST_TOKEN, { id: "botanist-one", role: "Botanist" }) } };
      if (name === "./apiConfiguration.js") return { mobileApiUrl: () => base };
      throw Error(`Unexpected mobile dependency: ${name}`);
    }, mobileModule, mobileModule.exports, fetchImpl, AbortSignal, false,
  );
  return mobileModule.exports.plantApi;
}

test("actual mobile Species route reads and validates isolated catalogue requests", async (t) => {
  const { db, request } = await createHarness(t);
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  const found = await request("/api/species?q=Synthetic", { token: BOTANIST_TOKEN });
  assert.equal(found.status, 200);
  assert.equal(found.body.species[0].scientific_name, "Synthetic species");
  assert.equal((await request("/api/species/invalid", { token: BOTANIST_TOKEN })).status, 400);
  assert.equal((await request("/api/species/999", { token: BOTANIST_TOKEN })).status, 404);
});

test("actual Observation creation route validates, persists and isolates duplicate keys", async (t) => {
  const { db, request } = await createHarness(t);
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES (1,1,'staff:botanist-one','Approved','synthetic-qr')");
  const content = { heightCm: 100, healthStatus: "Healthy", lifeStage: "Adult", morphology: "Leaves", latitude: 0, longitude: 0, accuracy_m: 0 };
  const payload = { content, client_key: "synthetic-observation-one" };
  assert.equal((await request("/api/plants/1/observations", { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, content: { ...content, heightCm: 0 } } })).status, 400);
  assert.equal((await request("/api/plants/1/observations", { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, content: { ...content, latitude: 91 } } })).status, 400);
  assert.equal((await request("/api/plants/999/observations", { token: BOTANIST_TOKEN, method: "POST", body: payload })).status, 404);
  const created = await request("/api/plants/1/observations", { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(created.status, 201, created.body.error);
  assert.equal(created.body.status, "Draft");
  assert.equal(created.body.content.heightCm, 100);
  assert.equal(created.body.content.latitude, 0);
  const stored = (await db.query("SELECT plant_id,owner_subject,status,content FROM plant_observation WHERE id=$1", [created.body.id])).rows[0];
  assert.equal(stored.owner_subject, "staff:botanist-one");
  assert.equal(stored.plant_id, 1);
  assert.equal(stored.status, "Draft");
  assert.deepEqual(stored.content, content);
  const detail = await request(`/api/observations/${created.body.id}`, { token: BOTANIST_TOKEN });
  assert.equal(detail.status, 200, detail.body.error);
  assert.equal(detail.body.observation.id, created.body.id);
  const submitted = await request(`/api/observations/${created.body.id}/submit`, { token: BOTANIST_TOKEN, method: "POST" });
  assert.equal(submitted.status, 200, submitted.body.error);
  assert.equal(submitted.body.submitted, true);
  assert.equal((await db.query("SELECT status FROM plant_observation WHERE id=$1", [created.body.id])).rows[0].status, "Pending Review");
  const retry = await request("/api/plants/1/observations", { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, created.body.id);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_observation")).rows[0].n, 1);
});

test("actual Species request route validates, persists, retrieves and rejects duplicate submissions", async (t) => {
  const { db, request } = await createHarness(t);
  await db.exec(readFileSync(join(__dirname, "../migrations/004-species-requests.sql"), "utf8"));
  await db.exec(readFileSync(join(__dirname, "../migrations/006-atomic-plant-submissions.sql"), "utf8"));
  for (const file of ["008-record-change-submissions.sql", "009-record-version-history.sql", "016-species-request-content-revision.sql", "017-species-review-cycle.sql"])
    await db.exec(readFileSync(join(__dirname, "../migrations", file), "utf8"));
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer();
  const payload = {
    scientific_name: "Testus isolatus", common_name: "Synthetic plant", genus_name: "Testus",
    family_name: "Testaceae", conservation_status: "Least Concern", description: "Synthetic description",
    habitat: "Synthetic habitat", client_key: "species-test-one",
    photo: { content_type: "image/jpeg", base64: photo.toString("base64") },
  };
  const path = "/api/species-requests";
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, photo: null } })).status, 400);
  const created = await request(path, { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(created.status, 201, created.body.error);
  const requestId = created.body.species_request.request_id;
  assert.ok(Number.isInteger(requestId));
  assert.equal(created.body.species_request.request_status, "Pending Review");
  const stored = (await db.query("SELECT owner_subject,scientific_name,request_status,octet_length(photo) AS photo_size FROM species_request_submission WHERE request_id=$1", [requestId])).rows[0];
  assert.equal(stored.owner_subject, "staff:botanist-one");
  assert.equal(stored.scientific_name, payload.scientific_name);
  assert.ok(stored.photo_size > 0);
  const detail = await request(`${path}/${requestId}`, { token: BOTANIST_TOKEN });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.species_request.request_id, requestId);
  assert.equal((await request(`${path}/999`, { token: BOTANIST_TOKEN })).status, 404);
  assert.equal((await request(`${path}/invalid`, { token: BOTANIST_TOKEN })).status, 400);
  const duplicate = await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, client_key: "species-test-two" } });
  assert.equal(duplicate.status, 409);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM species_request_submission")).rows[0].n, 1);
  await db.query("UPDATE species_request_submission SET request_status='Correction Required',review_comment='Clarify description',reviewed_by='staff:officer',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=$1", [requestId]);
  await db.query("UPDATE record_version_history SET status='Correction Required' WHERE request_id=$1", [requestId]);
  const feedback = await request(`${path}/${requestId}`, { token: BOTANIST_TOKEN });
  assert.equal(feedback.body.species_request.request_status, "Correction Required");
  assert.equal(feedback.body.species_request.review_comment, "Clarify description");
  const correction = await request(`/api/my-species-requests/${requestId}`, { token: BOTANIST_TOKEN, method: "PATCH", body: {
    expected_revision: 1, scientific_name: payload.scientific_name, common_name: payload.common_name,
    genus_name: payload.genus_name, family_name: payload.family_name,
    conservation_status: payload.conservation_status, description: "Corrected description", habitat: payload.habitat,
  } });
  assert.equal(correction.status, 200, correction.body.error);
  assert.equal(correction.body.status, "Pending Review");
  const corrected = (await db.query("SELECT request_status,description,content_revision,review_cycle,octet_length(photo) AS photo_size FROM species_request_submission WHERE request_id=$1", [requestId])).rows[0];
  assert.equal(corrected.description, "Corrected description");
  assert.equal(corrected.content_revision, 2);
  assert.equal(corrected.review_cycle, 2);
  assert.equal(corrected.photo_size, stored.photo_size);
  assert.deepEqual((await db.query("SELECT status FROM record_version_history WHERE request_id=$1 ORDER BY version_number", [requestId])).rows.map((row) => row.status), ["Correction Required", "Pending Review"]);
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,$1)", [payload.scientific_name]);
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  await db.query("UPDATE species_request_submission SET request_status='Approved',approved_species_id=1 WHERE request_id=$1", [requestId]);
  await db.query("UPDATE record_version_history SET status='Approved' WHERE request_id=$1 AND version_number=2", [requestId]);
  const edit = await request("/api/record-changes", { token: BOTANIST_TOKEN, method: "POST", body: {
    kind: "species", target_id: requestId, client_key: "approved-species-edit-one",
    proposed: { scientific_name: payload.scientific_name, common_name: "Proposed common name",
      genus_name: payload.genus_name, family_name: payload.family_name,
      conservation_status: payload.conservation_status, description: "A proposed species edit", habitat: payload.habitat },
  } });
  assert.equal(edit.status, 201, edit.body.error);
  assert.equal(edit.body.change.status, "Pending Review");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM record_change_submission WHERE species_id=1")).rows[0].n, 1);
  assert.equal((await db.query("SELECT common_name FROM species_request_submission WHERE request_id=$1", [requestId])).rows[0].common_name, payload.common_name);
  assert.equal((await db.query("SELECT version_number FROM record_version_history WHERE request_id=$1 ORDER BY version_number DESC LIMIT 1", [requestId])).rows[0].version_number, 3);
});

test("actual notification route keeps two synthetic recipients' rows separate", async (t) => {
  const { db, request } = await createHarness(t);
  await db.exec(readFileSync(join(__dirname, "../migrations/011-botanist-notification-history.sql"), "utf8"));
  await db.query(`INSERT INTO botanist_notification(id,recipient_subject,type,source_key,metadata)
    VALUES ('notification-one','staff:botanist-one','sync_failed','test-one','{}'),
      ('notification-two','staff:botanist-two','sync_failed','test-two','{}')`);
  const one = await request("/api/notifications", { token: BOTANIST_TOKEN });
  assert.equal(one.status, 200, one.body.error);
  assert.deepEqual(one.body.notifications.map((row) => row.id), ["notification-one"]);
  const two = await request("/api/notifications", { token: OTHER_BOTANIST_TOKEN });
  assert.equal(two.status, 200, two.body.error);
  assert.deepEqual(two.body.notifications.map((row) => row.id), ["notification-two"]);
  const marked = await request("/api/notifications/read", {
    token: BOTANIST_TOKEN, method: "POST", body: { ids: ["notification-two", "notification-one"] },
  });
  assert.equal(marked.status, 200, marked.body.error);
  assert.equal(marked.body.updated, 1);
  const rows = (await db.query("SELECT id,read_at IS NOT NULL AS read FROM botanist_notification ORDER BY id")).rows;
  assert.deepEqual(rows, [{ id: "notification-one", read: true }, { id: "notification-two", read: false }]);
});

test("actual correction routes report capabilities and reject invalid proposals", async (t) => {
  const { db, request } = await createHarness(t);
  await db.exec(readFileSync(join(__dirname, "../migrations/008-record-change-submissions.sql"), "utf8"));
  const capability = await request("/api/record-changes/capabilities", { token: BOTANIST_TOKEN });
  assert.equal(capability.status, 200, capability.body.error);
  assert.equal(capability.body.approved_edits_available, true);
  const path = "/api/record-changes/synthetic-change";
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "PATCH", body: {} })).status, 400);
  assert.equal((await request("/api/my-plants/invalid", { token: BOTANIST_TOKEN, method: "PATCH", body: { expected_revision: 1 } })).status, 400);
  assert.equal((await request("/api/my-species-requests/invalid", { token: BOTANIST_TOKEN, method: "PATCH", body: { scientific_name: "x" } })).status, 400);
});

test("real mobile API client reaches isolated Species, Observation and notification routes", async (t) => {
  const { db, base } = await createHarness(t);
  await db.exec(readFileSync(join(__dirname, "../migrations/014-move-qr-code-to-plant-app.sql"), "utf8"));
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES (1,1,'staff:botanist-one','Approved','synthetic-qr')");
  await db.exec(readFileSync(join(__dirname, "../migrations/011-botanist-notification-history.sql"), "utf8"));
  const plantApi = mobileClient(base);
  const species = await plantApi("/species", { expectedAccountId: "botanist-one" });
  assert.equal(species.species[0].scientific_name, "Synthetic species");
  const plant = await plantApi("/plants/1", { expectedAccountId: "botanist-one" });
  assert.equal(plant.plant.plant_id, 1);
  const created = await plantApi("/plants/1/observations", {
    method: "POST", expectedAccountId: "botanist-one",
    body: { content: { heightCm: 100, healthStatus: "Healthy", lifeStage: "Adult", morphology: "Leaves" }, client_key: "mobile-client-observation" },
  });
  assert.equal(created.status, "Draft");
  const detail = await plantApi(`/observations/${created.id}`, { expectedAccountId: "botanist-one" });
  assert.equal(detail.observation.id, created.id);
  const notifications = await plantApi("/notifications", { expectedAccountId: "botanist-one" });
  assert.deepEqual(notifications.notifications, []);
  await assert.rejects(plantApi("/plants/999/observations", {
    method: "POST", body: { content: { heightCm: 100, healthStatus: "Healthy", lifeStage: "Adult", morphology: "Leaves" }, client_key: "missing-plant" },
  }), { status: 404 });
});

test("Phase 4: Add Plant assigns generated QR, persists photos, rejects reuse and rolls back", async (t) => {
  const { db, request, base } = await createHarness(t);
  for (const file of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql", "014-move-qr-code-to-plant-app.sql", "025-original-plant-withdrawal.sql"])
    await db.exec(readFileSync(join(__dirname, "../migrations", file), "utf8"));
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  const generated = await request("/api/qr-codes", { token: BOTANIST_TOKEN, method: "POST", body: { count: 1 } });
  assert.equal(generated.status, 201, generated.body.error);
  const qr = generated.body.qr_codes[0];
  assert.equal(qr.status, "generated");
  const unused = await request(`/api/qr/${qr.qr_code}`);
  assert.equal(unused.status, 200, unused.body.error);
  assert.equal(unused.body.assigned, false);
  assert.equal((await request("/api/qr/unknown-synthetic-code")).status, 404);
  const spare = (await request("/api/qr-codes", { token: BOTANIST_TOKEN, method: "POST", body: { count: 1 } })).body.qr_codes[0];
  assert.equal((await request(`/api/qr-codes/${spare.qr_id}`, { token: BOTANIST_TOKEN, method: "DELETE" })).status, 200);
  assert.deepEqual((await request(`/api/qr/${spare.qr_code}`)).body, { assigned: false, status: "retired" });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer();
  const photo = { content_type: "image/jpeg", base64: image.toString("base64") };
  const payload = {
    species_id: 1, scientific_name: "Synthetic species", qr_id: qr.qr_id,
    latitude: 0, longitude: 0, accuracy_m: 0,
    content: { heightCm: 100, healthStatus: "Healthy", lifeStage: "Adult", morphology: "Leaves" },
    client_key: "plant-test-one", photos: [photo, photo, photo],
  };
  const path = "/api/plant-submissions";
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, photos: [photo] } })).status, 400);
  const oversized = { ...photo, base64: Buffer.alloc(4194305, 1).toString("base64") };
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, client_key: "oversized-test", photos: [photo, oversized, photo] } })).status, 413);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_record")).rows[0].n, 0);
  const created = await mobileClient(base)("/plant-submissions", { method: "POST", body: payload, expectedAccountId: "botanist-one" });
  assert.equal(created.status, "Pending Review");
  assert.equal(created.qr_token, qr.qr_code);
  const plantId = created.plant_id;
  assert.equal((await db.query("SELECT rbac_status FROM plant_record WHERE plant_id=$1", [plantId])).rows[0].rbac_status, "Pending Review");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_asset WHERE plant_id=$1", [plantId])).rows[0].n, 3);
  assert.equal((await db.query("SELECT version_number,status FROM record_version_history WHERE plant_id=$1", [plantId])).rows[0].version_number, 1);
  assert.equal((await db.query("SELECT status,plant_id FROM plant_app.qr_code WHERE qr_id=$1", [qr.qr_id])).rows[0].status, "assigned");
  assert.equal((await db.query("SELECT content->>'latitude' AS latitude FROM plant_observation WHERE plant_id=$1", [plantId])).rows[0].latitude, "0");
  const pending = await request(`/api/qr/${qr.qr_code}`, { token: BOTANIST_TOKEN });
  assert.deepEqual(pending.body, { assigned: false, status: "pending_review" });
  const publicPending = await request(`/api/qr/${qr.qr_code}`);
  assert.deepEqual(publicPending.body, { assigned: false, status: "unavailable_yet" });
  const retry = await request(path, { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(retry.status, 201, retry.body.error);
  assert.equal(retry.body.plant_id, plantId);
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, client_key: "plant-test-two" } })).status, 409);
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, qr_id: 999, client_key: "plant-test-three" } })).status, 409);
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, qr_id: spare.qr_id, client_key: "retired-qr-test" } })).status, 409);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_record")).rows[0].n, 1);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_submission_receipt")).rows[0].n, 1);
  const initialPhotos = (await db.query("SELECT id FROM plant_asset WHERE plant_id=$1 ORDER BY created_at,id", [plantId])).rows.map((row) => row.id);
  await db.query("UPDATE plant_record SET rbac_status='Correction Required' WHERE plant_id=$1", [plantId]);
  await db.query("UPDATE plant_observation SET status='Correction Required' WHERE plant_id=$1", [plantId]);
  await db.query("UPDATE record_version_history SET status='Correction Required' WHERE plant_id=$1", [plantId]);
  await db.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES ('review-one',$1,'staff:officer','Correction Required','Check description')", [created.id]);
  const correction = await request(`/api/my-plants/${plantId}`, { token: BOTANIST_TOKEN, method: "PATCH", body: {
    expected_revision: 1, species_id: 1, scientific_name: "Synthetic species",
    content: { ...payload.content, notes: "Corrected description", latitude: 0, longitude: 0, accuracy_m: 0 },
    photo_ids: initialPhotos,
  } });
  assert.equal(correction.status, 200, correction.body.error);
  assert.equal(correction.body.status, "Pending Review");
  const corrected = (await db.query("SELECT status,revision,content FROM plant_observation WHERE id=$1", [created.id])).rows[0];
  assert.equal(corrected.status, "Pending Review");
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.content.notes, "Corrected description");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_asset WHERE observation_id=$1", [created.id])).rows[0].n, 3);
  assert.deepEqual((await db.query("SELECT version_number,status FROM record_version_history WHERE plant_id=$1 ORDER BY version_number", [plantId])).rows.map((row) => row.status), ["Superseded", "Pending Review"]);
  await db.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=$1", [plantId]);
  await db.query("UPDATE plant_observation SET status='Approved' WHERE id=$1", [created.id]);
  await db.query("UPDATE plant_asset SET approved=TRUE WHERE observation_id=$1", [created.id]);
  await db.query("UPDATE record_version_history SET status='Approved' WHERE plant_id=$1 AND version_number=2", [plantId]);
  const edit = await request("/api/record-changes", { token: BOTANIST_TOKEN, method: "POST", body: {
    kind: "plant", target_id: plantId, client_key: "approved-plant-edit-one",
    proposed: { species_id: 1, scientific_name: "Synthetic species",
      content: { ...payload.content, notes: "A proposed approved-record edit", latitude: 0, longitude: 0, accuracy_m: 0 },
      photo_ids: initialPhotos },
  } });
  assert.equal(edit.status, 201, edit.body.error);
  assert.equal(edit.body.change.status, "Pending Review");
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM record_change_submission WHERE plant_id=$1", [plantId])).rows[0].n, 1);
  assert.equal((await db.query("SELECT status FROM record_version_history WHERE plant_id=$1 ORDER BY version_number DESC LIMIT 1", [plantId])).rows[0].status, "Pending Review");
  assert.equal((await db.query("SELECT content->>'notes' AS notes FROM plant_observation WHERE id=$1", [created.id])).rows[0].notes, "Corrected description");
  await db.query("UPDATE plant_app.qr_code SET status='active',activated_at=CURRENT_TIMESTAMP WHERE qr_id=$1", [qr.qr_id]);
  const approved = await request(`/api/qr/${qr.qr_code}`);
  assert.equal(approved.status, 200, approved.body.error);
  assert.equal(approved.body.assigned, true);
  await db.query("UPDATE plant_record SET rbac_status='Rejected' WHERE plant_id=$1", [plantId]);
  assert.deepEqual((await request(`/api/qr/${qr.qr_code}`, { token: BOTANIST_TOKEN })).body,
    { assigned: false, status: "invalid_record" });
  assert.deepEqual((await request(`/api/qr/${qr.qr_code}`)).body,
    { assigned: false, status: "record_unavailable" });
  await db.query("UPDATE plant_record SET rbac_status='Withdrawn',withdrawn_by='staff:botanist-one',withdrawn_at=CURRENT_TIMESTAMP WHERE plant_id=$1", [plantId]);
  assert.deepEqual((await request(`/api/qr/${qr.qr_code}`, { token: BOTANIST_TOKEN })).body,
    { assigned: false, status: "invalid_record" });
  assert.deepEqual((await request(`/api/qr/${qr.qr_code}`)).body,
    { assigned: false, status: "record_unavailable" });
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, client_key: "plant-test-four" } })).status, 409);
});

test("Phase 4: Observation edit and correction preserve the approved source", async (t) => {
  const { db, request } = await createHarness(t);
  await db.exec(readFileSync(join(__dirname, "../migrations/021-observation-edit-requests.sql"), "utf8"));
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES (1,1,'staff:botanist-one','Approved','synthetic-qr')");
  const observationId = "11111111-1111-4111-8111-111111111111";
  const original = { heightCm: 100, healthStatus: "Healthy", lifeStage: "Adult", morphology: "Original leaves", latitude: 0, longitude: 0 };
  await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:botanist-one','Approved',$2,'original-observation','subsequent_observation')`, [observationId, original]);
  const proposed = { ...original, morphology: "Proposed leaves" };
  const path = "/api/observation-edits";
  const payload = { observation_id: observationId, client_key: "observation-edit-one", content: proposed, photo_ids: [], photos: [] };
  assert.equal((await request(path, { token: BOTANIST_TOKEN, method: "POST", body: { ...payload, content: { ...proposed, heightCm: 0 } } })).status, 400);
  const created = await request(path, { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(created.status, 201, created.body.error);
  assert.equal(created.body.edit.status, "Pending Review");
  const editId = created.body.edit.id;
  assert.deepEqual((await db.query("SELECT content FROM plant_observation WHERE id=$1", [observationId])).rows[0].content, original);
  assert.equal((await request(`${path}/${editId}`, { token: BOTANIST_TOKEN })).body.edit.id, editId);
  const retry = await request(path, { token: BOTANIST_TOKEN, method: "POST", body: payload });
  assert.equal(retry.status, 201, retry.body.error);
  assert.equal(retry.body.edit.id, editId);
  await db.query("UPDATE observation_edit_request SET status='Correction Required',review_comment='Clarify morphology',reviewed_by='staff:officer',reviewed_at=CURRENT_TIMESTAMP WHERE id=$1", [editId]);
  const feedback = await request(`${path}/${editId}`, { token: BOTANIST_TOKEN });
  assert.equal(feedback.body.edit.status, "Correction Required");
  assert.equal(feedback.body.edit.review_comment, "Clarify morphology");
  const corrected = await request(`${path}/${editId}`, { token: BOTANIST_TOKEN, method: "PATCH", body: {
    revision: 1, content: { ...original, morphology: "Clarified leaves" }, photo_ids: [], photos: [],
  } });
  assert.equal(corrected.status, 200, corrected.body.error);
  assert.equal(corrected.body.edit.status, "Pending Review");
  assert.equal(corrected.body.edit.revision, 2);
  assert.equal((await db.query("SELECT proposed_content->>'morphology' AS morphology FROM observation_edit_request WHERE id=$1", [editId])).rows[0].morphology, "Clarified leaves");
  assert.deepEqual((await db.query("SELECT content FROM plant_observation WHERE id=$1", [observationId])).rows[0].content, original);
  assert.deepEqual((await db.query("SELECT event_type FROM observation_edit_event WHERE request_id=$1 ORDER BY created_at,id", [editId])).rows.map((row) => row.event_type).sort(), ["resubmitted", "submitted"]);
});

test("Phase 4: mobile API reports network, timeout and non-JSON failures without changing input", async (t) => {
  const { db, base } = await createHarness(t);
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic species')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
  let calls = 0;
  const flaky = mobileClient(base, async (...args) => {
    calls++;
    if (calls === 1) throw Error("synthetic offline");
    return fetch(...args);
  });
  await assert.rejects(flaky("/species"), { code: "API_UNREACHABLE" });
  assert.equal((await flaky("/species")).species[0].scientific_name, "Synthetic species");
  assert.equal(calls, 2); // Caller retry; plantApi does not silently duplicate requests.
  const timeout = mobileClient(base, async () => { throw Object.assign(Error("synthetic timeout"), { name: "TimeoutError" }); });
  await assert.rejects(timeout("/species"), { code: "API_TIMEOUT" });
  const invalid = mobileClient(base, async () => new Response("<html>bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
  await assert.rejects(invalid("/species"), { code: "API_NOT_JSON", status: 502 });
  const body = { content: { heightCm: 100 }, client_key: "unchanged-local-data" };
  const original = structuredClone(body);
  await assert.rejects(mobileClient(base, async () => { throw Error("offline"); })("/plants/1/observations", { method: "POST", body }), { code: "API_UNREACHABLE" });
  assert.deepEqual(body, original);
});
