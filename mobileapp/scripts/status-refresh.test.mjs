import test from "node:test";
import assert from "node:assert/strict";
import { watchStatus, STATUS_REFRESH_INTERVAL_MS } from "../utils/statusRefresh.js";

test("focused status refresh does not overlap and stops on background and blur", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let change, resolveRead, reads = 0;
  const appState = {
    currentState: "active",
    addEventListener(_event, callback) {
      change = callback;
      return { remove: () => { change = null; } };
    },
  };
  const stop = watchStatus(appState, () => {
    reads++;
    return new Promise((resolve) => { resolveRead = resolve; });
  });
  t.mock.timers.tick(STATUS_REFRESH_INTERVAL_MS);
  assert.equal(reads, 1);
  change("background");
  change("active");
  t.mock.timers.tick(STATUS_REFRESH_INTERVAL_MS);
  assert.equal(reads, 1);
  change("background");
  resolveRead();
  await Promise.resolve();
  t.mock.timers.tick(STATUS_REFRESH_INTERVAL_MS);
  assert.equal(reads, 1);
  change("active");
  assert.equal(reads, 2);
  stop();
  resolveRead();
  await Promise.resolve();
  t.mock.timers.tick(STATUS_REFRESH_INTERVAL_MS);
  assert.equal(reads, 2);
  assert.equal(change, null);
});
