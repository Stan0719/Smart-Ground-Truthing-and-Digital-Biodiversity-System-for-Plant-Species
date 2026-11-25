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

function mountedRoutes(pool, qrPlantSchema = "plant_app", auth = { event: async () => {} }) {
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
    auth,
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

test("QR inventory resolves a unique generating Botanist name and omits account identifiers", async () => {
  let inventorySql;
  const auth = { event: async () => {}, db: { prepare(sql) {
    assert.equal(sql, "SELECT id,name,role FROM users WHERE id=?");
    return { async get(id) { return id === "bot-1" ? { name: "A long Botanist name", role: "Botanist" } : null; } };
  } } };
  const routes = mountedRoutes({ async query(sql) { inventorySql = sql; return { rows: [
    { qr_id: 32, qr_code: "synthetic-32", status: "generated", plant_id: null, generator_subject: "staff:bot-1" },
    { qr_id: 31, qr_code: "synthetic-31", status: "generated", plant_id: null, generator_subject: null },
  ] }; } }, "plant_app", auth);
  let result;
  await routes.get("GET /api/qr-codes")({ user: botanist, query: {} }, { json(value) { result = value; } });
  assert.equal(result.qr_codes[0].generated_by_name, "A long Botanist name");
  assert.equal(result.qr_codes[1].generated_by_name, null);
  assert.equal("generator_subject" in result.qr_codes[0], false);
  assert.match(inventorySql, /a\.action='qr_codes_generated'/);
  assert.match(inventorySql, /CASE WHEN count\(\*\)=1 THEN min\(a\.actor_subject\)/);
  assert.match(inventorySql, /creator\.generated_id=q\.qr_id::text/);
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
            species_visibility: "public",
          }],
        };
      if (sql.includes("species_image_collection"))
        return { rows: [{ available: false }] };
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

test("QR lookup distinguishes generated inventory from retired codes without granting visitor assignment IDs", async () => {
  let status = "generated";
  const routes = mountedRoutes({ async query() { return { rows: [{ qr_id: 8, plant_id: null, status }] }; } });
  const handler = routes.get("GET /api/qr/:token");
  const lookup = async (user) => {
    let value;
    await handler({ params: { token: "synthetic-token" }, user }, { json(result) { value = result; } });
    return value;
  };
  assert.deepEqual(await lookup(botanist), { assigned: false, status: "generated", qr_id: 8 });
  assert.deepEqual(await lookup({ ...botanist, role: "Visitor" }), { assigned: false, status: "generated" });
  status = "retired";
  assert.deepEqual(await lookup(botanist), { assigned: false, status: "retired" });
});

test("QR inventory can include an exact older scanned ID for availability revalidation", async () => {
  let params;
  const routes = mountedRoutes({ async query(_sql, values) { params = values; return { rows: [] }; } });
  let result;
  await routes.get("GET /api/qr-codes")(
    { user: botanist, query: { qr_id: "4" } },
    { json(value) { result = value; } },
  );
  assert.equal(params[1], "4");
  assert.deepEqual(result, { qr_codes: [] });
});
