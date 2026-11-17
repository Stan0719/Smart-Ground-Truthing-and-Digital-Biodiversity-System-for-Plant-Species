export const validGpsPoint = (point) => Boolean(point && ["latitude", "longitude"].every((key) =>
  point[key] != null && typeof point[key] !== "boolean" && String(point[key]).trim() !== "" &&
  Number.isFinite(Number(point[key])) && Math.abs(Number(point[key])) <= (key === "latitude" ? 90 : 180)));

export async function readGpsLocation(location, translate) {
  const permission = await location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") throw Error(translate("gpsPicker.permissionDenied"));
  const { coords } = await location.getCurrentPositionAsync({ accuracy: location.Accuracy.High });
  if (!validGpsPoint(coords)) throw Error(translate("gpsPicker.unableToGetLocation"));
  const measurement = (value, nonnegative = false) => typeof value === "number" && Number.isFinite(value) &&
    (!nonnegative || value >= 0) ? String(value) : "";
  return { latitude: String(coords.latitude), longitude: String(coords.longitude),
    altitude_m: measurement(coords.altitude), accuracy_m: measurement(coords.accuracy, true) };
}
