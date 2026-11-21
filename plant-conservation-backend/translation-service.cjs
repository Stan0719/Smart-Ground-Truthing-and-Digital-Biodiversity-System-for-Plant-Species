"use strict";

const { createHash } = require("node:crypto");
const { permitted } = require("../shared/rbac.cjs");

const MODEL = "translategemma:4b";
const PROMPT_VERSION = "translategemma-prompt-v2";
const TARGETS = Object.freeze({
  ms: { name: "Malaysian Bahasa Melayu", code: "ms" },
  "zh-CN": { name: "Simplified Chinese", code: "zh-Hans" },
});
const MAX_ENTRIES = 25;
const MAX_TEXT_LENGTH = 8000;
const FIELD_ALLOWLIST = Object.freeze({
  species: new Set(["description", "habitat", "culturalSignificance"]),
  observation: new Set(["morphology", "notes"]),
  review: new Set(["comment"]),
  "review-comment": new Set(["comment"]),
});
const RECORD_TYPE_ALIASES = Object.freeze({
  species: ["species"],
  observation: ["observation", "plant-observation"],
  review: ["review", "observation-review"],
  "review-comment": ["review-comment"],
});

const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function diagnostic(event, locale, entry, details = {}) {
  console.info(JSON.stringify({
    event: `website_translation.${event}`,
    locale,
    recordType: entry?.recordType,
    recordId: entry?.recordId,
    fieldName: entry?.fieldName,
    ...details,
  }));
}
function diagnosedError(message) {
  const error = Error(message);
  error.translationDiagnosticLogged = true;
  return error;
}

function protectedMatches(text, knownNames = []) {
  const matches = [];
  const add = (expression) => {
    for (const match of text.matchAll(expression))
      if (match.index !== undefined && match[0])
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  };
  add(/https?:\/\/[^\s<>"']+/giu);
  add(/(?:\b[A-Za-z]:\\|(?:\.\.?[\\/]))[^\s<>"']+/gu);
  add(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gu);
  add(/(?<![\p{L}\p{N}])[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:\s?(?:cm|mm|km|m|kg|mg|g|ha|%|°C|°F|hours?|minutes?|seconds?|years?))?(?![\p{L}\p{N}])/giu);
  add(/\b(?:[A-Z]{2,}[A-Z0-9_-]*\d+[A-Z0-9_-]*|\d+[A-Z]{2,}[A-Z0-9_-]*)\b/gu);
  add(/\b[A-Z]{2,}\b/gu);
  const verifiedNames = knownNames.filter((value) => typeof value === "string" && value.trim());
  const knownGenera = new Set(verifiedNames.flatMap((name) => {
    const genus = /^([A-Z][a-z-]+)(?:\s|$)/u.exec(name.trim())?.[1];
    return genus ? [genus] : [];
  }));
  for (const genus of knownGenera) add(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(genus)}\\s+[a-z][a-z-]+(?![\\p{L}\\p{N}])`, "gu"));
  for (const name of verifiedNames) {
    const expression = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "gu");
    add(expression);
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const selected = [];
  let end = -1;
  for (const match of matches) {
    if (match.start < end) continue;
    selected.push(match);
    end = match.end;
  }
  return selected;
}

async function translateProtectedText(text, target, knownNames, translateChunk) {
  const protectedValues = protectedMatches(text, knownNames);
  const markers = protectedValues.map((_part, index) => `ZXQDBV${index}QXZ`);
  if (markers.some((marker) => text.includes(marker))) throw Error("Protected marker collision.");
  let cursor = 0;
  let staged = "";
  for (let index = 0; index < protectedValues.length; index++) {
    const part = protectedValues[index];
    const marker = markers[index];
    if (!part || !marker) throw Error("Protected value indexing failed.");
    staged += text.slice(cursor, part.start) + marker;
    cursor = part.end;
  }
  staged += text.slice(cursor);
  const translated = await translateChunk(staged, target);
  if (typeof translated !== "string" || !translated.trim()) throw Error("Translation output was empty.");
  let output = translated;
  let lastIndex = -1;
  for (let index = 0; index < protectedValues.length; index++) {
    const marker = markers[index];
    const part = protectedValues[index];
    if (!marker || !part) throw Error("Protected value indexing failed.");
    const position = output.indexOf(marker);
    if (position < 0 || output.indexOf(marker, position + marker.length) >= 0 || position <= lastIndex)
      throw Error("Protected marker validation failed.");
    lastIndex = position;
    output = output.replace(marker, part.text);
  }
  for (const part of protectedValues) {
    if (output.split(part.text).length - 1 !== text.split(part.text).length - 1)
      throw Error("Protected content validation failed.");
  }
  return output;
}

function createTranslationService({
  pool,
  fetchImpl = fetch,
  env = process.env,
  timeoutMs = 90000,
} = {}) {
  if (!pool) throw Error("Translation service requires PostgreSQL.");
  const inFlight = new Map();
  let translationTail = Promise.resolve();
  let namesCache = { expiresAt: 0, values: [] };
  let modelVerified = false;

  const baseUrl = () => {
    const raw = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
    let url;
    try { url = new URL(raw); } catch { throw Error("Invalid Ollama URL."); }
    if (!["http:", "https:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash)
      throw Error("Ollama must use a private loopback endpoint.");
    return url.toString().replace(/\/$/, "");
  };

  async function verifyModel() {
    if (modelVerified) return;
    const response = await fetchImpl(`${baseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Error("Ollama model list is unavailable.");
    const body = await response.json();
    if (!Array.isArray(body.models) || !body.models.some((item) => item?.name === MODEL))
      throw Error(`Installed Ollama model ${MODEL} is unavailable; no download was attempted.`);
    modelVerified = true;
  }

  async function ollamaTranslate(text, target, entry) {
    try {
      await verifyModel();
    } catch {
      diagnostic("ollama_failure", target, entry, { reason: "model_unavailable" });
      throw diagnosedError("Installed Ollama model is unavailable.");
    }
    const targetInfo = TARGETS[target];
    const regional = target === "ms"
      ? "Use standard Malaysian Bahasa Melayu vocabulary and grammar."
      : "Use Simplified Chinese characters and standard Simplified Chinese grammar.";
    const prompt = `You are a professional English (en) to ${targetInfo.name} (${targetInfo.code}) translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to ${targetInfo.name} grammar, vocabulary, and cultural sensitivities. ${regional} Copy every opaque ZXQDBV...QXZ placeholder exactly once without changing or translating it.\nProduce only the ${targetInfo.name} translation, without any additional explanations or commentary. Please translate the following English text into ${targetInfo.name}:\n\n\n${text}`;
    diagnostic("ollama-pending", target, entry, { model: MODEL });
    try {
      const response = await fetchImpl(`${baseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          keep_alive: "2m",
          options: { temperature: 0, num_predict: 2048 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw Error("Ollama translation failed.");
      const body = await response.json();
      const result = body?.message?.content;
      if (typeof result !== "string" || !result.trim()) throw Error("Ollama returned an empty translation.");
      diagnostic("ollama-complete", target, entry, { model: MODEL });
      return result.trim();
    } catch {
      diagnostic("ollama_failure", target, entry, { reason: "request_failed" });
      throw diagnosedError("Ollama translation failed.");
    }
  }

  async function knownTaxonomicNames() {
    if (Date.now() < namesCache.expiresAt) return namesCache.values;
    const result = await pool.query(`
      SELECT scientific_name AS name FROM species WHERE NULLIF(btrim(scientific_name),'') IS NOT NULL
      UNION SELECT genus_name FROM genus WHERE NULLIF(btrim(genus_name),'') IS NOT NULL
      UNION SELECT family_name FROM family WHERE NULLIF(btrim(family_name),'') IS NOT NULL`);
    namesCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      values: result.rows.map((row) => row.name).filter((name) => typeof name === "string"),
    };
    return namesCache.values;
  }

  function visibilityFor(user) {
    if (permitted(user, "plants.protected.read") || user?.role === "Administrator")
      return ["public", "internal", "protected"];
    if (permitted(user, "plants.scientific.read")) return ["public", "internal"];
    if (permitted(user, "plants.catalogue.read")) return ["public"];
    return [];
  }

  async function resolveSource(entry, user) {
    const { recordType, recordId, fieldName } = entry;
    if (!FIELD_ALLOWLIST[recordType]?.has(fieldName)) return null;
    if (recordType === "species") {
      if (!/^[1-9][0-9]{0,18}$/.test(recordId)) return null;
      const scientificRead = permitted(user, "plants.scientific.read") || user?.role === "Administrator";
      if (fieldName === "culturalSignificance" && !scientificRead) return null;
      if (fieldName === "habitat" && user && !scientificRead) return null;
      const expression = fieldName === "description" ? "s.description" : "s.rbac_data ->> $3";
      const values = fieldName === "description"
        ? [recordId, visibilityFor(user)]
        : [recordId, visibilityFor(user), fieldName];
      const result = await pool.query(`SELECT s.species_id::text AS id,to_jsonb(s)->>'revision' AS source_version,${expression} AS source_text
        FROM species s LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        WHERE s.species_id=$1 AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
          AND COALESCE(v.visibility,'protected')=ANY($2::text[])`, values);
      return result.rows[0] || null;
    }
    if (recordType === "observation") {
      if (!/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(recordId)) return null;
      const staff = permitted(user, "plants.scientific.read") || permitted(user, "plants.protected.read") || user?.role === "Administrator";
      if (fieldName === "notes" && !staff) return null;
      const result = await pool.query(`SELECT o.id, o.revision::text AS source_version, o.content->>$2 AS source_text
        FROM plant_observation o
        JOIN plant_record p ON p.plant_id=o.plant_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
        WHERE o.id=$1 AND ((o.status='Approved' AND COALESCE(v.visibility,'protected')=ANY($3::text[])) OR $4::boolean)
          AND o.content->>$2 IS NOT NULL`, [recordId, fieldName, visibilityFor(user), staff && (permitted(user, "plants.protected.read") || user?.role === "Administrator")]);
      return result.rows[0] || null;
    }
    if (recordType === "review") {
      if (!permitted(user, "observations.review")) return null;
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(recordId)) return null;
      const result = await pool.query(`SELECT r.id, r.id::text AS source_version, r.comment AS source_text
        FROM observation_review r WHERE r.id=$1 AND NULLIF(btrim(r.comment),'') IS NOT NULL`, [recordId]);
      return result.rows[0] || null;
    }
    if (recordType === "review-comment") {
      if (!permitted(user, "observations.review")) return null;
      if (!/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(recordId)) return null;
      const result = await pool.query(`SELECT r.id, r.id::text AS source_version, r.comment AS source_text
        FROM observation_review r JOIN plant_observation o ON o.id=r.observation_id
        WHERE r.observation_id=$1 AND NULLIF(btrim(r.comment),'') IS NOT NULL
        ORDER BY r.created_at DESC,r.id DESC LIMIT 1`, [recordId]);
      return result.rows[0] || null;
    }
    return null;
  }

  const typeAliases = (entry) => RECORD_TYPE_ALIASES[entry.recordType] || [entry.recordType];

  async function cached(entry, sourceText, targetLocale, sourceHash) {
    const result = await pool.query(`SELECT translated_text,source_locale,source_hash
      FROM plant_translation_cache
      WHERE record_type=ANY($1::text[]) AND record_id=$2 AND field_name=$3
        AND target_locale=$4 AND source_hash=$5 AND model_name=$6
      ORDER BY CASE WHEN record_type=$7 THEN 0 ELSE 1 END LIMIT 1`,
    [typeAliases(entry), entry.recordId, entry.fieldName, targetLocale, sourceHash, MODEL, entry.recordType]);
    const value = result.rows[0];
    if (!value || value.source_locale !== "en" || typeof value.translated_text !== "string" || !value.translated_text.trim()) return null;
    const names = await knownTaxonomicNames();
    const protectedValues = protectedMatches(sourceText, names).map((part) => part.text);
    let cursor = 0;
    for (const token of protectedValues) {
      const position = value.translated_text.indexOf(token, cursor);
      if (sourceText.split(token).length !== value.translated_text.split(token).length || position < 0) {
        diagnostic("validation-failure", targetLocale, entry, { reason: "cached_protected_value_integrity" });
        return null;
      }
      cursor = position + token.length;
    }
    return value.translated_text;
  }

  async function sourceLocale(entry, sourceHash) {
    const result = await pool.query(`SELECT record_type,source_locale FROM plant_translation_source_language
      WHERE record_type=ANY($1::text[]) AND record_id=$2 AND field_name=$3 AND source_hash=$4
      ORDER BY CASE WHEN record_type=$5 THEN 0 ELSE 1 END LIMIT 1`,
    [typeAliases(entry), entry.recordId, entry.fieldName, sourceHash, entry.recordType]);
    const row = result.rows[0];
    return row && ["en", "ms", "zh-CN"].includes(row.source_locale)
      ? { locale: row.source_locale, recordType: row.record_type }
      : null;
  }

  async function translateOne(entry, targetLocale, user) {
    const source = await resolveSource(entry, user);
    if (!source || typeof source.source_text !== "string" || !source.source_text.trim() || source.source_text.length > MAX_TEXT_LENGTH) {
      diagnostic("source-skip", targetLocale, entry, { reason: "not_found_not_visible_or_empty" });
      return null;
    }
    const sourceHash = digest(source.source_text);
    if ((entry.sourceHash !== undefined && entry.sourceHash !== sourceHash) ||
        (entry.sourceVersion !== undefined && entry.sourceVersion !== source.source_version)) return null;
    const storedEntry = entry.recordType === "review-comment"
      ? { recordType: "review", recordId: String(source.id), fieldName: entry.fieldName }
      : { ...entry, recordId: String(source.id ?? entry.recordId) };
    const key = [storedEntry.recordType, storedEntry.recordId, entry.fieldName, targetLocale, sourceHash].join("\u0000");
    if (inFlight.has(key)) {
      diagnostic("translation-pending", targetLocale, entry, { state: "coalesced" });
      return inFlight.get(key);
    }
    const task = (async () => {
      const cachedValue = await cached(storedEntry, source.source_text, targetLocale, sourceHash);
      if (cachedValue) {
        diagnostic("cache-hit", targetLocale, entry, { model: MODEL });
        return cachedValue;
      }
      diagnostic("cache-miss", targetLocale, entry);
      const sourceInfo = await sourceLocale(storedEntry, sourceHash);
      if (!sourceInfo) {
        diagnostic("metadata-skip", targetLocale, entry, { reason: "missing_or_source_hash_mismatch" });
        return null;
      }
      if (sourceInfo.locale !== "en") {
        diagnostic("metadata-skip", targetLocale, entry, { reason: "unsupported_source_locale", sourceLocale: sourceInfo.locale });
        return null;
      }
      const names = await knownTaxonomicNames();
      const work = translationTail.then(() => translateProtectedText(
        source.source_text,
        targetLocale,
        names,
        (text, target) => ollamaTranslate(text, target, entry),
      ));
      translationTail = work.catch(() => {});
      diagnostic("translation-pending", targetLocale, entry, { state: "queued" });
      let translatedText;
      try {
        translatedText = await work;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/Protected|marker|collision|indexing/i.test(message))
          diagnostic("validation-failure", targetLocale, entry, { reason: "protected_value_validation" });
        if (/Protected|marker|collision|indexing/i.test(message) && error instanceof Error)
          error.translationDiagnosticLogged = true;
        throw error;
      }
      if (translatedText.length > MAX_TEXT_LENGTH * 2) throw Error("Translation output exceeded its limit.");
      await pool.query(`INSERT INTO plant_translation_cache
        (record_type,record_id,field_name,source_locale,target_locale,source_hash,translated_text,model_name,prompt_version)
        VALUES($1,$2,$3,'en',$4,$5,$6,$7,$8)
        ON CONFLICT(record_type,record_id,field_name,target_locale) DO UPDATE SET
          source_locale=EXCLUDED.source_locale,source_hash=EXCLUDED.source_hash,
          translated_text=EXCLUDED.translated_text,model_name=EXCLUDED.model_name,
          prompt_version=EXCLUDED.prompt_version,updated_at=CURRENT_TIMESTAMP`,
      [sourceInfo.recordType, storedEntry.recordId, entry.fieldName, targetLocale, sourceHash, translatedText, MODEL, PROMPT_VERSION]);
      diagnostic("cache-saved", targetLocale, entry, { model: MODEL });
      return translatedText;
    })();
    inFlight.set(key, task);
    try { return await task; }
    finally { if (inFlight.get(key) === task) inFlight.delete(key); }
  }

  async function translateEntries(entries, targetLocale, user) {
    if (!Object.hasOwn(TARGETS, targetLocale)) throw Error("Unsupported translation locale.");
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw Error("Invalid translation request.");
    const unique = new Map();
    for (const entry of entries) {
      if (!entry || !Object.keys(entry).every((key) => ["recordType", "recordId", "fieldName", "sourceHash", "sourceVersion"].includes(key)) ||
          typeof entry.recordType !== "string" || typeof entry.recordId !== "string" ||
          typeof entry.fieldName !== "string" || !FIELD_ALLOWLIST[entry.recordType]?.has(entry.fieldName))
        throw Error("Unsupported translation field.");
      if ((entry.sourceHash !== undefined && (typeof entry.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.sourceHash))) ||
          (entry.sourceVersion !== undefined && (typeof entry.sourceVersion !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(entry.sourceVersion)))) throw Error("Invalid translation source binding.");
      const key = [entry.recordType, entry.recordId, entry.fieldName, entry.sourceHash || "", entry.sourceVersion || ""].join("\u0000");
      unique.set(key, entry);
    }
    const results = [];
    for (const entry of unique.values()) {
      try {
        const translated = await translateOne(entry, targetLocale, user);
        if (translated) results.push({ ...entry, text: translated });
      } catch (error) {
        const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined;
        if (!error?.translationDiagnosticLogged)
          diagnostic(code ? "database-failure" : "translation-failure", targetLocale, entry, code ? { code } : { reason: "processing_failed" });
        // A failed translation leaves the original visible in the website.
      }
    }
    return results;
  }

  return { translateEntries, verifyModel, digest };
}

function mountWebsiteTranslations(app, { pool, allow, origins }) {
  const service = createTranslationService({ pool });
  app.post("/api/website/translations", allow("plants.catalogue.read"), async (req, res) => {
    const origin = req.headers.origin;
    if (!origin || !origins?.has(origin) || req.headers.authorization) {
      diagnostic("request-rejected", undefined, undefined, { reason: !origin ? "missing_origin" : !origins?.has(origin) ? "origin_not_allowed" : "authorization_header_present" });
      return res.status(403).json({ error: "Website translation request rejected." });
    }
    const { locale, entries } = req.body || {};
    if (!Object.hasOwn(TARGETS, locale) || !Array.isArray(entries) || entries.length > MAX_ENTRIES)
      return res.status(400).json({ error: "Invalid translation request." });
    diagnostic("request-accepted", locale, undefined, { entries: entries.map((entry) => ({ recordType: entry?.recordType, recordId: entry?.recordId, fieldName: entry?.fieldName })) });
    try {
      const translations = await service.translateEntries(entries, locale, req.user);
      diagnostic("request-complete", locale, undefined, { requested: entries.length, returned: translations.length });
      return res.json({ locale, translations });
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined;
      diagnostic("request-failure", locale, undefined, code ? { code } : { reason: "processing_failed" });
      return res.json({ locale, translations: [] });
    }
  });
  return service;
}

module.exports = {
  MODEL,
  PROMPT_VERSION,
  FIELD_ALLOWLIST,
  protectedMatches,
  translateProtectedText,
  createTranslationService,
  mountWebsiteTranslations,
};
