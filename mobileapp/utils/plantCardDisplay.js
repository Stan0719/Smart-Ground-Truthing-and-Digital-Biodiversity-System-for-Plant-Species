import { getPlantLocationDisplay } from "./plantLocationDisplay";

export function getPlantCardZoneLabel(plant, role, { restricted, missing }) {
  if (plant?.currentStatus !== "Approved") return missing;
  const location = getPlantLocationDisplay(plant.location, role);
  if (location.status === "restricted") return restricted;
  return plant.location?.zone || missing;
}
