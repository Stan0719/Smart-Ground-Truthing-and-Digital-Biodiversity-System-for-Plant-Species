"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPermissionResolver,
  AuthorizationDeniedError,
  PermissionDatabaseUnavailableError,
} = require("../rbac.cjs");

const activeUser = (role = "Botanist") => ({
  id: "test-user",
  role,
  status: "Active",
  mustChangePassword: false,
});

const rowsFor = (roleName, ...permissionNames) =>
  permissionNames.map((permission_name) => ({
    role_id: 101,
    role_name: roleName,
    permission_name,
  }));

function fakePool(rowsOrError) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (rowsOrError instanceof Error) throw rowsOrError;
      return { rows: rowsOrError };
    },
  };
}

test("uses qualified parameterized SQL and maps Administrator to Admin", async () => {
  const pool = fakePool(
    rowsFor("Admin", "manage_users", "view_alerts", "manage_qr_codes"),
  );
  const resolver = createPermissionResolver(pool);
  const permissionSet = await resolver.resolveForUser(
    activeUser("Administrator"),
  );

  assert.deepEqual(pool.calls[0].values, ["Admin"]);
  assert.match(pool.calls[0].sql, /FROM public\.role AS r/);
  assert.match(pool.calls[0].sql, /LEFT JOIN public\.role_permission AS rp/);
  assert.match(
    pool.calls[0].sql,
    /rp\.role_id\s*=\s*r\.role_id/,
  );
  assert.match(pool.calls[0].sql, /LEFT JOIN public\.permission AS p/);
  assert.match(
    pool.calls[0].sql,
    /p\.permission_id\s*=\s*rp\.permission_id/,
  );
  assert.match(pool.calls[0].sql, /WHERE r\.role_name = \$1/);
  assert.equal(permissionSet.has("accounts.manage"), true);
  assert.equal(permissionSet.has("alerts.read"), true);
  assert.equal(permissionSet.has("qr.generate"), false);
});

test("maps only the explicit allowlist, including observation helper keys", async () => {
  const pool = fakePool(
    rowsFor(
      "Botanist",
      "register_plants",
      "record_observations",
      "view_plants",
    ),
  );
  const permissions = await createPermissionResolver(pool).resolveForUser(
    activeUser(),
  );

  assert.equal(permissions.has("plants.create"), true);
  assert.equal(permissions.has("observations.create"), true);
  assert.equal(permissions.has("observations.edit.own"), true);
  assert.equal(permissions.has("plants.public.read"), true);
  assert.equal(permissions.has("plants.protected.read"), false);
  assert.equal(permissions.has("qr.generate"), false);
});

test("maps all approved database permissions, including narrow QR generation", async () => {
  const rows = rowsFor(
    "Botanist",
    "manage_permissions",
    "read_audit_logs",
    "manage_security_settings",
    "read_system_status",
    "view_scientific_plants",
    "view_protected_species",
    "read_exact_plant_gps",
    "read_reports",
    "view_devices",
    "view_readings",
    "manage_thresholds",
    "manage_alert_responses",
    "generate_qr_codes",
  );
  const permissions = await createPermissionResolver(fakePool(rows)).resolveForUser(
    activeUser(),
  );
  for (const permission of [
    "permissions.manage",
    "audit.read",
    "security.manage",
    "system.read",
    "plants.scientific.read",
    "plants.protected.read",
    "plants.gps.exact.read",
    "reports.read",
    "devices.read",
    "readings.read",
    "thresholds.manage",
    "responses.manage",
    "qr.generate",
  ]) assert.equal(permissions.has(permission), true, permission);
  assert.equal(permissions.has("qr.approve"), false);
  assert.equal(permissions.has("qr.delete"), false);
});

test("does not query for anonymous access and returns an empty request-scoped set", async () => {
  const pool = fakePool([]);
  const resolver = createPermissionResolver(pool);
  const first = await resolver.resolveForUser(null);
  const second = await resolver.resolveForUser(undefined);

  assert.equal(pool.calls.length, 0);
  assert.equal(first.has("plants.public.read"), false);
  assert.notEqual(first, second);
});

test("denies empty database results", async () => {
  const resolver = createPermissionResolver(fakePool([]));
  await assert.rejects(
    resolver.resolveForUser(activeUser()),
    AuthorizationDeniedError,
  );
});

test("denies unknown application roles without querying or normalizing", async () => {
  const pool = fakePool(rowsFor("Admin", "manage_users"));
  const resolver = createPermissionResolver(pool);

  for (const role of ["admin", "ADMIN", "Administrator ", "Unknown"]) {
    await assert.rejects(
      resolver.resolveForUser(activeUser(role)),
      AuthorizationDeniedError,
    );
  }
  assert.equal(pool.calls.length, 0);
});

test("denies malformed, mismatched, or duplicate permission rows", async () => {
  const malformedResults = [
    [null],
    [{ role_name: "Botanist" }],
    [{ role_id: 101, role_name: "Botanist", permission_name: null }],
    [{ role_id: "not-an-id", role_name: "Botanist", permission_name: "view_plants" }],
    [{ role_name: "Conservation Officer", permission_name: "view_plants" }],
    rowsFor("Botanist", "view_plants", "view_plants"),
  ];

  for (const rows of malformedResults) {
    const resolver = createPermissionResolver(fakePool(rows));
    await assert.rejects(
      resolver.resolveForUser(activeUser()),
      AuthorizationDeniedError,
    );
  }
});

test("denies permission rows that resolve to duplicate role identities", async () => {
  const pool = fakePool([
    { role_id: 101, role_name: "Botanist", permission_name: "view_plants" },
    { role_id: 202, role_name: "Botanist", permission_name: "register_plants" },
  ]);
  const resolver = createPermissionResolver(pool);

  await assert.rejects(
    resolver.resolveForUser(activeUser()),
    AuthorizationDeniedError,
  );
});

test("denies unknown permission names including inherited object properties", async () => {
  for (const permissionName of [
    "future_unreviewed_permission",
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ]) {
    const pool = fakePool(rowsFor("Botanist", "view_plants", permissionName));
    const resolver = createPermissionResolver(pool);

    await assert.rejects(
      resolver.resolveForUser(activeUser()),
      AuthorizationDeniedError,
      permissionName,
    );
  }
});

test("turns known but deliberately unmapped QR permission into no grant", async () => {
  const pool = fakePool(rowsFor("Botanist", "manage_qr_codes"));
  const permissions = await createPermissionResolver(pool).resolveForUser(
    activeUser(),
  );

  assert.equal(permissions.has("qr.generate"), false);
  assert.equal(permissions.has("qr.public.read"), false);
});

test("denies inactive and temporary-password users", async () => {
  const pool = fakePool(rowsFor("Botanist", "view_plants"));
  const resolver = createPermissionResolver(pool);

  await assert.rejects(
    resolver.resolveForUser({ ...activeUser(), status: "Suspended" }),
    AuthorizationDeniedError,
  );
  await assert.rejects(
    resolver.resolveForUser({ ...activeUser(), mustChangePassword: true }),
    AuthorizationDeniedError,
  );
  assert.equal(pool.calls.length, 0);
});

test("sanitizes database failures without exposing driver details", async () => {
  const pool = fakePool(
    Object.assign(Error("private SQL and credential details"), {
      code: "08006",
    }),
  );
  const resolver = createPermissionResolver(pool);

  await assert.rejects(
    resolver.resolveForUser(activeUser()),
    (error) => {
      assert.ok(error instanceof PermissionDatabaseUnavailableError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "RBAC_DATABASE_UNAVAILABLE");
      assert.equal(error.message.includes("private SQL"), false);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test("permission results are isolated and do not mutate or serialize the user", async () => {
  const outputs = [
    rowsFor("Botanist", "view_plants"),
    rowsFor("Botanist", "register_plants"),
  ];
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: outputs.shift() };
    },
  };
  const resolver = createPermissionResolver(pool);
  const user = activeUser();
  const serializedUserBefore = JSON.stringify(user);
  const first = await resolver.resolveForUser(user);
  const second = await resolver.resolveForUser(user);

  assert.notEqual(first, second);
  assert.equal(first.has("plants.public.read"), true);
  assert.equal(first.has("plants.create"), false);
  assert.equal(second.has("plants.public.read"), false);
  assert.equal(second.has("plants.create"), true);
  assert.equal(JSON.stringify(first), undefined);
  assert.equal(JSON.stringify(user), serializedUserBefore);
  assert.equal(calls.length, 2);
});

test("requires an injected query-capable pool and does not create a pool", () => {
  assert.throws(() => createPermissionResolver(), TypeError);
  assert.throws(() => createPermissionResolver({}), TypeError);
});
