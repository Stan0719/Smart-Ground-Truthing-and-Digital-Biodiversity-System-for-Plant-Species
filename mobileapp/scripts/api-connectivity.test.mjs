import test from "node:test";
import assert from "node:assert/strict";
import {
  selectApiConfiguration,
  validatedApiUrl,
  checkApiConnectivity,
  createConnectivityGuard,
} from "../utils/apiConfiguration.js";
import { createFaceClient } from "../utils/faceApi.js";
const reply = (
  body = { service: "Plant Conservation API", ready: true },
  extra = {},
) => ({
  status: 200,
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => body,
  ...extra,
});
test("development and production settings are separate; release cannot silently use a development URL", () => {
  const settings = {
    plant: "https://dev.example.invalid",
    face: "https://face-dev.example.invalid",
    plantProduction: "https://api.example.invalid",
    faceProduction: "https://face.example.invalid",
  };
  assert.equal(selectApiConfiguration(settings).plant, settings.plant);
  assert.equal(
    selectApiConfiguration(settings, true).plant,
    settings.plantProduction,
  );
  assert.equal(
    selectApiConfiguration({ plant: settings.plant }, true).plant,
    undefined,
  );
  assert.ok(selectApiConfiguration({ environment: "typo" }).error);
  for (const bad of [
    "http://host.invalid",
    "https://user:secret@host.invalid",
    "https://host.invalid/?key=private",
    "https://host.invalid/#token",
  ])
    assert.throws(() => validatedApiUrl(bad, "development", "plant"));
  for (const bad of ["https://localhost", "https://demo-3000.app.github.dev"])
    assert.throws(() => validatedApiUrl(bad, "production", "plant"));
});
test("connectivity checks send no credentials and reject GitHub/HTML redirects", async () => {
  await assert.rejects(
    checkApiConnectivity(
      "plant",
      "https://api.example.invalid",
      async (_url, options) => {
        assert.equal(options.method, "GET");
        assert.equal(options.credentials, "omit");
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.body, undefined);
        return reply({}, { status: 302, ok: false });
      },
    ),
    { code: "API_ACCESS_REDIRECT", transient: true },
  );
  await assert.rejects(
    checkApiConnectivity("plant", "https://api.example.invalid", async () =>
      reply({}, { redirected: true }),
    ),
    { code: "API_ACCESS_REDIRECT" },
  );
  await assert.rejects(
    checkApiConnectivity("plant", "https://api.example.invalid", async () =>
      reply({}, { headers: { get: () => "text/html" } }),
    ),
    { code: "API_NOT_JSON" },
  );
});
test("health identifies the correct ready service and handles network errors/timeouts", async () => {
  assert.equal(
    (
      await checkApiConnectivity(
        "plant",
        "https://api.example.invalid",
        async () => reply(),
      )
    ).ready,
    true,
  );
  assert.equal(
    (
      await checkApiConnectivity(
        "face",
        "https://api.example.invalid",
        async () => reply({ ready: true, accountService: "authoritative" }),
      )
    ).ready,
    true,
  );
  await assert.rejects(
    checkApiConnectivity("face", "https://api.example.invalid", async () =>
      reply({ ready: true, accountService: "prototype" }),
    ),
    { code: "API_WRONG_SERVICE" },
  );
  await assert.rejects(
    checkApiConnectivity("plant", "https://api.example.invalid", async () => {
      throw Error("network");
    }),
    { code: "API_UNREACHABLE" },
  );
  await assert.rejects(
    checkApiConnectivity(
      "plant",
      "https://api.example.invalid",
      () => new Promise(() => {}),
      5,
    ),
    { code: "API_TIMEOUT" },
  );
});
test("failed preflight prevents authenticated face requests; successful checks are shared and retried after expiry", async () => {
  let calls = 0,
    now = 1000;
  const guard = createConnectivityGuard(
    "plant",
    () => "https://api.example.invalid",
    async () => {
      calls++;
      return reply();
    },
    () => now,
  );
  await Promise.all([guard(), guard(), guard()]);
  assert.equal(calls, 1);
  now += 10001;
  await guard();
  assert.equal(calls, 2);
  const client = createFaceClient({
    url: "https://face.example.invalid",
    beforeRequest: async () => {
      throw Error("private forwarding");
    },
    fetchImpl: async () => {
      throw Error("credentials were sent");
    },
  });
  await assert.rejects(
    client("/password", { password: "test-only" }, "test-token"),
    /private forwarding/,
  );
});

test("private gateway derives one origin and session binding changes for either service", async () => {
  const { sessionBackendBinding, classifyConnectivityFailure } =
    await import("../utils/apiConfiguration.js");
  const selected = selectApiConfiguration({
    privateGateway: "https://approved.example.invalid",
    plant: "https://stale.example.invalid",
  });
  assert.equal(selected.plant, "https://approved.example.invalid");
  assert.equal(selected.face, selected.plant + "/face");
  assert.ok(
    selectApiConfiguration({
      privateGateway: "http://insecure.example.invalid",
    }).error,
  );
  assert.notEqual(
    sessionBackendBinding("https://a.invalid", "https://face.invalid"),
    sessionBackendBinding("https://b.invalid", "https://face.invalid"),
  );
  assert.equal(
    classifyConnectivityFailure({ cause: { code: "CERT_HAS_EXPIRED" } }).code,
    "API_TLS",
  );
  assert.equal(
    classifyConnectivityFailure({ cause: { code: "ENOTFOUND" } }).code,
    "API_DNS",
  );
  assert.equal(
    classifyConnectivityFailure(Error("unknown native failure")).code,
    "API_UNREACHABLE",
  );
  for (const status of [401, 403])
    await assert.rejects(
      checkApiConnectivity("plant", "https://example.invalid", async () =>
        reply({}, { status, ok: false }),
      ),
      { code: status === 401 ? "API_AUTH_REQUIRED" : "API_ACCESS_DENIED" },
    );
});

test("normal HTTPS backend needs no VPN-specific URL and preserves release isolation", () => {
  const selected = selectApiConfiguration({
    backend: "https://reachable.example.invalid",
    privateGateway: "https://old-private.example.invalid",
  });
  assert.equal(selected.plant, "https://reachable.example.invalid");
  assert.equal(selected.face, "https://reachable.example.invalid/face");
  assert.equal(
    selectApiConfiguration({
      backend: "https://dev.example.invalid",
      backendDevelopment: "https://explicit-dev.example.invalid",
    }).plant,
    "https://explicit-dev.example.invalid",
  );
  assert.equal(
    selectApiConfiguration({ backend: "https://dev.example.invalid" }, true)
      .plant,
    undefined,
  );
  assert.equal(
    selectApiConfiguration(
      {
        backend: "https://dev.example.invalid",
        backendProduction: "https://release.example.invalid",
      },
      true,
    ).plant,
    "https://release.example.invalid",
  );
  assert.ok(
    selectApiConfiguration({ backend: "http://insecure.example.invalid" })
      .error,
  );
  assert.ok(
    selectApiConfiguration({ backend: "https://user:secret@example.invalid" })
      .error,
  );
});
