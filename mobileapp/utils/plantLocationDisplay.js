export function getPlantLocationDisplay(location, role) {
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole !== "botanist" && normalizedRole !== "conservation officer")
    return { status: "restricted" };
  if (location?.restricted) return { status: "restricted" };

  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const hasPair = latitude !== null && latitude !== undefined && latitude !== "" &&
    longitude !== null && longitude !== undefined && longitude !== "" &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;

  return hasPair
    ? {
        status: "available",
        latitude: Number(latitude),
        longitude: Number(longitude),
        accuracyM: location?.accuracyM ?? null,
        altitudeM: location?.altitudeM ?? null,
        zone: location?.zone && location.zone !== "Not recorded" ? location.zone : null,
      }
    : { status: "not_recorded" };
}
