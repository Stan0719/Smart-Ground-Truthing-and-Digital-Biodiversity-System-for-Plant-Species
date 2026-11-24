"use strict";

const { createHash } = require("node:crypto");
const { detectSourceLanguage } = require("./translation-language-detection.cjs");

const LOCALES = new Set(["en", "ms", "zh-CN"]);
const FIELDS = Object.freeze({
  species: new Set(["description", "habitat", "culturalSignificance"]),
  observation: new Set(["morphology", "notes"]),
  review: new Set(["comment"]),
});
const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const detectedRecordType = (recordType) => `__detected_v1_${recordType}`;

async function saveDetectedSource(client, { recordType, recordId, fieldName, sourceHash, locale }) {
  await client.query(`INSERT INTO plant_translation_source_language
    (record_type,record_id,field_name,source_hash,source_locale) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(record_type,record_id,field_name) DO UPDATE SET
      source_hash=EXCLUDED.source_hash,source_locale=EXCLUDED.source_locale,updated_at=CURRENT_TIMESTAMP
    WHERE plant_translation_source_language.source_hash<>EXCLUDED.source_hash`,
  [detectedRecordType(recordType), String(recordId), fieldName, sourceHash, locale]);
}

function normalizeSourceLanguages(value, allowedFields) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowedFields.includes(key)))
    throw Object.assign(Error("Invalid source-language selections."), { status: 400 });
  const result = {};
  for (const [field, locale] of Object.entries(value)) {
    if (locale !== "unknown" && !LOCALES.has(locale))
      throw Object.assign(Error("Unsupported source language."), { status: 400 });
    result[field] = locale;
  }
  return result;
}

// Call only with the transaction client that writes the corresponding source text.
async function syncSourceLanguage(client, { recordType, recordId, fieldName, sourceText, sourceLocale }) {
  const allowed = FIELDS[recordType];
  if (!allowed?.has(fieldName)) throw Error("Unsupported translation source field.");
  const id = String(recordId);
  if (!id || id === "undefined" || id === "null") throw Error("Invalid translation source record ID.");
  const sourceHash = typeof sourceText === "string" && sourceText.trim() ? digest(sourceText) : null;
  if (sourceLocale === undefined || sourceLocale === "unknown") {
    const locale = detectSourceLanguage(sourceText);
    if (locale) {
      await saveDetectedSource(client, { recordType, recordId: id, fieldName, sourceHash, locale });
      return;
    }
    if (sourceLocale === undefined) return;
  }
  if (!sourceHash || sourceLocale === "unknown") {
    await client.query(`DELETE FROM plant_translation_source_language
      WHERE record_type=$1 AND record_id=$2 AND field_name=$3
        AND ($4::text IS NULL OR source_hash<>$4)`, [recordType, id, fieldName, sourceHash]);
    return;
  }
  if (!LOCALES.has(sourceLocale)) throw Error("Unsupported source language.");
  await client.query(`INSERT INTO plant_translation_source_language
    (record_type,record_id,field_name,source_hash,source_locale)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(record_type,record_id,field_name) DO UPDATE SET
      source_hash=EXCLUDED.source_hash,source_locale=EXCLUDED.source_locale,updated_at=CURRENT_TIMESTAMP`,
  [recordType, id, fieldName, sourceHash, sourceLocale]);
}

async function syncSourceLanguages(client, { recordType, recordId, values, selections, fieldMap }) {
  for (const [selectionKey, fieldName] of Object.entries(fieldMap)) {
    if (values?.[selectionKey] !== undefined)
      await syncSourceLanguage(client, { recordType, recordId, fieldName,
        sourceText: values[selectionKey] ?? "", sourceLocale: selections?.[selectionKey] });
  }
}

async function stageSourceLanguages(client, { submissionType, submissionId, values, selections, fieldMap }) {
  const recordType = `__pending_${submissionType}`;
  for (const [selectionKey, fieldName] of Object.entries(fieldMap)) {
    if (values?.[selectionKey] === undefined) continue;
    const locale = selections?.[selectionKey];
    const sourceText = values?.[selectionKey] ?? "";
    if (locale === undefined || locale === "unknown") {
      const detected = detectSourceLanguage(sourceText);
      if (detected) {
        await saveDetectedSource(client, { recordType, recordId: submissionId, fieldName, sourceHash: digest(sourceText), locale: detected });
        continue;
      }
      if (locale === undefined) continue;
    }
    if (locale === "unknown" || !sourceText.trim()) {
      await client.query(`DELETE FROM plant_translation_source_language WHERE record_type=$1 AND record_id=$2 AND field_name=$3
        AND ($4::text IS NULL OR source_hash<>$4)`,
        [recordType, String(submissionId), fieldName, sourceText.trim() ? digest(sourceText) : null]);
      continue;
    }
    if (!LOCALES.has(locale)) throw Object.assign(Error("Unsupported source language."), { status: 400 });
    await client.query(`INSERT INTO plant_translation_source_language
      (record_type,record_id,field_name,source_hash,source_locale) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(record_type,record_id,field_name) DO UPDATE SET source_hash=EXCLUDED.source_hash,
        source_locale=EXCLUDED.source_locale,updated_at=CURRENT_TIMESTAMP`,
    [recordType, String(submissionId), fieldName, digest(sourceText), locale]);
  }
}

async function promoteSourceLanguages(client, { submissionType, submissionId, recordType, recordId, values, fieldMap }) {
  const stagedType = `__pending_${submissionType}`, detectedType = detectedRecordType(stagedType);
  for (const [selectionKey, fieldName] of Object.entries(fieldMap)) {
    const staged = (await client.query(`SELECT source_hash,source_locale FROM plant_translation_source_language
      WHERE record_type=$1 AND record_id=$2 AND field_name=$3 FOR UPDATE`,
    [stagedType, String(submissionId), fieldName])).rows[0];
    const sourceText = values?.[selectionKey] ?? "";
    const sourceHash = sourceText.trim() ? digest(sourceText) : null;
    const detected = (await client.query(`SELECT source_hash,source_locale FROM plant_translation_source_language
      WHERE record_type=$1 AND record_id=$2 AND field_name=$3 FOR UPDATE`,
    [detectedType, String(submissionId), fieldName])).rows[0];
    if (sourceHash && staged?.source_hash === sourceHash) {
      await syncSourceLanguage(client, { recordType, recordId, fieldName, sourceText, sourceLocale: staged.source_locale });
    } else if (sourceHash && detected?.source_hash === sourceHash) {
      await saveDetectedSource(client, { recordType, recordId, fieldName, sourceHash, locale: detected.source_locale });
    }
    if (detected)
      await client.query("DELETE FROM plant_translation_source_language WHERE record_type=$1 AND record_id=$2 AND field_name=$3",
        [detectedType, String(submissionId), fieldName]);
    if (staged)
      await client.query("DELETE FROM plant_translation_source_language WHERE record_type=$1 AND record_id=$2 AND field_name=$3",
        [stagedType, String(submissionId), fieldName]);
  }
}

module.exports = { LOCALES, FIELDS, digest, normalizeSourceLanguages, syncSourceLanguage, syncSourceLanguages,
  stageSourceLanguages, promoteSourceLanguages, detectedRecordType, saveDetectedSource };
