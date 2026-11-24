"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { useVerifiedPhotoKeyTypes } = require("./species-photo-bigint-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { detectSourceLanguage } = require("../translation-language-detection.cjs");
const { digest, stageSourceLanguages, promoteSourceLanguages } = require("../translation-source-language.cjs");

const description = "This plant has broad green leaves and grows near the river.";
const habitat = "It grows on wet slopes under a canopy of tropical trees.";
const malay = "Pokok ini mempunyai daun hijau dan tumbuh di hutan tropika.";
const chinese = "这种植物生长在潮湿的森林里，叶片呈绿色。";
const examples = {
  en: [description, habitat, "Slender trees with narrow leaves and upright branches.", "Tidal mangrove areas and newly deposited muddy substrates."],
  ms: [malay, "Tumbuhan menjalar ini ditemui di kawasan yang lembap.", "Daun pokok ini tumbuh di kawasan teduh dan lembap."],
  "zh-CN": [chinese, "这种灌木的叶子呈红色，在潮湿的河岸很常见。", "红树林的根系适合在潮湿土壤中生长。"],
  uncertain: ["Flat landscape", "Nepenthes rafflesiana", "PL-002 19.5 cm", "A forest with foliage dan daun hijau.",
    "This plant grows in the 森林 with green leaves.", "這種植物生長於潮濕的森林中。", "植物は森林に生育する。",
    "Tanaman ini memiliki daun hijau dan tumbuh di hutan tropis.", "Verified.", "Daun hijau"],
};
test("language evidence and abstention on botanical samples", () => {
  for (const [locale, samples] of Object.entries(examples))
    for (const sample of samples)
      assert.equal(detectSourceLanguage(sample), locale === "uncertain" ? null : locale, sample);
});

test("shared translation flow preserves provenance, authorization, hash binding and cache in disposable PostgreSQL", async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(readFileSync(join(__dirname, "../migrations/032-translation-storage.sql"), "utf8"));
  await useVerifiedPhotoKeyTypes(pool);
  const officer = { id: "fixture-officer", role: "Conservation Officer", status: "Active", mustChangePassword: false };
  const token = "a".repeat(64);
  const origin = "http://localhost:5173";
  const inference = process.env.TEST_LOCAL_TRANSLATEGEMMA === "1";
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith(":11434/api/chat")) calls.push(JSON.parse(options.body).model);
    if (url.endsWith(":11434/api/tags") && !inference) return Response.json({ models: [{ name: "translategemma:4b" }] });
    if (url.endsWith(":11434/api/chat") && !inference) {
      return Response.json({ message: { content: options.body.includes("Simplified Chinese") ? chinese : malay } });
    }
    return originalFetch(input, options);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = previousUrl;
  });
  const server = createPlantApp({ pool, auth: { session: async value => value === token ? officer : null, event: async () => {} },
    origins: new Set([origin]) }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const request = (path, method, body, authHeaders) => originalFetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(body),
  });
  const row = (text, suffix, visibility = "public") => ({
    scientific_name: `Fixture taxon ${suffix}`, common_name: `Fixture ${suffix}`, description: text, habitat, visibility,
  });
  const create = async body => {
    const response = await request("/api/species", "POST", body, { Authorization: `Bearer ${token}` });
    assert.equal(response.status, 201);
    return String((await response.json()).species_id);
  };
  const legacy = String((await pool.query("INSERT INTO species(scientific_name,description) VALUES($1,$2) RETURNING species_id",
    ["Legacy fixture", description])).rows[0].species_id);
  await pool.query("INSERT INTO rbac_species_visibility VALUES($1,'public')", [legacy]);
  const added = await create(row(description, "new"));
  const protectedId = await create(row(description, "protected", "protected"));
  const sourceRows = async id => (await pool.query("SELECT record_type, field_name, source_hash, source_locale FROM plant_translation_source_language WHERE record_id=$1", [id])).rows;
  assert.equal((await sourceRows(legacy)).length, 0);
  assert.ok((await sourceRows(added)).some(item => item.record_type === "__detected_v1_species" && item.source_hash === digest(habitat)));
  const entry = (id, fieldName = "description") => ({ recordType: "species", recordId: id, fieldName, sourceHash: digest(fieldName === "habitat" ? habitat : description) });
  const translate = async (entries, locale, mobile = false) => {
    const response = await request(`/api/${mobile ? "mobile" : "website"}/translations`, "POST", { entries, locale }, mobile ? {} : { Origin: origin });
    assert.equal(response.status, 200);
    return (await response.json()).translations;
  };
  for (const [locale, entries] of [["ms", [entry(legacy), entry(protectedId)]], ["zh-CN", [entry(added, "habitat")]]]) {
    const results = await translate(entries, locale);
    assert.equal(results.length, 1);
    assert.equal(results[0].recordId, entries[0].recordId);
    assert.deepEqual(await translate(entries, locale, true), results);
    if (inference) t.diagnostic(`${locale}: ${results[0].text}`);
  }
  assert.deepEqual(calls, ["translategemma:4b", "translategemma:4b"]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM plant_translation_cache")).rows[0].n, 2);
  assert.equal((await sourceRows(legacy))[0].source_hash, digest(description));
  assert.equal((await pool.query("SELECT description FROM species WHERE species_id=$1", [legacy])).rows[0].description, description);

  const edit = await request(`/api/species/${added}`, "PATCH", row(malay, "new"), { Authorization: `Bearer ${token}` });
  assert.equal(edit.status, 200);
  assert.ok((await sourceRows(added)).some(item => item.source_locale === "ms" && item.source_hash === digest(malay)));
  assert.deepEqual(await translate([entry(added), { ...entry(added), sourceHash: digest(malay) }], "zh-CN"), []);
  const explicit = await create({ ...row(description, "explicit"), source_languages: { description: "ms" } });
  assert.deepEqual(await translate([entry(explicit)], "zh-CN"), []);

  const stage = { submissionType: "species_request", submissionId: "synthetic-request", fieldMap: { description: "description", habitat: "habitat" } };
  await stageSourceLanguages(pool, { ...stage, values: { description, habitat }, selections: {} });
  await promoteSourceLanguages(pool, { ...stage, recordType: "species", recordId: explicit, values: { description, habitat: "Changed habitat" } });
  assert.ok((await sourceRows(explicit)).some(item => item.record_type === "species" && item.source_locale === "ms"));
  assert.ok((await sourceRows(explicit)).some(item => item.record_type === "__detected_v1_species" && item.field_name === "description"));

  if (process.env.TEST_TRANSLATION_BROWSER === "1")
    await verifyBrowser(t, { pool, legacy, added, habitat, malayText: !inference ? malay : undefined, modelCalls: () => calls.length });
});

async function verifyBrowser(t, { pool, legacy, added, habitat, malayText, modelCalls }) {
  const express = require("express");
  const { chromium } = require(process.env.TEST_PLAYWRIGHT_MODULE || "../../web/node_modules/@playwright/test");
  const dist = join(__dirname, "../../web/dist");
  const app = express();
  const origins = new Set();
  const officer = { id: "browser-officer", name: "Fixture Officer", role: "Conservation Officer", status: "Active", mustChangePassword: false };
  const sessionCookie = `niah_session=${"c".repeat(64)}`;
  const plantApi = createPlantApp({ pool, auth: { session: async token => token === "c".repeat(64) ? officer : null, event: async () => {} }, origins });
  app.get("/api/auth/me", (req, res) => req.headers.cookie === sessionCookie
    ? res.json({ user: officer }) : res.status(401).json({ error: "Guest" }));
  // This fixture has species but no plant registrations or plant-list migrations.
  app.get("/api/data/plants", (_req, res) => res.json({ plants: [] }));
  app.use("/api/data", (req, res) => { req.url = `/api${req.url}`; plantApi(req, res); });
  app.use(express.static(dist));
  app.get(["/species", "/species/:id", "/plant/:id"], (_req, res) => res.sendFile(join(dist, "index.html")));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  origins.add(origin);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "en-US" });
  const diagnostics = [];
  page.on("pageerror", error => diagnostics.push(error.message));
  page.on("response", response => {
    if (response.url().startsWith(origin + "/api/")) diagnostics.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
  const switchLanguage = async index => {
    await page.locator(".language-trigger").filter({ visible: true }).first().click();
    await page.getByRole("option").nth(index).click();
  };
  await page.goto(`${origin}/species`);
  const legacyCard = page.locator(".plant-card").filter({ hasText: "Legacy fixture" });
  const addedCard = page.locator(".plant-card").filter({ hasText: "Fixture new" });
  const assertCompactCards = async () => {
    await legacyCard.locator(".scientific-name", { hasText: /^Legacy fixture$/ }).waitFor();
    await addedCard.waitFor();
    assert.equal(await legacyCard.getByText(description, { exact: true }).count(), 0);
    assert.equal(await addedCard.getByText(habitat, { exact: true }).count(), 0);
    assert.equal(await page.locator(".plant-card .plant-description").count(), 0);
    assert.equal(await legacyCard.locator(".card-actions a").count(), 2);
  };
  try {
    await assertCompactCards();
  } catch (error) {
    t.diagnostic(JSON.stringify(diagnostics));
    t.diagnostic((await page.locator("body").innerText()).slice(0, 1200));
    throw error;
  }
  await switchLanguage(1);
  const cachedMalay = malayText || (await pool.query("SELECT translated_text FROM plant_translation_cache WHERE record_id=$1 AND field_name='description' AND target_locale='ms'", [legacy])).rows[0].translated_text;
  await assertCompactCards();
  assert.equal(await legacyCard.getByText(cachedMalay, { exact: true }).count(), 0);
  await legacyCard.locator(`a[href="/species/${legacy}"]`).click();
  await page.locator(".profile-description").getByText(cachedMalay, { exact: true }).waitFor();
  await switchLanguage(0);
  await page.locator(".profile-description").getByText(description, { exact: true }).waitFor();
  await page.goto(`${origin}/species/${added}`);
  await page.locator(".profile-habitat").getByText(habitat, { exact: true }).waitFor();
  await switchLanguage(2);
  const cachedChinese = (await pool.query("SELECT translated_text FROM plant_translation_cache WHERE record_id=$1 AND field_name='habitat' AND target_locale='zh-CN'", [added])).rows[0].translated_text;
  await page.locator(".profile-habitat").getByText(cachedChinese, { exact: true }).waitFor();
  await switchLanguage(0);
  await page.locator(".profile-habitat").getByText(habitat, { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/species`);
  await assertCompactCards();
  t.diagnostic("Chrome kept desktop and mobile-width cards compact and rendered Malay and Chinese prose on species detail pages.");

  const notes = "The plant grows in wet soil near the river.";
  const morphology = "The shrub has broad leaves and narrow stems.";
  const observationId = "00000000-0000-4000-8000-000000000071";
  await pool.query("UPDATE species SET rbac_data = rbac_data || jsonb_build_object('habitat',$1::text) WHERE species_id=$2", [habitat, legacy]);
  await pool.query("INSERT INTO plant_record(plant_id,species_id,scientific_name,registered_subject,rbac_status,qr_token) VALUES(71,$1,'Fixture plant scientific name','staff:fixture','Approved','fixture-plant-71')", [legacy]);
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,71,'staff:fixture','Approved',$2,'fixture-observation','subsequent_observation')`,
  [observationId, { heightCm: 21, morphology, notes }]);
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.context().addCookies([{ name: "niah_session", value: "c".repeat(64), url: origin }]);
  await page.goto(`${origin}/plant/71`);
  const summary = page.locator(".profile-description .summary");
  const habitatText = page.locator(".profile-habitat p");
  const historyRow = page.locator(".observation-row").first();
  await historyRow.locator("summary").click();
  await historyRow.getByText(morphology, { exact: true }).waitFor();
  for (const [index, locale] of [[2, "zh-CN"], [1, "ms"]]) {
    await switchLanguage(index);
    const bindings = [
      ["species", legacy, "description", summary],
      ["species", legacy, "habitat", habitatText],
      ["observation", observationId, "morphology", historyRow.locator(".observation-facts").first().locator("dd").nth(3)],
      ["observation", observationId, "notes", historyRow.locator(".observation-facts").first().locator("dd").nth(4)],
    ];
    for (const [type, id, field, locator] of bindings) {
      await locator.waitFor();
      const deadline = Date.now() + 30000;
      let cached;
      do {
        cached = (await pool.query(`SELECT translated_text FROM plant_translation_cache
          WHERE record_type=$1 AND record_id=$2 AND field_name=$3 AND target_locale=$4`, [type, id, field, locale])).rows[0];
        if (!cached) await new Promise(resolve => setTimeout(resolve, 100));
      } while (!cached && Date.now() < deadline);
      assert.ok(cached, `Missing ${locale} translation for ${field}`);
      await locator.filter({ hasText: cached.translated_text }).waitFor();
    }
    await historyRow.getByText("21 cm", { exact: true }).waitFor();
  }
  await switchLanguage(0);
  await summary.filter({ hasText: description }).waitFor();
  await habitatText.filter({ hasText: habitat }).waitFor();
  await historyRow.getByText(morphology, { exact: true }).waitFor();
  await historyRow.getByText(notes, { exact: true }).waitFor();
  await page.getByText("Fixture plant scientific name", { exact: true }).first().waitFor();
  const callsBeforeRepeat = modelCalls();
  const repeated = page.waitForResponse(response =>
    response.url().endsWith("/api/data/website/translations") && response.request().postDataJSON()?.locale === "ms");
  await switchLanguage(1);
  assert.equal((await (await repeated).json()).translations.length, 4);
  assert.equal(modelCalls(), callsBeforeRepeat);
  t.diagnostic("Chrome rendered Plant Detail prose in both locales, restored English, and reused all four Malay cache entries.");
}
