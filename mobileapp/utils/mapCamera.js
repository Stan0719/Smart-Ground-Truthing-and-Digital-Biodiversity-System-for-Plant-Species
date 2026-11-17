export const SARAWAK_REGION = { latitude: 3.82, longitude: 113.78, latitudeDelta: 0.12, longitudeDelta: 0.12 };

export function validMapPoint(plant) {
  const latitude = plant?.mapLocation?.latitude;
  const longitude = plant?.mapLocation?.longitude;
  if (latitude === null || latitude === undefined || typeof latitude === "boolean" || String(latitude).trim() === "" ||
      longitude === null || longitude === undefined || typeof longitude === "boolean" || String(longitude).trim() === "") return null;
  const lat = Number(latitude), lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { latitude: lat, longitude: lon } : null;
}

export function mapDistanceKm(a, b) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

// Choose a coherent local group for the opening camera. Other valid markers
// remain on the map and can be selected individually.
export function initialMapCluster(plants, radiusKm = 150) {
  const points = (Array.isArray(plants) ? plants : []).map((plant) => ({ plant, coordinate: validMapPoint(plant) }))
    .filter((item) => item.coordinate);
  if (!points.length) return [];
  // Prefer the project's Sarawak field area when it has any valid marker.
  // This affects only the opening camera, not which markers are rendered.
  const sarawakCenters = points.filter((item) => mapDistanceKm(item.coordinate, SARAWAK_REGION) <= 650);
  const centers = sarawakCenters.length ? sarawakCenters : points;
  let best = [];
  let bestAnchorDistance = Infinity;
  for (const center of centers) {
    const group = points.filter((item) => mapDistanceKm(center.coordinate, item.coordinate) <= radiusKm);
    const anchorDistance = mapDistanceKm(center.coordinate, SARAWAK_REGION);
    if (group.length > best.length || (group.length === best.length && anchorDistance < bestAnchorDistance)) {
      best = group;
      bestAnchorDistance = anchorDistance;
    }
  }
  return best;
}
