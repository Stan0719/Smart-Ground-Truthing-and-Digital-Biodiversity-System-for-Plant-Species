import test from "node:test";
import assert from "node:assert/strict";
import { createBotanistNotificationStore, eventsFromObservations, notificationMessage } from "../utils/botanistNotificationStore.js";

const row = (extra = {}) => ({ id: "1", plant_id: 9, owner_subject: "staff:alice", status: "Approved", reviewed_at: "2026-11-02T02:00:00.000Z", review_decision: "Approved", review_comment: "Verified leaf details.", ...extra });
function fixture() {
  const values = new Map();
  let user = { id: "alice", role: "botanist" };
  let payload = { observations: [row()] };
  let failure = null;
  const storage = { getItem: async (key) => values.get(key) || null, setItem: async (key, value) => values.set(key, value) };
  const dependencies = {
    storage, backend: "https://plant.example", authorize: async () => user,
    fetchObservations: async (accountId) => { assert.equal(accountId, user.id); if (failure) throw failure; return payload; },
    now: () => "2026-11-02T03:00:00.000Z",
  };
  return { dependencies, values, store: createBotanistNotificationStore(dependencies),
    user: (next) => { user = next; }, payload: (next) => { payload = next; }, fail: (next) => { failure = next; } };
}

test("real latest reviews produce approved, rejected and correction events with available Officer comments", () => {
  for (const [decision, type] of [["Approved", "observation_approved"], ["Rejected", "observation_rejected"], ["Correction Required", "correction_requested"]]) {
    const [event] = eventsFromObservations({ observations: [row({ review_decision: decision, status: decision })] }, "alice");
    assert.equal(event.type, type);
    assert.equal(event.observationId, "1");
    assert.equal(event.plantId, "9");
    assert.match(notificationMessage(event), /Verified leaf details/);
  }
});

test("confirmed Pending Review creates a submission event while Draft never invents a submission", () => {
  const draft = row({ status: "Draft", review_decision: null, reviewed_at: null });
  assert.deepEqual(eventsFromObservations({ observations: [draft] }, "alice"), []);
  const [submitted] = eventsFromObservations({ observations: [{ ...draft, status: "Pending Review", updated_at: "2026-11-02T01:00:00.000Z" }] }, "alice");
  assert.equal(submitted.type, "observation_submitted");
  assert.equal(submitted.createdAt, "2026-11-02T01:00:00.000Z");
});

test("unknown review states and plant approval events are not invented", () => {
  assert.deepEqual(eventsFromObservations({ observations: [row({ review_decision: "Flagged", status: "Flagged" })] }, "alice"), []);
  assert.equal(eventsFromObservations({ observations: [row()] }, "alice").some((event) => event.type === "plant_approved"), false);
});

test("notifications are deduplicated, sorted newest first, and repeated refresh preserves unread count", async () => {
  const f = fixture();
  f.payload({ observations: [row(), row(), row({ id: "2", reviewed_at: "2026-11-02T02:30:00.000Z" })] });
  for (let i = 0; i < 8; i++) {
    const result = await f.store.load("alice");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].observationId, "2");
    assert.equal(result.items.filter((item) => !item.read).length, 2);
  }
});

test("opening and marking all visible items read persists across service/app restart", async () => {
  const f = fixture();
  const first = await f.store.load("alice");
  await f.store.markRead("alice", [first.items[0].id]);
  const restarted = createBotanistNotificationStore(f.dependencies);
  assert.equal((await restarted.load("alice")).items[0].read, true);
  f.payload({ observations: [row(), row({ id: "2" })] });
  const latest = await restarted.load("alice");
  assert.equal(latest.items.filter((item) => !item.read).length, 1);
  await restarted.markRead("alice", latest.items.map((item) => item.id));
  assert.equal((await restarted.load("alice")).items.filter((item) => !item.read).length, 0);
});

test("another Botanist and other roles cannot read or mark a previous account's private notifications", async () => {
  const f = fixture();
  const first = await f.store.load("alice");
  f.user({ id: "bob", role: "botanist" });
  await assert.rejects(f.store.load("alice"), /owns these notifications/);
  await assert.rejects(f.store.markRead("alice", [first.items[0].id]), /owns these notifications/);
  f.payload({ observations: [] });
  assert.deepEqual((await f.store.load("bob")).items, []);
  f.user({ id: "alice", role: "visitor" });
  await assert.rejects(f.store.load("alice"), /Botanist account/);
});

test("a response containing another owner's observations is rejected without changing existing notifications", async () => {
  const f = fixture();
  const old = await f.store.load("alice");
  f.payload({ observations: [row({ owner_subject: "staff:bob", review_comment: "Private Bob comment" })] });
  const result = await f.store.load("alice");
  assert.match(result.error, /does not belong/);
  assert.deepEqual(result.items, old.items);
  assert.equal(JSON.stringify([...f.values.values()]).includes("Private Bob comment"), false);
});

test("network failures, malformed replies and empty later snapshots retain observed history", async () => {
  const f = fixture();
  const original = await f.store.load("alice");
  f.fail(Error("Network request failed"));
  const failed = await f.store.load("alice");
  assert.match(failed.error, /Network/);
  assert.deepEqual(failed.items, original.items);
  f.fail(null);
  f.payload({});
  assert.match((await f.store.load("alice")).error, /invalid observation list/);
  f.payload({ observations: [] });
  const inaccessible = (await f.store.load("alice")).items;
  assert.deepEqual(inaccessible.map(({ comment, ...item }) => item), original.items.map(({ comment, ...item }) => item));
  assert.equal(inaccessible[0].comment, undefined);
});

test("valid empty state differs from an offline or failed load", async () => {
  const f = fixture();
  f.payload({ observations: [] });
  assert.deepEqual(await f.store.load("alice"), { items: [], error: "" });
  f.user({ id: "alice", role: "botanist", offline: true });
  assert.match((await f.store.load("alice")).error, /offline/);
});

test("Officer comments are not written to local storage; offline read flags still persist", async () => {
  const f = fixture();
  const first = await f.store.load("alice");
  assert.match(first.items[0].comment, /Verified/);
  assert.equal([...f.values.values()].some((value) => value.includes("Verified leaf details")), false);
  f.user({ id: "alice", role: "botanist", offline: true });
  await f.store.markRead("alice", [first.items[0].id]);
  const restart = createBotanistNotificationStore(f.dependencies);
  const offline = await restart.load("alice");
  assert.equal(offline.items[0].read, true);
  assert.equal(offline.items[0].comment, undefined);
});

test("actual sync outcomes are saved once and repeated failures do not spam the list", async () => {
  const f = fixture();
  f.payload({ observations: [] });
  for (let i = 0; i < 3; i++) await f.store.recordSync("alice", { type: "sync_failed", key: "draft-one" });
  await f.store.recordSync("alice", { type: "sync_completed", key: "batch-one", count: 2 });
  const result = await f.store.load("alice");
  assert.equal(result.items.length, 2);
  assert.equal(result.items.find((item) => item.type === "sync_failed").draftKey, "draft-one");
  assert.match(notificationMessage(result.items.find((item) => item.type === "sync_completed")), /2 saved records/);
  await assert.rejects(f.store.recordSync("alice", { type: "sync_completed", key: "empty", count: 0 }), /Invalid/);
});

test("session changes while fetching prevent caching or returning another account's events", async () => {
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const store = createBotanistNotificationStore({ ...f.dependencies, fetchObservations: () => pending });
  const loading = store.load("alice");
  await new Promise((resolve) => setImmediate(resolve));
  f.user({ id: "bob", role: "botanist" });
  release({ observations: [row()] });
  await assert.rejects(loading, /owns these notifications/);
  assert.equal(f.values.size, 0);
});

test("storage is namespaced to the backend and concurrent marking cannot undo read state", async () => {
  const f = fixture();
  const original = await f.store.load("alice");
  await Promise.all([f.store.load("alice"), f.store.markRead("alice", [original.items[0].id]), f.store.load("alice")]);
  assert.equal((await f.store.load("alice")).items[0].read, true);
  const other = createBotanistNotificationStore({ ...f.dependencies, backend: "https://other.example", fetchObservations: async () => ({ observations: [] }) });
  assert.deepEqual((await other.load("alice")).items, []);
});

test("backend history is complete, deduplicated, newest first, and read state survives refresh and a new service session", async () => {
  const values = new Map();
  let history = Array.from({ length: 1005 }, (_, index) => ({
    id: `server-${index}`,
    type: index % 2 ? "observation_rejected" : "observation_approved",
    observationId: String(index + 1),
    plantId: "9",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    read: index < 1003,
  })).reverse();
  let failWrite = false;
  const storage = { getItem: async key => values.get(key) || null, setItem: async (key, value) => values.set(key, value) };
  const dependencies = {
    storage, backend: "https://plant.example", authorize: async () => ({ id: "alice", role: "botanist" }),
    fetchNotifications: async () => ({ notifications: [...history, history[0]] }),
    markNotificationsRead: async (_account, request) => {
      if (failWrite) throw Error("Notification read update failed");
      const ids = new Set(request.all ? history.map(item => item.id) : request.ids);
      history = history.map(item => ids.has(item.id) ? { ...item, read: true } : item);
    },
    recordSyncRemote: async () => { throw Error("not used"); },
  };
  const firstStore = createBotanistNotificationStore(dependencies);
  const initial = await firstStore.load("alice");
  assert.equal(initial.items.length, 1005);
  assert.equal(initial.items[0].id, "server-1004");
  assert.equal(initial.items.filter(item => !item.read).length, 2);
  await firstStore.markRead("alice", ["server-1004"]);
  const afterRefresh = await firstStore.load("alice");
  assert.equal(afterRefresh.items.find(item => item.id === "server-1004").read, true);
  assert.equal(afterRefresh.items.filter(item => !item.read).length, 1);
  const secondStore = createBotanistNotificationStore(dependencies);
  assert.equal((await secondStore.load("alice")).items.find(item => item.id === "server-1004").read, true);
  await secondStore.markRead("alice", [], { all: true });
  assert.equal((await createBotanistNotificationStore(dependencies).load("alice")).items.filter(item => !item.read).length, 0);
});

test("failed persistent read updates leave the notification unread", async () => {
  let read = false;
  const values = new Map();
  const store = createBotanistNotificationStore({
    storage: { getItem: async key => values.get(key) || null, setItem: async (key, value) => values.set(key, value) },
    backend: "https://plant.example", authorize: async () => ({ id: "alice", role: "botanist" }),
    fetchNotifications: async () => ({ notifications: [{ id: "one", type: "observation_approved", observationId: "1", plantId: "2", createdAt: "2026-11-03T00:00:00.000Z", read }] }),
    markNotificationsRead: async () => { throw Error("Database update failed"); },
  });
  const first = await store.load("alice");
  await assert.rejects(store.markRead("alice", ["one"]), /Database update failed/);
  assert.equal((await store.load("alice")).items[0].read, false);
  assert.equal(first.items[0].read, false);
});
