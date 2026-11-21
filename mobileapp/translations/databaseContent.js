const MAX_ENTRIES_PER_REQUEST = 25;
const MAX_LOCAL_CACHE_ENTRIES = 500;

function localeForBackend(language) {
  if (language === "ms") return "ms";
  if (language === "zh" || language === "zh-CN") return "zh-CN";
  return null;
}

function sourceKey(field) {
  return JSON.stringify([
    field.recordType,
    String(field.recordId),
    field.fieldName,
    field.sourceText,
  ]);
}

function requestKey(field, locale, accountId) {
  return JSON.stringify([String(accountId || "guest"), locale, sourceKey(field)]);
}

function displayKey(field, locale, accountId) {
  return JSON.stringify([String(accountId || "guest"), locale, sourceKey(field)]);
}

function validField(field) {
  return field &&
    ["species", "observation", "review", "review-comment"].includes(field.recordType) &&
    typeof field.recordId === "string" && field.recordId.length > 0 && field.recordId.length <= 200 &&
    typeof field.fieldName === "string" &&
    typeof field.sourceText === "string" && field.sourceText.trim().length > 0 && field.sourceText.length <= 8000;
}

export function createDatabaseContentTranslator(requestTranslations) {
  const translatedCache = new Map();
  const inFlight = new Map();
  const pendingByScope = new Map();
  const scheduledScopes = new Set();
  function remember(key, value) {
    translatedCache.delete(key);
    translatedCache.set(key, value);
    while (translatedCache.size > MAX_LOCAL_CACHE_ENTRIES)
      translatedCache.delete(translatedCache.keys().next().value);
  }

  function schedule(scope) {
    if (scheduledScopes.has(scope)) return;
    scheduledScopes.add(scope);
    void Promise.resolve().then(() => flush(scope));
  }

  async function flush(scope) {
    scheduledScopes.delete(scope);
    const pending = pendingByScope.get(scope);
    if (!pending?.size) return;
    pendingByScope.delete(scope);
    const items = [...pending.values()];
    for (let offset = 0; offset < items.length; offset += MAX_ENTRIES_PER_REQUEST) {
      const batch = items.slice(offset, offset + MAX_ENTRIES_PER_REQUEST);
      try {
        const response = await requestTranslations(batch[0].locale, batch.map(({ field }) => ({
          recordType: field.recordType,
          recordId: field.recordId,
          fieldName: field.fieldName,
        })), { publicOnly: batch[0].publicOnly });
        const translated = new Map((Array.isArray(response?.translations) ? response.translations : [])
          .filter((item) => item && typeof item.text === "string" && item.text.trim())
          .map((item) => [JSON.stringify([item.recordType, String(item.recordId), item.fieldName]), item.text]));
        for (const item of batch) {
          const resultKey = JSON.stringify([item.field.recordType, String(item.field.recordId), item.field.fieldName]);
          const value = translated.get(resultKey) || null;
          if (value) remember(item.key, value);
          item.resolve(value);
          inFlight.delete(item.key);
        }
      } catch {
        for (const item of batch) {
          item.resolve(null);
          inFlight.delete(item.key);
        }
      }
    }
  }

  async function translateFields(fields, language, accountId = null, { publicOnly = false } = {}) {
    const locale = localeForBackend(language);
    if (!locale || !Array.isArray(fields) || !fields.length) return {};
    const unique = new Map(fields.filter(validField).map((field) => [sourceKey(field), field]));
    const values = await Promise.all([...unique.values()].map((field) => {
      const key = requestKey(field, locale, accountId);
      const cached = translatedCache.get(key);
      if (cached) return Promise.resolve([displayKey(field, locale, accountId), cached]);
      const existing = inFlight.get(key);
      if (existing) return existing.then((value) => [displayKey(field, locale, accountId), value]);

      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      inFlight.set(key, promise);
      const scope = JSON.stringify([String(accountId || "guest"), locale, publicOnly]);
      if (!pendingByScope.has(scope)) pendingByScope.set(scope, new Map());
      pendingByScope.get(scope).set(key, { key, field, locale, publicOnly, resolve });
      schedule(scope);
      return promise.then((value) => [displayKey(field, locale, accountId), value]);
    }));
    return Object.fromEntries(values.filter(([, text]) => typeof text === "string" && text.length > 0));
  }

  function clear() {
    translatedCache.clear();
  }

  return { translateFields, clear };
}

export { displayKey as databaseContentDisplayKey, localeForBackend };
