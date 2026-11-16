export function uniquePlantPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  const seen = new Set();
  return photos.filter((photo) => {
    const uri = typeof photo?.uri === "string" ? photo.uri.trim() : "";
    if (!/^https?:\/\//i.test(uri) || seen.has(uri)) return false;
    seen.add(uri);
    return true;
  }).map((photo) => ({ ...photo, uri: photo.uri.trim() }));
}

export function clampPhotoIndex(index, count) {
  if (count < 1) return 0;
  return Math.max(0, Math.min(Number.isInteger(index) ? index : 0, count - 1));
}

export function stepPhotoIndex(index, direction, count) {
  if (count < 2) return 0;
  return (clampPhotoIndex(index, count) + direction + count) % count;
}
