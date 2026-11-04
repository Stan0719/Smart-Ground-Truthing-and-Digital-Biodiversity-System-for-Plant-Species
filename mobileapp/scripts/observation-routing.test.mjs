import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("Add New Observation uses the backend collection form and carries the selected plant ID", () => {
  const app = source("../App.js");
  const plantDetail = source("../screens/PlantDetail.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(app, /name="AddObservation"\s+component=\{FieldCollectionScreen\}/);
  assert.match(plantDetail, /navigation\.navigate\("AddObservation",\s*\{\s*plantId:\s*plant\.plantId,?\s*\}\)/);
  assert.match(form, /const mode = route\.name/);
  assert.match(form, /plant_id:\s*String\(route\.params\?\.plantId\s*\|\|\s*""\)/);
  assert.doesNotMatch(form, /getPlantById\(/);
  assert.match(form, /`\/plants\/\$\{form\.plant_id\}\/observations`/);
});

test("Edit Observation remains a distinct correction route with its observation ID", () => {
  const app = source("../App.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(app, /name="FieldCollectionEdit"\s+component=\{FieldCollectionScreen\}/);
  assert.match(form, /mode === "FieldCollectionEdit"/);
  assert.match(form, /path:\s*`\/observations\/\$\{observation\.id\}`/);
  assert.match(form, /navigation\.navigate\("FieldCollectionEdit",\s*\{\s*observation:\s*row,\s*plantId:\s*row\.plant_id\s*\}\)/);
});
