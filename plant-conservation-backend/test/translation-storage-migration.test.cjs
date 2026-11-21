"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("translation storage migration creates the verified shape and is repeatable", async (t) => {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  t.after(() => pool.end());
  await pool.query("CREATE SCHEMA plant_app");
  await pool.query(readFileSync(join(__dirname, "../migrations/032-translation-storage.sql"), "utf8"));
  await pool.query(readFileSync(join(__dirname, "../migrations/032-translation-storage.sql"), "utf8"));

  const columns = (await pool.query(`
    SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns
    WHERE table_schema='plant_app'
      AND table_name=ANY($1::text[])
    ORDER BY table_name,ordinal_position
  `, [["plant_translation_cache", "plant_translation_source_language"]])).rows;
  assert.deepEqual(columns.map((row) => [row.table_name, row.column_name]), [
    ["plant_translation_cache", "record_type"],
    ["plant_translation_cache", "record_id"],
    ["plant_translation_cache", "field_name"],
    ["plant_translation_cache", "source_locale"],
    ["plant_translation_cache", "target_locale"],
    ["plant_translation_cache", "source_hash"],
    ["plant_translation_cache", "translated_text"],
    ["plant_translation_cache", "model_name"],
    ["plant_translation_cache", "prompt_version"],
    ["plant_translation_cache", "created_at"],
    ["plant_translation_cache", "updated_at"],
    ["plant_translation_source_language", "record_type"],
    ["plant_translation_source_language", "record_id"],
    ["plant_translation_source_language", "field_name"],
    ["plant_translation_source_language", "source_hash"],
    ["plant_translation_source_language", "source_locale"],
    ["plant_translation_source_language", "updated_at"],
  ]);
  assert.ok(columns.filter((row) => row.column_name.endsWith("_at")).every((row) => row.column_default));

  const indexes = (await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='plant_app' ORDER BY indexname")).rows.map((row) => row.indexname);
  assert.deepEqual(indexes, [
    "plant_translation_cache_locale_updated_idx",
    "plant_translation_cache_pkey",
    "plant_translation_source_language_pkey",
  ]);

  await pool.query(`INSERT INTO plant_app.plant_translation_source_language
    (record_type,record_id,field_name,source_hash,source_locale)
    VALUES ('species','19','description',repeat('a',64),'en')`);
  await pool.query(`INSERT INTO plant_app.plant_translation_cache
    (record_type,record_id,field_name,source_locale,target_locale,source_hash,translated_text,model_name,prompt_version)
    VALUES ('species','19','description','en','ms',repeat('a',64),'Teks terjemahan','translategemma:4b','translategemma-prompt-v2')`);
  const counts = (await pool.query(`
    SELECT (SELECT count(*)::int FROM plant_app.plant_translation_cache) AS cache_rows,
           (SELECT count(*)::int FROM plant_app.plant_translation_source_language) AS metadata_rows
  `)).rows[0];
  assert.deepEqual(counts, { cache_rows: 1, metadata_rows: 1 });
});
