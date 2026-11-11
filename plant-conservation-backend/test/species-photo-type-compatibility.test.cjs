"use strict";
// Disposable PGlite only. BIGINT parameters/results use decimal strings and ::text
// so the engine's numeric decoder cannot conceal JavaScript precision loss.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { useVerifiedPhotoKeyTypes } = require("./species-photo-bigint-fixture.cjs");
const { readGallery } = require("../species-gallery.cjs");
const { listLibrary } = require("../species-photo-library.cjs");

test("014/015 accept the verified mixed key types without altering existing evidence", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql"])
    await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  await useVerifiedPhotoKeyTypes(pool);
  const species = "9007199254740993", plant = "9007199254740995";
  await pool.query(`INSERT INTO species(species_id,scientific_name)
    VALUES(1,'Small'),(2147483648,'Beyond int32'),(${species},'Exact bigint');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
    VALUES(${plant},${species},'staff:bot','Approved','big-plant');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
    VALUES('obs:text',${plant},'staff:bot','Approved','{}','obs:text');
    INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content)
    VALUES('a',${species},'staff:bot','a',true,'image/jpeg',decode('1234','hex')),
      ('b',${species},'staff:bot','b',true,'image/png',decode('5678','hex')),
      ('other',2147483648,'staff:bot','other',true,'image/jpeg',decode('abcd','hex'));
    INSERT INTO plant_asset(id,plant_id,observation_id,owner_subject,client_key,content_type,content)
    VALUES('whole',${plant},'obs:text','staff:bot','whole','image/jpeg',decode('abcd','hex'));
    INSERT INTO species_request_submission(request_id,owner_subject,client_key,payload_hash,
      scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
    VALUES(1,'staff:bot','request','hash','Requested','Common','Genus','Family','Status','Description','Habitat',decode('1234','hex'),${species});`);
  const evidence = async () => (await pool.query(`SELECT id,species_id::text,plant_id::text,
    observation_id,owner_subject,client_key,encode(content,'hex') AS bytes
    FROM plant_asset ORDER BY id`)).rows;
  const before = await evidence();
  for (const name of ["014-species-image-gallery.sql", "015-species-photo-roles.sql"])
    await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  const rejects = (sql, code) => assert.rejects(pool.query(sql), { code });

  await t.test("every verified and newly defined key has its intended type", async () => {
    const expected = {
      "species.species_id": "bigint",
      "plant_record.plant_id": "bigint", "plant_record.species_id": "bigint",
      "plant_asset.id": "text", "plant_asset.species_id": "bigint",
      "plant_asset.plant_id": "bigint", "plant_asset.observation_id": "text",
      "plant_observation.id": "text", "plant_observation.plant_id": "bigint",
      "species_request_submission.request_id": "integer",
      "species_request_submission.approved_species_id": "integer",
      "species_request_submission.proposed_species_id": "bigint",
      "species_request_submission.photo_asset_id": "text",
      "species_image_collection.species_id": "bigint",
      "species_image_reference.species_id": "bigint",
      "species_image_reference.asset_id": "text", "species_image_reference.position": "integer",
      "species_image_arrangement_history.species_id": "bigint",
      "plant_asset_photo_role.plant_id": "bigint",
      "plant_asset_photo_role.asset_id": "text", "plant_asset_photo_role.observation_id": "text",
      "species_request_proposed_image.request_id": "integer",
      "species_request_proposed_image.asset_id": "text",
    };
    const rows = (await pool.query(`SELECT table_name || '.' || column_name AS key,data_type
      FROM information_schema.columns WHERE table_schema='public'`)).rows;
    for (const [key, type] of Object.entries(expected))
      assert.equal(rows.find((r) => r.key === key)?.data_type, type, key);
    assert.deepEqual((await pool.query("SELECT conname FROM pg_constraint WHERE NOT convalidated")).rows, []);
    assert.deepEqual((await pool.query("SELECT indexrelid FROM pg_index WHERE NOT indisvalid OR NOT indisready")).rows, []);
    assert.deepEqual(await evidence(), before);
  });

  await t.test("INTEGER approved FK to BIGINT parent works in range, rejects orphans and overflows", async () => {
    await pool.query("UPDATE species_request_submission SET approved_species_id=1,request_status='Approved' WHERE request_id=1");
    await rejects("UPDATE species_request_submission SET approved_species_id=999 WHERE request_id=1", "23503");
    await rejects("UPDATE species_request_submission SET approved_species_id=2147483648 WHERE request_id=1", "22003");
    await rejects("UPDATE species_request_submission SET proposed_species_id=999 WHERE request_id=1", "23503");
    assert.equal((await pool.query("SELECT proposed_species_id::text AS id FROM species_request_submission WHERE request_id=1")).rows[0].id, species);
  });

  await t.test("BIGINT membership, primary choice and deferred order retain constraints", async () => {
    await pool.query("INSERT INTO species_image_collection(species_id,updated_by) VALUES($1,'staff:officer')", [species]);
    await pool.query(`INSERT INTO species_image_reference(species_id,asset_id,position,is_primary,added_by)
      VALUES(${species},'b',0,true,'staff:officer'),(${species},'a',1,false,'staff:officer')`);
    await rejects(`INSERT INTO species_image_reference(species_id,asset_id,position,added_by) VALUES(${species},'other',2,'staff:officer')`, "23503");
    await rejects("INSERT INTO species_image_collection(species_id,updated_by) VALUES(999,'staff:officer')", "23503");
    await rejects(`UPDATE species_image_reference SET is_primary=true WHERE asset_id='a'`, "23505");
    await rejects("UPDATE species_image_reference SET position=0 WHERE asset_id='a'", "23505");
    await rejects(`INSERT INTO species_image_reference(species_id,asset_id,position,added_by) VALUES(${species},'a',2,'staff:officer')`, "23505");
    await pool.query(`BEGIN;
      UPDATE species_image_reference SET position=1 WHERE asset_id='b';
      UPDATE species_image_reference SET position=0 WHERE asset_id='a'; COMMIT;`);
    assert.deepEqual((await pool.query("SELECT asset_id FROM species_image_reference ORDER BY position")).rows.map((r) => r.asset_id), ["a", "b"]);
    assert.equal((await pool.query("SELECT species_id::text AS id FROM species_image_reference WHERE is_primary")).rows[0].id, species);
  });

  await t.test("tombstones and append-only revision history preserve bytes", async () => {
    await rejects("UPDATE species_image_reference SET removed_at=now(),removed_by='staff:officer' WHERE asset_id='b'", "23514");
    await pool.query(`UPDATE species_image_reference SET removed_at=now(),removed_by='staff:officer',position=NULL,is_primary=false WHERE asset_id='b';
      UPDATE species_image_collection SET revision=1 WHERE species_id=${species};
      INSERT INTO species_image_arrangement_history(species_id,previous_revision,new_revision,previous_arrangement,new_arrangement,operation,actor)
      VALUES(${species},0,1,'{"orderedAssetIds":["a","b"],"primaryAssetId":"b"}','{"orderedAssetIds":["a"],"primaryAssetId":null}','save','staff:officer');`);
    await rejects("UPDATE species_image_arrangement_history SET actor='other'", "P0001");
    await rejects("DELETE FROM species_image_arrangement_history", "P0001");
    const row = (await pool.query("SELECT species_id::text AS id,previous_arrangement,new_arrangement FROM species_image_arrangement_history")).rows[0];
    assert.equal(row.id, species);
    assert.deepEqual(row.previous_arrangement.orderedAssetIds, ["a", "b"]);
    assert.deepEqual(row.new_arrangement.orderedAssetIds, ["a"]);
    assert.deepEqual(await evidence(), before);
  });

  await t.test("whole-plant roles and INTEGER request pointers enforce original evidence", async () => {
    await rejects(`INSERT INTO plant_asset_photo_role(asset_id,plant_id,observation_id,role,recorded_by) VALUES('whole',${plant},'missing','whole_plant','staff:bot')`, "P0001");
    await rejects(`INSERT INTO plant_asset_photo_role(asset_id,plant_id,observation_id,role,recorded_by) VALUES('whole',1,'obs:text','whole_plant','staff:bot')`, "P0001");
    await rejects(`INSERT INTO plant_asset_photo_role(asset_id,plant_id,observation_id,role,recorded_by) VALUES('whole',${plant},'obs:text','whole_plant','staff:other')`, "P0001");
    await pool.query("INSERT INTO plant_asset_photo_role(asset_id,plant_id,observation_id,role,recorded_by) VALUES('whole',$1,'obs:text','whole_plant','staff:bot')", [plant]);
    await pool.query("INSERT INTO species_request_proposed_image(request_id,asset_id) VALUES(1,'whole')");
    await rejects("UPDATE species_request_proposed_image SET request_id=999", "23503");
    await rejects("UPDATE species_request_proposed_image SET asset_id='a'", "23503");
    await rejects("UPDATE species_request_proposed_image SET role='leaf_close_up'", "23514");
    await rejects("UPDATE plant_asset_photo_role SET role='additional'", "P0001");
    await rejects("DELETE FROM plant_asset_photo_role", "P0001");
    assert.equal((await pool.query("SELECT plant_id::text AS id FROM plant_asset_photo_role")).rows[0].id, plant);
    assert.deepEqual(await evidence(), before);
  });

  await t.test("current backend range limitation is explicit, not silently rounded", async () => {
    const officer = { id: "officer", role: "Conservation Officer", status: "Active", mustChangePassword: false };
    for (const id of ["2147483648", species]) {
      await assert.rejects(readGallery(pool, id, officer), { status: 400 });
      await assert.rejects(listLibrary(pool, id, officer), { status: 400 });
    }
  });
});
