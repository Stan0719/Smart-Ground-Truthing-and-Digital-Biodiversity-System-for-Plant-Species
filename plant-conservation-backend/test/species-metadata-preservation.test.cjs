"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { useVerifiedPhotoKeyTypes } = require("./species-photo-bigint-fixture.cjs");
const { createPlantApp } = require("../server.js");

// Disposable in-memory PGlite only. No configuration, live database or upload calls.
test("Officer species edits preserve omitted metadata and retain explicit legacy updates", async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await useVerifiedPhotoKeyTypes(pool);
  await pool.query("INSERT INTO family(family_name) VALUES('Fixture family'); INSERT INTO genus(family_id,genus_name) VALUES(1,'Fixture genus'); INSERT INTO conservation_status(status_name) VALUES('Fixture status')");
  const accounts = ["Conservation Officer", "Botanist", "Administrator"].map((role, i) => ({
    token: String(i + 1).repeat(64), id: `fixture-${i}`, role, status: "Active", mustChangePassword: false,
  }));
  const auth = { session: async token => accounts.find(account => account.token === token) || null, event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const call = async (path, body, account = accounts[0], method = "PATCH") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/species${path}`, {
      method, headers: { "Content-Type": "application/json", ...(account ? { Authorization: `Bearer ${account.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const original = {
    habitat: "Existing habitat", culturalSignificance: "Existing cultural knowledge",
    approvalStatus: "Approved", submittedBy: "staff:botanist", customFlag: true,
    provenance: { source: "existing metadata", tags: ["preserve", "all"] },
  };
  let serial = 0;
  const fixture = async () => {
    const body = { scientific_name: `Metadata fixture ${++serial}`, common_name: "Fixture common", description: "Required description", visibility: "protected", status_id: 1 };
    const id = (await pool.query("INSERT INTO species(scientific_name,common_name,description,genus_id,status_id,rbac_data) VALUES($1,$2,$3,1,1,$4) RETURNING species_id", [body.scientific_name, body.common_name, body.description, original])).rows[0].species_id;
    await pool.query("INSERT INTO rbac_species_visibility VALUES($1,'protected')", [id]);
    return { id: String(id), body };
  };
  const stored = async id => (await pool.query("SELECT s.*,v.visibility FROM species s JOIN rbac_species_visibility v USING(species_id) WHERE species_id=$1", [id])).rows[0];

  await t.test("omission preserves cultural text, habitat, taxonomy, visibility and arbitrary metadata", async () => {
    const { id, body } = await fixture();
    assert.equal((await call(`/${id}`, body)).status, 200);
    const after = await stored(id);
    assert.deepEqual(after.rbac_data, original);
    assert.equal(after.visibility, "protected"); assert.equal(String(after.genus_id), "1"); assert.equal(String(after.status_id), "1");
    assert.equal(after.description, body.description);
    const read = await call(`/${id}`, undefined, accounts[0], "GET");
    assert.equal(read.status, 200); assert.equal(read.body.species.culturalSignificance, original.culturalSignificance);
  });
  await t.test("the simplified web payload updates habitat without touching cultural or unrelated keys", async () => {
    const { id, body } = await fixture();
    assert.equal((await call(`/${id}`, { ...body, habitat: "  Updated habitat  ", visibility: "internal" })).status, 200);
    const after = await stored(id);
    assert.deepEqual(after.rbac_data, { ...original, habitat: "Updated habitat" });
    assert.equal(after.visibility, "internal");
  });
  await t.test("explicit authorized cultural changes and empty-string clearing retain their contract", async () => {
    const { id, body } = await fixture();
    for (const value of ["  Explicit cultural update  ", "x".repeat(4000), "", "   "]) {
      assert.equal((await call(`/${id}`, { ...body, culturalSignificance: value, rbac_data: { provenance: "must not overwrite" } })).status, 200);
      assert.deepEqual((await stored(id)).rbac_data, { ...original, culturalSignificance: value.trim() });
    }
    assert.equal((await call(`/${id}`, { ...body, habitat: "" })).status, 200);
    assert.equal((await stored(id)).rbac_data.habitat, "");
  });
  await t.test("invalid metadata and missing Description are rejected without changing stored information", async () => {
    const { id, body } = await fixture();
    for (const key of ["habitat", "culturalSignificance"]) for (const value of [null, 7, false, {}, [], "x".repeat(4001)]) {
      assert.equal((await call(`/${id}`, { ...body, [key]: value })).status, 400);
      assert.deepEqual((await stored(id)).rbac_data, original);
    }
    assert.equal((await call(`/${id}`, { ...body, description: "", culturalSignificance: "Must not be saved" })).status, 400);
    assert.deepEqual((await stored(id)).rbac_data, original);
  });
  await t.test("non-Officer and unauthenticated writes remain denied", async () => {
    const { id, body } = await fixture();
    // Requests without a bearer token or browser Origin are rejected by the existing boundary.
    for (const account of [...accounts.slice(1), null]) {
      assert.equal((await call(`/${id}`, { ...body, culturalSignificance: "Denied" }, account)).status, 403);
    }
    assert.deepEqual((await stored(id)).rbac_data, original);
  });
  await t.test("Create still accepts explicit legacy cultural data and keeps its existing omission defaults", async () => {
    for (const explicit of [false, true]) {
      const body = { scientific_name: `New fixture ${++serial}`, common_name: "Fixture", description: "Required description", visibility: "protected", habitat: "Habitat", ...(explicit ? { culturalSignificance: "  Legacy culture  " } : {}) };
      const result = await call("", body, accounts[0], "POST");
      assert.equal(result.status, 201);
      assert.deepEqual((await stored(result.body.species_id)).rbac_data, { habitat: "Habitat", culturalSignificance: explicit ? "Legacy culture" : "" });
    }
  });
});
