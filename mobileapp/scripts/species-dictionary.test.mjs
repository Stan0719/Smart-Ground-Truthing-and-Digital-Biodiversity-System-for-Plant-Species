import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../", import.meta.url);

function loadCore(plantApi = async () => ({ results: [] })) {
  const source = readFileSync(new URL("utils/speciesDictionary.js", root), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: () => ({ plantApi }), encodeURIComponent, Error });
  return module.exports;
}

test("search parses mocked results, sends only encoded text, and handles empty or failed responses", async () => {
  let requestedPath;
  const result = { id: 9, scientificName: "Capsicum annuum", commonName: "chili pepper", rank: "species", family: "Solanaceae", description: "", sourceName: "iNaturalist", sourceUrl: "https://www.inaturalist.org/taxa/9" };
  const { searchSpeciesDictionary } = loadCore(async (path) => { requestedPath = path; return { results: [result] }; });
  assert.deepEqual(JSON.parse(JSON.stringify(await searchSpeciesDictionary(" Capsicum annuum "))), [result]);
  assert.equal(requestedPath, "/species-dictionary?q=Capsicum%20annuum");
  assert.deepEqual(await loadCore().searchSpeciesDictionary("Capsicum"), []);
  await assert.rejects(loadCore(async () => { throw new Error("offline"); }).searchSpeciesDictionary("Capsicum"), /offline/);
  await assert.rejects(searchSpeciesDictionary("x"), /Invalid search text/);
});

test("Add Plant result reviews list only mapped values and scientific fields are italicized", () => {
  const { planSpeciesFieldUpdates, speciesReviewRows } = loadCore();
  const fields = {
    plantScientificName: { value: "", label: "Plant Scientific Name *" },
    speciesScientificName: { value: "", label: "Species Scientific Name *" },
    speciesCommonName: { value: "", label: "Species Common Name *" },
    speciesGenus: { value: "", label: "Genus *" },
    speciesFamily: { value: "", label: "Family *" },
  };
  const rows = speciesReviewRows(planSpeciesFieldUpdates({ scientificName: "Capsicum annuum", commonName: "chili pepper", family: "Solanaceae" }, fields));
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { key: "plantScientificName", label: "Plant Scientific Name *", value: "Capsicum annuum", current: "", italic: true },
    { key: "speciesScientificName", label: "Species Scientific Name *", value: "Capsicum annuum", current: "", italic: true },
    { key: "speciesCommonName", label: "Species Common Name *", value: "chili pepper", current: "", italic: false },
    { key: "speciesGenus", label: "Genus *", value: "Capsicum", current: "", italic: true },
    { key: "speciesFamily", label: "Family *", value: "Solanaceae", current: "", italic: false },
  ]);
});

test("cancel preserves manual values; applying or replacing changes only compatible species fields", () => {
  const { planSpeciesFieldUpdates, commitSpeciesReview } = loadCore();
  const state = { plantScientificName: "My plant name", speciesScientificName: "", speciesCommonName: "", speciesGenus: "", speciesFamily: "", plantId: "P-9", height: "70", health: "Healthy", lifeStage: "Mature", morphology: "Tree", latitude: "4.3", longitude: "102", zone: "North", photo: "leaf.jpg", observation: "flowering" };
  const fields = Object.fromEntries(["plantScientificName", "speciesScientificName", "speciesCommonName", "speciesGenus", "speciesFamily"].map((key) => [key, { value: state[key], label: key, setValue: (value) => { state[key] = value; } }]));
  const suggestion = { scientificName: "Capsicum annuum", commonName: "chili pepper", family: "Solanaceae" };
  const plantOnly = planSpeciesFieldUpdates(suggestion, { plantScientificName: fields.plantScientificName });
  const before = { ...state };
  commitSpeciesReview(plantOnly, fields, { confirmed: false, replace: true });
  assert.deepEqual(state, before, "Cancel makes no changes");
  commitSpeciesReview(plantOnly, fields, { confirmed: true, replace: false });
  assert.equal(state.plantScientificName, "My plant name", "unconfirmed existing text is preserved");
  commitSpeciesReview(plantOnly, fields, { confirmed: true, replace: true });
  assert.equal(state.plantScientificName, "Capsicum annuum", "replacement occurs after explicit confirmation");

  const requestFields = Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith("species")));
  const requestPlan = planSpeciesFieldUpdates(suggestion, requestFields);
  commitSpeciesReview(requestPlan, requestFields, { confirmed: true });
  assert.equal(state.speciesScientificName, "Capsicum annuum");
  assert.equal(state.speciesCommonName, "chili pepper");
  assert.equal(state.speciesGenus, "Capsicum");
  assert.equal(state.speciesFamily, "Solanaceae");
  for (const key of ["plantId", "height", "health", "lifeStage", "morphology", "latitude", "longitude", "zone", "photo", "observation"]) assert.equal(state[key], before[key]);
});

test("Add Plant exposes the modal dictionary by the plant name field; Add Species stays on its current flow", () => {
  const addPlant = readFileSync(new URL("screens/AddPlant.js", root), "utf8");
  const addSpecies = readFileSync(new URL("screens/AddSpeciesRequest.js", root), "utf8");
  const component = readFileSync(new URL("components/SpeciesDictionary.js", root), "utf8");
  assert.match(addPlant, /<SpeciesDictionary reviewPresentation="modal" fields=\{\{[\s\S]*plantScientificName:[\s\S]*showSpeciesForm[\s\S]*speciesScientificName:[\s\S]*speciesCommonName:[\s\S]*speciesGenus:[\s\S]*speciesFamily:/);
  assert.match(addSpecies, /<SpeciesDictionary fields=/);
  assert.doesNotMatch(addSpecies, /reviewPresentation=/);
  assert.match(component, /<Modal[\s\S]*onRequestClose=\{cancelReview\}/);
  assert.match(component, /<ScrollView[\s\S]*dialogContent/);
  assert.match(component, /speciesDictionary\.apply/);
  assert.match(component, /speciesDictionary\.replaceExisting/);
  assert.match(component, /item\.commonName/);
  assert.match(component, /item\.scientificName/);
  assert.match(component, /item\.sourceUrl/);
});

test("dictionary and review translations exist for English, Malay and Simplified Chinese", () => {
  const keys = ["title", "helper", "placeholder", "search", "loading", "empty", "error", "rateLimited", "family", "rank", "description", "source", "use", "attribution", "reviewTitle", "reviewMessage", "fillEmpty", "apply", "applyListedFields", "replaceExisting", "noFieldsTitle", "noFields"];
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(readFileSync(new URL(`translations/${language}.json`, root), "utf8"));
    for (const key of keys) assert.equal(typeof translations.speciesDictionary[key], "string", `${language}.speciesDictionary.${key}`);
  }
});

test("Add Plant dictionary bounds nested results and presents a botanical review dialog", () => {
  const component = readFileSync(new URL("components/SpeciesDictionary.js", root), "utf8");
  assert.match(component, /card: \{ backgroundColor: "#F0F7EF"/);
  assert.match(component, /searchRow: \{[^\n]*backgroundColor: "#FFFFFF"/);
  assert.match(component, /result: \{ backgroundColor: "#FFFFFF"/);
  assert.match(component, /<ScrollView ref=\{resultsScroll\} nestedScrollEnabled/);
  assert.match(component, /maxHeight: Math\.min\(height \* 0\.45, 370\)/);
  assert.match(component, /resultsScroll\.current\?\.scrollTo\(\{ y: 0, animated: false \}\)/);
  assert.match(component, /onRequestClose=\{cancelReview\}/);
  assert.match(component, /<Pressable[^\n]*onPress=\{cancelReview\}/);
  assert.match(component, /onPress=\{confirmReview\}/);
  assert.match(component, /row\.key === "plantScientificName" && dialogStyles\.primaryRow/);
});
