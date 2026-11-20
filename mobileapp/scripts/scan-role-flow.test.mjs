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
    for (const key of ["noPlantRecordFound", "visitorUnassigned", "botanistUnassigned", "addNewPlant", "qrRetired"])
      assert.ok(strings.scan[key] && !strings.scan[key].includes("???"), `${language}:scan.${key}`);
    assert.ok(strings.addPlant.scannedQrUnavailable, `${language}:addPlant.scannedQrUnavailable`);
  }
});
