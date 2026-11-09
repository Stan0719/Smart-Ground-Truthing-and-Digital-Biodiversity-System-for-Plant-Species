"use strict";
// Disposable PGlite + mock identities only; no .env, real login or live pools.
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantApp } = require("../server.js");
const { createReadySpeciesPhotoDatabase } = require("./species-photo-bigint-fixture.cjs");
const { speciesPhotoWritesRequested, requireSpeciesPhotoWrites } = require("../species-photo-activation.cjs");
const { verifySpeciesPhotoStartup } = require("../species-photo-startup.cjs");

test("activation accepts only exact true; absent, empty, invalid and non-string settings are disabled", async () => {
  assert.equal(speciesPhotoWritesRequested({}), false);
  for (const value of [undefined, null, "", "false", "TRUE", "True", "1", "yes", "on", " true", "true ", true, false, 1, {}, []])
    assert.equal(speciesPhotoWritesRequested({ PLANT_SPECIES_PHOTO_WRITES_ENABLED: value }), false);
  assert.equal(speciesPhotoWritesRequested({ PLANT_SPECIES_PHOTO_WRITES_ENABLED: "true" }), true);
  for (const enabled of [undefined, false, "true", 1])
    await assert.rejects(requireSpeciesPhotoWrites({
      connect: () => assert.fail("disabled gate must not acquire a connection"),
    }, enabled), { status: 503 });
});

test("enabled configuration does not weaken the existing writes-off startup preflight", async () => {
  const logs = [];
  let checkouts = 0, released = false;
  await assert.rejects(verifySpeciesPhotoStartup({ enabled: true,
    writesEnabled: speciesPhotoWritesRequested({ PLANT_SPECIES_PHOTO_WRITES_ENABLED: "true" }),
    pool: { schema: "plant_app", async connect() {
      checkouts++;
      return { query: async () => ({ rows: [{ current_user: "postgres", session_user: "postgres",
        effective_schema: "plant_app", search_path: "plant_app, pg_catalog",
        schemas: ["plant_app", "pg_catalog"], read_only: "on" }] }),
        release() { released = true; } };
    } },
    log: (...args) => logs.push(args),
  }), { code: "PHOTO_STARTUP_CHECK_FAILED" });
  assert.equal(checkouts, 1);
  assert.equal(released, true);
  assert.equal(JSON.parse(logs[0][1]).managementWritesDisabled.status, "FAILED");
});

test("one gate covers species images and arrangements, preserving plant/PDF uploads and authorization", async (t) => {
  const pool = await createReadySpeciesPhotoDatabase();
  t.after(() => pool.end());
  const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "green" } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  await pool.query(`INSERT INTO species(scientific_name) VALUES('Activation fixture');
    INSERT INTO rbac_species_visibility VALUES(1,'public');
    INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token)
      VALUES(1,'staff:bot','Pending Review','activation-qr');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
      VALUES('activation-observation',1,'staff:bot','Draft','{}','activation-observation');`);
  await pool.query(`INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content)
    VALUES('existing-reference',1,'staff:officer','existing-reference',true,'image/jpeg',$1)`, [jpeg]);
  const officer = { id: "officer", role: "Conservation Officer", status: "Active", mustChangePassword: false };
  const users = {
    officer,
    bot: { ...officer, id: "bot", role: "Botanist" },
    admin: { ...officer, id: "admin", role: "Administrator" },
    inactive: { ...officer, id: "inactive", status: "Disabled" },
    password: { ...officer, id: "password", mustChangePassword: true },
  };
  const tokens = Object.fromEntries(Object.keys(users).map((key, index) => [key, String(index + 1).repeat(64)]));
  const state = async () => (await pool.query(`SELECT
    (SELECT count(*)::text FROM plant_asset) AS assets,
    (SELECT count(*)::text FROM species_image_reference) AS refs,
    (SELECT count(*)::text FROM species_image_arrangement_history) AS history`)).rows[0];

  for (const [mode, enabled] of [["default", undefined], ["off", false], ["invalid", "true"], ["on", true], ["rollback", false]]) {
    await t.test(mode, async () => {
      const options = { pool, auth: {
        event: async () => {},
        session: async (token) => users[Object.keys(tokens).find((key) => tokens[key] === token)] || null,
      } };
      if (enabled !== undefined) options.speciesPhotoWritesEnabled = enabled;
      const server = createPlantApp(options).listen(0, "127.0.0.1");
      await once(server, "listening");
      const call = async (path, role = "officer", method = "GET", body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
          method, headers: { "Content-Type": "application/json",
            ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, body: response.headers.get("content-type")?.includes("json")
          ? await response.json() : null };
      };
      try {
        const cap = await call("/species/photos/capabilities");
        assert.equal(cap.status, 200);
        assert.equal(cap.body.schemaReady, true);
        assert.equal(cap.body.activationRequested, enabled === true);
        assert.equal(cap.body.writesEnabled, enabled === true);
        const gallery = (await call("/species/1/images")).body;
        const arrangement = { expectedRevision: gallery.revision,
          orderedAssetIds: gallery.images.map((image) => image.assetId),
          removedAssetIds: [], primaryAssetId: "existing-reference" };
        const image = { species_id: 1, client_key: `${mode}-image`,
          content_type: "image/png", base64: png.toString("base64") };
        const before = await state();
        for (const role of [null, "bot", "admin", "inactive", "password"]) {
          assert.ok([401, 403].includes((await call("/assets", role, "POST", image)).status));
          assert.ok([401, 403].includes((await call("/species/1/images", role, "PUT", arrangement)).status));
        }
        assert.deepEqual(await state(), before);
        for (const content_type of ["image/png", "image/jpeg"]) {
          const upload = await call("/assets", "officer", "POST", { ...image, content_type,
            client_key: `${mode}-${content_type}`, base64: (content_type === "image/png" ? png : jpeg).toString("base64") });
          assert.equal(upload.status, enabled === true ? 201 : 503);
        }
        if (enabled !== true) assert.deepEqual(await state(), before);
        const latest = (await call("/species/1/images")).body;
        const saved = await call("/species/1/images", "officer", "PUT", { ...arrangement,
          expectedRevision: latest.revision, orderedAssetIds: latest.images.map((entry) => entry.assetId) });
        assert.equal(saved.status, enabled === true ? 200 : 503);
        if (enabled !== true) assert.deepEqual(await state(), before);
        assert.equal((await call("/assets/existing-reference", null)).status, 200);

        const pdf = await call("/assets", "officer", "POST", { species_id: 1,
          client_key: `${mode}-pdf`, content_type: "application/pdf", base64: Buffer.from("%PDF-offline-fixture").toString("base64") });
        assert.equal(pdf.status, 201);
        const plant = await call("/assets", "bot", "POST", { plant_id: 1, observation_id: "activation-observation",
          client_key: `${mode}-plant`, content_type: "image/png", base64: png.toString("base64") });
        assert.equal(plant.status, 201);
        assert.equal((await call(`/assets/${plant.body.id}`, null)).status, 404);
        assert.equal((await call("/assets", "officer", "POST", { ...image, plant_id: 1 })).status, 400);
        assert.equal((await call("/assets", "officer", "POST", { ...image, content_type: "application/pdf" })).status, 400);

        if (enabled === true) {
          await pool.query("ALTER INDEX species_photo_whole_plant RENAME TO activation_missing_index");
          try {
            assert.equal((await call("/species/photos/capabilities")).body.writesEnabled, false);
            const unchanged = await state();
            assert.equal((await call("/assets", "officer", "POST", image)).status, 503);
            assert.equal((await call("/species/1/images", "officer", "PUT", arrangement)).status, 503);
            assert.deepEqual(await state(), unchanged);
            assert.equal((await call("/assets", "officer", "POST", { species_id: 1,
              client_key: "unready-pdf", content_type: "application/pdf",
              base64: Buffer.from("%PDF-offline-fixture").toString("base64") })).status, 201);
            assert.equal((await call("/assets", "bot", "POST", { plant_id: 1,
              observation_id: "activation-observation", client_key: "unready-plant",
              content_type: "image/png", base64: png.toString("base64") })).status, 201);
          } finally {
            await pool.query("ALTER INDEX activation_missing_index RENAME TO species_photo_whole_plant");
          }
          assert.equal((await call("/species/photos/capabilities")).body.writesEnabled, true);
        }
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  }
});
