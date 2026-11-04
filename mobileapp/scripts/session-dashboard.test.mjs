import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser"), traverse = require("@babel/traverse").default, generate = require("@babel/generator").default;
const source = readFileSync(new URL("../utils/faceSessionLifecycle.js", import.meta.url), "utf8");
const { createFaceSessionManager } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const token = "a".repeat(64), user = { id: "owner", name: "Owner", email: "owner@example.invalid", role: "botanist" };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));
function fixture(api = async () => ({ user })) {
  let saved = null; const events = [];
  const manager = createFaceSessionManager({ backend: "https://api.example.invalid/api/mobile", validUser: (v) => v?.id === user.id, api,
    storage: { get: async () => saved, set: async (_, v) => { saved = v; }, remove: async () => { saved = null; } }, diagnostic: (e) => events.push(e) });
  return { manager, events, seed: (value) => { saved = JSON.stringify(value); } };
}
test("missing credentials emit signed-out state and typed authentication error before any plant request", async () => {
  const { manager, events } = fixture(); let called = false, state;
  manager.subscribe((next) => { state = next; });
  await assert.rejects(manager.withToken(() => { called = true; }), (e) => e.code === "SESSION_REQUIRED" && e.status === 401 && !e.message.includes("business request"));
  assert.equal(called, false); assert.equal(state.authenticated, false);
  assert.ok(events.every((e) => !JSON.stringify(e).includes(token)));
});
test("cold in-memory state restores an existing secure session and revalidates the same owner", async () => {
  let verifications = 0;
  const { manager, seed } = fixture(async () => { verifications++; return { user }; });
  seed({ backend: "https://api.example.invalid/api/mobile", token });
  assert.equal(manager.hasSession(), false);
  await manager.withToken((bearer, owner) => { assert.equal(bearer, token); assert.equal(owner.id, user.id); });
  assert.equal(verifications, 1); assert.equal(manager.hasSession(), true);
});
test("parallel dashboard requests share verification but each retain bearer and identity checks", async () => {
  let gate = null, checks = 0;
  const { manager } = fixture(async () => { checks++; if (gate) await gate.promise; return { user }; });
  await manager.establish({ token, user }); gate = deferred();
  const requests = Array.from({ length: 3 }, () => manager.withToken((bearer, owner) => `${bearer === token}:${owner.id}`));
  await tick(); assert.equal(checks, 2); gate.resolve();
  assert.deepEqual(await Promise.all(requests), ["true:owner", "true:owner", "true:owner"]);
});
test("network failures preserve credentials; authoritative rejection and logout invalidate observers", async () => {
  let failure; const { manager } = fixture(async () => { if (failure) throw failure; return { user }; });
  await manager.establish({ token, user }); let invalidations = 0; manager.subscribe((e) => { if (!e.authenticated) invalidations++; });
  failure = Object.assign(Error("Offline"), { transient: true }); await assert.rejects(manager.withToken(() => {}));
  assert.equal(manager.hasSession(), true); assert.equal(invalidations, 0);
  failure = Object.assign(Error("Expired"), { status: 401 }); await assert.rejects(manager.withToken(() => {}));
  assert.equal(manager.hasSession(), false); assert.equal(invalidations, 1);
  failure = null; await manager.establish({ token, user }); await manager.logout(); assert.equal(invalidations, 2);
});
test("restore cannot reload a token while logout is deleting secure storage", async () => {
  let saved, gate;
  const manager = createFaceSessionManager({ backend: "https://api.example.invalid", validUser: () => true, api: async () => ({ user }),
    storage: { get: async () => saved, set: async (_, v) => { saved = v; }, remove: async () => { if (gate) await gate.promise; saved = null; } } });
  await manager.establish({ token, user }); gate = deferred();
  const logout = manager.logout(), restore = manager.restore(); await tick();
  assert.equal(manager.hasSession(), false); gate.resolve(); await logout; assert.equal(await restore, null);
});

const app = readFileSync(new URL("../App.js", import.meta.url), "utf8");
let effect;
traverse(parser.parse(app, { sourceType: "module", plugins: ["jsx"] }), { CallExpression(path) {
  if (path.node.callee.name === "useEffect" && generate(path.node.arguments[0]).code.includes("faceSession.subscribe")) effect = generate(path.node.arguments[0]).code;
} });
function runAppEffect(restore) {
  assert.ok(effect); let current = user, resets = [], subscriber, removed = false;
  const session = { hasSession: () => false, restore, subscribe: (fn) => { subscriber = fn; return () => { removed = true; }; } };
  const navigation = { isReady: () => true, getCurrentRoute: () => ({ name: "AccountTab" }), reset: (value) => resets.push(value) };
  const fn = new Function("faceSession", "navigationRef", "authGeneration", "setUser", "AppState", "setInterval", "clearInterval", `return (${effect});`)(session, navigation, { current: 0 }, (v) => { current = v; }, { addEventListener: () => ({ remove: () => {} }) }, () => 1, () => {});
  const cleanup = fn(); return { user: () => current, resets, emit: (event) => subscriber(event), cleanup, removed: () => removed };
}
test("actual App effect checks persistent storage even when in-memory hasSession is false", async () => {
  let reads = 0; const live = runAppEffect(async () => { reads++; return user; }); await tick();
  assert.equal(reads, 1); assert.equal(live.user(), user); assert.equal(live.resets.length, 0); live.cleanup(); assert.equal(live.removed(), true);
});
test("actual App effect removes stale dashboard identity for missing/rejected sessions, not network failures", async () => {
  for (const restore of [async () => null, async () => { throw Object.assign(Error("Expired"), { status: 401 }); }]) {
    const live = runAppEffect(restore); await tick(); assert.equal(live.user(), null); assert.equal(live.resets[0].routes[0].name, "Login"); live.cleanup();
  }
  const network = runAppEffect(async () => { throw Object.assign(Error("Offline"), { transient: true }); }); await tick();
  assert.equal(network.user(), user); assert.equal(network.resets.length, 0);
  network.emit({ authenticated: false, reason: "cleared" }); assert.equal(network.user(), null); network.cleanup();
});
