import test from "node:test";
import assert from "node:assert/strict";
import { createScanHistoryLoader } from "../utils/scanHistoryLoader.js";

const page = (ids, nextOffset) => ({ scans: ids.map((scan_id) => ({ scan_id })), nextOffset });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(fetchPage, fetchAll = async () => []) {
  let state;
  const loader = createScanHistoryLoader({ fetchPage, fetchAll }, (next) => { state = next; });
  return { loader, get state() { return state; }, get ids() { return state.scans.map((scan) => scan.scan_id); } };
}

test("scan history loads the first page, deduplicates overlap, and stops on explicit end", async () => {
  const offsets = [];
  const next = deferred();
  const f = fixture((offset) => {
    offsets.push(offset);
    return offset === 0 ? page([3, 2], 2) : next.promise;
  });
  await f.loader.refresh("paged");
  assert.deepEqual(f.ids, [3, 2]);
  assert.deepEqual(offsets, [0]);
  const pending = f.loader.loadMore();
  await f.loader.loadMore();
  assert.equal(f.state.phase, "more");
  assert.deepEqual(offsets, [0, 2]);
  next.resolve(page([2, 1], null));
  await pending;
  assert.deepEqual(f.ids, [3, 2, 1]);
  await f.loader.loadMore();
  assert.deepEqual(offsets, [0, 2]);
});

test("a page failure preserves existing data and an explicit retry continues from the same offset", async () => {
  const offsets = [];
  const f = fixture(async (offset) => {
    offsets.push(offset);
    if (offset === 0) return page([2], 1);
    if (offsets.length === 2) throw Error("offline");
    return page([1], null);
  });
  await f.loader.refresh("paged");
  await f.loader.loadMore();
  assert.deepEqual(f.ids, [2]);
  assert.equal(f.state.pageError.message, "offline");
  await f.loader.loadMore();
  await f.loader.loadMore({ retry: true });
  assert.deepEqual(offsets, [0, 1, 1]);
  assert.deepEqual(f.ids, [2, 1]);
  assert.equal(f.state.pageError, null);
});

test("pull-to-refresh restarts from zero and a stale page cannot append to new results", async () => {
  const stale = deferred();
  let initialReads = 0;
  const f = fixture((offset) => offset ? stale.promise : page([++initialReads], 1));
  await f.loader.refresh("paged");
  const pending = f.loader.loadMore();
  const refresh = f.loader.refresh("paged", true);
  assert.equal(f.state.phase, "refresh");
  assert.deepEqual(f.ids, [1]);
  await refresh;
  stale.resolve(page([99], null));
  await pending;
  assert.deepEqual(f.ids, [2]);
  assert.equal(f.state.nextOffset, 1);
});

test("global filter mode replaces paged results and ignores late responses after filters change or account leaves", async () => {
  const all = deferred();
  const staleAccount = deferred();
  const f = fixture(() => page([4], 1), () => all.promise);
  await f.loader.refresh("paged");
  const search = f.loader.refresh("all");
  assert.deepEqual(f.ids, []);
  await f.loader.refresh("paged");
  all.resolve(page([4, 1], null).scans);
  await search;
  assert.deepEqual(f.ids, [4]);
  await f.loader.refresh("all");
  assert.deepEqual(f.ids, [4, 1]);
  const previous = fixture(() => staleAccount.promise);
  const pending = previous.loader.refresh("paged");
  previous.loader.cancel();
  staleAccount.resolve(page([99], null));
  await pending;
  assert.deepEqual(previous.ids, []);
});

test("authorization loss drops retained scan history", async () => {
  const f = fixture(async (offset) => {
    if (offset) throw Object.assign(Error("Forbidden"), { status: 403 });
    return page([1], 1);
  });
  await f.loader.refresh("paged");
  await f.loader.loadMore();
  assert.deepEqual(f.ids, []);
  assert.equal(f.state.nextOffset, null);
  assert.equal(f.state.error.status, 403);
});

test("returning from another screen keeps the existing pages", async () => {
  const f = fixture(async (offset) => offset === 0 ? page([3, 2], 2) : page([1], null));
  assert.equal(f.loader.resume("paged"), false);
  await f.loader.refresh("paged");
  await f.loader.loadMore();
  f.loader.cancel();
  assert.equal(f.loader.resume("paged"), true);
  assert.equal(f.loader.resume("all"), false);
  assert.deepEqual(f.ids, [3, 2, 1]);
});
