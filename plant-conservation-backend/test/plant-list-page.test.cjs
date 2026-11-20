const test = require("node:test");
const assert = require("node:assert/strict");
const { publicPlantPageOptions, publicPlantPageMetadata, readPlantSpeciesCounts } = require("../plant-list-page.cjs");

test("Species count query applies catalogue visibility and counts approved plants without the list cap or media joins", async () => {
  const rows = [{ species_id: 8, count: 501 }];
  const result = await readPlantSpeciesCounts({ query: async (sql, params) => {
    assert.deepEqual(params, [["public"], false]);
    assert.match(sql, /p\.rbac_status='Approved'/);
    assert.match(sql, /COALESCE\(v\.visibility,'protected'\) = ANY\(\$1::text\[\]\)/);
    assert.match(sql, /\$2::boolean OR COALESCE\(s\.rbac_data->>'approvalStatus','Approved'\)='Approved'/);
    assert.match(sql, /GROUP BY p\.species_id/i);
    assert.doesNotMatch(sql, /\bLIMIT\b|plant_asset|plant_observation/i);
    return { rows };
  } }, ["public"], false);
  assert.deepEqual(result, rows);
});

test("Plant list callers that omit page size keep the existing response contract", () => {
  assert.equal(publicPlantPageOptions({}, true), null);
  assert.equal(publicPlantPageOptions({ scope: "mine" }, false), null);
  assert.equal(publicPlantPageOptions({ scope: "public-web" }, false), null);
});

test("public Plant pagination accepts only a bounded page with valid species and continuation IDs", () => {
  const query = { species_id: "6", page_size: "20" };
  assert.deepEqual(publicPlantPageOptions(query, true), { speciesId: "6", before: null, limit: 20 });
  assert.deepEqual(publicPlantPageOptions({ ...query, before_plant_id: "42" }, true),
    { speciesId: "6", before: "42", limit: 20 });
  for (const invalid of [
    { species_id: undefined }, { species_id: "0" }, { page_size: "51" }, { page_size: ["20"] },
    { before_plant_id: "2147483648" }, { before_plant_id: "1 OR 1=1" },
  ]) assert.throws(() => publicPlantPageOptions({ ...query, ...invalid }, true), { status: 400 });
  assert.throws(() => publicPlantPageOptions(query, false), { status: 400 });
});

test("Plant continuation uses the last returned ID and stops on a short or exact final page", () => {
  const rows = [12, 7, 1].map((plant_id) => ({ plant_id }));
  assert.deepEqual(publicPlantPageMetadata(rows, 2), { limit: 2, has_more: true, next_cursor: "7" });
  assert.deepEqual(publicPlantPageMetadata(rows, 3), { limit: 3, has_more: false, next_cursor: null });
  assert.deepEqual(publicPlantPageMetadata(rows, 20), { limit: 20, has_more: false, next_cursor: null });
});
