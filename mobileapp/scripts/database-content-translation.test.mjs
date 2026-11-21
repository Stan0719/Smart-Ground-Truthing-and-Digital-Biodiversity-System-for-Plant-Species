import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../", import.meta.url);

function loadTranslator(request) {
  const source = readFileSync(new URL("translations/databaseContent.js", root), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Promise, Map, Set, JSON, String, Array });
  return module.exports.createDatabaseContentTranslator(request);
}

const speciesFields = [
  { recordType: "species", recordId: "19", fieldName: "description", sourceText: "Very small but fragile" },
  { recordType: "species", recordId: "19", fieldName: "habitat", sourceText: "Flat landscape" },
];

test("English makes no request; Malay and Chinese use supported backend locale codes", async () => {
  const calls = [];
  const translator = loadTranslator(async (locale, entries) => {
    calls.push({ locale, entries });
    return { translations: entries.map((entry) => ({ ...entry, text: `localized:${entry.fieldName}` })) };
  });
  assert.equal(Object.keys(await translator.translateFields(speciesFields, "en", "user-1")).length, 0);
  const ms = await translator.translateFields(speciesFields, "ms", "user-1");
  assert.equal(ms[JSON.stringify(["user-1", "ms", JSON.stringify(["species", "19", "description", "Very small but fragile"])])], "localized:description");
  const zh = await translator.translateFields([speciesFields[0]], "zh", "user-1");
  assert.equal(Object.values(zh)[0], "localized:description");
  assert.deepEqual(calls.map((call) => call.locale), ["ms", "zh-CN"]);
  assert.ok(calls.every((call) => call.entries.every((entry) => !Object.hasOwn(entry, "sourceText"))));
});

test("same-language fields batch together, deduplicate, and reuse successful results", async () => {
  let requests = 0;
  const translator = loadTranslator(async (_locale, entries) => {
    requests += 1;
    return { translations: entries.map((entry) => ({ ...entry, text: `translated:${entry.fieldName}` })) };
  });
  const [first, duplicate] = await Promise.all([
    translator.translateFields(speciesFields, "ms", "botanist-1"),
    translator.translateFields([speciesFields[0], speciesFields[0]], "ms", "botanist-1"),
  ]);
  assert.equal(requests, 1);
  assert.equal(Object.values(duplicate)[0], "translated:description");
  const cached = await translator.translateFields(speciesFields, "ms", "botanist-1");
  assert.deepEqual(cached, first);
  assert.equal(requests, 1);
});

test("new fields join a later batch without cancelling an active request", async () => {
  const completions = [];
  const translator = loadTranslator((locale, entries) => new Promise((resolve) => {
    completions.push(() => resolve({ translations: entries.map((entry) => ({ ...entry, text: `${locale}:${entry.fieldName}` })) }));
  }));
  const first = translator.translateFields([speciesFields[0]], "ms", "user-1");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completions.length, 1);
  const second = translator.translateFields([speciesFields[1]], "ms", "user-1");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completions.length, 2);
  completions[1]();
  completions[0]();
  assert.equal(Object.values(await first)[0], "ms:description");
  assert.equal(Object.values(await second)[0], "ms:habitat");
});

test("failed or empty translations fail soft and preserve original-value fallback", async () => {
  const translator = loadTranslator(async () => { throw Error("offline"); });
  assert.equal(Object.keys(await translator.translateFields(speciesFields, "ms", "user-1")).length, 0);
  const empty = loadTranslator(async () => ({ translations: [] }));
  assert.equal(Object.keys(await empty.translateFields(speciesFields, "zh", "user-1")).length, 0);
});

test("source edits and account changes do not reuse a different local display cache", async () => {
  const translator = loadTranslator(async (_locale, entries) => ({
    translations: entries.map((entry) => ({ ...entry, text: `cached:${entry.recordId}` })),
  }));
  const initial = await translator.translateFields([speciesFields[0]], "ms", "user-1");
  const changed = await translator.translateFields([{ ...speciesFields[0], sourceText: "A different source" }], "ms", "user-1");
  const otherAccount = await translator.translateFields([speciesFields[0]], "ms", "user-2");
  assert.notDeepEqual(changed, initial);
  assert.notDeepEqual(otherAccount, initial);
});

test("species detail passes its public-only authorization mode to database translation", () => {
  const detail = readFileSync(new URL("screens/SpeciesDetail.js", root), "utf8");
  const knowledge = readFileSync(new URL("screens/PersistentKnowledge.js", root), "utf8");
  assert.match(detail, /const publicOnly = !user \|\| isGuest \|\| isVisitor/);
  assert.match(detail, /\["commonName", "description", "habitat", "culturalSignificance"\]/);
  assert.match(detail, /\{speciesText\("commonName"\)\}/);
  assert.match(detail, /useDatabaseTranslations\(speciesTranslationFields,\s*\{\s*accountId: user\?\.id \?\? null,\s*publicOnly,/s);
  assert.match(knowledge, /useDatabaseTranslations\(speciesTranslationFields,\s*\{\s*accountId: user\?\.id \?\? null,\s*publicOnly: !can\(user, "plants\.scientific\.read"\),/s);
  assert.match(knowledge, /fieldName: "commonName", sourceText: item\.common_name/);
  assert.match(knowledge, /\{speciesCommonName\(s\)\}/);
});

test("plant detail keeps hooks unconditional and passes translation lookup into observation history cards", () => {
  const detail = readFileSync(new URL("screens/PlantDetail.js", root), "utf8");
  const hookPosition = detail.indexOf("const translatedDatabaseText = useDatabaseTranslations(");
  const loadingReturnPosition = detail.indexOf("if (loading && !plant)");
  assert.ok(hookPosition >= 0 && hookPosition < loadingReturnPosition, "translation hook must run before loading and not-found returns");
  assert.match(detail, /<ObservationCard[\s\S]*?translateObservationText=\{observationText\}/);
  assert.match(detail, /fieldName: "commonName", sourceText: speciesCommonNameForTranslation/);
  assert.match(detail, /translatedSpeciesCommonName/);
  const card = detail.slice(detail.indexOf("export function ObservationCard"), detail.indexOf("function ObservationPhotos"));
  assert.match(card, /translateObservationText\?\.\(observation, "morphology"\)/);
  assert.match(card, /translateObservationText\?\.\(observation, "notes"\)/);
  assert.doesNotMatch(card, /\bobservationText\(/, "child component must not call a parent-scoped helper");
});

test("database translation hook is unconditional across screen loading and role branches", () => {
  const hook = readFileSync(new URL("hooks/useDatabaseTranslations.js", root), "utf8");
  assert.match(hook, /export default function useDatabaseTranslations\(/);
  for (const call of ["useAppTranslation()", "useMemo(() =>", "useState({})", "useEffect(() =>"])
    assert.equal(hook.split(call).length - 1, 1, `${call} must be called once at the hook's top level`);
  assert.ok(hook.indexOf("useEffect(() =>") < hook.indexOf("if (!locale)"), "locale branching must remain inside the effect");

  const screenChecks = [
    ["screens/PlantDetail.js", "const translatedDatabaseText = useDatabaseTranslations(", "if (loading && !plant)"],
    ["screens/SpeciesDetail.js", "const translatedSpeciesText = useDatabaseTranslations(", "if (!selectedSpecies)"],
    ["screens/PersistentKnowledge.js", "const translatedSpeciesText = useDatabaseTranslations(", "if (map)"],
    ["components/PlantCard.js", "const translatedDatabaseText = useDatabaseTranslations(", "if (speciesDetailCard)"],
  ];
  for (const [path, hookCall, conditionalBranch] of screenChecks) {
    const source = readFileSync(new URL(path, root), "utf8");
    const hookPosition = source.indexOf(hookCall);
    const branchPosition = source.indexOf(conditionalBranch);
    assert.ok(hookPosition >= 0 && branchPosition > hookPosition, `${path}: translation hook must run before conditional render paths`);
  }
});
