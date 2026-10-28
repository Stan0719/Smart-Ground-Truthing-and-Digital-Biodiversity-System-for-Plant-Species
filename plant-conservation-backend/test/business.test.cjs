"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { readFileSync } = require("node:fs"),
  { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs"),
  sharp = require("sharp"),
  { createPlantApp } = require("../server.js");
test("PostgreSQL: visibility, ownership, review, media and simulated IoT", async (t) => {
  const pool = await createPlantDatabase(),
    pg = pool;
  t.after(() => pool.end());
  const { createTestAuth } = await import(
      pathToFileURL(resolve(__dirname, "../../web/server/test-postgres.mjs"))
        .href
    ),
    auth = await createTestAuth(":memory:");
  t.after(async () => await auth.db.close());
  const tokens = {},
    users = {};
  for (const [key, role] of [
    ["admin", "Administrator"],
    ["officer", "Conservation Officer"],
    ["bot", "Botanist"],
    ["other", "Botanist"],
  ]) {
    users[key] = await auth.createUser({
      name: key,
      email: key + "@example.invalid",
      role,
      password: "test-account-password",
      mustChangePassword: false,
    });
    tokens[key] = (
      await auth.login(key + "@example.invalid", "test-account-password", key)
    ).token;
  }
  await auth.createVisitor({
    name: "Visitor",
    email: "visitor@example.invalid",
    password: "test-account-password",
  });
  tokens.visitor = (
    await auth.login(
      "visitor@example.invalid",
      "test-account-password",
      "visitor",
    )
  ).token;
  const app = createPlantApp({
      pool,
      auth,
      origins: new Set(["http://localhost:5173"]),
    }),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const health = await fetch(base.replace(/\/api$/, "") + "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    service: "Plant Conservation API",
    ready: true,
  });
  async function call(path, role, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
        ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.arrayBuffer(),
    };
  }
  // The real application starts empty. Every list endpoint must succeed without fixtures.
  for (const [path, role, key] of [
    ["/species", null, "species"],
    ["/plants", null, "plants"],
    ["/assets?species_id=1", null, "assets"],
    ["/observations", "bot", "observations"],
    ["/reports", "officer", "rows"],
    ["/devices", "admin", "devices"],
    ["/readings", "officer", "readings"],
    ["/alerts", "officer", "alerts"],
    ["/audit", "admin", "events"],
  ]) {
    const result = await call(path, role);
    assert.equal(result.status, 200, path + JSON.stringify(result.data));
    assert.deepEqual(result.data[key], [], path);
  }
  assert.equal((await call("/db-test", "admin")).status, 200);
  assert.ok((await call("/tables", "admin")).data.tables.includes("species"));
  for (const path of ["/species/1", "/qr/missing", "/assets/missing"])
    assert.equal((await call(path)).status, 404, path);
  for (const name of ["Public", "Internal", "Protected"])
    await pool.query(
      "INSERT INTO species(scientific_name,common_name,description) VALUES($1,$1,'Description')",
      [name],
    );
  for (const [id, visibility] of [
    [1, "public"],
    [2, "internal"],
    [3, "protected"],
  ])
    await pool.query("INSERT INTO rbac_species_visibility VALUES($1,$2)", [
      id,
      visibility,
    ]);
  assert.equal(
    (await call("/species?q=does-not-exist")).data.species.length,
    0,
  );
  assert.equal((await call("/species?q=public")).data.species.length, 1);
  assert.equal((await call("/species/1")).status, 200);
  const catalog = await call("/species");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.species.length, 1);
  assert.equal("conservation_status" in catalog.data.species[0], false);
  assert.equal(
    (await call("/species?scope=scientific", "bot")).data.species.length,
    2,
  );
  assert.equal(
    (await call("/species?scope=scientific", "officer")).data.species.length,
    3,
  );
  const content = {
      heightCm: 12,
      healthStatus: "Healthy",
      lifeStage: "Young",
      morphology: "Leaves",
      latitude: 1,
      longitude: 2,
    },
    body = {
      species_id: 1,
      latitude: 1,
      longitude: 2,
      content,
      client_key: "field-one",
    };
  const created = await call("/plants", "bot", "POST", body);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const plantId = created.data.plant_id;
  assert.equal(
    (await call("/plants", "bot", "POST", body)).data.plant_id,
    plantId,
  );
  assert.equal(
    (
      await pg.query(
        "SELECT registered_subject FROM plant_record WHERE plant_id=$1",
        [plantId],
      )
    ).rows[0].registered_subject,
    "staff:" + users.bot.id,
  );
  assert.equal((await call("/plants")).data.plants.length, 0);
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#00ff00" },
  })
    .png()
    .toBuffer();
  const asset = await call("/assets", "bot", "POST", {
    plant_id: plantId,
    observation_id: created.data.id,
    base64: png.toString("base64"),
    content_type: "image/png",
    client_key: "photo-one",
  });
  assert.equal(asset.status, 201, JSON.stringify(asset.data));
  assert.equal((await call("/assets/" + asset.data.id)).status, 404);
  assert.equal(
    (await call(`/observations/${created.data.id}/submit`, "bot", "POST", {}))
      .status,
    200,
  );
  assert.equal((await call('/taxonomy','officer')).status,200);
  for(const role of ['admin','bot','visitor'])assert.equal((await call('/taxonomy',role)).status,403);
  const approved = await call(
    `/observations/${created.data.id}/review`,
    "officer",
    "POST",
    { decision: "Approved", revision: 1, comment: "" },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const qr = await call(`/plants/${plantId}/qr`, "bot");
  assert.equal(qr.status, 200);
  assert.equal((await call(`/qr/${qr.data.qr_token}`)).status, 200);
  assert.equal((await call(`/plants/${plantId}/qr`, "other")).status, 404);
  const scientificPlants = await call("/plants", "officer");
  assert.equal(scientificPlants.status, 200);
  assert.equal(scientificPlants.data.plants[0].latest_approved.heightCm, 12);
  assert.equal(Number(scientificPlants.data.plants[0].latitude), 1);
  const publicPlants = (await call("/plants")).data.plants;
  assert.equal(publicPlants.length, 1);
  assert.equal("latitude" in publicPlants[0], false);
  assert.equal((await call("/assets/" + asset.data.id)).status, 200);
  assert.equal(
    (
      await call(`/observations/${created.data.id}`, "bot", "PATCH", {
        revision: 2,
        content,
      })
    ).status,
    409,
  );
  const next = await call(`/plants/${plantId}/observations`, "bot", "POST", {
    content,
    client_key: "field-two",
  });
  assert.equal(next.status, 201, JSON.stringify(next.data));
  const path = `/observations/${next.data.id}`;
  assert.equal((await call(path + "/submit", "bot", "POST", {})).status, 200);
  assert.equal(
    (
      await call(path + "/review", "officer", "POST", {
        decision: "Rejected",
        comment: "",
        revision: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(path + "/review", "officer", "POST", {
        decision: "Correction Required",
        comment: "Correct height",
        revision: 1,
      })
    ).status,
    200,
  );
  const feedback=(await call('/observations','bot')).data.observations.find(row=>row.id===next.data.id);
  assert.equal(feedback.review_comment,'Correct height');
  assert.equal((await call('/observations','other')).data.observations.some(row=>row.id===next.data.id),false);
  assert.equal(
    (await call(path, "other", "PATCH", { revision: 2, content })).status,
    403,
  );
  assert.equal(
    (await call(path, "bot", "PATCH", { revision: 2, content })).status,
    200,
  );
  await auth.db
    .prepare("UPDATE users SET role='Conservation Officer' WHERE id=?")
    .run(users.bot.id);
  tokens.bot = (
    await auth.login(
      "bot@example.invalid",
      "test-account-password",
      "changed-role",
    )
  ).token;
  assert.equal(
    (
      await call(path + "/review", "bot", "POST", {
        decision: "Approved",
        revision: 3,
        comment: "",
      })
    ).status,
    403,
  );
  assert.equal((await call("/reports", "officer")).status, 200);
  const device = await call("/devices", "admin", "POST", {
    name: "Simulated sensor",
  });
  assert.equal(device.status, 201, "Device registration should return HTTP 201.");
  assert.deepEqual(Object.keys(device.data).sort(), [
    "id",
    "message",
    "provisioningKey",
  ]);
  assert.match(device.data.provisioningKey, /^[a-f0-9]{64}$/);
  assert.equal(
    (
      await call(`/devices/${device.data.id}/thresholds`, "admin", "PATCH", {
        thresholds: { temperature: 30 },
      })
    ).status,
    200,
  );
  const ingest = await fetch(base + "/device/readings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Device ${device.data.provisioningKey}`,
    },
    body: JSON.stringify({
      device_id: device.data.id,
      values: { temperature: 35 },
      client_key: "reading-one",
    }),
  });
  assert.equal(ingest.status, 201, await ingest.text());
  async function reading(
    values,
    key = "reading-one",
    credential = device.data.provisioningKey,
  ) {
    const response = await fetch(base + "/device/readings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Device ${credential}`,
      },
      body: JSON.stringify({
        device_id: device.data.id,
        values,
        client_key: key,
      }),
    });
    return response.status;
  }
  assert.equal(await reading({ temperature: 35 }), 201);
  assert.equal(await reading({ temperature: 36 }), 409);
  assert.equal(await reading({ humidity: 101 }, "invalid-humidity"), 400);
  assert.equal(await reading({ movement: 3 }, "invalid-movement"), 400);
  assert.equal(await reading({ soilMoisture: -1 }, "invalid-adc"), 400);
  assert.equal(
    await reading({ temperature: 35 }, "bad-key", "0".repeat(64)),
    401,
  );
  assert.equal((await call("/readings", "officer")).data.readings.length, 1);
  const readingTimestamp = (await call("/readings", "officer")).data.readings[0]
    .created_at;
  assert.match(readingTimestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.ok(Number.isFinite(Date.parse(readingTimestamp)));
  const alerts = (await call("/alerts", "officer")).data.alerts;
  assert.equal(alerts.length, 1);
  assert.equal(
    (
      await call(`/alerts/${alerts[0].id}/responses`, "admin", "POST", {
        note: "Not allowed",
        status: "Resolved",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/alerts/${alerts[0].id}/responses`, "officer", "POST", {
        note: "Inspected simulated data",
        status: "Resolved",
      })
    ).status,
    200,
  );
  const official = await call("/species", "officer", "POST", {
    scientific_name: "Curated species",
    common_name: "Curated",
    description: "Official record",
    visibility: "internal",
  });
  assert.equal(official.status, 201, JSON.stringify(official.data));
  assert.equal(
    (
      await call(`/species/${official.data.species_id}`, "officer", "PATCH", {
        scientific_name: "Updated curated species",
        common_name: "Curated",
        description: "Updated official record",
        visibility: "public",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `/species/${official.data.species_id}`,
        "officer",
        "DELETE",
        {},
      )
    ).status,
    200,
  );
  const officialImage = await call("/assets", "officer", "POST", {
    species_id: "1",
    base64: png.toString("base64"),
    content_type: "image/png",
    client_key: "official-photo",
  });
  assert.equal(officialImage.status, 201);
  assert.ok(
    (await call("/assets?species_id=1")).data.assets.some(
      (a) => a.id === officialImage.data.id,
    ),
  );
  const image = await call(`/assets/${officialImage.data.id}`);
  assert.equal(image.status, 200);
  assert.equal(
    (await sharp(Buffer.from(image.data)).metadata()).format,
    "jpeg",
  );
  const pdf = await call("/assets", "officer", "POST", {
    species_id: "1",
    base64: Buffer.from("%PDF-test-only").toString("base64"),
    content_type: "application/pdf",
    client_key: "official-pdf",
  });
  assert.equal(pdf.status, 201);
  assert.equal((await call(`/assets/${pdf.data.id}`)).status, 403);
  assert.equal((await call(`/assets/${pdf.data.id}`, "officer")).status, 200);
  assert.equal((await call("/species/1", "officer", "DELETE", {})).status, 409);
  const registeredDevices = (await call("/devices", "admin")).data;
  assert.deepEqual(Object.keys(registeredDevices), ["devices"]);
  assert.equal(registeredDevices.devices.length, 1);
  assert.deepEqual(Object.keys(registeredDevices.devices[0]).sort(), [
    "id",
    "last_seen",
    "latest_reading",
    "name",
    "plant_id",
    "status",
    "thresholds",
  ]);
  assert.equal(registeredDevices.devices[0].id, device.data.id);
  assert.equal(registeredDevices.devices[0].name, "Simulated sensor");

  const readingResponse = (await call("/readings", "officer")).data;
  assert.deepEqual(Object.keys(readingResponse), ["readings"]);
  assert.equal(readingResponse.readings.length, 1);
  assert.deepEqual(Object.keys(readingResponse.readings[0]).sort(), [
    "created_at",
    "device_id",
    "id",
    "values",
  ]);
  assert.equal(readingResponse.readings[0].device_id, device.data.id);
  assert.equal(readingResponse.readings[0].values.temperature, 35);

  const alertResponse = (await call("/alerts", "officer")).data;
  assert.deepEqual(Object.keys(alertResponse).sort(), ["alerts", "responses"]);
  assert.equal(alertResponse.alerts.length, 1);
  assert.deepEqual(Object.keys(alertResponse.alerts[0]).sort(), [
    "created_at",
    "device_id",
    "id",
    "metric",
    "reading_id",
    "status",
    "value",
  ]);
  assert.equal(alertResponse.alerts[0].device_id, device.data.id);
  assert.equal(alertResponse.alerts[0].metric, "temperature");
  assert.equal(alertResponse.alerts[0].value, 35);
  assert.equal(alertResponse.responses.length, 1);
  assert.equal(
    (
      await call(`/devices/${device.data.id}`, "admin", "PATCH", {
        name: "Renamed",
        status: "Inactive",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/alerts/${alerts[0].id}/responses`, "officer", "POST", {
        note: "Again",
        status: "Resolved",
      })
    ).status,
    409,
  );
  // The self-approval test above changed this account to Officer; restore it
  // before checking the actual Botanist policy.
  await auth.db
    .prepare("UPDATE users SET role='Botanist' WHERE id=?")
    .run(users.bot.id);
  tokens.bot = (
    await auth.login(
      "bot@example.invalid",
      "test-account-password",
      "restored-botanist",
    )
  ).token;
  const namedBody = {
    scientific_name: "Named status fixture",
    common_name: "Named status",
    description: "Isolated fixture",
    visibility: "internal",
    conservation_status: "Verified test status",
  };
  const named = await call("/species", "officer", "POST", namedBody);
  assert.equal(named.status, 201);
  const detail = (await call(`/species/${named.data.species_id}`, "officer"))
    .data.species;
  assert.equal(detail.conservation_status, "Verified test status");
  assert.equal(
    (
      await call(`/species/${named.data.species_id}`, "officer", "PATCH", {
        ...namedBody,
        conservation_status: "verified test status",
      })
    ).status,
    200,
  );
  assert.equal(
    (await pool.query("SELECT COUNT(*) AS n FROM conservation_status")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (
      await call("/species", "officer", "POST", {
        ...namedBody,
        status_id: detail.status_id,
      })
    ).status,
    400,
  );
  const genus = (
    await pool.query(
      "INSERT INTO genus(genus_name) VALUES('Synthetic genus') RETURNING genus_id",
    )
  ).rows[0].genus_id;
  assert.equal(
    (
      await call(`/species/${named.data.species_id}`, "officer", "PATCH", {
        ...namedBody,
        genus_id: genus,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/species/${named.data.species_id}`, "officer")).data.species
      .genus_name,
    "Synthetic genus",
  );
  assert.equal(
    (
      await call(
        `/species/${named.data.species_id}`,
        "officer",
        "PATCH",
        namedBody,
      )
    ).status,
    200,
  );
  assert.equal(
    String(
      (await call(`/species/${named.data.species_id}`, "officer")).data.species
        .genus_id,
    ),
    String(genus),
  );
  const protectedImage = await call("/assets", "officer", "POST", {
    species_id: "3",
    base64: png.toString("base64"),
    content_type: "image/png",
    client_key: "protected-photo",
  });
  assert.equal(protectedImage.status, 201);
  await pool.query(
    "INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(3,$1,'Approved','protected-test-qr')",
    ["staff:" + users.bot.id],
  );
  for (const role of [undefined, "visitor", "bot", "other", "admin"]) {
    const expected = role === "admin" ? 403 : 404;
    for (const path of [
      "/species/3",
      `/assets/${protectedImage.data.id}`,
      "/qr/protected-test-qr",
    ])
      assert.equal(
        (await call(path, role)).status,
        expected,
        path + ":" + role,
      );
    const search = await call("/species?q=Protected", role);
    if (role !== "admin") assert.deepEqual(search.data.species, []);
    assert.equal((await call("/reports", role)).status, role ? 403 : 401);
  }
  assert.equal(
    (await call(`/assets/${protectedImage.data.id}`, "officer")).status,
    200,
  );
  assert.equal((await call("/qr/protected-test-qr", "officer")).status, 200);
  assert.ok((await call("/audit", "admin")).data.events.length >= 5);
});
