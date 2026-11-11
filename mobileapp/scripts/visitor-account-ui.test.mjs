import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Visitor Account retains profile, language, existing destinations, and logout callback", () => {
  const account = read("../screens/Account.js");
  assert.match(account, /<LanguageSelector \/>/);
  assert.match(account, /user\?\.name \|\| t\("account\.visitor"\)/);
  assert.match(account, /user\?\.email \|\| t\("account\.noEmail"\)/);
  assert.match(account, /navigation\.navigate\("FavouritePlants"\)/);
  assert.match(account, /navigation\.navigate\("ScanHistory"\)/);
  assert.match(account, /function handleLogout\(\)\s*\{\s*if \(onLogout\)\s*\{\s*onLogout\(\);/);
  assert.match(account, /maxWidth: 620/);
  assert.doesNotMatch(account, /sideBySide|collectionsRow|collectionCardHalf/);
  assert.match(account, /if \(!isVisitor\) return \(/);
  assert.match(account, /navigation\.navigate\("RecordChangeReview"\)/);
});

test("Visitor Logout uses Botanist Dashboard icon button dimensions, colors, and interaction", () => {
  const account = read("../screens/Account.js");
  const dashboard = read("../screens/BotanistDashboard.js");
  assert.match(account, /logoutButton: \{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#FAFBF7"[^}]*borderWidth: 1, borderColor: "#C9DEC9"/);
  assert.match(account, /<Ionicons name="log-out-outline" size=\{21\} color="#2F6B4F" \/>/);
  assert.match(account, /activeOpacity=\{0\.75\}/);
  assert.match(dashboard, /iconButton: \{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#FAFBF7"[^}]*borderWidth: 1, borderColor: "#C9DEC9"/);
  assert.match(dashboard, /<Ionicons name="log-out-outline" size=\{21\} color="#2F6B4F" \/>/);
});

test("Visitor Account uses a centered layout, profile-contained logout, and compact stacked collection rows", () => {
  const account = read("../screens/Account.js");
  assert.match(account, /maxWidth: 620/);
  assert.doesNotMatch(account, /sideBySide|collectionsRow|collectionCardHalf/);
  assert.match(account, /profileTopRow/);
  assert.match(account, /profileCopy/);
  assert.match(account, /styles\.collectionIcon/);
  assert.match(account, /styles\.collectionDescription/);
  assert.match(account, /collectionCard: \{[^}]*flexDirection: "row"/);
  assert.match(account, /t\("account\.myCollection"\)/);
  assert.equal((account.match(/style=\{styles\.logoutButton\}/g) || []).length, 1);
  assert.match(account, /navigation\.navigate\("FavouritePlants"\)/);
  assert.match(account, /navigation\.navigate\("ScanHistory"\)/);
  for (const language of ["en", "ms", "zh"]) {
    const catalogue = JSON.parse(read(`../translations/${language}.json`));
    assert.ok(catalogue.navigation.favouritePlants);
    assert.ok(catalogue.account.scanHistory);
    assert.ok(catalogue.account.viewYourFavouritePlants);
    assert.ok(catalogue.account.viewYourPreviousPlantScans);
    assert.ok(catalogue.account.myCollection);
    assert.ok(catalogue.account.logOut);
  }
});
