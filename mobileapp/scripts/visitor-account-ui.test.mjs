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

test("Login Visitor account popup keeps its open/close controls and localized benefits", () => {
  const login = read("../screens/Login.js");
  assert.match(login, /onPress=\{\(\) => setShowAccountBenefits\(true\)\}/);
  assert.match(login, /onRequestClose=\{\(\) => setShowAccountBenefits\(false\)\}/);
  assert.match(login, /accessibilityLabel=\{t\("login\.close"\)\} onPress=\{\(\) => setShowAccountBenefits\(false\)\}/);
  assert.match(login, /style=\{styles\.accountBenefitsLink\}>\{t\("login\.whyRegisterOrLogIn"\)\}/);
  assert.match(login, /style=\{styles\.modalTitle\}>\{t\("login\.exploreAsGuest"\)\}/);
  assert.equal((login.match(/onPress=\{\(\) => setShowAccountBenefits\(true\)\}/g) || []).length, 2);
  assert.match(login, /onPress=\{handleGuest\}/);
  const handler = login.slice(login.indexOf("  function handleGuest()"), login.indexOf("  if (pendingPasswordSession)"));
  assert.match(handler, /setShowAccountBenefits\(false\)/);
  assert.match(handler, /navigation\.replace\("MainTabs"\)/);
  assert.doesNotMatch(handler, /setShowAccountBenefits\(true\)/);
  assert.match(login, /t\("login\.loginOrRegister"\)/);
  assert.match(login, /t\("login\.visitorBenefitsHeading"\)/);
  assert.match(login, /t\("login\.visitorCompactBenefit"\)/);
  assert.doesNotMatch(login, /\["heart-outline", "visitorSaveBenefit"\]/);
  for (const language of ["en", "ms", "zh"]) {
    const strings = JSON.parse(read(`../translations/${language}.json`)).login;
    for (const key of ["exploreAsGuest", "guestExploreDescription", "visitorBenefitsHeading", "visitorCompactBenefit", "loginOrRegister"]) assert.ok(strings[key]);
  }
  assert.match(login, /ScrollView style=\{styles\.benefitsScrollView\}/);
  const expected = {
    en: ["Why Create a Visitor Account?", "Without a Visitor Account", "With a Visitor Account", "Browse plants, explore species, and scan QR codes as a Guest.", "Browse plants, explore species, and scan QR codes.", "Save your favourite plants and species for easy access later.", "View your QR scan history to revisit previously scanned plants.", "Plant and Observation submissions are available only to authorized Botanists."],
    ms: ["Mengapa Perlu Mendaftar Akaun Pelawat?", "Tanpa Akaun Pelawat", "Dengan Akaun Pelawat", "Layari tumbuhan, terokai spesies dan imbas kod QR sebagai tetamu.", "Layari tumbuhan, terokai spesies dan imbas kod QR.", "Simpan tumbuhan dan spesies kegemaran anda untuk diakses dengan mudah kemudian.", "Lihat sejarah imbasan kod QR anda untuk melawat semula tumbuhan yang pernah diimbas.", "Penghantaran rekod tumbuhan dan pemerhatian hanya tersedia kepada Ahli Botani yang diberi kebenaran."],
    zh: ["为什么要注册访客账户？", "没有访客账户", "拥有访客账户", "以访客身份浏览植物、探索物种并扫描二维码。", "浏览植物、探索物种并扫描二维码。", "收藏喜爱的植物和物种，方便日后查看。", "查看二维码扫描历史，重新浏览之前扫描过的植物。", "只有获得授权的植物学家才能提交植物和观察记录。"],
  };
  for (const [language, values] of Object.entries(expected)) {
    const strings = JSON.parse(read(`../translations/${language}.json`)).login;
    assert.deepEqual([strings.whyRegisterOrLogIn, strings.withoutAccount, strings.withAccount, strings.guestCapabilities,
      strings.visitorBenefitBrowse, strings.visitorBenefitFavourites, strings.visitorBenefitScanHistory, strings.botanistRestriction], values);
  }
});
