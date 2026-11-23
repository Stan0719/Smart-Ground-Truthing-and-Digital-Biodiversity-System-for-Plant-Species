import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const mobileRequire = createRequire(import.meta.url);
const backendRequire = createRequire(new URL("../../plant-conservation-backend/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const express = backendRequire("express");
const { mountSpeciesDictionary } = backendRequire("./species-dictionary.cjs");
const token = "a".repeat(64);

function loadMobileModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", "AbortSignal", "__DEV__", code)(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`);
      return dependencies[name];
    }, module, module.exports, fetch, AbortSignal, false,
  );
  return module.exports;
}

test("mobile Species search reaches the mounted backend route without external requests", async (t) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = req.headers.authorization === `Bearer ${token}`
      ? { id: "fixture-botanist", role: "Botanist" } : null;
    next();
  });
  const upstream = [];
  mountSpeciesDictionary(app, { allow: () => (_req, _res, next) => next(), fetchImpl: async (url) => {
    upstream.push(new URL(url));
    return { ok: true, status: 200, json: async () => ({ results: [
      { id: 42, name: "Nepenthes mirabilis", preferred_common_name: "Pitcher plant" },
    ] }) };
  } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { plantApi } = loadMobileModule("../utils/plantApi.js", {
    "./faceSession": { faceSession: { withToken: async (callback) => callback(token, { id: "fixture-botanist", role: "Botanist" }) } },
    "./apiConfiguration.js": { mobileApiUrl: () => base },
  });
  const { searchSpeciesDictionary } = loadMobileModule("../utils/speciesDictionary.js", {
    "./plantApi": { plantApi },
  });
  const rows = await searchSpeciesDictionary(" Nepenthes ");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scientificName, "Nepenthes mirabilis");
  assert.equal(rows[0].commonName, "Pitcher plant");
  assert.equal(upstream.length, 1);
  assert.equal(upstream[0].searchParams.get("q"), "Nepenthes");
  await assert.rejects(searchSpeciesDictionary("x"), /Invalid search text/);
});
