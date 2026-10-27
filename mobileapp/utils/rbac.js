import policy from "../../shared/rbac.cjs";

// Presentation checks for identities verified by faceSession. Server APIs remain
// authoritative; never call this with a role selected by the user or route params.
const mobileRoles = { botanist: "Botanist", visitor: "Visitor", "conservation-officer":"Conservation Officer" };
export function can(user, permission) {
  if (!user) return policy.permitted(null, permission);
  const role = Object.hasOwn(mobileRoles, user.role) ? mobileRoles[user.role] : null;
  if (!role || !user.id || user.offline) return false;
  // The face adapter projects id/name/email/role after verifying account state.
  // Honor explicit state flags when supplied by the authoritative service.
  return policy.permitted({
    role,
    status: user.status ?? "Active",
    mustChangePassword: user.mustChangePassword ?? false,
  }, permission);
}
export function canCollectDrafts(user) {
  return can(user && { ...user, offline: false }, "plants.create");
}
export function accountScreen(user) {
  return canCollectDrafts(user) ? "AccountTab" : "HomeTab";
}
