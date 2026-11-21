import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const scan = read("../screens/Scan.js");
const addPlant = read("../screens/AddPlant.js");

test("scanner resolves inventory before recording visitor history or offering registration", () => {
  assert.match(scan, /const result = await fetchPlantByQRCode\(token\)/);
  assert.match(scan, /result\?\.assigned && user\?\.role\?\.toLowerCase\(\) === "visitor"/);
  assert.match(scan, /result\.status === "retired"/);
  assert.match(scan, /result\.status === "generated" && \/\^\[1-9\]\\d\*\$\//);
  assert.match(scan, /user\?\.role\?\.toLowerCase\(\) === "botanist"\) navigation\.navigate\("AddPlant"/);
  assert.match(scan, /if \(scanInProgress\.current\) return/);
  assert.match(scan, /if \(!navigated && !prompted\) scanInProgress\.current = false/);
  assert.match(scan, /navigation\.navigate\("PlantDetails", \{ plantId: String\(plantId\) \}\)/);
});

test("an assigned Visitor scan opens Plant Details before the history write completes", async () => {
  const source = scan.match(/async function handleBarcodeScanned\([\s\S]*?\n  }(?=\s*\/\/)/)[0];
  const events = [];
  let finishHistory;
  const history = new Promise((resolve) => { finishHistory = resolve; });
  const dependencies = {
    scanInProgress: { current: false },
    parsePlantQrPayload: () => "synthetic-qr",
    fetchPlantByQRCode: async () => ({ assigned: true, plant: { plant_id: 8 } }),
    recordVisitorScan: async () => { events.push("history-started"); await history; events.push("history-saved"); },
    user: { id: "visitor", role: "Visitor" },
    navigation: { navigate: (name, params) => events.push([name, params]) },
  };
  const handle = new Function(...Object.keys(dependencies), source + "\nreturn handleBarcodeScanned;")(...Object.values(dependencies));
  await handle({ data: "synthetic-qr" });
  await handle({ data: "synthetic-qr" });
  assert.deepEqual(events, [["PlantDetails", { plantId: "8" }], "history-started"]);
  finishHistory();
  await history;
  assert.equal(events.at(-1), "history-saved");
});

test("Pending Review scan prompts by role without navigation or a second request", async () => {
  const source = scan.match(/async function handleBarcodeScanned\([\s\S]*?\n  }(?=\s*\/\/)/)[0];
  for (const [role, accountId, status, expected] of [
    [undefined, null, "unavailable_yet", "pendingPublic"],
    ["Visitor", "visitor", "unavailable_yet", "pendingPublic"],
    ["Botanist", "owner", "pending_review", "pendingBotanist"],
    ["Botanist", "other", "pending_review", "pendingBotanist"],
  ]) {
    let calls = 0, prompt, navigations = 0;
    const dependencies = {
      scanInProgress: { current: false }, parsePlantQrPayload: () => "synthetic-qr",
      fetchPlantByQRCode: async () => { calls++; return { assigned: false, status }; },
      user: role ? { id: accountId, role } : null,
      setPrompt: (value) => { prompt = value; }, navigation: { navigate: () => { navigations++; } },
    };
    const handle = new Function(...Object.keys(dependencies), source + "\nreturn handleBarcodeScanned;")(...Object.values(dependencies));
    await handle({ data: "synthetic-qr" });
    await handle({ data: "synthetic-qr" });
    assert.equal(calls, 1);
    assert.equal(prompt.kind, expected);
    assert.equal(prompt.qrId, null);
    assert.equal(navigations, 0);
  }
  assert.match(scan, /else dismissPrompt\(\)/);
  const dismissSource = scan.match(/const dismissPrompt = \(\) => \{[^\n]+/)[0];
  let prompt = { kind: "pendingPublic" }, cameraKey = 0;
  const scanInProgress = { current: true };
  const dismiss = new Function("setPrompt", "setCameraKey", "scanInProgress", `${dismissSource}\nreturn dismissPrompt;`)(
    (value) => { prompt = value; }, (update) => { cameraKey = update(cameraKey); }, scanInProgress);
  dismiss();
  assert.equal(prompt, null);
  assert.equal(cameraKey, 1);
  assert.equal(scanInProgress.current, false);
  const english = JSON.parse(read("../translations/en.json")).scan;
  assert.equal(english.noRecordFound, "No Record Found");
  assert.equal(english.plantNotAvailableYet, "Plant information is not available yet.");
  assert.equal(english.qrAlreadySubmitted, "QR Already Submitted");
  assert.equal(english.pendingReviewQr, "This QR code has already been assigned to a plant record and is currently pending review.");
});

test("Rejected and Withdrawn QR markers show role-specific prompts without navigation", async () => {
  const source = scan.match(/async function handleBarcodeScanned\([\s\S]*?\n  }(?=\s*\/\/)/)[0];
  for (const [role, status, kind] of [
    [null, "record_unavailable", "invalidRecordPublic"],
    ["Visitor", "record_unavailable", "invalidRecordPublic"],
    ["Botanist", "invalid_record", "invalidRecordBotanist"],
  ]) {
    let prompt, requests = 0, navigations = 0;
    const dependencies = {
      scanInProgress: { current: false }, parsePlantQrPayload: () => "qr",
      fetchPlantByQRCode: async () => { requests++; return { assigned: false, status }; },
      user: role ? { role, id: "account" } : null,
      setPrompt: (value) => { prompt = value; }, navigation: { navigate: () => { navigations++; } },
    };
    const handle = new Function(...Object.keys(dependencies), source + "\nreturn handleBarcodeScanned;")(...Object.values(dependencies));
    await handle({ data: "qr" }); await handle({ data: "qr" });
    assert.equal(prompt.kind, kind);
    assert.equal(prompt.qrId, null);
    assert.equal(requests, 1);
    assert.equal(navigations, 0);
  }
  const english = JSON.parse(read("../translations/en.json")).scan;
  assert.equal(english.noRecordFound, "No Record Found");
  assert.equal(english.plantNotAvailable, "Plant information is not available.");
  assert.equal(english.qrNoLongerValid, "QR Code No Longer Valid");
  assert.equal(english.invalidRecordQr, "This QR code is linked to a rejected or withdrawn plant record and can no longer be used for plant registration.");
});

test("Add Plant matches backend inventory ID and token, keeps QR picker editable, and rechecks before submission", () => {
  assert.match(addPlant, /String\(code\.qr_id\) === String\(scannedId\) &&\s*code\.qr_code === route\.params\?\.scannedQrToken/);
  assert.match(addPlant, /if \(match\) setSelectedQRCode\(match\)/);
  assert.match(addPlant, /setShowQRDropdown\(\(open\) => !open\)/);
  assert.match(addPlant, /String\(code\.qr_id\) === String\(selectedQRCode\.qr_id\)/);
  assert.match(addPlant, /code\.status === "generated" && code\.plant_id == null/);
  assert.match(addPlant, /qr_id: selectedQRCode\.qr_id/);
});

test("scanner and unavailable QR labels exist in all languages", () => {
  for (const language of ["en", "ms", "zh"]) {
    const strings = JSON.parse(read(`../translations/${language}.json`));
    for (const key of ["noPlantRecordFound", "visitorUnassigned", "botanistUnassigned", "addNewPlant", "qrRetired", "noRecordFound", "plantNotAvailableYet", "qrAlreadySubmitted", "pendingReviewQr", "qrNoLongerValid", "invalidRecordQr", "plantNotAvailable"])
      assert.ok(strings.scan[key] && !strings.scan[key].includes("???"), `${language}:scan.${key}`);
    assert.ok(strings.addPlant.scannedQrUnavailable, `${language}:addPlant.scannedQrUnavailable`);
  }
});
