"use strict";

// These are evidence rules for catalogue prose, not probabilities or human verification.
const ENGLISH_GRAMMAR = new Set("a an and are at by for from in is near of on or the this those to under with".split(" "));
const ENGLISH_PROSE = new Set("areas bark bears branches branching broad breathing canopy climate climbing coastal coastlines cones contains crown dense develops dipterocarp found flowers flowering foliage forest forests forming fronds fruits green grow growing grows habitat habitats large leathery leaves limestone lowland mangrove margins moist muddy narrow oval plant plants roots round shaded sheltered shrub slopes small soil soils stem stems tall thick tidal tree trees tropical trunk upright vegetation wet wetlands woody young".split(" "));
const MALAY_GRAMMAR = new Set("atau bagi dalam dan dari dengan di ialah ini itu pada seperti untuk yang".split(" "));
const MALAY_PROSE = new Set("akar batang berdaun berdekatan berbunga besar bukit danau daun ditemui duri habitat hijau hutan kawasan kecil lembap mempunyai menjalar pokok rawa tebal teduh tinggi tropika tumbuh tumbuhan".split(" "));
const MALAY_REGIONAL = new Set("berdekatan ditemui lembap mempunyai menjalar pokok teduh tropika".split(" "));
const OTHER_LANGUAGE = /\b(?:adalah|berada|berasal|ditemukan|merupakan|pepohonan|tanaman|tropis|tumbuhannya|avec|dans|und|mit|eine|einer|bosque|hojas|selva|folhas|della)\b/u;
const TRADITIONAL = /[葉樹長環濕綠莖種這於邊陰熱帶開與紅區廣棲顏無風細間類]/u;
const SIMPLIFIED = /[叶树长环湿绿茎种这边阴热带开与红区广栖颜无风细间类]/u;
const CHINESE_PROSE = /(?:植物|生长|森林|叶片|树木|根系|花朵|开花|潮湿|湿润|红树林|栖息|树干|枝条|灌木|攀援|分布|河岸|土壤|适合|常见|具有|颜色|叶子)/gu;
const uniqueHits = (words, vocabulary) => new Set(words.filter(word => vocabulary.has(word))).size;

function detectSourceLanguage(source) {
  if (typeof source !== "string" || source.length > 8000) return null;
  const text = source.normalize("NFC").replace(/https?:\/\/\S+|\b[A-Z]{2,8}[-_]?\d[\w-]*\b/g, " ").trim();
  const letters = text.match(/\p{L}/gu) || [];
  const han = text.match(/\p{Script=Han}/gu) || [];
  if (han.length) {
    const terms = new Set(text.match(CHINESE_PROSE) || []);
    return han.length >= 8 && han.length === letters.length && !TRADITIONAL.test(text) &&
      SIMPLIFIED.test(text) && terms.size >= 2 ? "zh-CN" : null;
  }
  if (letters.some(char => !/\p{Script=Latin}/u.test(char))) return null;
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z]+/g) || [];
  if (words.length < 5 || OTHER_LANGUAGE.test(lower) || /[^\x00-\x7f]/u.test(letters.join(""))) return null;
  const en = uniqueHits(words, ENGLISH_GRAMMAR);
  const ms = uniqueHits(words, MALAY_GRAMMAR);
  const englishTerms = uniqueHits(words, ENGLISH_PROSE);
  const malayTerms = uniqueHits(words, MALAY_PROSE);
  // Words shared across the two languages (such as habitat) do not veto either.
  const malayOnly = words.some(word => MALAY_PROSE.has(word) && !ENGLISH_PROSE.has(word));
  const englishOnly = words.some(word => ENGLISH_PROSE.has(word) && !MALAY_PROSE.has(word));
  if (en >= 1 && englishTerms >= (en >= 2 ? 2 : 4) && !ms && !malayOnly) return "en";
  if (ms >= 2 && malayTerms >= 2 && uniqueHits(words, MALAY_REGIONAL) >= 2 && !en && !englishOnly) return "ms";
  return null;
}

module.exports = { detectSourceLanguage };
