"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { seedRegistrationReceipt } = require("./registration-provenance-fixture.cjs");
const { permitted, grants, visibilityFor } = require("../../shared/rbac.cjs");

test("Administrator catalogue reads match Officer records/projections and retain independent write gates", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer,plant_id integer,qr_code text,status text);
    INSERT INTO family VALUES(1,'Family'); INSERT INTO genus VALUES(1,1,'Genus');
    INSERT INTO conservation_status VALUES(1,'Vulnerable');`);
  const users = {
    admin: {
      id: "admin",
      role: "Administrator",
      status: "Active",
      mustChangePassword: false,
    },
    officer: {
      id: "officer",
      role: "Conservation Officer",
      status: "Active",
      mustChangePassword: false,
    },
    inactive: {
      id: "inactive",
      role: "Administrator",
      status: "Inactive",
      mustChangePassword: false,
    },
    reset: {
      id: "reset",
      role: "Administrator",
      status: "Active",
      mustChangePassword: true,
    },
    unknown: {
      id: "unknown",
      role: "Unknown",
      status: "Active",
      mustChangePassword: false,
    },
  };
  const tokens = Object.fromEntries(
    Object.keys(users).map((name, index) => [
      name,
      String(index + 1).repeat(64),
    ]),
  );
  const auth = {
    session: async (token) =>
      users[Object.keys(tokens).find((key) => tokens[key] === token)] || null,
    event: async () => {},
  };
  for (const [id, visibility, approval] of [
    [1, "public", "Approved"],
    [2, "internal", "Approved"],
    [3, "protected", "Approved"],
    [4, "public", "Pending Review"],
    [5, null, "Approved"],
  ]) {
    await pool.query(
      "INSERT INTO species(species_id,scientific_name,common_name,genus_id,status_id,description,rbac_data) VALUES($1,$2,$3,1,1,$4,$5)",
      [
        id,
        "Species " + id,
        "Common " + id,
        "Description",
        { approvalStatus: approval, habitat: "Rainforest" },
      ],
    );
    if (visibility)
      await pool.query("INSERT INTO rbac_species_visibility VALUES($1,$2)", [
        id,
        visibility,
      ]);
    await pool.query(
      "INSERT INTO plant_record(plant_id,species_id,scientific_name,registered_subject,rbac_status,qr_token) VALUES($1,$1,$2,'staff:bot','Approved',$3)",
      [id, "Individual " + id, "qr-" + id],
    );
    await pool.query(
      "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,'staff:bot','Approved',$3,$1)",
      [
        "observation-" + id,
        id,
        {
          latitude: 4,
          longitude: 113,
          zone: "Approved zone",
          healthStatus: "Healthy",
          heightCm: 12,
          lifeStage: "Mature",
        },
      ],
    );
    await pool.query(
      "INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,'staff:bot',$1,$3,true,'image/jpeg',$4)",
      [
        "plant-photo-" + id,
        id,
        "observation-" + id,
        Buffer.from("isolated photo"),
      ],
    );
    await pool.query(
      "INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,'staff:bot',$1,true,'image/jpeg',$3)",
      ["species-photo-" + id, id, Buffer.from("isolated photo")],
    );
  }
  for (const id of [1,2,3,4,5]) await seedRegistrationReceipt(pool, "observation-" + id);
  await pool.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(6,3,'staff:bot','Pending Review','pending');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('pending',6,'staff:bot','Pending Review','{}','pending');
    INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,content_type,content) VALUES('pending-photo',6,'staff:bot','pending-photo','pending','image/jpeg','private');`);
  const server = createPlantApp({
    pool,
    auth,
    origins: new Set(["http://localhost:5173"]),
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const call = async (path, role, method = "GET", body) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          ...(role ? { Authorization: "Bearer " + tokens[role] } : {}),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return {
      status: response.status,
      data: response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()).toString("hex"),
    };
  };
  await t.test('Species deletion returns a stable FK restriction code and preserves related evidence', async () => {
    const before = (await pool.query('SELECT count(*)::integer AS count FROM plant_record')).rows[0].count;
    const blocked = await call('/species/3', 'officer', 'DELETE', {});
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'SPECIES_DELETE_REFERENCED');
    assert.equal(blocked.data.error, 'This Species is referenced by existing records and cannot be deleted.');
    assert.equal((await pool.query('SELECT count(*)::integer AS count FROM plant_record')).rows[0].count, before);
    assert.equal((await pool.query('SELECT species_id FROM species WHERE species_id=3')).rows.length, 1);
    await pool.query("INSERT INTO species(species_id,scientific_name) VALUES(9999,'Isolated unused Species')");
    const deleted = await call('/species/9999', 'officer', 'DELETE', {});
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.deleted, true);
    assert.equal((await pool.query('SELECT species_id FROM species WHERE species_id=9999')).rows.length, 0);
    assert.equal((await call('/species/9999', 'officer', 'DELETE', {})).status, 404);
  });
  await t.test(
    "catalogue, protected parent, exact approved locations and thumbnails use the same read contract",
    async () => {
      const cookieResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/api/species/3`,
        {
          headers: {
            Cookie: "niah_session=" + tokens.admin,
            Origin: "http://localhost:5173",
          },
        },
      );
      assert.equal(cookieResponse.status, 200);
      assert.deepEqual(
        await cookieResponse.json(),
        (await call("/species/3", "admin")).data,
      );
      for (const path of [
        "/species?scope=scientific",
        "/species/3",
        "/plants",
        "/plants/3",
        "/assets?species_id=3",
        "/assets?plant_id=3",
        "/assets/species-photo-3",
        "/assets/plant-photo-3",
        "/assets/pending-photo",
        "/plants/3/detail",
        "/plants/3/detail/history",
        "/plants/3/detail/gallery",
      ]) {
        const officer = await call(path, "officer"),
          admin = await call(path, "admin");
        assert.equal(admin.status, 200, path);
        assert.deepEqual(admin, officer, path);
      }
      assert.deepEqual(
        (await call("/species?scope=scientific", "admin")).data.species.map(
          (row) => row.species_id,
        ),
        ["1", "2", "3", "5"],
      );
      const plant = (await call("/plants/3", "admin")).data.plant;
      assert.equal(plant.latitude, 4);
      assert.equal(plant.latest_approved.healthStatus, "Healthy");
      assert.equal(plant.plant_image_asset_id, "plant-photo-3");
      assert.ok(
        (await call("/plants", "admin")).data.plants.some(
          (row) => row.plant_id === 6,
        ),
      );
      assert.equal((await call("/species/4", "admin")).status, 404);
      assert.equal((await call("/assets/nonexistent", "admin")).status, 404);
    },
  );
  await t.test(
    "Guest restrictions and inactive/unknown identity checks stay enforced",
    async () => {
      assert.deepEqual(
        (await call("/species")).data.species.map((row) => row.species_id),
        ["1"],
      );
      for (const id of [2, 3, 4, 5]) {
        assert.equal((await call("/species/" + id)).status, 404);
        assert.equal((await call("/plants/" + id + "/detail")).status, 404);
        assert.equal((await call("/assets/species-photo-" + id)).status, 404);
      }
      const guest = (await call("/plants/1/detail")).data;
      assert.equal(guest.staff, null);
      assert.equal(guest.information.habitat, "Rainforest");
      for (const role of ["inactive", "reset", "unknown"]) {
        for (const path of ["/species", "/plants", "/assets/species-photo-3"])
          assert.equal((await call(path, role)).status, 403);
      }
      assert.equal((await call("/plants/6/detail")).status, 404);
    },
  );
  await t.test(
    "scientific mutation, management and unrelated read capabilities remain denied",
    async () => {
      for (const permission of [
        "plants.create",
        "observations.create",
        "observations.edit.own",
        "observations.review",
        "species.manage",
        "plants.public.read",
        "plants.scientific.read",
        "plants.gps.exact.read",
        "plants.protected.read",
      ])
        assert.equal(permitted(users.admin, permission), false, permission);
      for (const permission of [
        "accounts.manage",
        "permissions.manage",
        "audit.read",
        "devices.manage",
      ])
        assert.equal(permitted(users.admin, permission), true, permission);
      assert.deepEqual(visibilityFor(users.admin), []);
      assert.deepEqual(
        Object.entries(grants)
          .filter(([name]) => name.startsWith("plants.catalogue"))
          .map(([name]) => name),
        ["plants.catalogue.read", "plants.catalogue.scientific.read"],
      );
      for (const [method, path] of [
        ["POST", "/species"],
        ["PATCH", "/species/3"],
        ["DELETE", "/species/3"],
        ["POST", "/plants"],
        ["POST", "/assets"],
        ["POST", "/plants/3/observations"],
        ["PATCH", "/observations/pending"],
        ["POST", "/observations/pending/review"],
        ["POST", "/species-requests/1/review"],
        ["PUT", "/species/3/images"],
      ])
        assert.equal(
          (await call(path, "admin", method, {})).status,
          403,
          method + " " + path,
        );
      for (const path of [
        "/taxonomy",
        "/observations",
        "/species/3/images",
        "/species/3/photo-library",
      ])
        assert.equal((await call(path, "admin")).status, 403, path);
    },
  );
});
