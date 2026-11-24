"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { normalizeSourceLanguages, syncSourceLanguage, syncSourceLanguages, stageSourceLanguages, promoteSourceLanguages } = require("../translation-source-language.cjs");

function metadataClient() {
  const rows = new Map(), queries = [];
  return { rows, queries, async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith("INSERT INTO plant_translation_source_language")) {
      const [recordType, recordId, fieldName, sourceHash, sourceLocale] = values;
      rows.set(`${recordType}:${recordId}:${fieldName}`, { sourceHash, sourceLocale });
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("DELETE FROM plant_translation_source_language")) {
      const key = `${values[0]}:${values[1]}:${values[2]}`;
      if (!values[3] || rows.get(key)?.sourceHash !== values[3]) rows.delete(key);
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("SELECT source_hash,source_locale")) {
      const row = rows.get(`${values[0]}:${values[1]}:${values[2]}`);
      return { rows: row ? [{ source_hash: row.sourceHash, source_locale: row.sourceLocale }] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}
const sha = text => createHash("sha256").update(text, "utf8").digest("hex");

test("source language selections accept only supported prose locales and fields", () => {
  assert.deepEqual(normalizeSourceLanguages({ description: "en", habitat: "ms", culturalSignificance: "zh-CN" },
    ["description", "habitat", "culturalSignificance"]), { description: "en", habitat: "ms", culturalSignificance: "zh-CN" });
  assert.deepEqual(normalizeSourceLanguages({ morphology: "unknown" }, ["morphology"]), { morphology: "unknown" });
  assert.throws(() => normalizeSourceLanguages({ latitude: "en" }, ["morphology"]), /Invalid source-language/);
  assert.throws(() => normalizeSourceLanguages({ morphology: "id" }, ["morphology"]), /Unsupported source language/);
});

test("creation metadata stores the canonical hash for English, Malay, and Chinese text", async () => {
  const client = metadataClient();
  for (const [text, locale] of [["Green leaves", "en"], ["Daun hijau", "ms"], ["绿叶", "zh-CN"]])
    await syncSourceLanguage(client, { recordType: "species", recordId: "19", fieldName: "description", sourceText: text, sourceLocale: locale });
  assert.deepEqual(client.rows.get("species:19:description"), { sourceHash: sha("绿叶"), sourceLocale: "zh-CN" });
});

test("automatic mode preserves matching explicit metadata", async () => {
  const client = metadataClient();
  await syncSourceLanguages(client, { recordType: "species", recordId: 19,
    values: { description: "Green leaves", habitat: "Hutan tropika" },
    selections: { description: "en", habitat: "ms" },
    fieldMap: { description: "description", habitat: "habitat" } });
  assert.equal(client.rows.get("species:19:description").sourceLocale, "en");
  assert.equal(client.rows.get("species:19:habitat").sourceLocale, "ms");
  await syncSourceLanguage(client, { recordType: "species", recordId: 19, fieldName: "habitat", sourceText: "Hutan tropika", sourceLocale: "unknown" });
  assert.equal(client.rows.get("species:19:habitat").sourceLocale, "ms");
});

test("approved submissions promote only exact staged text and discard stale selections", async () => {
  const client = metadataClient();
  await stageSourceLanguages(client, { submissionType: "species_request", submissionId: "req-1",
    values: { description: "Green leaves", habitat: "Wet forest" },
    selections: { description: "en", habitat: "ms" }, fieldMap: { description: "description", habitat: "habitat" } });
  await promoteSourceLanguages(client, { submissionType: "species_request", submissionId: "req-1", recordType: "species", recordId: 19,
    values: { description: "Green leaves updated", habitat: "Wet forest" }, fieldMap: { description: "description", habitat: "habitat" } });
  assert.equal(client.rows.has("species:19:description"), false, "changed source text must not get stale metadata");
  assert.equal(client.rows.get("species:19:habitat").sourceHash, sha("Wet forest"));
  assert.equal(client.rows.get("species:19:habitat").sourceLocale, "ms");
  assert.equal(client.rows.has("__pending_species_request:req-1:description"), false);
  assert.equal(client.rows.has("__pending_species_request:req-1:habitat"), false);
});
