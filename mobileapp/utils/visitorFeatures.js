import { mapBackendPlant, mapBackendSpecies, plantApi, plantAssetSources } from "./plantApi";

function requireAccountId(accountId) {
  if (!accountId) throw Object.assign(Error("Sign in as a Visitor to use this feature."), { code: "SESSION_REQUIRED", status: 401 });
}

async function requestVisitorApi(path, options = {}) {
  const method = options.method || "GET";
  try {
    return await plantApi(path, options);
  } catch (error) {
    if (error?.status === 404 && /^not found\.?$/i.test(error.message || "")) {
      error.message = `Visitor API route was not found (HTTP 404) for ${method} ${path}. Deploy or restart the Plant API with the Visitor routes.`;
    } else if (error?.status === 401) {
      error.message = "Visitor sign-in is required (HTTP 401). Sign in again and retry.";
    } else if (error?.status === 403) {
      error.message = "Visitor account access was denied (HTTP 403).";
    } else if (error?.status === 503) {
      const detail = error.message?.trim();
      if (!detail || /^service unavailable(?:\. please try again\.)?$/i.test(detail)) {
        error.message = "Visitor service is unavailable (HTTP 503). Check Plant API readiness and the Visitor database migration.";
      } else {
        error.message = `Visitor service returned HTTP 503: ${detail}`;
      }
    } else if (["API_UNREACHABLE", "API_TIMEOUT"].includes(error?.code)) {
      error.message = "Cannot reach the Visitor service. Check the configured API URL, network, and running backend.";
    }
    throw error;
  }
}

async function addAuthenticatedImages(rows, accountId) {
  const assetIds = [...new Set(rows.map((row) => row.image_asset_id).filter(Boolean).map(String))];
  if (!assetIds.length) return new Map();
  const sources = await plantAssetSources(assetIds.map((id) => ({ id })), accountId);
  return new Map(assetIds.map((id, index) => [id, sources[index]]));
}

export async function fetchVisitorFavourites(accountId) {
  requireAccountId(accountId);
  const payload = await requestVisitorApi("/visitor/favourites", { accountId });
  const rawPlants = payload?.favourites?.plants;
  const rawSpecies = payload?.favourites?.species;
  if (!Array.isArray(rawPlants) || !Array.isArray(rawSpecies))
    throw Error("The backend returned an invalid favourites response.");
  const imageRows = [
    ...rawPlants.map((row) => ({ ...row, image_asset_id: row.plant_image_asset_id })),
    ...rawSpecies,
  ];
  const images = await addAuthenticatedImages(imageRows, accountId);
  return {
    plants: rawPlants.map((row) => ({
      ...mapBackendPlant(row),
      image: images.get(String(row.plant_image_asset_id)) || null,
      favouritedAt: row.favourited_at || null,
    })),
    species: rawSpecies.map((row) => ({
      ...mapBackendSpecies(row),
      image: images.get(String(row.image_asset_id)) || null,
      favouritedAt: row.favourited_at || null,
    })),
  };
}

export async function fetchVisitorFavouritePlantIds(accountId) {
  requireAccountId(accountId);
  const payload = await requestVisitorApi("/visitor/favourites", { accountId });
  const rows = payload?.favourites?.plants;
  if (!Array.isArray(rows)) throw Error("The backend returned an invalid favourites response.");
  return new Set(rows.map((row) => row?.plant_id).filter((id) => id != null).map(String));
}

export async function setVisitorFavourite(accountId, type, id, favourited) {
  requireAccountId(accountId);
  if (!["plant", "species"].includes(type) || !/^\d+$/.test(String(id)))
    throw Error("Invalid favourite item.");
  if (favourited) {
    return requestVisitorApi("/visitor/favourites", {
      method: "POST",
      accountId,
      body: { type, id: String(id) },
    });
  }
  return requestVisitorApi(`/visitor/favourites/${type}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    accountId,
    body: {},
  });
}

export async function recordVisitorScan(accountId, qrCode) {
  requireAccountId(accountId);
  if (typeof qrCode !== "string" || !qrCode.trim() || qrCode.length > 200)
    throw Error("Invalid QR code.");
  return requestVisitorApi("/visitor/scan-history", {
    method: "POST",
    accountId,
    body: { qr_code: qrCode.trim() },
  });
}

export async function fetchVisitorScanHistory(accountId) {
  requireAccountId(accountId);
  const pageSize = 200;
  const rows = [];
  let offset = 0;
  while (true) {
    const payload = await requestVisitorApi(`/visitor/scan-history?limit=${pageSize}&offset=${offset}`, { accountId });
    if (!Array.isArray(payload?.scans)) throw Error("The backend returned an invalid scan history response.");
    rows.push(...payload.scans);
    const hasMore = payload.page?.has_more === true ||
      (payload.page?.has_more === undefined && payload.scans.length === pageSize);
    if (!hasMore || payload.scans.length === 0) break;
    offset += payload.scans.length;
  }
  let images = new Map();
  try {
    images = await addAuthenticatedImages(rows.map((row) => row.plant || {}), accountId);
  } catch {
    // Keep the history available when a protected image source cannot be resolved.
  }
  return rows.map((row) => ({
    ...row,
    scannedAt: row.scanned_at,
    qrIdentifier: row.qr_identifier,
    plant: row.plant?.plant_id ? {
      ...mapBackendPlant(row.plant),
      image: images.get(String(row.plant.image_asset_id)) || null,
    } : null,
  }));
}
