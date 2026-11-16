import { getPlantLocationDisplay } from "./plantLocationDisplay";

export function getPlantCardZoneValue(plant, role, { allowOwnedPending = false } = {}) {
  const botanistOwnPending = String(role || "").toLowerCase() === "botanist" &&
    allowOwnedPending === true && plant?.currentStatus === "Pending Review";
  if (plant?.currentStatus !== "Approved" && !botanistOwnPending) return null;
  const location = getPlantLocationDisplay(plant.location, role);
  if (location.status === "restricted") return null;
  const zone = location.zone ?? plant.location?.zone;
  return typeof zone === "string" && zone.trim() && zone !== "Not recorded" ? zone : null;
}

export function getPlantCardZoneLabel(plant, role, { restricted, missing, allowOwnedPending = false }) {
  const botanistOwnPending = String(role || "").toLowerCase() === "botanist" &&
    allowOwnedPending === true && plant?.currentStatus === "Pending Review";
  if (plant?.currentStatus !== "Approved" && !botanistOwnPending) return missing;
  const location = getPlantLocationDisplay(plant.location, role);
  if (location.status === "restricted") return restricted;
  return getPlantCardZoneValue(plant, role, { allowOwnedPending }) || missing;
}
