"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mountDomain } = require("../domain.cjs");
const {
  qrPlantRecordRelation,
} = require("../qr-plant-mode.cjs");

const botanist = {
  id: "local-test",
  role: "Botanist",
  status: "Active",
  mustChangePassword: false,
};

function mountedRoutes(pool, qrPlantSchema = "plant_app") {
  const routes = new Map();
  const app = new Proxy({}, {
    get(_target, method) {
      return (path, ...handlers) => {
        if (typeof path === "string")
          routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
      };
    },
  });
  mountDomain(app, {
    auth: { event: async () => {} },
    pool,
    allow: () => () => {},
    qrPlantSchema,
  });
  return routes;
}

test("post-migration QR parent relation is fixed to plant_app", () => {
  assert.equal(qrPlantRecordRelation("plant_app"), "plant_app.plant_record");
  assert.throws(() => qrPlantRecordRelation("public"), /after migration 015/);
});

test("domain refuses legacy public QR configuration before registering routes", () => {
  assert.throws(() => mountedRoutes({ query() {} }, "public"), /after migration 015/);
});

test("QR lookup joins plant_app QR inventory to plant_app plant records", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM plant_app.qr_code q LEFT JOIN plant_app.plant_record p"))
        return {
          rows: [{
            qr_id: "8",
            plant_id: "41",
            status: "active",
            species_id: "7",
            rbac_status: "Approved",
            scientific_name: "Local plant",
          }],
        };
      if (sql.includes("FROM species s"))
        return {
          rows: [{
            species_id: "7",
            scientific_name: "Local species",
            common_name: "Local common name",
            rbac_data: { approvalStatus: "Approved" },
            visibility: "public",
          }],
        };
      throw Error("Unexpected query in mock pool.");
    },
  };
  const routes = mountedRoutes(pool);
  const handler = routes.get("GET /api/qr/:token");
  let response;
  await handler(
    { params: { token: "local-qr-token" }, user: botanist },
    { json(value) { response = value; } },
  );

  assert.equal(response.assigned, true);
  assert.equal(response.plant.scientific_name, "Local plant");
  assert.ok(queries[0].includes("plant_app.qr_code"));
  assert.ok(queries[0].includes("plant_app.plant_record"));
  assert.equal(queries[0].includes("public.plant_record"), false);
});
