import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../screens/PlantQRCode.js");

test("QR page removes its informational workflow and repeated section descriptions", () => {
  assert.doesNotMatch(page, /fieldSurveyWorkflow|workflowCard|workflowStep|stepCircle|stepNumber|stepText/);
  assert.doesNotMatch(page, /createPrintableCodesNowThenChooseOneWhenYouRegister|printUnusedTagsForYourFieldVisitOrReprintAn/);
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(read(`../translations/${language}.json`));
    for (const key of [
      "fieldSurveyWorkflow", "addAPlantRecordWithItsFieldDetailsAndPhotos", "submitThePlantRecordForOfficerReview",
      "theBackendAssignsAUniqueQrCodeToTheSaved", "theBackendAssignsTheQrCodeToTheSavedPlant",
      "printTheCodeAndAttachItToTheDocumentedPlant", "theQrLinkBecomesPubliclyAvailableAfterApproval",
    ]) assert.equal(key in translations.plantQRCode, false, `${language}:${key} is no longer used`);
  }
});

test("unused QR cards retain readable previews and compact 44-point icon actions", () => {
  assert.match(page, /<QRCode value=\{qr\.value\} size=\{100\} quietZone=\{20\}/);
  assert.match(page, /actionButton:\s*\{[^}]*minWidth:\s*62[^}]*minHeight:\s*44/);
  assert.match(page, /accessibilityLabel=\{t\("plantQRCode\.print"/);
  assert.match(page, /accessibilityLabel=\{t\("plantQRCode\.deleteQrCode"/);
});

test("Generate, Print, Print All, and Delete remain wired to their existing handlers", () => {
  assert.match(page, /onPress=\{handleGenerate\}/);
  assert.match(page, /method:\s*"POST"[\s\S]*?body:\s*\{ count \}/);
  assert.match(page, /onPress=\{\(\) => handlePrintQR\(qr\)\}/);
  assert.match(page, /onPress=\{handlePrintAll\}/);
  assert.match(page, /onPress=\{\(\) => confirmDeleteQR\(qr\)\}/);
  assert.match(page, /loader\.retire\(qr\.id\)/);
  assert.doesNotMatch(page, /loader\.removeDeleted/);
});

test("status filters use the existing QR inventory values, and Add Plant still owns QR assignment", () => {
  assert.match(page, /availableQRCodes = plantQRCodes\.filter\(\(qr\) => !qr\.plantId && qr\.status === "generated"\)/);
  assert.match(page, /assignedQRCodes = plantQRCodes\.filter\(\(qr\) => qr\.status !== "retired" && \(Boolean\(qr\.plantId\) \|\| qr\.status === "assigned" \|\| qr\.status === "active"\)\)/);
  assert.match(page, /activeQRCodesCount = availableQRCodes\.length \+ assignedQRCodes\.length/);
  assert.match(page, /count: activeQRCodesCount/,'visible total counts only unused and assigned QR codes');
  assert.doesNotMatch(page, /retiredQRCodes|plantQRCode\.retired|noRetiredQrCodes|retiredBadge/);
  const addPlant = read("../screens/AddPlant.js");
  assert.match(addPlant, /codes\.filter\(\(code\) => code\.status === "generated" && code\.plant_id == null\)/);
  assert.match(addPlant, /qr_id: selectedQRCode\.qr_id/);
});

test("QR inventory has only Unused and Assigned tabs and one expandable card at a time", () => {
  assert.match(page, /key: "unused"/);
  assert.match(page, /key: "assigned"/);
  assert.doesNotMatch(page, /key:\s*"retired"/);
  assert.match(page, /const expanded = expandedQrId === qr\.id/);
  assert.match(page, /setExpandedQrId\(expanded \? null : qr\.id\)/);
  assert.match(page, /activeTab === "assigned" \? assignedQRCodes : availableQRCodes/);
  assert.match(page, /{unused && <TouchableOpacity/,'Delete is rendered only for unused codes');
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(read(`../translations/${language}.json`));
    for (const key of ["pageTitle", "pageDescription", "totalCodes", "unusedCodes", "assignedCodes", "assigned", "availableForAssignment", "noAssignedQrCodes", "printAction", "deleteAction", "confirmDeleteQrCodeMessage", "qrCodeDeletedMessage"])
      assert.ok(translations.plantQRCode[key], `${language}:${key} translation exists`);
    assert.equal("retired" in translations.plantQRCode, false, `${language}: retired tab label removed`);
    assert.equal("noRetiredQrCodes" in translations.plantQRCode, false, `${language}: retired empty label removed`);
  }
});

test("QR management remains behind its safe native navigator header", () => {
  const app = read("../App.js");
  assert.match(app, /name="PlantQRCode"[\s\S]*?headerShown:\s*true/);
  assert.match(app, /name="PlantQRCode"[\s\S]*?title:\s*t\("plantQRCode\.pageTitle"\)/);
});
