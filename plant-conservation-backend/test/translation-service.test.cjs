"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createServer } = require("node:http");
const { browserBoundary } = require("../authorization.cjs");
const {
  FIELD_ALLOWLIST,
  createTranslationService,
  mountWebsiteTranslations,
  protectedMatches,
  translateProtectedText,
} = require("../translation-service.cjs");

const source = "Nepenthes ampullaria grows 1.5 m near https://example.test/plant.jpg (PL001).";
const sourceHash = require("node:crypto").createHash("sha256").update(source, "utf8").digest("hex");

function fakePool({ metadata = true, cache = null, sourceText = source } = {}) {
  const hash = require("node:crypto").createHash("sha256").update(sourceText, "utf8").digest("hex");
  const state = { cache, writes: [], queries: [] };
  return {
    state,
    async query(sql, values = []) {
      state.queries.push(sql);
      if (sql.includes("SELECT scientific_name AS name")) return { rows: [{ name: "Nepenthes ampullaria" }] };
      if (sql.includes("FROM species s LEFT JOIN")) return { rows: [{ id: "12", source_text: sourceText }] };
      if (sql.includes("FROM plant_observation o")) return { rows: [{ id: values[0], source_text: sourceText }] };
      if (sql.includes("FROM plant_translation_source_language")) {
        return { rows: metadata && values[3] === hash ? [{ record_type: "species", source_locale: "en" }] : [] };
      }
      if (sql.includes("FROM plant_translation_cache")) {
        const row = state.cache;
        return { rows: row && values[3] === row.target_locale && values[4] === row.source_hash ? [row] : [] };
      }
      if (sql.includes("INSERT INTO plant_translation_cache")) {
        const [record_type, record_id, field_name, target_locale, source_hash, translated_text, model_name, prompt_version] = values;
        const row = { record_type, record_id, field_name, target_locale, source_locale: "en", source_hash, translated_text, model_name, prompt_version };
        state.cache = row;
        state.writes.push({ sql, row });
        return { rows: [row] };
      }
      throw Error("Unexpected test query");
    },
  };
}

function fakeOllama({ installed = true, output = null } = {}) {
  const prompts = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: installed ? [{ name: "translategemma:4b" }] : [] }), { status: 200 });
    if (url.endsWith("/api/chat")) {
      const body = JSON.parse(options.body);
      const prompt = body.messages[0].content;
      prompts.push(prompt);
      const translatedInput = prompt.split("\n\n\n").at(-1) || "";
      const markers = [...translatedInput.matchAll(/ZXQDBV\d+QXZ/g)].map((item) => item[0]);
      const content = typeof output === "function"
        ? output(prompt, markers)
        : typeof output === "string"
          ? output
          : `${prompt.includes("Simplified Chinese") ? "已翻译" : "Teks diterjemahkan"} ${markers.join(" ")}`;
      return new Response(JSON.stringify({ message: { content } }), { status: 200 });
    }
    throw Error("Unexpected Ollama endpoint");
  };
  return { fetchImpl, prompts };
}

test("only allowlisted narrative fields are eligible", () => {
  assert.deepEqual([...FIELD_ALLOWLIST.species], ["commonName", "description", "habitat", "culturalSignificance"]);
  assert.deepEqual([...FIELD_ALLOWLIST.observation], ["morphology", "notes"]);
  assert.deepEqual([...FIELD_ALLOWLIST.review], ["comment"]);
  assert.equal(FIELD_ALLOWLIST.observation.has("latitude"), false);
  assert.equal(FIELD_ALLOWLIST.observation.has("taxonomy"), false);
  assert.equal(FIELD_ALLOWLIST.species.has("scientific_name"), false);
});

test("scientific names, numbers, IDs, URLs, and paths are excluded from model input", async () => {
  const tokens = protectedMatches(source, ["Nepenthes ampullaria"]);
  assert.deepEqual(tokens.map((item) => item.text), [
    "Nepenthes ampullaria", "1.5 m", "https://example.test/plant.jpg", "PL001",
  ]);
  const sent = [];
  const translated = await translateProtectedText(source, "ms", ["Nepenthes ampullaria"], async (chunk) => {
    sent.push(chunk);
    const markers = [...chunk.matchAll(/ZXQDBV\d+QXZ/g)].map((item) => item[0]);
    return `Terjemahan ${markers.join(" ")}`;
  });
  assert.match(translated, /Nepenthes ampullaria/);
  assert.match(translated, /1\.5 m/);
  assert.match(translated, /https:\/\/example\.test\/plant\.jpg/);
  assert.match(translated, /PL001/);
  assert.ok(sent.length === 1 && !/Nepenthes ampullaria|1\.5|https:|PL001/.test(sent[0]));
  assert.equal((sent[0].match(/ZXQDBV\d+QXZ/g) || []).length, 4);
});

test("specific geological technical terms are protected and restored exactly", async () => {
  const text = "It grows on nepheline syenite soils.";
  const protectedValues = protectedMatches(text);
  assert.deepEqual(protectedValues.map((item) => item.text), ["nepheline syenite"]);
  const translated = await translateProtectedText(text, "zh-CN", [], async (chunk) => {
    const marker = chunk.match(/ZXQDBV\d+QXZ/)?.[0];
    assert.ok(marker);
    assert.ok(!chunk.includes("nepheline syenite"));
    return `土壤中含有 ${marker}。`;
  });
  assert.equal(translated, "土壤中含有 nepheline syenite。");
});

test("known genus names are protected without freezing ordinary sentence openings", () => {
  const values = protectedMatches("This plant has green leaves. Nepenthes rafflesiana grows here.", ["Nepenthes rafflesiana", "Nepenthes"]);
  assert.deepEqual(values.map((item) => item.text), ["Nepenthes rafflesiana"]);
});

test("repeated protected names and adjacent punctuation restore exactly in order", async () => {
  const repeated = "Nepenthes ampullaria, unlike Nepenthes ampullaria var. alba, grows here.";
  const translated = await translateProtectedText(repeated, "zh-CN", ["Nepenthes ampullaria", "Nepenthes ampullaria var. alba"], async (chunk) => {
    const markers = [...chunk.matchAll(/ZXQDBV\d+QXZ/g)].map((item) => item[0]);
    assert.equal(markers.length, 2);
    return `${markers[0]}，与 ${markers[1]} 不同。`;
  });
  assert.equal(translated, "Nepenthes ampullaria，与 Nepenthes ampullaria var. alba 不同。");
});

test("a cached translation with a repeated scientific name is reused", async () => {
  const repeated = "Nepenthes ampullaria grows near Nepenthes ampullaria.";
  const hash = require("node:crypto").createHash("sha256").update(repeated, "utf8").digest("hex");
  const pool = fakePool({ sourceText: repeated, cache: {
    record_type: "species", record_id: "12", field_name: "description", target_locale: "ms",
    source_locale: "en", source_hash: hash,
    translated_text: "Nepenthes ampullaria tumbuh berhampiran Nepenthes ampullaria.",
    model_name: "translategemma:4b", prompt_version: "translategemma-prompt-v2",
  } });
  const ollama = fakeOllama();
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const result = await service.translateEntries([{ recordType: "species", recordId: "12", fieldName: "description" }], "ms", null);
  assert.equal(result[0]?.text, "Nepenthes ampullaria tumbuh berhampiran Nepenthes ampullaria.");
  assert.equal(ollama.prompts.length, 0);
  assert.equal(pool.state.writes.length, 0);
});

test("a cached translation that alters a protected technical term is regenerated", async () => {
  const sourceText = "The soil contains nepheline syenite.";
  const hash = require("node:crypto").createHash("sha256").update(sourceText, "utf8").digest("hex");
  const pool = fakePool({ sourceText, cache: {
    record_type: "species", record_id: "12", field_name: "description", target_locale: "zh-CN",
    source_locale: "en", source_hash: hash, translated_text: "土壤中含有石英岩。",
    model_name: "translategemma:4b", prompt_version: "translategemma-prompt-v2",
  } });
  const ollama = fakeOllama({ output: (_prompt, markers) => `土壤中含有 ${markers[0]}。` });
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const result = await service.translateEntries([{ recordType: "species", recordId: "12", fieldName: "description" }], "zh-CN", null);
  assert.equal(result[0]?.text, "土壤中含有 nepheline syenite。");
  assert.equal(ollama.prompts.length, 1);
  assert.equal(pool.state.writes.length, 1);
  assert.equal(pool.state.cache.translated_text, result[0].text);
});

test("marker loss, duplication, or reordering fails closed", async () => {
  const sentence = "Nepenthes ampullaria grows near Nepenthes ampullaria.";
  for (const corrupt of ["terjemahan tanpa nama", "ZXQDBV0QXZ ZXQDBV0QXZ ZXQDBV1QXZ", "ZXQDBV1QXZ ZXQDBV0QXZ"]) {
    await assert.rejects(
      translateProtectedText(sentence, "ms", ["Nepenthes ampullaria"], async () => corrupt),
      /Protected marker validation failed/,
    );
  }
});

test("a verified English source is translated, cached only in the dedicated table, and reused", async () => {
  const pool = fakePool();
  const ollama = fakeOllama();
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const entry = { recordType: "species", recordId: "12", fieldName: "description" };
  const first = await service.translateEntries([entry], "ms", null);
  assert.equal(first.length, 1);
  assert.ok(first[0].text.includes("Nepenthes ampullaria"));
  assert.ok(first[0].text.includes("1.5 m"));
  assert.ok(first[0].text.includes("https://example.test/plant.jpg"));
  assert.ok(first[0].text.includes("PL001"));
  assert.equal(pool.state.writes.length, 1);
  assert.ok(pool.state.writes[0].sql.includes("INSERT INTO plant_translation_cache"));
  assert.equal(pool.state.queries.some((sql) => /UPDATE\s+(species|plant_observation)/i.test(sql)), false);
  assert.ok(ollama.prompts.every((prompt) => prompt.includes("English (en) to Malaysian Bahasa Melayu (ms)")));
  const callCount = ollama.prompts.length;
  const second = await service.translateEntries([entry], "ms", null);
  assert.deepEqual(second, first);
  assert.equal(ollama.prompts.length, callCount);
});

test("unknown source-language metadata returns no translation and makes no model request", async () => {
  const pool = fakePool({ metadata: false });
  const ollama = fakeOllama();
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const diagnostics = [];
  const originalInfo = console.info;
  console.info = (message) => diagnostics.push(String(message));
  let result;
  try {
    result = await service.translateEntries([{ recordType: "species", recordId: "12", fieldName: "description" }], "zh-CN", null);
  } finally { console.info = originalInfo; }
  assert.deepEqual(result, []);
  assert.equal(ollama.prompts.length, 0);
  assert.equal(pool.state.writes.length, 0);
  assert.ok(diagnostics.some((line) => line.includes('"event":"website_translation.metadata-skip"')));
  assert.ok(!diagnostics.some((line) => line.includes(source)));
});

test("observation prose is selected from one allowlisted JSON path and cached separately", async () => {
  const content = "Leaves are mottled; height 42 cm; latitude 3.8.";
  const hash = require("node:crypto").createHash("sha256").update(content, "utf8").digest("hex");
  const state = { writes: [], queries: [] };
  const pool = {
    state,
    async query(sql, values = []) {
      state.queries.push(sql);
      if (sql.includes("SELECT scientific_name AS name")) return { rows: [] };
      if (sql.includes("FROM plant_observation o")) return { rows: [{ id: "123e4567-e89b-12d3-a456-426614174000", source_text: content }] };
      if (sql.includes("FROM plant_translation_source_language")) return { rows: values[3] === hash ? [{ record_type: "observation", source_locale: "en" }] : [] };
      if (sql.includes("FROM plant_translation_cache")) return { rows: [] };
      if (sql.includes("INSERT INTO plant_translation_cache")) { state.writes.push(sql); return { rows: [] }; }
      throw Error("Unexpected observation test query");
    },
  };
  const ollama = fakeOllama();
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const result = await service.translateEntries([{ recordType: "observation", recordId: "123e4567-e89b-12d3-a456-426614174000", fieldName: "morphology" }], "zh-CN", null);
  assert.equal(result.length, 1);
  assert.ok(ollama.prompts[0].includes("English (en) to Simplified Chinese (zh-Hans)"));
  assert.ok(ollama.prompts[0].includes("Leaves are mottled"), ollama.prompts[0]);
  assert.ok(!ollama.prompts[0].includes('"heightCm"') && !ollama.prompts[0].includes('"latitude"'));
  assert.ok(state.queries.some((sql) => sql.includes("o.content->>$2")));
  assert.equal(state.writes.length, 1);
  assert.ok(state.writes[0].includes("INSERT INTO plant_translation_cache"));
  assert.equal(state.queries.some((sql) => /UPDATE\s+(plant_observation|species)/i.test(sql)), false);
});

test("an unavailable local model is not downloaded and leaves source text untouched", async () => {
  const pool = fakePool();
  const ollama = fakeOllama({ installed: false });
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const result = await service.translateEntries([{ recordType: "species", recordId: "12", fieldName: "description" }], "ms", null);
  assert.deepEqual(result, []);
  assert.equal(ollama.prompts.length, 0);
  assert.equal(pool.state.writes.length, 0);
});

test("ambiguous short source fragments are not sent to Ollama and are cooldown-suppressed", async () => {
  const text = "Jn morphology";
  const hash = require("node:crypto").createHash("sha256").update(text, "utf8").digest("hex");
  const pool = fakePool({ sourceText: text, cache: { record_type: "observation", record_id: "123e4567-e89b-12d3-a456-426614174000", field_name: "morphology",
    target_locale: "ms", source_locale: "en", source_hash: hash, translated_text: text,
    model_name: "translategemma:4b", prompt_version: "translategemma-prompt-v2" } });
  const ollama = fakeOllama();
  const diagnostics = [];
  const originalInfo = console.info;
  console.info = (message) => diagnostics.push(String(message));
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const entry = { recordType: "observation", recordId: "123e4567-e89b-12d3-a456-426614174000", fieldName: "morphology" };
  try {
    assert.deepEqual(await service.translateEntries([entry], "ms", null), []);
    assert.deepEqual(await service.translateEntries([entry], "ms", null), []);
  } finally { console.info = originalInfo; }
  assert.equal(ollama.prompts.length, 0);
  assert.equal(pool.state.writes.length, 0);
  assert.equal(pool.state.cache.translated_text, text, "the invalid cache is left untouched for authorized manual review");
  assert.ok(diagnostics.some((line) => line.includes('"reason":"cached_source_field_echo"')));
  assert.ok(diagnostics.some((line) => line.includes('"reason":"recent_failure_cooldown"')));
});

test("verbatim English narrative and model explanations are rejected without cache writes", async () => {
  const narrative = "This plant has green leaves and grows in shaded forest areas.";
  const entry = { recordType: "species", recordId: "12", fieldName: "description" };
  for (const output of [narrative, `Here is the translation: ${narrative}`]) {
    const pool = fakePool({ sourceText: narrative });
    const ollama = fakeOllama({ output });
    const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
    assert.deepEqual(await service.translateEntries([entry], "ms", null), []);
    assert.equal(ollama.prompts.length, 1);
    assert.equal(pool.state.writes.length, 0);
    assert.equal(pool.state.cache, null);
    assert.deepEqual(await service.translateEntries([entry], "ms", null), []);
    assert.equal(ollama.prompts.length, 1, "the same failed source should not cause an inference loop");
  }
});

test("unchanged scientific-name content is allowed, while empty responses are never cached", async () => {
  const name = "Nepenthes rafflesiana.";
  const pool = fakePool({ sourceText: name });
  const ollama = fakeOllama({ output: (_prompt, markers) => `${markers[0]}.` });
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const entry = { recordType: "species", recordId: "12", fieldName: "description" };
  const namedResult = await service.translateEntries([entry], "ms", null);
  assert.equal(namedResult[0]?.text, name);
  assert.equal(ollama.prompts.length, 1);
  assert.equal(pool.state.writes.length, 1);

  const chinesePool = fakePool({ sourceText: name });
  const chineseOllama = fakeOllama({ output: (_prompt, markers) => `${markers[0]}.` });
  const chineseService = createTranslationService({ pool: chinesePool, fetchImpl: chineseOllama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  const chineseResult = await chineseService.translateEntries([entry], "zh-CN", null);
  assert.equal(chineseResult[0]?.text, name, "unchanged scientific names need no forced Chinese script");

  const narrative = "This plant has green leaves and grows in shaded forest areas.";
  const emptyPool = fakePool({ sourceText: narrative });
  const emptyOllama = fakeOllama({ output: "   " });
  const emptyService = createTranslationService({ pool: emptyPool, fetchImpl: emptyOllama.fetchImpl, env: { OLLAMA_BASE_URL: "http://127.0.0.1:11434" } });
  assert.deepEqual(await emptyService.translateEntries([entry], "ms", null), []);
  assert.equal(emptyPool.state.writes.length, 0);
});

test("mobile translation endpoint accepts only native Botanist/Visitor or public Guest access and reuses PostgreSQL cache", async (context) => {
  const cachedText = "Nepenthes ampullaria tumbuh 1.5 m dekat https://example.test/plant.jpg (PL001).",
    cache = { record_type: "species", record_id: "12", field_name: "description", target_locale: "ms",
      source_locale: "en", source_hash: sourceHash, translated_text: cachedText,
      model_name: "translategemma:4b", prompt_version: "translategemma-prompt-v2" };
  const pool = fakePool({ cache });
  const ollama = fakeOllama();
  const serviceApp = express();
  serviceApp.use(express.json());
  serviceApp.use((req, _res, next) => {
    const role = req.headers["x-test-role"];
    req.user = role ? { id: "mobile-user", role, status: "Active", mustChangePassword: false } : null;
    next();
  });
  mountWebsiteTranslations(serviceApp, {
    pool,
    allow: () => (req, res, next) => {
      if (req.user && !["Botanist", "Visitor", "Administrator", "Conservation Officer"].includes(req.user.role))
        return res.status(403).json({ error: "Access denied." });
      next();
    },
    origins: new Set(["http://localhost:5173"]),
  });
  const server = createServer(serviceApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/mobile/translations`;
  const body = JSON.stringify({ locale: "ms", entries: [{ recordType: "species", recordId: "12", fieldName: "description" }] });
  const botanist = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(64)}`, "X-Test-Role": "Botanist", "Content-Type": "application/json" }, body });
  assert.equal(botanist.status, 200);
  assert.deepEqual((await botanist.json()).translations.map((row) => row.text), [cachedText]);
  const visitor = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${"b".repeat(64)}`, "X-Test-Role": "Visitor", "Content-Type": "application/json" }, body });
  assert.equal(visitor.status, 200);
  assert.deepEqual((await visitor.json()).translations.map((row) => row.text), [cachedText]);
  const guest = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(guest.status, 200);
  assert.deepEqual((await guest.json()).translations.map((row) => row.text), [cachedText]);
  const browser = await fetch(url, { method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" }, body });
  assert.equal(browser.status, 403);
  const admin = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(64)}`, "X-Test-Role": "Administrator", "Content-Type": "application/json" }, body });
  assert.equal(admin.status, 403);
  assert.equal(ollama.prompts.length, 0, "valid shared cache hit must not call Ollama");
  assert.equal(pool.state.writes.length, 0, "existing cache rows are read-only during this test");
});

test("browser boundary permits only the exact anonymous mobile translation POST path", async (context) => {
  const app = express();
  app.use(browserBoundary(new Set(["http://localhost:5173"])));
  app.post("/api/mobile/translations", (_req, res) => res.sendStatus(204));
  app.post("/api/mobile/plant-submissions", (_req, res) => res.sendStatus(204));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const translation = await fetch(`${base}/api/mobile/translations`, { method: "POST" });
  const unrelated = await fetch(`${base}/api/mobile/plant-submissions`, { method: "POST" });
  assert.equal(translation.status, 204);
  assert.equal(unrelated.status, 403);
});

test("website translation endpoint rejects missing origins and bearer-authenticated clients", async (context) => {
  const pool = fakePool();
  const serviceApp = express();
  serviceApp.use(express.json());
  const { mountWebsiteTranslations } = require("../translation-service.cjs");
  mountWebsiteTranslations(serviceApp, {
    pool,
    allow: () => (_req, _res, next) => next(),
    origins: new Set(["http://localhost:5173"]),
  });
  const server = createServer(serviceApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/website/translations`;
  const body = JSON.stringify({ locale: "ms", entries: [{ recordType: "species", recordId: "12", fieldName: "description" }] });
  const noOrigin = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(noOrigin.status, 403);
  const bearer = await fetch(url, { method: "POST", headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${"a".repeat(64)}`, "Content-Type": "application/json" }, body });
  assert.equal(bearer.status, 403);
  assert.equal(pool.state.queries.length, 0);
});
