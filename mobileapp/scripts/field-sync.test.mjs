import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../utils/fieldSync.js", import.meta.url),
  "utf8",
)
  .replace(/^import[^\n]*\n/gm, "")
  .replace("export function syncDrafts", "function syncDrafts");
async function fixture({ fail = false, owner = "owner" } = {}) {
  const calls = [],
    removed = [];
  const factory = new Function(
    "readDrafts",
    "removeDraft",
    "plantApi",
    "faceSession",
    source + "\nreturn syncDrafts;",
  );
  const sync = factory(
    async () => [
      {
        client_key: "key",
        path: "/plants",
        body: { client_key: "key" },
        assets: [],
      },
    ],
    async (_id, key) => removed.push(key),
    async (path, options) => {
      calls.push({ path, options });
      if (fail) throw Error("offline");
      return { id: "observation", plant_id: 1 };
    },
    { restore: async () => ({ id: owner, role: "botanist" }) },
  );
  return { sync, calls, removed };
}
test("sync submits draft and removes it only after server confirmation", async () => {
  const f = await fixture();
  assert.equal(await f.sync("owner"), 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].options.expectedAccountId, "owner");
  assert.equal(f.calls[1].path, "/observations/observation/submit");
  assert.deepEqual(f.removed, ["key"]);
});
test("failed requests retain drafts for retry", async () => {
  const f = await fixture({ fail: true });
  await assert.rejects(f.sync("owner"), /offline/);
  assert.equal(f.removed.length, 0);
});
test("another account cannot synchronize a previous account draft", async () => {
  const f = await fixture({ owner: "other" });
  await assert.rejects(f.sync("owner"), /owner/);
  assert.equal(f.calls.length, 0);
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
    source + "\nreturn syncDrafts;",
  );
  const draft = {
    client_key: "stable",
    path: "/plants",
    body: { content: { heightCm: 10 } },
    assets: [{ client_key: "photo-stable", base64: "test" }],
  };
  const sync = factory(
    async () => [draft],
    async (_id, key) => removed.push(key),
    async (path, options) => {
      calls.push([path, options]);
      if (path === "/assets" && fail) throw Error("interrupted");
      return { id: "observation", plant_id: 1 };
    },
    { restore: async () => ({ id: "owner", role: "botanist" }) },
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
    body: { revision: 2, content: { heightCm: 20 } },
    assets: [],
  };
  const factory = new Function(
    "readDrafts",
    "removeDraft",
    "plantApi",
    "faceSession",
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
              content: { heightCm: patched ? 20 : 10 },
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
  );
  await assert.rejects(sync("owner"), /lost response/);
  assert.deepEqual(removed, []);
  fail = false;
  assert.equal(await sync("owner"), 1);
  assert.deepEqual(removed, ["correction"]);
});
