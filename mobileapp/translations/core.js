import { createInstance } from "i18next";

export const LANGUAGE_STORAGE_KEY = "niah.ui-language.v1";
export const supportedLanguages = ["en", "ms"];

// No language detector or network backend: English is the first-launch default.
export function createLocalization({ storage, resources, plugins = [] }) {
  const i18n = createInstance();
  for (const plugin of plugins) i18n.use(plugin);
  void i18n.init({
    resources,
    lng: "en",
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  let preferenceVersion = 0;
  let pendingSave = Promise.resolve();
  return {
    i18n,
    async restoreLanguage() {
      const version = preferenceVersion;
      try {
        const saved = await storage.getItem(LANGUAGE_STORAGE_KEY);
        if (version === preferenceVersion && supportedLanguages.includes(saved)) await i18n.changeLanguage(saved);
      } catch { /* A storage failure must not prevent login or change the English default. */ }
    },
    async changeLanguage(language) {
      if (!supportedLanguages.includes(language)) throw Error("Unsupported UI language.");
      preferenceVersion += 1;
      await i18n.changeLanguage(language);
      // Serialize saves so rapid changes cannot persist an older selection last.
      pendingSave = pendingSave.catch(() => {}).then(() => storage.setItem(LANGUAGE_STORAGE_KEY, language));
      await pendingSave;
    },
  };
}

export function flattenTranslations(object, prefix = "") {
  return Object.entries(object).flatMap(([name, value]) => {
    const key = prefix ? `${prefix}.${name}` : name;
    return typeof value === "string" ? [[key, value]] : flattenTranslations(value, key);
  });
}

// Adapt existing UI option values/errors at display time; never mutate API data.
export function createDisplayTranslator(i18n, english) {
  const entries = flattenTranslations(english);
  const exact = new Map(entries.map(([key, value]) => [value, key]));
  const folded = new Map(entries.map(([key, value]) => [value.toLowerCase(), key]));
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = entries.filter(([, value]) => value.includes("{{")).map(([key, value]) => {
    const names = [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    const parts = value.split(/\{\{\w+\}\}/g);
    return { key, names, length: parts.join("").length, expression: new RegExp("^" + parts.map(escape).join("(.*?)") + "$", "s") };
  }).sort((a, b) => b.length - a.length);
  function label(value) {
    if (typeof value !== "string") return value;
    const key = exact.get(value) || folded.get(value.toLowerCase());
    return key ? i18n.t(key, { defaultValue: value }) : value;
  }
  return {
    label,
    message(value) {
      if (typeof value !== "string") return value;
      if (exact.has(value)) return label(value);
      for (const pattern of patterns) {
        const match = value.match(pattern.expression);
        if (!match) continue;
        const values = Object.fromEntries(pattern.names.map((name, index) => [name,
          /status/i.test(name) ? label(match[index + 1]) : match[index + 1],
        ]));
        return i18n.t(pattern.key, values);
      }
      // Unrecognized server text is preserved, not machine-translated.
      return value;
    },
  };
}

export function createFieldValueTranslator(label, english, malay) {
  const controlled = new Set([
    "health", "healthstatus", "growthstage", "lifestage", "category", "plantgroup",
    "status", "syncstatus", "qrstatus", "conservationstatus", "sensitivitylevel",
  ]);
  const normalize = (field) => String(field).replace(/[\s_]/g, "").toLowerCase();
  const malayLabels = new Map(flattenTranslations(malay));
  for (const [key, value] of flattenTranslations(english)) {
    if (controlled.has(normalize(value))) controlled.add(normalize(malayLabels.get(key) || value));
  }
  // Notes, names, descriptions and comments are deliberately excluded.
  return (field, value) => controlled.has(normalize(field)) ? label(value) : value;
}
