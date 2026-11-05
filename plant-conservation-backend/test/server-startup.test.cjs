"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createServer, get } = require("node:http"), { once } = require("node:events");
const { readFileSync } = require("node:fs"), { join } = require("node:path");
const { createPlantApp } = require("../server.js");
const rawGet = (url, headers = {}) => new Promise((resolve, reject) => get(url, { headers }, (res) => {
  let body = ""; res.on("data", (b) => { body += b; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
}).on("error", reject));

test("Plant API JSON does not emit ETags or turn a previous cached ETag into a bodyless 304", async (t) => {
  const app = createPlantApp({ pool: {}, auth: {} });
  const server = createServer(app).listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/health`;
  for (const headers of [{}, { "If-None-Match": 'W/"previously-cached-health"' }]) {
    const result = await rawGet(url, headers);
    assert.equal(result.status, 200); assert.equal(result.headers.etag, undefined);
    assert.equal(result.headers["cache-control"], "no-store"); assert.equal(JSON.parse(result.body).ready, true);
  }
});

test("actual startup code handles an occupied port without dereferencing a null server address", async (t) => {
  const occupied = createServer().listen(0, "127.0.0.1"); await once(occupied, "listening");
  t.after(() => new Promise((r) => occupied.close(r)));
  const source = readFileSync(join(__dirname, "../server.js"), "utf8");
  const begin = source.indexOf("  const officerNotifications = createOfficerNotificationDelivery", source.indexOf("async function start()"));
  assert.ok(begin >= 0, 'production notification/bootstrap wiring must be present');
  const code = source.slice(begin, source.indexOf("  for (const signal", begin));
  const logs = []; let authClosed = false, poolClosed = false, workerStarted = false;
  const processState = { env: { PORT: String(occupied.address().port), HOST: "127.0.0.1" }, exitCode: 0 };
  const server = new Function("createPlantApp", "auth", "pool", "process", "createServer", "console", "createOfficerNotificationDelivery", code + "\nreturn server;")(
    () => (_req, res) => res.end("ok"), { db: { close: async () => { authClosed = true; } } },
    { end: async () => { poolClosed = true; } }, processState, createServer, { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    () => ({ start: () => { workerStarted = true; } }),
  );
  const [error] = await once(server, "error"); await new Promise((r) => setImmediate(r));
  assert.equal(error.code, "EADDRINUSE"); assert.equal(processState.exitCode, 1);
  assert.equal(authClosed, true); assert.equal(poolClosed, true);
  assert.equal(workerStarted, false);
  assert.ok(logs.flat().some((value) => String(value).includes("already in use")));
  assert.ok(!logs.flat().some((value) => String(value).includes("listening on port")));
});
