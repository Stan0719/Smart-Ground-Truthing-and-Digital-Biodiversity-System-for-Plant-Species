import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createApi() {
  const source = readFileSync(new URL("../utils/visitorFeatures.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("export async function", "async function");
  const requests = [];
  const imageRequests = [];
  let nextError;
  let response = {};
  let pageResponses = null;
  const context = vm.createContext({
    plantApi: async (path, options) => {
      requests.push({ path, options });
      if (nextError) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      if (pageResponses) return pageResponses.shift() || { scans: [], page: { has_more: false } };
      return response;
    },
    plantAssetSources: async (assets) => {
      imageRequests.push(assets.map((asset) => String(asset.id)));
      return assets.map((asset) => ({ uri: `https://api.test/assets/${asset.id}`, headers: { Authorization: "Bearer test" } }));
    },
    mapBackendPlant: (row) => row,
    mapBackendSpecies: (row) => row,
  });
  vm.runInContext(`${source}\nglobalThis.api={setVisitorFavourite,recordVisitorScan,fetchVisitorScanHistory,fetchVisitorFavourites};`, context);
  return {
    api: context.api,
    requests,
    imageRequests,
    respond(payload) { response = payload; },
    respondPages(payloads) { pageResponses = [...payloads]; },
    fail(error) { nextError = error; },
  };
}

test("Visitor favourite and scan requests use the expected authenticated API contracts", async () => {
  const { api, requests } = createApi();
  await api.setVisitorFavourite("visitor-7", "plant", "15", true);
  await api.setVisitorFavourite("visitor-7", "species", "4", true);
  await api.recordVisitorScan("visitor-7", "qr-payload-15");

  assert.deepEqual(requests.map(({ path }) => path), [
    "/visitor/favourites", "/visitor/favourites", "/visitor/scan-history",
  ]);
  assert.deepEqual(requests.map(({ options }) => options.method), ["POST", "POST", "POST"]);
  assert.deepEqual(requests.map(({ options }) => options.accountId), Array(3).fill("visitor-7"));
  assert.deepEqual(JSON.parse(JSON.stringify(requests.map(({ options }) => options.body))), [
    { type: "plant", id: "15" },
    { type: "species", id: "4" },
    { qr_code: "qr-payload-15" },
  ]);
  assert.ok(requests.every(({ options }) => !Object.hasOwn(options.body, "visitor_id")));
});

test("scan history loads every server page before resolving distinct plant photo assets", async () => {
  const { api, requests, imageRequests, respondPages } = createApi();
  respondPages([
    { scans: [{ scan_id: 1, scanned_at: "2026-11-10T01:00:00Z", plant: { plant_id: 8, image_asset_id: "plant-eight" } }], page: { has_more: true } },
    { scans: [{ scan_id: 2, scanned_at: "2026-11-10T02:00:00Z", plant: { plant_id: 9, image_asset_id: "plant-nine" } }], page: { has_more: false } },
  ]);
  const scans = await api.fetchVisitorScanHistory("visitor-7");
  assert.equal(scans.length, 2);
  assert.deepEqual(requests.map(({ path }) => path), [
    "/visitor/scan-history?limit=200&offset=0",
    "/visitor/scan-history?limit=200&offset=1",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(imageRequests)), [["plant-eight", "plant-nine"]]);
});

test("favourite plant photos use each plant asset while species favourites retain species portraits", async () => {
  const { api, imageRequests, respond } = createApi();
  respond({ favourites: {
    plants: [
      { plant_id: 8, species_id: 2, plant_image_asset_id: "plant-8-primary", image_asset_id: "species-portrait" },
      { plant_id: 9, species_id: 2, plant_image_asset_id: "plant-9-first", image_asset_id: "species-portrait" },
      { plant_id: 10, species_id: 2, plant_image_asset_id: null, image_asset_id: "species-portrait" },
    ],
    species: [{ species_id: 2, image_asset_id: "species-portrait" }],
  } });
  const favourites = await api.fetchVisitorFavourites("visitor-7");

  assert.deepEqual(favourites.plants.map((plant) => plant.image?.uri ?? null), [
    "https://api.test/assets/plant-8-primary",
    "https://api.test/assets/plant-9-first",
    null,
  ]);
  assert.equal(favourites.species[0].image.uri, "https://api.test/assets/species-portrait");
  assert.deepEqual(JSON.parse(JSON.stringify(imageRequests)), [["plant-8-primary", "plant-9-first", "species-portrait"]]);
});

test("scan history resolves the linked plant photos, deduplicates repeated asset lookups, and leaves photo-less plants empty", async () => {
  const { api, requests, respond } = createApi();
  respond({ scans: [
    { scan_id: 1, plant: { plant_id: 10, species_details: { image_asset_id: "species-portrait" }, image_asset_id: "plant-photo-a" } },
    { scan_id: 2, plant: { plant_id: 10, species_details: { image_asset_id: "species-portrait" }, image_asset_id: "plant-photo-a" } },
    { scan_id: 3, plant: { plant_id: 11, species_details: { image_asset_id: "species-portrait" }, image_asset_id: "plant-photo-b" } },
    { scan_id: 4, plant: { plant_id: 12, species_details: { image_asset_id: "species-portrait" }, image_asset_id: null } },
  ] });
  const scans = await api.fetchVisitorScanHistory("visitor-7");

  assert.deepEqual(JSON.parse(JSON.stringify(scans.map((scan) => scan.plant?.image?.uri ?? null))), [
    "https://api.test/assets/plant-photo-a",
    "https://api.test/assets/plant-photo-a",
    "https://api.test/assets/plant-photo-b",
    null,
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { path: "/visitor/scan-history?limit=200&offset=0", options: { accountId: "visitor-7" } });
});

test("HTTP and network errors remain distinguishable and generic 404 identifies a missing route", async () => {
  const { api, fail } = createApi();
  const cases = [
    [{ status: 404, message: "Not found." }, /Visitor API route was not found \(HTTP 404\)/],
    [{ status: 401, message: "Unauthorized." }, /HTTP 401/],
    [{ status: 403, message: "Forbidden." }, /HTTP 403/],
    [{ status: 503, message: "Service unavailable." }, /HTTP 503/],
    [{ code: "API_UNREACHABLE", message: "Unable to reach backend." }, /Cannot reach the Visitor service/],
  ];
  for (const [input, expected] of cases) {
    const error = Object.assign(new Error(input.message), input);
    fail(error);
    await assert.rejects(api.setVisitorFavourite("visitor-7", "plant", "15", true), expected);
  }

  const schemaError = Object.assign(new Error("Plant database setup is incomplete. Apply the supplied Add Plant migrations and restart the plant API."), { status: 503 });
  fail(schemaError);
  await assert.rejects(
    api.recordVisitorScan("visitor-7", "qr-payload-15"),
    /HTTP 503: Plant database setup is incomplete/,
  );

  const unavailableRecord = Object.assign(new Error("This record is not available."), { status: 404 });
  fail(unavailableRecord);
  await assert.rejects(api.setVisitorFavourite("visitor-7", "plant", "15", true), /This record is not available/);
});
