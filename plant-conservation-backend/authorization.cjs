"use strict";
const { permitted } = require("../shared/rbac.cjs");
function configuredOrigins(env = process.env) {
  const values = env.WEB_ORIGINS
    ? env.WEB_ORIGINS.split(",").map((v) => v.trim())
    : [env.APP_ORIGIN || "http://localhost:5173", "http://127.0.0.1:5173"];
  if (
    !env.WEB_ORIGINS &&
    !env.APP_ORIGIN &&
    env.CODESPACE_NAME &&
    env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  )
    values.push(
      `https://${env.CODESPACE_NAME}-5173.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`,
    );
  for (const value of values) {
    const url = new URL(value);
    if (
      url.origin !== value ||
      !["http:", "https:"].includes(url.protocol) ||
      (env.NODE_ENV === "production" && url.protocol !== "https:")
    )
      throw Error("Invalid website origin.");
  }
  return new Set(values);
}
function credentials(req) {
  const header = req.headers.authorization;
  const cookies = (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith("niah_session="));
  if (
    cookies.length > 1 ||
    (header !== undefined && !/^Bearer [a-f0-9]{64}$/.test(header))
  )
    throw Error("Invalid credentials.");
  const bearer = header?.slice(7),
    cookie = cookies[0]?.slice(13);
  if (
    (cookie && !/^[a-f0-9]{64}$/.test(cookie)) ||
    (cookies.length && !cookie) ||
    (bearer && cookie && bearer !== cookie)
  )
    throw Error("Invalid credentials.");
  return bearer || cookie || null;
}
function browserBoundary(origins) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!origins.has(origin))
        return res.status(403).json({ error: "Request rejected." });
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      if (!origin) return res.status(403).end();
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      return res.status(204).end();
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !origin &&
      !/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization || "") &&
      !req.path.startsWith("/api/device/")
    )
      return res.status(403).json({ error: "Request rejected." });
    next();
  };
}
function identity(auth) {
  return async (req, res, next) => {
    let token;
    try {
      token = credentials(req);
    } catch {
      return res.status(401).json({ error: "Invalid session." });
    }
    req.user = token ? await auth.session(token) : null;
    // Browser/cookie authentication is restricted before any domain permission check.
    // Native bearer clients retain the existing mobile permissions.
    if (req.user && (req.headers.origin || req.headers.cookie) &&
        !['Administrator', 'Conservation Officer'].includes(req.user.role))
      return res.status(403).json({ error: 'Access denied.' });
    if (token && !req.user)
      return res.status(401).json({ error: "Please sign in again." });
    next();
  };
}
function requirePermission(auth, permission) {
  return async (req, res, next) => {
    if (permitted(req.user, permission)) return next();
    await auth.event(
      req.user?.id || null,
      req.socket.remoteAddress || "unknown",
      `access_denied:${permission}`,
    );
    res
      .status(req.user ? 403 : 401)
      .json({ error: req.user ? "Access denied." : "Please sign in." });
  };
}
module.exports = {
  configuredOrigins,
  credentials,
  browserBoundary,
  identity,
  requirePermission,
};
