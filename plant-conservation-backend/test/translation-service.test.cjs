"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createServer } = require("node:http");
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

function fakeOllama({ installed = true } = {}) {
  const prompts = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: installed ? [{ name: "translategemma:4b" }] : [] }), { status: 200 });
    if (url.endsWith("/api/chat")) {
      const body = JSON.parse(options.body);
      const prompt = body.messages[0].content;
      prompts.push(prompt);
      const translatedInput = prompt.split("\n\n\n").at(-1) || "";
      const markers = [...translatedInput.matchAll(/ZXQDBV\d+QXZ/g)].map((item) => item[0]);
      return new Response(JSON.stringify({ message: { content: `Teks diterjemahkan ${markers.join(" ")}` } }), { status: 200 });
    }
    throw Error("Unexpected Ollama endpoint");
  };
  return { fetchImpl, prompts };
}

test("only allowlisted narrative fields are eligible", () => {
  assert.deepEqual([...FIELD_ALLOWLIST.species], ["description", "habitat", "culturalSignificance"]);
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


test("displayed source commitments reject stale values before cache lookup or translation writes", async () => {
  const pool = fakePool(); const ollama = fakeOllama();
  const service = createTranslationService({ pool, fetchImpl: ollama.fetchImpl, env: {} });
  const officer = { id: 'synthetic-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false };
  const result = await service.translateEntries([{ recordType: 'species', recordId: '12', fieldName: 'description', sourceHash: '0'.repeat(64) }], 'ms', officer);
  assert.deepEqual(result, []); assert.equal(pool.state.writes.length, 0);
  assert.ok(!pool.state.queries.some(sql => sql.includes('FROM plant_translation_cache')));
  await assert.rejects(service.translateEntries([{ recordType: 'species', recordId: '12', fieldName: 'description', sourceHash: 'invalid' }], 'ms', officer), /source binding/);
});
