"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { projectTaxa, mountSpeciesDictionary } = require("../species-dictionary.cjs");
const { createServer } = require("node:http");

test("projects iNaturalist results with explicit source attribution and optional fields", () => {
  const results = projectTaxa({ results: [{ id: 42, name: "Nepenthes mirabilis", preferred_common_name: "Swamp pitcher plant", rank: "species", ancestors: [{ rank: "family", name: "Nepenthaceae" }] }] });
  assert.deepEqual(results[0], { id: 42, scientificName: "Nepenthes mirabilis", commonName: "Swamp pitcher plant", rank: "species", family: "Nepenthaceae", description: "", sourceName: "iNaturalist", sourceUrl: "https://www.inaturalist.org/taxa/42" });
});

test("empty taxa results remain empty and malformed API responses fail closed", () => {
  assert.deepEqual(projectTaxa({ results: [] }), []);
  assert.throws(() => projectTaxa({}), { status: 502 });
  assert.deepEqual(projectTaxa({ results: [{ id: "bad", name: "Species" }, null] }), []);
});

test("lookup requires Botanist role and forwards only bounded search text upstream", async (t) => {
  const app = express();
  app.use((req, _res, next) => { req.user = req.headers["x-role"] ? { role: req.headers["x-role"] } : null; next(); });
  let upstream;
  mountSpeciesDictionary(app, { allow: () => (_req, _res, next) => next(), fetchImpl: async (url) => { upstream = new URL(url); return { ok: true, status: 200, json: async () => ({ results: [] }) }; } });
  const server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/species-dictionary?q=${encodeURIComponent("Nepenthes")}`;
  assert.equal((await fetch(base)).status, 403);
  assert.equal((await fetch(base, { headers: { "x-role": "Visitor" } })).status, 403);
  const response = await fetch(base, { headers: { "x-role": "Botanist" } });
  assert.equal(response.status, 200);
  assert.equal(upstream.searchParams.get("q"), "Nepenthes");
  assert.equal(upstream.hostname, "api.inaturalist.org");
  assert.deepEqual(await response.json(), { sourceName: "iNaturalist", results: [] });
});
