import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../utils/fieldSync.js", import.meta.url),
  "utf8",
)
  .replace(/^import[^\n]*\n/gm, "")
  .replace(/^export async function /gm, "async function ")
  .replace(/^export function /gm, "function ");
const { validate, getPlantObservationEligibility } = new Function(source + "\nreturn { validate: validateObservationDraft, getPlantObservationEligibility };")();
const makeEligibilityClient = (plantApi) => new Function("plantApi", source + "\nreturn { fetchPlantObservationEligibility, verifyApprovedPlantForObservation };")(plantApi);
const validDraft = (extra = {}) => ({
  client_key: "key", path: "/plants/7/observations", plant_id: "7", assets: [],
  body: { client_key: "key", content: {
    heightCm: "12.5", healthStatus: "Healthy", lifeStage: "Mature", morphology: "Healthy specimen",
    notes: "", taxonomy: "", latitude: "", longitude: "", accuracy_m: "",
  } }, ...extra,
});
async function fixture({ fail = false, owner = "owner", notificationFailure = false, drafts, plantStatus = "Approved" } = {}) {
  const calls = [],
    removed = [], notifications = [];
  const factory = new Function(
    "readDrafts",
    "removeDraft",
    "plantApi",
    "faceSession",
    "botanistNotifications",
    source + "\nreturn syncDrafts;",
  );
  const sync = factory(
    async () => drafts || [
      {
        ...validDraft(),
      },
    ],
    async (_id, key) => removed.push(key),
    async (path, options) => {
      calls.push({ path, options });
      if (path === "/plants/7/qr") return { plant_id: 7, rbac_status: plantStatus };
      if (path === "/observations/observation/submit") return { submitted: true };
      if (fail) throw Error("offline");
      return { id: "observation", plant_id: 1 };
    },
    { restore: async () => ({ id: owner, role: "botanist" }) },
    { recordSync: async (accountId, event) => {
      if (notificationFailure) throw Error("Notification storage unavailable");
      notifications.push({ accountId, ...event });
    } },
  );
  return { sync, calls, removed, notifications };
}
test("sync submits draft and removes it only after server confirmation", async () => {
  const f = await fixture();
  assert.equal(await f.sync("owner"), 1);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].path, "/plants/7/qr");
  assert.equal(f.calls[0].options.expectedAccountId, "owner");
  assert.equal(f.calls[1].path, "/plants/7/observations");
  assert.equal(f.calls[2].path, "/observations/observation/submit");
  assert.deepEqual(f.removed, ["key"]);
  assert.equal(f.notifications[0].type, "sync_completed");
  assert.equal(f.notifications[0].count, 1);
  assert.equal(f.notifications[0].accountId, "owner");
});
test("sync returns the actual submitted observation identity to the originating form", async () => {
  const f = await fixture();
  const submitted = [];
  assert.equal(await f.sync("owner", { onSubmitted: (item) => submitted.push(item) }), 1);
  assert.deepEqual(submitted, [{ clientKey: "key", id: "observation", plantId: "1", status: "Pending Review", type: "observation" }]);
});
test("failed requests retain drafts for retry", async () => {
  const f = await fixture({ fail: true });
  await assert.rejects(f.sync("owner"), /offline/);
  assert.equal(f.removed.length, 0);
  assert.equal(f.notifications[0].type, "sync_failed");
  assert.equal(f.notifications[0].key, "key");
});

test("new observation sync blocks non-approved plants before creating a record or uploading photos", async () => {
  const f = await fixture({ plantStatus: "Pending Review", drafts: [{ ...validDraft(), assets: [{ client_key: "photo-1", base64: "abc" }] }] });
  await assert.rejects(f.sync("owner"), /This plant is awaiting approval/);
  assert.deepEqual(f.calls.map(({ path }) => path), ["/plants/7/qr"]);
  assert.deepEqual(f.removed, []);
});

test("plant eligibility uses the current plant status, independently of a pending reviewed edit", () => {
  assert.equal(getPlantObservationEligibility({ plant_id: 7, rbac_status: "Approved" }, 7), "approved");
  assert.equal(getPlantObservationEligibility({ plant_id: 7, rbac_status: "Approved", pending_edit: "Pending Review" }, 7), "approved");
  assert.equal(getPlantObservationEligibility({ plant_id: 7, rbac_status: "Pending Review" }, 7), "pending");
  assert.equal(getPlantObservationEligibility({ plant_id: 7, rbac_status: "Rejected" }, 7), "rejected");
  assert.equal(getPlantObservationEligibility({ plant_id: 7, rbac_status: "Correction Required" }, 7), "correctionRequired");
  assert.equal(getPlantObservationEligibility({ plant_id: 8, rbac_status: "Approved" }, 7), "unavailable");
});
test("eligibility reads current owner status and fails closed when status cannot be verified", async () => {
  let status = "Approved";
  const calls = [];
  const client = makeEligibilityClient(async (path) => {
    calls.push(path);
    if (path.endsWith("/qr")) return { rbac_status: status };
    const error = Error("not owner"); error.status = 404; throw error;
  });
  assert.equal(await client.fetchPlantObservationEligibility("owner", "7"), "approved");
  status = "Pending Review";
  assert.equal(await client.fetchPlantObservationEligibility("owner", "7"), "pending");
  assert.equal(await client.fetchPlantObservationEligibility("owner", "wrong"), "unavailable");
  assert.deepEqual(calls, ["/plants/7/qr", "/plants/7/qr"]);
  const unavailable = makeEligibilityClient(async () => { throw Error("offline"); });
  await assert.rejects(unavailable.verifyApprovedPlantForObservation("owner", "7"), /Unable to verify/);
});
test("a non-owner can add observations only when the public record endpoint confirms visibility", async () => {
  const client = makeEligibilityClient(async (path) => {
    if (path.endsWith("/qr")) { const error = Error("not owner"); error.status = 404; throw error; }
    if (path.endsWith("?scope=mine")) { const error = Error("not owner"); error.status = 404; throw error; }
    return { plant: { plant_id: 7, species_id: 4 } };
  });
  assert.equal(await client.fetchPlantObservationEligibility("observer", "7"), "approved");
});
test("an owned plant with unavailable status is not treated as approved", async () => {
  const client = makeEligibilityClient(async (path) => {
    if (path.endsWith("/qr")) { const error = Error("QR unavailable"); error.status = 404; throw error; }
    if (path.endsWith("?scope=mine")) return { plant: { plant_id: 7, species_id: 4 } };
    throw Error("public fallback must not run for an owned record");
  });
  assert.equal(await client.fetchPlantObservationEligibility("owner", "7"), "unavailable");
});
test("another account cannot synchronize a previous account draft", async () => {
  const f = await fixture({ owner: "other" });
  await assert.rejects(f.sync("owner"), /owner/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.notifications.length, 0);
});

test("form drafts are excluded from synchronization until the Botanist explicitly submits them", async () => {
  const f = await fixture({ drafts: [{ kind: "botanist-form", client_key: "form-key", form_type: "add-plant", form: { name: "unfinished" }, photo_refs: [] }] });
  assert.equal(await f.sync("owner"), 0);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.removed, []);
});

test("partial photo failure retains the draft and retries with the same upload keys", async () => {
  const removed = [],
    calls = [];
  let fail = true;
  const factory = new Function(
    "readDrafts",
    "removeDraft",
    "plantApi",
    "faceSession",
    "botanistNotifications",
    source + "\nreturn syncDrafts;",
  );
  const draft = {
    client_key: "stable",
    path: "/plants/7/observations",
    plant_id: "7",
    body: { client_key: "stable", content: { heightCm: 10, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Specimen" } },
    assets: [{ client_key: "photo-stable", base64: "test" }],
  };
  const sync = factory(
    async () => [draft],
    async (_id, key) => removed.push(key),
    async (path, options) => {
      calls.push([path, options]);
      if (path === "/plants/7/qr") return { plant_id: 7, rbac_status: "Approved" };
      if (path === "/assets" && fail) throw Error("interrupted");
      return { id: "observation", plant_id: 1 };
    },
    { restore: async () => ({ id: "owner", role: "botanist" }) },
    { recordSync: async () => {} },
  );
  await assert.rejects(sync("owner"), /interrupted/);
  assert.deepEqual(removed, []);
  fail = false;
  assert.equal(await sync("owner"), 1);
  assert.equal(
    calls
      .filter(([p]) => p === "/assets")
      .every(([, o]) => o.body.client_key === "photo-stable"),
    true,
  );
  assert.deepEqual(removed, ["stable"]);
});

test("offline corrections recover after a PATCH succeeded but its response was lost", async () => {
  let patched = false,
    fail = true;
  const removed = [];
  const draft = {
    client_key: "correction",
    method: "PATCH",
    path: "/observations/observation",
    body: { revision: 2, content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Specimen", notes: "", taxonomy: "" } },
    assets: [],
  };
  const factory = new Function(
    "readDrafts",
    "removeDraft",
    "plantApi",
    "faceSession",
    "botanistNotifications",
    source + "\nreturn syncDrafts;",
  );
  const sync = factory(
    async () => [draft],
    async (_id, key) => removed.push(key),
    async (path, options) => {
      if (path === "/observations")
        return {
          observations: [
            {
              id: "observation",
              plant_id: 1,
              status: patched ? "Draft" : "Correction Required",
              revision: patched ? 3 : 2,
              content: patched ? { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Specimen", notes: "", taxonomy: "" } : { heightCm: 10 },
            },
          ],
        };
      if (options.method === "PATCH") {
        patched = true;
        if (fail) throw Error("lost response");
      }
      return { id: "observation", plant_id: 1 };
    },
    { restore: async () => ({ id: "owner", role: "botanist" }) },
    { recordSync: async () => {} },
  );
  await assert.rejects(sync("owner"), /lost response/);
  assert.deepEqual(removed, []);
  fail = false;
  assert.equal(await sync("owner"), 1);
  assert.deepEqual(removed, ["correction"]);
});


test("notification storage failures do not change synchronization success or its original error", async () => {
  const success = await fixture({ notificationFailure: true });
  assert.equal(await success.sync("owner"), 1);
  assert.deepEqual(success.removed, ["key"]);
  const failure = await fixture({ notificationFailure: true, fail: true });
  await assert.rejects(failure.sync("owner"), /offline/);
  assert.deepEqual(failure.removed, []);
});

test("incomplete queued observation drafts are rejected before any network request or photo upload", async () => {
  const drafts = [
    validDraft({ assets: [{ client_key: "photo-1", base64: "photo" }] }),
    validDraft({ client_key: "correction", method: "PATCH", path: "/observations/obs-1", body: { revision: 3, content: { ...validDraft().body.content } } }),
  ];
  for (const draft of drafts) {
    draft.body.content.heightCm = "";
    const f = await fixture({ drafts: [draft] });
    await assert.rejects(f.sync("owner"), /valid plant height/);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.removed, []);
  }
});

test("height validation matches the API limits and allows a valid decimal height", () => {
  for (const [height, message] of [["0", /greater than 0/], ["100000.1", /cannot exceed/], ["nope", /valid plant height/]]) {
    const draft = validDraft();
    draft.body.content.heightCm = height;
    assert.throws(() => validate(draft), message);
  }
  const checked = validate(validDraft());
  assert.equal(checked.body.content.heightCm, 12.5);
});

test("subsequent observations may omit GPS, but new plant registration requires species and GPS", () => {
  assert.equal(validate(validDraft()).body.content.latitude, undefined);
  const registration = validDraft({ path: "/plants", body: { species_id: "3", client_key: "key", latitude: "", longitude: "", content: validDraft().body.content } });
  assert.throws(() => validate(registration), /Record GPS/);
  registration.body.latitude = "-3.2";
  registration.body.longitude = "114.1";
  const checked = validate(registration);
  assert.equal(checked.body.latitude, -3.2);
  assert.equal(checked.body.longitude, 114.1);
});

test("invalid coordinates and correction revision metadata fail validation without losing multiline taxonomy", () => {
  const badGps = validDraft();
  badGps.body.content.latitude = "91";
  badGps.body.content.longitude = "0";
  assert.throws(() => validate(badGps), /valid latitude and longitude/);
  const partialGps = validDraft();
  partialGps.body.content.latitude = "-3.2";
  assert.throws(() => validate(partialGps), /both latitude and longitude/);
  const badAccuracy = validDraft();
  badAccuracy.body.content.accuracy_m = "-0.1";
  assert.throws(() => validate(badAccuracy), /nonnegative number/);

  const correction = validDraft({ method: "PATCH", path: "/observations/observation-1", body: {
    revision: 7, content: { ...validDraft().body.content, taxonomy: "Observation line 1\nObservation line 2" },
  } });
  const checked = validate(correction);
  assert.equal(checked.body.revision, 7);
  assert.equal(checked.body.content.taxonomy, "Observation line 1\nObservation line 2");
  correction.body.revision = 0;
  assert.throws(() => validate(correction), /target or revision/);
});
