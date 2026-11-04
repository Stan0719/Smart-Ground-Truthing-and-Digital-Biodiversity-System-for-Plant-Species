import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createQRInventoryLoader, normalizeQRCodes } from "../utils/qrInventory.js";
import { A4_PRINT_OPTIONS, buildQRPrintHtml, buildQRSvg } from "../utils/qrPrint.js";

const row = (id, extra = {}) => ({ qr_id: id, qr_code: `token-${id}`, plant_id: null, status: "generated", ...extra });
const payload = (...records) => ({ qr_codes: records });
const qrcodeCore = createRequire(import.meta.url)("qrcode/lib/core/qrcode");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("initial load distinguishes loading, valid empty inventory and failure", async () => {
  let fail = true;
  const changes = [];
  const loader = createQRInventoryLoader(async () => {
    if (fail) throw Error("Sign in before making a business request.");
    return payload();
  }, (state) => changes.push(state));
  const request = loader.refresh();
  assert.equal(loader.getState().loading, true);
  assert.equal(loader.getState().hasLoaded, false);
  assert.equal(await request, false);
  assert.equal(loader.getState().hasLoaded, false);
  assert.match(loader.getState().error, /Sign in/);
  fail = false;
  assert.equal(await loader.refresh(), true);
  assert.equal(loader.getState().hasLoaded, true);
  assert.deepEqual(loader.getState().records, []);
  assert.equal(loader.getState().error, "");
  assert.ok(changes.length > 0);
});

test("repeated refresh retains cards while loading and on network, auth or malformed-response errors", async () => {
  let next = payload(row(1), row(2));
  const loader = createQRInventoryLoader(async () => {
    if (next instanceof Error) throw next;
    return next;
  }, () => {});
  await loader.refresh();
  const original = loader.getState().records;
  for (const result of [Error("Network request failed"), Error("Access denied"), {}, { qr_codes: null }, payload(row(3), { qr_id: 4 })]) {
    next = result;
    const request = loader.refresh();
    assert.equal(loader.getState().records, original);
    assert.equal(loader.getState().loading, true);
    assert.equal(await request, false);
    assert.equal(loader.getState().records, original);
    assert.equal(loader.getState().hasLoaded, true);
    assert.ok(loader.getState().error);
    assert.equal(loader.getState().loading, false);
  }
  next = payload(row(1), row(2));
  for (let i = 0; i < 10; i++) {
    assert.equal(await loader.refresh(), true);
    assert.deepEqual(loader.getState().records.map((qr) => qr.id), ["2", "1"]);
  }
  next = payload();
  await loader.refresh();
  assert.deepEqual(loader.getState().records, []);
  assert.equal(loader.getState().error, "");
});

test("pull-to-refresh and focus refresh share one in-flight request", async () => {
  const result = deferred();
  let calls = 0;
  const loader = createQRInventoryLoader(() => { calls++; return result.promise; }, () => {});
  const focus = loader.refresh();
  const pull = loader.refresh();
  assert.equal(focus, pull);
  await Promise.resolve();
  assert.equal(calls, 1);
  result.resolve(payload(row(1)));
  await Promise.all([focus, pull]);
  assert.equal(loader.getState().records.length, 1);
});

test("late response from a previous visit cannot replace newer records or loading state", async () => {
  const old = deferred(), latest = deferred();
  let calls = 0;
  const loader = createQRInventoryLoader(() => (++calls === 1 ? old.promise : latest.promise), () => {});
  const previousVisit = loader.refresh();
  await Promise.resolve();
  loader.cancel();
  const returnVisit = loader.refresh();
  await Promise.resolve();
  old.resolve(payload());
  assert.equal(await previousVisit, false);
  assert.equal(loader.getState().loading, true);
  latest.resolve(payload(row(9)));
  await returnVisit;
  assert.deepEqual(loader.getState().records.map((qr) => qr.id), ["9"]);
  assert.equal(loader.getState().loading, false);
});

test("late errors after leaving do not notify an unmounted screen", async () => {
  const result = deferred();
  let updates = 0;
  const loader = createQRInventoryLoader(() => result.promise, () => updates++);
  const request = loader.refresh();
  await Promise.resolve();
  loader.cancel();
  const before = updates;
  result.reject(Error("Late timeout"));
  await request;
  assert.equal(updates, before);
  assert.equal(loader.getState().error, "");
});

test("an older empty response cannot overwrite an already completed newer visit", async () => {
  const old = deferred();
  let calls = 0;
  const loader = createQRInventoryLoader(() => (++calls === 1 ? old.promise : payload(row(7))), () => {});
  const stale = loader.refresh();
  await Promise.resolve();
  loader.cancel();
  await loader.refresh();
  old.resolve(payload());
  await stale;
  assert.deepEqual(loader.getState().records.map((qr) => qr.id), ["7"]);
});

test("normalization keeps assigned records, deduplicates and sorts bigint identifiers stably", () => {
  const result = normalizeQRCodes(payload(
    row("9007199254740993"), row("9007199254740992"), row(9), row(9),
    row(10, { plant_id: 4, status: "assigned" }), row(11, { plant_id: 5, status: "active" }),
  ));
  assert.deepEqual(result.map((qr) => qr.id), ["9007199254740993", "9007199254740992", "11", "10", "9"]);
  assert.equal(result.find((qr) => qr.id === "10").plantId, "4");
  assert.equal(result.find((qr) => qr.id === "9").label, "QR-0009");
  assert.throws(() => normalizeQRCodes(payload(row(1), row(1, { qr_code: "different" }))), /conflicting/);
  assert.throws(() => normalizeQRCodes(payload(row(1), row(2, { qr_code: "token-1" }))), /duplicate QR tokens/);
});

test("confirmed generation survives a failed read and invalidates older responses", async () => {
  const old = deferred();
  let calls = 0;
  const loader = createQRInventoryLoader(() => {
    calls++;
    if (calls === 1) return payload(row(1));
    if (calls === 2) return old.promise;
    throw Error("Read timed out");
  }, () => {});
  await loader.refresh();
  const stale = loader.refresh();
  await Promise.resolve();
  assert.equal(loader.addGenerated(payload(row(2), row(3))), 2);
  old.resolve(payload(row(1)));
  await stale;
  assert.deepEqual(loader.getState().records.map((qr) => qr.id), ["3", "2", "1"]);
  assert.equal(await loader.refresh(), false);
  assert.deepEqual(loader.getState().records.map((qr) => qr.id), ["3", "2", "1"]);
  assert.throws(() => loader.addGenerated(payload()), /did not return/);
});

test("print builds a vector QR from the unchanged payload with A4 geometry", async () => {
  const qrPayload = "original-payload-for-this-code";
  const qr = normalizeQRCodes(payload(row(17, { qr_code: qrPayload, plant_id: 8, status: "active" })))[0];
  const html = buildQRPrintHtml([{ qr }]);
  assert.match(html, /QR-0017/);
  assert.match(html, /Plant 8/);
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="qr-svg"/);
  assert.match(html, /viewBox="0 0 \d+ \d+"/);
  assert.match(html, /width="227" height="227"/);
  assert.match(html, /fill="#fff"/);
  assert.match(html, /fill="#000"/);
  assert.doesNotMatch(html, /<img|data:image/);
  assert.match(html, /size:A4 portrait;margin:10mm/);
  assert.match(html, /\.qr-svg\{[^}]*width:60mm;height:60mm/);
  assert.equal((html.match(/class="page"/g) || []).length, 1);
  assert.doesNotMatch(html, /page-break-after\s*:\s*always|break-after\s*:\s*page/);
  assert.equal(qr.value, qrPayload);
  const expected = qrcodeCore.create(qrPayload, { errorCorrectionLevel: "M" }).modules;
  const expectedPath = [];
  for (let row = 0; row < expected.size; row++) {
    for (let column = 0; column < expected.size; column++) {
      if (expected.get(row, column)) expectedPath.push(`M${column + 4},${row + 4}h1v1h-1z`);
    }
  }
  assert.ok(html.includes(`<path d="${expectedPath.join("")}" fill="#000"/>`));
  assert.match(html, /font-size:24pt/);
  assert.match(html, /font-size:14pt/);
  assert.ok(Math.abs(A4_PRINT_OPTIONS.width - 595.28) < 0.02);
  assert.ok(Math.abs(A4_PRINT_OPTIONS.height - 841.89) < 0.02);
});

test("print reports missing/invalid image exports, escapes labels and produces one page per tag", async () => {
  assert.throws(() => buildQRPrintHtml([]), /Choose at least/);
  assert.throws(() => buildQRSvg(""), /Invalid QR payload/);
  const html = buildQRPrintHtml([
    { qr: { label: '<tag "one">', value: "first-payload", plantId: null } },
    { qr: { label: "QR-0002", value: "second-payload", plantId: null } },
  ]);
  assert.equal((html.match(/class="page"/g) || []).length, 2);
  assert.equal((html.match(/class="page" style="break-before:page;page-break-before:always"/g) || []).length, 1);
  assert.doesNotMatch(html, /page-break-after\s*:\s*always|break-after\s*:\s*page/);
  assert.equal((html.match(/class="qr-svg"/g) || []).length, 2);
  assert.ok(html.includes("&lt;tag &quot;one&quot;&gt;"));
  assert.equal(html.includes('<tag "one">'), false);
});
