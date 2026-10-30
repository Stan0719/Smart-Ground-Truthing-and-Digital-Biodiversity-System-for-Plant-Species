"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const { createPlantApp } = require("../server.js");
const {
  permitted,
  projectGps,
  assertEdit,
  assertReview,
  projectSpecies,
  visibilityFor,
} = require("../../shared/rbac.cjs");
const { credentials } = require("../authorization.cjs");
const user = (role) => ({
  id: "actor",
  role,
  status: "Active",
  mustChangePassword: false,
});
test("least privilege, protected species, projections and unknown permissions", () => {
  const publicRow = projectSpecies(
    {
      species_id: 1,
      scientific_name: "Test",
      latitude: 123,
      conservation_status: "Private",
      rbac_data: { latitude: 123 },
    },
    false,
  );
  assert.equal("latitude" in publicRow, false);
  assert.equal("conservation_status" in publicRow, false);
  assert.deepEqual(visibilityFor(user("Botanist")), ["public", "internal"]);
  assert.equal(permitted(user("Administrator"), "plants.public.read"), false);
  assert.equal(permitted(user("Administrator"), "responses.manage"), false);
  assert.equal(
    permitted(user("Conservation Officer"), "devices.manage"),
    false,
  );
  assert.equal(permitted(user("Administrator"), "unknown"), false);
  for (const role of ["admin", "botanist", "Unknown", "Guest", "__proto__"])
    for (const permission of Object.keys(
      require("../../shared/rbac.cjs").grants,
    ))
      if (role !== "Guest")
        assert.equal(permitted(user(role), permission), false);
  assert.equal(
    permitted(
      { ...user("Botanist"), mustChangePassword: true },
      "plants.create",
    ),
    false,
  );
  assert.equal(
    permitted({ ...user("Botanist"), status: "Suspended" }, "plants.create"),
    false,
  );
});
test("ownership, workflow, feedback, and self-approval restrictions", () => {
  const observation = {
    owner_subject: "staff:actor",
    status: "Correction Required",
  };
  assert.equal(assertEdit(user("Botanist"), observation), 0);
  assert.equal(
    assertEdit({ ...user("Botanist"), id: "another" }, observation),
    403,
  );
  assert.equal(
    assertEdit(user("Botanist"), { ...observation, status: "Approved" }),
    409,
  );
  assert.equal(
    assertReview(
      user("Conservation Officer"),
      { ...observation, status: "Pending Review" },
      "Approved",
      "",
    ),
    403,
  );
  const other = {
    ...observation,
    owner_subject: "staff:other",
    status: "Pending Review",
  };
  assert.equal(
    assertReview(user("Conservation Officer"), other, "Approved", ""),
    0,
  );
  assert.equal(
    assertReview(user("Conservation Officer"), other, "Rejected", ""),
    400,
  );
  assert.equal(
    assertReview(
      user("Conservation Officer"),
      { ...other, status: "Approved" },
      "Rejected",
      "reason",
    ),
    409,
  );
});
test("conflicting and malformed credentials are rejected", () => {
  assert.throws(() =>
    credentials({ headers: { authorization: "Bearer forged" } }),
  );
  assert.throws(() =>
    credentials({
      headers: {
        authorization: "Bearer " + "a".repeat(64),
        cookie: "niah_session=" + "b".repeat(64),
      },
    }),
  );
  assert.throws(() =>
    credentials({
      headers: {
        cookie:
          "niah_session=" + "a".repeat(64) + "; niah_session=" + "a".repeat(64),
      },
    }),
  );
});
test("exact GPS permission and nested field projection are Officer-only", () => {
  for (const role of ["Administrator", "Botanist", "Visitor"])
    assert.equal(permitted(user(role), "plants.gps.exact.read"), false, role);
  assert.equal(
    permitted(user("Conservation Officer"), "plants.gps.exact.read"),
    true,
  );
  assert.deepEqual(
    projectGps({
      latitude: 1,
      nested: [{ gps_latitude: 2, longitude: 3, value: "retained" }],
      value: "retained",
    }, user("Botanist")),
    { nested: [{ value: "retained" }], value: "retained" },
  );
  assert.deepEqual(
    projectGps({ latitude: 1, nested: { gps_longitude: 2 } }, user("Conservation Officer")),
    { latitude: 1, nested: { gps_longitude: 2 } },
  );
});
test("HTTP access matrix rejects unauthorized roles before database calls", async (t) => {
  const { createTestAuth } = await import(
      pathToFileURL(resolve(__dirname, "../../web/server/test-postgres.mjs"))
        .href
    ),
    auth = await createTestAuth(":memory:");
  const tokens = {};
  for (const role of ["Administrator", "Conservation Officer", "Botanist"]) {
    const email = role.replaceAll(" ", "") + "@example.invalid";
    await auth.createUser({
      name: role,
      email,
      role,
      password: "isolated-test-password",
      mustChangePassword: false,
    });
    tokens[role] = (
      await auth.login(email, "isolated-test-password", role)
    ).token;
  }
  await auth.createVisitor({
    name: "Visitor",
    email: "visitor@example.invalid",
    password: "isolated-test-password",
  });
  tokens.Visitor = (
    await auth.login(
      "visitor@example.invalid",
      "isolated-test-password",
      "visitor",
    )
  ).token;
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      return { rows: [] };
    },
    connect: async () => {
      calls++;
      throw Object.assign(Error("Test DB unavailable"), { status: 503 });
    },
  };
  const app = createPlantApp({
      auth,
      pool,
      origins: new Set(["http://localhost:5173"]),
    }),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await auth.db.close();
  });
  const routes = [
    ["POST", "/api/plants", ["Botanist"]],
    ["GET", "/api/plants/1", ["Guest", "Visitor", "Botanist", "Conservation Officer"]],
    ["GET", "/api/observations/1", ["Botanist", "Conservation Officer"]],
    ["GET", "/api/devices/11111111-1111-4111-8111-111111111111/readings", ["Administrator", "Conservation Officer"]],
    [
      "GET",
      "/api/species/1",
      ["Guest", "Visitor", "Botanist", "Conservation Officer"],
    ],
    [
      "GET",
      "/api/plants",
      ["Guest", "Visitor", "Botanist", "Conservation Officer"],
    ],
    [
      "GET",
      "/api/qr/one",
      ["Guest", "Visitor", "Botanist", "Conservation Officer"],
    ],
    [
      "GET",
      "/api/assets?species_id=1",
      ["Guest", "Visitor", "Botanist", "Conservation Officer"],
    ],
    [
      "GET",
      "/api/assets/one",
      ["Guest", "Visitor", "Botanist", "Conservation Officer"],
    ],
    ["POST", "/api/assets", ["Botanist"]],
    ["POST", "/api/plants/1/observations", ["Botanist"]],
    ["POST", "/api/observations/one/submit", ["Botanist"]],
    ["PATCH", "/api/observations/one", ["Botanist"]],
    ["GET", "/api/plants/1/qr", ["Botanist"]],
    ["PATCH", "/api/species/1", ["Conservation Officer"]],
    ["DELETE", "/api/species/1", ["Conservation Officer"]],
    ["PATCH", "/api/devices/one", ["Administrator"]],
    ["GET", "/api/readings", ["Administrator", "Conservation Officer"]],
    ["GET", "/api/db-test", ["Administrator"]],
    ["GET", "/api/observations", ["Botanist", "Conservation Officer"]],
    ["POST", "/api/observations/one/review", ["Conservation Officer"]],
    ["POST", "/api/species", ["Conservation Officer"]],
    ["GET", "/api/reports", ["Conservation Officer"]],
    ["GET", "/api/devices", ["Administrator", "Conservation Officer"]],
    ["POST", "/api/devices", ["Administrator"]],
    ["PATCH", "/api/devices/one/thresholds", ["Administrator"]],
    ["GET", "/api/alerts", ["Administrator", "Conservation Officer"]],
    ["POST", "/api/alerts/one/responses", ["Conservation Officer"]],
    ["GET", "/api/audit", ["Administrator"]],
    ["GET", "/api/tables", ["Administrator"]],
  ];
  for (const [method, path, allowed] of routes)
    for (const role of [
      "Guest",
      "Visitor",
      "Botanist",
      "Conservation Officer",
      "Administrator",
    ]) {
      if (allowed.includes(role)) continue;
      const before = calls;
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        {
          method,
          headers: {
            Origin: "http://localhost:5173",
            "Content-Type": "application/json",
            ...(tokens[role]
              ? { Authorization: `Bearer ${tokens[role]}` }
              : {}),
          },
          ...(method === "GET" ? {} : { body: "{}" }),
        },
      );
      assert.equal(
        response.status,
        role === "Guest" ? 401 : 403,
        `${role} ${method} ${path}`,
      );
      assert.equal(calls, before, "Denied request reached plant storage");
    }
  const guest = await fetch(
    `http://127.0.0.1:${server.address().port}/api/species`,
  );
  assert.equal(guest.status, 200);
  const bot = await fetch(
    `http://127.0.0.1:${server.address().port}/api/species?scope=scientific`,
    { headers: { Authorization: `Bearer ${tokens.Botanist}` } },
  );
  assert.equal(bot.status, 200);
});
