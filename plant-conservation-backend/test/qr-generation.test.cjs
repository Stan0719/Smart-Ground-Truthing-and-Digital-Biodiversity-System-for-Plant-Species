"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("QR generation persists unique inventory rows in plant_app", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(`CREATE TABLE plant_app.qr_code(
    qr_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id BIGINT UNIQUE REFERENCES plant_record(plant_id) ON DELETE SET NULL,
    qr_code TEXT NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'generated',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ
  )`);

  const tokens = { botanist: "b".repeat(64), visitor: "c".repeat(64) };
  const roles = { botanist: "Botanist", visitor: "Visitor" };
  const auth = {
    session: async (token) => {
      const key = Object.keys(tokens).find((candidate) => tokens[candidate] === token);
      return key ? { id: key, role: roles[key], status: "Active", mustChangePassword: false } : null;
    },
    event: async () => {},
  };
  const server = createPlantApp({ auth, pool, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  async function request(account, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/qr-codes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokens[account] ? { Authorization: `Bearer ${tokens[account]}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }

  assert.equal((await request(null, { count: 2 })).status, 403);
  assert.equal((await request("visitor", { count: 2 })).status, 403);
  const generated = await request("botanist", { count: 2 });
  assert.equal(generated.status, 201);
  assert.equal(generated.data.qr_codes.length, 2);
  assert.ok(generated.data.qr_codes.every((row) =>
    row.plant_id === null && row.status === "generated" && /^[a-f0-9]{48}$/.test(row.qr_code),
  ));
  assert.equal(new Set(generated.data.qr_codes.map((row) => row.qr_code)).size, 2);

  const persisted = (await pool.query(
    "SELECT qr_id, plant_id, status FROM plant_app.qr_code ORDER BY qr_id",
  )).rows;
  assert.equal(persisted.length, 2);
  assert.ok(persisted.every((row) => row.plant_id === null && row.status === "generated"));

  for (const count of [0, 4, 1.5, "2"]) {
    const invalid = await request("botanist", { count });
    assert.equal(invalid.status, 400);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM plant_app.qr_code")).rows[0].count, 2);
});
