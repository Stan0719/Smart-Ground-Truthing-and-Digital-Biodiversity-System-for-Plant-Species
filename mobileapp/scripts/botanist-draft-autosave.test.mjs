import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url), ts = require("typescript");
const source = readFileSync(new URL("../utils/botanistDraftAutosave.js", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "botanistDraftAutosave.js", compilerOptions: {
  module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
} }).outputText;

function harness() {
  const refs = [], stateSlots = [], hookSlots = [], pendingEffects = [], timers = new Map(), appListeners = new Set(), navListeners = new Map();
  let hookIndex = 0, timerId = 0, lastResult, lastProps;
  const React = {
    useRef(initial) { const i = hookIndex++; return refs[i] ||= { current: initial }; },
    useState(initial) { const i = hookIndex++; if (!(i in stateSlots)) stateSlots[i] = typeof initial === "function" ? initial() : initial; return [stateSlots[i], (next) => { stateSlots[i] = typeof next === "function" ? next(stateSlots[i]) : next; }]; },
    useCallback(fn, deps) {
      const i = hookIndex++, prior = hookSlots[i];
      const same = prior && deps?.length === prior.deps?.length && deps.every((value, index) => Object.is(value, prior.deps[index]));
      if (same) return prior.callback;
      hookSlots[i] = { deps, callback: fn };
      return fn;
    },
    useEffect(effect, deps) {
      const i = hookIndex++, prior = hookSlots[i];
      const changed = !prior || !deps || deps.some((value, index) => !Object.is(value, prior.deps?.[index]));
      if (changed) pendingEffects.push(() => {
        prior?.cleanup?.();
        const cleanup = effect(); hookSlots[i] = { deps, cleanup };
      });
    },
    useLayoutEffect(effect, deps) { React.useEffect(effect, deps); },
  };
  const AppState = { addEventListener(_event, listener) { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } };
  const navigation = { addListener(event, listener) { navListeners.set(event, listener); return () => navListeners.delete(event); }, dispatch(action) { navigation.dispatched = action; } };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => name === "react" ? React : name === "react-native" ? { AppState } : (() => { throw Error(name); })(), module, module.exports);
  const useAutosave = module.exports.useBotanistDraftAutosave;
  function render(props) {
    lastProps = props;
    hookIndex = 0; pendingEffects.length = 0;
    lastResult = useAutosave({ ...props, navigation });
    pendingEffects.splice(0).forEach((run) => run());
    return lastResult;
  }
  function advanceTime(ms = Infinity) {
    const due = [...timers.entries()].filter(([, timer]) => timer.delay <= ms);
    for (const [id] of due) timers.delete(id);
    due.forEach(([, timer]) => timer.callback());
  }
  function unmount() { for (const slot of hookSlots) slot?.cleanup?.(); }
  function installTimers() {
    const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
    globalThis.clearTimeout = (id) => timers.delete(id);
    return () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; };
  }
  return { render, advanceTime, unmount, appListeners, navListeners, navigation, timers, installTimers,
    retryDetached: module.exports.retryBotanistDraftAutosave,
    stopDraftWriter: module.exports.stopBotanistDraftAutosave,
    subscribeFailures: module.exports.subscribeBotanistDraftAutosaveFailures,
    get result() { return lastResult; }, get props() { return lastProps; } };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("meaningful changes persist after short coalescing, before the two-second fallback", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  try {
    h.render({ enabled: true, signature: "one", save: async () => saved.push("one") });
    assert.deepEqual([...h.timers.values()].map((timer) => timer.delay).sort((a, b) => a - b), [300, 1000, 2000]);
    h.render({ enabled: true, signature: "two", save: async () => saved.push("two") });
    assert.equal(h.timers.size, 3, "rapid changes coalesce to fast, maximum-wait and fallback timers");
    h.advanceTime(300);
    await tick();
    assert.deepEqual(saved, ["two"], "the latest snapshot is durable after the fast interval");
    h.advanceTime(2000);
    await tick();
    assert.deepEqual(saved, ["two"], "the full-delay timer does not duplicate a completed write");
  } finally { restoreTimers(); }
});

test("an edit made during a write is serialized and the newest snapshot follows it", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  let releaseFirst;
  try {
    h.render({ enabled: true, signature: "one", save: () => new Promise((resolve) => { saved.push("one"); releaseFirst = resolve; }) });
    h.advanceTime(300);
    await Promise.resolve();
    h.render({ enabled: true, signature: "two", save: async () => saved.push("two") });
    h.advanceTime(300);
    releaseFirst();
    await tick();
    assert.deepEqual(saved, ["one", "two"]);
  } finally { restoreTimers(); }
});

test("Back is not intercepted; blur and unmount start best-effort persistence without waiting", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  let release;
  try {
    h.render({ enabled: true, signature: "latest", save: () => new Promise((resolve) => { saved.push("latest"); release = resolve; }) });
    h.navigation.dispatch("BACK");
    assert.equal(h.navigation.dispatched, "BACK", "navigation dispatch proceeds immediately");
    [...h.navListeners.values()][0]();
    await Promise.resolve();
    assert.deepEqual(saved, ["latest"], "blur flush starts a write without gating the transition");
    h.unmount();
    release();
    await tick();
  } finally { restoreTimers(); }

  assert.doesNotMatch(source, /usePreventRemove|beforeRemove/);
});

test("backgrounding flushes immediately and a failed fast write remains retryable", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  let attempts = 0;
  try {
    h.render({ enabled: true, signature: "first", save: async () => saved.push("background") });
    [...h.appListeners][0]("background");
    await tick();
    assert.deepEqual(saved, ["background"]);

    h.render({ enabled: true, signature: "retry", save: async () => { attempts += 1; if (attempts === 1) throw Error("storage full"); saved.push("retry"); } });
    h.advanceTime(300);
    await tick();
    assert.equal(h.timers.size, 1, "a failed write schedules the full-delay retry");
    await h.result.retry();
    assert.equal(attempts, 2);
    assert.deepEqual(saved, ["background", "retry"]);
  } finally { restoreTimers(); }
});

test("a detached write failure appears in My Drafts and its retry clears after durable success", async () => {
  const h = harness(), restoreTimers = h.installTimers(), failures = [];
  let attempts = 0;
  try {
    h.render({ enabled: true, signature: "typed", accountId: "owner", errorKey: "owner:route", save: async () => {
      attempts += 1;
      if (attempts === 1) throw Error("storage unavailable");
      return { client_key: "draft-1" };
    } });
    h.unmount();
    await tick();
    const unsubscribe = h.subscribeFailures((items) => failures.splice(0, failures.length, ...items));
    assert.equal(failures[0]?.key, "owner:route");
    assert.match(failures[0]?.message || "", /storage unavailable/);
    await h.retryDetached("owner:route");
    assert.deepEqual(failures, []);
    assert.equal(attempts, 2);
    unsubscribe();
  } finally { restoreTimers(); }
});

test("My Draft delete cancels a registered writer so it cannot recreate a deleted draft", async () => {
  const h = harness(), restoreTimers = h.installTimers();
  let writes = 0;
  try {
    h.render({ enabled: true, signature: "one", accountId: "owner", save: async () => { writes += 1; return { client_key: "draft-1" }; } });
    h.advanceTime(300);
    await tick();
    await h.stopDraftWriter("owner", "draft-1");
    h.render({ enabled: true, signature: "two", accountId: "owner", save: async () => { writes += 1; return { client_key: "draft-1" }; } });
    h.advanceTime(Infinity);
    await tick();
    assert.equal(writes, 1);
  } finally { restoreTimers(); }
});

test("unmount flushes pending form data and a new screen instance can recover the durable snapshot", async () => {
  const persisted = new Map(), first = harness(), restoreTimers = first.installTimers();
  try {
    first.render({ enabled: true, signature: "partially typed", save: async () => persisted.set("draft", "partially typed") });
    first.unmount();
    await tick();
    assert.equal(persisted.get("draft"), "partially typed");
  } finally { restoreTimers(); }

  const restarted = harness(), restoreRestartTimers = restarted.installTimers();
  try {
    restarted.render({ enabled: true, signature: "recovered", save: async () => persisted.set("draft", "recovered") });
    assert.equal(persisted.get("draft"), "partially typed", "mounting alone does not overwrite recovered data");
  } finally { restarted.unmount(); restoreRestartTimers(); }
});

test("stopping after successful submission or deletion cancels pending writes", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  try {
    const writer = h.render({ enabled: true, signature: "latest", save: async () => saved.push("write") });
    await writer.stop();
    h.advanceTime(Infinity);
    await Promise.resolve();
    assert.deepEqual(saved, []);
  } finally { restoreTimers(); }
});

test("a draft can be stopped by account/key before its first debounce writes anything", async () => {
  const h = harness(), restoreTimers = h.installTimers(), saved = [];
  try {
    h.render({ enabled: true, signature: "typed", accountId: "owner", clientKey: "new-draft", save: async () => saved.push("unexpected") });
    await h.stopDraftWriter("owner", "new-draft");
    h.advanceTime(Infinity);
    h.unmount();
    await tick();
    assert.deepEqual(saved, []);
  } finally { restoreTimers(); }
});

test("all active Botanist form routes use the shared encrypted-draft autosave lifecycle", () => {
  for (const path of ["AddPlant.js", "EditPlantRecord.js", "AddSpeciesRequest.js", "EditSpeciesRequest.js", "FieldCollection.js"]) {
    const screen = readFileSync(new URL(`../screens/${path}`, import.meta.url), "utf8");
    assert.match(screen, /useBotanistDraftAutosave/, `${path} uses the shared lifecycle handler`);
    assert.match(screen, /autoSaving/, `${path} exposes a localized saving state`);
  }
  const autosave = readFileSync(new URL("../utils/botanistDraftAutosave.js", import.meta.url), "utf8");
  assert.match(autosave, /FAST_WRITE_MS\s*=\s*300/);
  assert.match(autosave, /MAX_WRITE_WAIT_MS\s*=\s*1000/);
  assert.match(autosave, /FULL_WRITE_MS\s*=\s*2000/);
  assert.match(autosave, /AppState\.addEventListener/);
  assert.match(autosave, /addListener\?\.\("blur"/);
  assert.doesNotMatch(autosave, /usePreventRemove|beforeRemove/);
  const app = readFileSync(new URL("../App.js", import.meta.url), "utf8");
  for (const route of ["AddPlant", "EditPlant", "AddSpeciesRequest", "EditSpeciesRequest", "AddObservation", "FieldCollection", "FieldCollectionPlant", "FieldCollectionEdit"]) {
    const start = app.indexOf(`name="${route}"`);
    assert.notEqual(start, -1, `${route} route exists`);
    const end = app.indexOf("</RootStack.Screen>", start);
    assert.match(app.slice(start, end), /headerBackButtonMenuEnabled:\s*false/, `${route} disables native back menu dismiss-all`);
  }
});
