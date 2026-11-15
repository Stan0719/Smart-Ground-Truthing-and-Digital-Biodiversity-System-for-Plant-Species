import test from "node:test";
import assert from "node:assert/strict";
import { BOTANIST_ONLY_ROOT_ROUTES, OFFICER_ONLY_ROOT_ROUTES, canAccessRootRoute } from "../utils/routeAccess.js";

test("Botanist root routes are registered only for an authenticated Botanist", () => {
  for (const route of BOTANIST_ONLY_ROOT_ROUTES) {
    assert.equal(canAccessRootRoute(route, { id: "bot-1", role: "botanist" }), true, `${route} for Botanist`);
    for (const user of [null, { role: "visitor" }, { role: "conservation-officer" }, { role: "guest" }])
      assert.equal(canAccessRootRoute(route, user), false, `${route} for ${user?.role || "signed out"}`);
  }
});

test("Officer review routes remain separate and authorized version history remains shared", () => {
  for (const route of OFFICER_ONLY_ROOT_ROUTES) {
    assert.equal(canAccessRootRoute(route, { role: "conservation-officer" }), true);
    assert.equal(canAccessRootRoute(route, { role: "botanist" }), false);
    assert.equal(canAccessRootRoute(route, { role: "visitor" }), false);
  }
  for (const role of ["botanist", "conservation-officer"])
    assert.equal(canAccessRootRoute("RecordVersionHistory", { role }), true);
  assert.equal(canAccessRootRoute("RecordVersionHistory", { role: "visitor" }), false);
  assert.equal(canAccessRootRoute("MainTabs", null), true);
});
