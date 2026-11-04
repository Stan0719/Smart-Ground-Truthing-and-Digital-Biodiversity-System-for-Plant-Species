import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createApi() {
  const source = readFileSync(new URL("../utils/visitorFeatures.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replaceAll("export async function", "async function");
  const requests = [];
  let nextError;
  const context = vm.createContext({
    plantApi: async (path, options) => {
      requests.push({ path, options });
      if (nextError) {
        const error = nextError;
        nextError = null;
        throw error;
      }
      return {};
    },
    plantAssetSources: async () => [],
    mapBackendPlant: (row) => row,
    mapBackendSpecies: (row) => row,
  });
  vm.runInContext(`${source}\nglobalThis.api={setVisitorFavourite,recordVisitorScan};`, context);
  return {
    api: context.api,
    requests,
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
