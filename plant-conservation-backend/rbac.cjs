"use strict";

const DATABASE_ROLE_BY_APPLICATION_ROLE = Object.freeze({
  Visitor: "Visitor",
  Botanist: "Botanist",
  "Conservation Officer": "Conservation Officer",
  Administrator: "Admin",
});

const APPLICATION_PERMISSIONS_BY_DATABASE_PERMISSION = Object.freeze({
  manage_users: Object.freeze(["accounts.manage"]),
  manage_species: Object.freeze(["species.manage"]),
  register_plants: Object.freeze(["plants.create"]),
  record_observations: Object.freeze([
    "observations.create",
    "observations.edit.own",
  ]),
  verify_observations: Object.freeze(["observations.review"]),
  view_plants: Object.freeze(["plants.public.read"]),
  manage_sensors: Object.freeze(["devices.manage"]),
  view_alerts: Object.freeze(["alerts.read"]),
  manage_permissions: Object.freeze(["permissions.manage"]),
  read_audit_logs: Object.freeze(["audit.read"]),
  manage_security_settings: Object.freeze(["security.manage"]),
  read_system_status: Object.freeze(["system.read"]),
  view_scientific_plants: Object.freeze(["plants.scientific.read"]),
  view_protected_species: Object.freeze(["plants.protected.read"]),
  read_exact_plant_gps: Object.freeze(["plants.gps.exact.read"]),
  read_reports: Object.freeze(["reports.read"]),
  view_devices: Object.freeze(["devices.read"]),
  view_readings: Object.freeze(["readings.read"]),
  manage_thresholds: Object.freeze(["thresholds.manage"]),
  manage_alert_responses: Object.freeze(["responses.manage"]),
  generate_qr_codes: Object.freeze(["qr.generate"]),
});

// This is an established database permission, but its broader meaning is not
// approved for application authorization. It intentionally produces no grant.
const KNOWN_UNMAPPED_DATABASE_PERMISSIONS = new Set(["manage_qr_codes"]);

const RESOLVER_SQL = `
  SELECT r.role_id, r.role_name, p.permission_name
  FROM public.role AS r
  LEFT JOIN public.role_permission AS rp ON rp.role_id = r.role_id
  LEFT JOIN public.permission AS p ON p.permission_id = rp.permission_id
  WHERE r.role_name = $1
  ORDER BY p.permission_name
`;

class AuthorizationDeniedError extends Error {
  constructor() {
    super("Authorization denied.");
    this.name = "AuthorizationDeniedError";
    this.code = "AUTHORIZATION_DENIED";
    this.status = 403;
  }
}

class PermissionDatabaseUnavailableError extends Error {
  constructor() {
    super("Permission service unavailable.");
    this.name = "PermissionDatabaseUnavailableError";
    this.code = "RBAC_DATABASE_UNAVAILABLE";
    this.status = 503;
  }
}

function resolvedPermissionSet(permissionNames) {
  const granted = new Set(permissionNames);
  const result = Object.create(null);
  Object.defineProperties(result, {
    has: {
      enumerable: false,
      value(permission) {
        return typeof permission === "string" && granted.has(permission);
      },
    },
    toJSON: {
      enumerable: false,
      value() {
        return undefined;
      },
    },
  });
  return Object.freeze(result);
}

function createPermissionResolver(pool) {
  if (!pool || typeof pool.query !== "function")
    throw new TypeError("A PostgreSQL pool with query(sql, values) is required.");

  async function resolveForUser(user) {
    // Anonymous access is handled by explicit public-route rules, never by a
    // database role or a synthetic Guest permission grant.
    if (user === null || user === undefined) return resolvedPermissionSet([]);

    if (
      typeof user !== "object" ||
      !Object.hasOwn(DATABASE_ROLE_BY_APPLICATION_ROLE, user.role) ||
      user.status !== "Active" ||
      user.mustChangePassword !== false
    )
      throw new AuthorizationDeniedError();

    const databaseRole = DATABASE_ROLE_BY_APPLICATION_ROLE[user.role];
    let result;
    try {
      result = await pool.query(RESOLVER_SQL, [databaseRole]);
    } catch {
      // Do not retain or expose driver errors, SQL, connection details, or
      // credentials through this error boundary.
      throw new PermissionDatabaseUnavailableError();
    }

    if (!result || !Array.isArray(result.rows) || result.rows.length === 0)
      throw new AuthorizationDeniedError();

    const seenDatabasePermissions = new Set();
    const seenRoleIds = new Set();
    const applicationPermissions = new Set();

    for (const row of result.rows) {
      const roleId =
        typeof row?.role_id === "number" &&
        Number.isSafeInteger(row.role_id) &&
        row.role_id > 0
          ? String(row.role_id)
          : typeof row?.role_id === "string" && /^[1-9]\d*$/.test(row.role_id)
            ? row.role_id
            : null;
      if (
        !row ||
        roleId === null ||
        row.role_name !== databaseRole ||
        typeof row.permission_name !== "string" ||
        row.permission_name.length === 0 ||
        seenDatabasePermissions.has(row.permission_name)
      )
        throw new AuthorizationDeniedError();

      seenRoleIds.add(roleId);
      if (seenRoleIds.size > 1) throw new AuthorizationDeniedError();
      seenDatabasePermissions.add(row.permission_name);

      if (
        Object.hasOwn(
          APPLICATION_PERMISSIONS_BY_DATABASE_PERMISSION,
          row.permission_name,
        )
      ) {
        const mapped =
          APPLICATION_PERMISSIONS_BY_DATABASE_PERMISSION[row.permission_name];
        for (const permission of mapped) applicationPermissions.add(permission);
      } else if (
        !KNOWN_UNMAPPED_DATABASE_PERMISSIONS.has(row.permission_name)
      ) {
        // Unknown database permission data invalidates this resolution rather
        // than being silently ignored or converted into a grant.
        throw new AuthorizationDeniedError();
      }
    }

    return resolvedPermissionSet(applicationPermissions);
  }

  return Object.freeze({ resolveForUser });
}

module.exports = {
  createPermissionResolver,
  AuthorizationDeniedError,
  PermissionDatabaseUnavailableError,
};
