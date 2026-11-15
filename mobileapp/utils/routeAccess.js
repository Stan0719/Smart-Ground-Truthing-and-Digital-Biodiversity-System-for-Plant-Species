export const BOTANIST_ONLY_ROOT_ROUTES = new Set([
  "BotanistDashboard", "BotanistSubmissions", "BotanistMyDrafts", "BotanistMyObservations",
  "BotanistCorrectionRequests", "BotanistPlantDetail", "BotanistSpeciesRequestDetail",
  "EditSpeciesRequest", "BotanistNotifications", "NotificationObservation", "AddObservation",
  "AddSpeciesRequest", "AddPlant", "EditPlant", "FieldCollection", "FieldCollectionPlant",
  "FieldCollectionEdit", "PlantQRCode",
]);
export const OFFICER_ONLY_ROOT_ROUTES = new Set(["RecordChangeReview"]);

export function canAccessRootRoute(routeName, user) {
  if (BOTANIST_ONLY_ROOT_ROUTES.has(routeName)) return user?.role === "botanist";
  if (OFFICER_ONLY_ROOT_ROUTES.has(routeName)) return user?.role === "conservation-officer";
  if (routeName === "RecordVersionHistory") return ["botanist", "conservation-officer"].includes(user?.role);
  return true;
}
