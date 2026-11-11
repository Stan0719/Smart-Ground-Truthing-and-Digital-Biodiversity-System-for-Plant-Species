import {faceSession} from "./faceSession";
import { mobileApiUrl } from "./apiConfiguration.js";
const logPlantRequest = (entry) => {
 if(typeof __DEV__==='boolean'&&__DEV__)console.info('[plant-api]',entry);
};

export async function plantApi(path,{method='GET',body,expectedAccountId,accountId=expectedAccountId}={}){
 const API_URL = mobileApiUrl("plant");
 if(!path.startsWith('/')||path.startsWith('//'))throw Error('Invalid plant API path.');
 const endpoint=API_URL+'/api'+path;
 try{return await faceSession.withToken(async(token,user)=>{
 if(accountId&&user.id!==accountId)throw Object.assign(Error('Sign in with the correct account.'),{code:'ACCOUNT_MISMATCH',status:403});
 if(path==='/species'&&['botanist','conservation-officer'].includes(user.role))path+='?scope=scientific';
 logPlantRequest({phase:'request_started',endpoint:API_URL+'/api'+path,method,credentialsIncluded:true,accountIdAvailable:Boolean(user.id),accountMatchesExpected:!accountId||user.id===accountId});
 let response;
 try{response=await fetch(API_URL+'/api'+path,{method,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/plant-submissions'?90000:15000)})}
 catch(cause){throw Object.assign(Error('Unable to reach the plant service. Check your connection and the running backend.'),{code:['AbortError','TimeoutError'].includes(cause.name)?'API_TIMEOUT':'API_UNREACHABLE',transient:true})}
 logPlantRequest({phase:'response_received',endpoint:API_URL+'/api'+path,method,status:response.status});
 const responseText=await response.text();
 let result;
 try{result=responseText?JSON.parse(responseText):{}}catch{
 throw Object.assign(Error(`Plant API returned a non-JSON response (HTTP ${response.status}) for ${method} ${path}. Check that the backend and tunnel are running the current code.`),{code:'API_NOT_JSON',status:response.status,transient:[502,503,504].includes(response.status)});
 }
 if(!response.ok)throw Object.assign(Error(result.error||`Plant request failed (HTTP ${response.status}).`),{status:response.status,code:response.status===401?'API_AUTH_REQUIRED':response.status===403?'API_ACCESS_DENIED':'PLANT_API_ERROR',transient:[502,503,504].includes(response.status)});
 if(Array.isArray(result.plants))logPlantRequest({phase:'records_received',endpoint:API_URL+'/api'+path,status:response.status,recordCount:result.plants.length,ownedRecordCount:result.plants.filter(row=>row.registered_subject===`staff:${user.id}`).length});
 return result;
 });}catch(error){logPlantRequest({phase:'request_failed',endpoint,method,code:error.code||'PLANT_API_ERROR',...(error.status?{status:error.status}:{}),...(error.code==='SESSION_REQUIRED'?{credentialsIncluded:false}: {})});throw error;}
}
async function getJson(path, { accountId, publicOnly = false } = {}) {
  const API_URL = mobileApiUrl("plant");
  if (publicOnly && !/^\/api\/(?:species(?:\/[1-9][0-9]*)?|plants)$/.test(path))
    throw new Error("Public catalogue access is limited to visible species and plant lists.");
  if(!publicOnly && (accountId || faceSession.hasSession()))return plantApi(path.replace(/^\/api/,''), { expectedAccountId: accountId });
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { credentials: "omit", redirect: "error", headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Unable to reach the plant backend. Check its URL and that the server is running.");
  }

  if (!response.ok) {
    throw new Error(`Backend request failed (${response.status}).`);
  }

  return response.json();
}

function unwrapList(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  throw new Error("The backend returned an unexpected list response.");
}

export function mapBackendSpecies(species) {
  const scientificName = species.scientific_name ?? species.scientificName ?? "";
  const commonName = species.common_name ?? species.commonName ?? species.name ?? "Unknown species";
  const existingSpecies = undefined;
  const id = String(species.species_id ?? species.id ?? scientificName ?? commonName);
  const imageAssetId = typeof species.image_asset_id === "string" && species.image_asset_id.trim()
    ? species.image_asset_id.trim()
    : null;

  return {
    ...existingSpecies,
    id,
    speciesId: id,
    slug: existingSpecies?.slug ?? `api-species-${id}`,
    name: commonName,
    commonName,
    scientificName: scientificName || existingSpecies?.scientificName || "",
    genus: species.genus_name ?? species.genus ?? existingSpecies?.genus ?? "",
    family: species.family_name ?? species.family ?? existingSpecies?.family ?? "",
    conservationStatus:
      species.conservation_status ??
      species.conservationStatus ??
      existingSpecies?.conservationStatus ??
      "Not recorded",
    description: species.description ?? existingSpecies?.description ?? "",
    image: imageAssetId ? { uri: mobileApiUrl("plant") + "/api/assets/" + encodeURIComponent(imageAssetId) } : undefined,
    speciesImageVerified: Boolean(imageAssetId),
    registeredAt: species.registered_at ?? species.registeredAt ?? null,
  };
}

export async function fetchSpeciesCatalog(options = {}) {
  const payload = await getJson("/api/species", options);
  return speciesImageSources(unwrapList(payload, ["species", "data", "results"]).map(mapBackendSpecies), options);
}

async function speciesImageSources(species, { accountId, publicOnly = false } = {}) {
  if (publicOnly) return species;
  if (!species.some((row) => row.image) || (!accountId && !faceSession.hasSession())) return species;
  return faceSession.withToken(async (token, user) => {
    if (accountId && String(user.id) !== String(accountId)) throw Object.assign(Error("Sign in with the correct account."), { code: "ACCOUNT_MISMATCH", status: 403 });
    return species.map((row) => row.image ? { ...row, image: { ...row.image, headers: { Authorization: "Bearer " + token } } } : row);
  });
}

export async function fetchSpeciesDetail(speciesId, slug, options = {}) {
  const id = String(speciesId ?? "");
  if (/^\d+$/.test(id)) {
    const payload = await getJson(`/api/species/${encodeURIComponent(id)}`, options);
    return (await speciesImageSources([mapBackendSpecies(payload?.species ?? payload)], options))[0];
  }

  const catalog = await fetchSpeciesCatalog(options);
  return catalog.find((species) => species.slug === slug) ?? null;
}

function mapBackendObservation(record) {
  record={...record,...record.content,observation_id:record.id??record.observation_id,recorded_by:record.owner_subject??record.recorded_by,observed_at:record.created_at??record.observed_at};
  const verificationStatus = record.verification_status ?? record.verificationStatus;
  const status = record.status ?? (
    verificationStatus === "Verified" ? "Approved" :
    verificationStatus === "Rejected" ? "Rejected" :
    "Pending Review"
  );

  return {
    observationId: String(record.observation_id ?? record.observationId ?? ""),
    plantId: String(record.plant_id ?? record.plantId ?? ""),
    recordedBy: record.recorded_by ?? record.recordedBy ?? "Not recorded",
    recordedByName: record.recorded_by_name ?? record.recordedByName ?? record.recorder_name ?? null,
    date: record.observed_at ?? record.date ?? null,
    observedAt: record.observed_at ?? record.observedAt ?? null,
    updatedAt: record.updated_at ?? record.updatedAt ?? null,
    status,
    heightCm: record.height_cm ?? record.heightCm ?? null,
    healthStatus: record.health_status ?? record.healthStatus ?? "Not recorded",
    lifeStage: record.life_stage ?? record.lifeStage ?? "Not recorded",
    morphology: record.morphology ?? "Not recorded",
    taxonomy: record.taxonomy ?? "",
    notes: record.notes ?? "",
    photos: Array.isArray(record.assets)
      ? record.assets
        .filter((asset) => asset?.id && ["image/jpeg", "image/png"].includes(String(asset.content_type ?? asset.contentType ?? "").toLowerCase()))
        .map((asset) => ({ id: String(asset.id), contentType: asset.content_type ?? asset.contentType }))
      : [],
    verificationStatus: verificationStatus ?? null,
    verifiedAt: record.verified_at ?? record.verifiedAt ?? null,
  };
}

export function getObservationRecorderDisplayName(observation, user, unknownName) {
  const apiName = observation?.recordedByName ?? observation?.recorded_by_name ?? observation?.recorder_name;
  if (typeof apiName === "string" && apiName.trim()) return apiName.trim();

  const currentSubject = user?.id ? `staff:${user.id}` : null;
  const confirmedCreator = currentSubject && observation?.recordedBy === currentSubject;
  if (confirmedCreator) {
    const profileName = user?.name ?? user?.displayName ?? user?.fullName ?? user?.full_name;
    if (typeof profileName === "string" && profileName.trim()) return profileName.trim();
  }
  return unknownName;
}

export function getPlantRegisteredByDisplayName(plant, user, unknownName) {
  const apiName = plant?.registeredByName ?? plant?.registered_by_name;
  if (typeof apiName === "string" && apiName.trim()) return apiName.trim();

  const currentSubject = user?.id ? `staff:${user.id}` : null;
  if (currentSubject && plant?.registeredBy === currentSubject) {
    const profileName = user?.name ?? user?.displayName ?? user?.fullName ?? user?.full_name;
    if (typeof profileName === "string" && profileName.trim()) return profileName.trim();
  }
  return unknownName;
}

export function selectLatestApprovedObservation(observations) {
  return observations
    .filter((observation) => observation.status === "Approved")
    .sort((a, b) => new Date(b.updatedAt || b.date || 0).getTime() - new Date(a.updatedAt || a.date || 0).getTime())[0] || null;
}

export function mapBackendPlant(record, speciesById = new Map()) {
  const plantStatus = record.rbac_status ?? record.status ?? record.current_status ?? record.currentStatus;
  const approvedContent = record.latest_approved?.content && typeof record.latest_approved.content === "object"
    ? record.latest_approved.content
    : record.latest_approved;
  const submittedContent = record.latest_submission && typeof record.latest_submission === "object"
    ? (record.latest_submission.content && typeof record.latest_submission.content === "object"
      ? record.latest_submission.content
      : record.latest_submission)
    : null;
  const observationName = plantStatus === "Approved" ? approvedContent : submittedContent;
  const projectedLocation = Object.fromEntries(
    ["latitude", "longitude", "accuracy_m", "altitude_m", "zone"]
      .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
      .map((field) => [field, record[field]]),
  );
  const hasProjectedField = (field) => Object.prototype.hasOwnProperty.call(projectedLocation, field);
  record = { ...record, ...approvedContent };
  // The backend's top-level location fields are the authorized, approved
  // location projection. Do not let a different latest-observation payload
  // overwrite them during the general observation-field merge.
  Object.assign(record, projectedLocation);
  const speciesId = String(record.species_id ?? record.speciesId ?? "");
  const species = speciesById.get(speciesId) || (record.species_details ? {
    ...mapBackendSpecies(record.species_details), habitat: record.species_details.habitat || "",
  } : undefined);
  const plantScientificName = record.scientific_name || record.scientificName ||
    observationName?.scientific_name || observationName?.scientificName || species?.scientificName || "";
  const registeredAt = record.registered_at ?? record.registeredAt ?? null;
  const plantId = String(record.plant_id ?? record.plantId ?? record.id ?? "");
  const plant = {
    ...record,
    id: plantId,
    plantId: plantId || "Unknown ID",
    speciesId,
    speciesSlug: species?.slug ?? record.species_slug ?? record.speciesSlug ?? `api-species-${speciesId}`,
    species,
    // The schema stores a plant-level scientific_name but has no
    // plant-level common_name column. Keep that distinction explicit.
    plantScientificName,
    plantCommonName: record.plant_common_name ?? record.plantCommonName ?? null,
    commonName: record.common_name ?? record.commonName ?? species?.name ?? "Unknown species",
    scientificName: plantScientificName,
    qrCode: record.qr_id != null ? `QR-${String(record.qr_id).padStart(4, "0")}` : (record.qr_token ?? record.qr_code ?? record.qrCode ?? record.qr?.code ?? ""),
    qrId: record.qr_id == null ? null : String(record.qr_id),
    genus: record.genus_name ?? record.genus ?? species?.genus ?? "",
    family: record.family_name ?? record.family ?? species?.family ?? "",
    currentStatus: record.rbac_status ?? record.status ?? record.current_status ?? record.currentStatus ?? "Not recorded",
    plantImageAssetId: record.plant_image_asset_id == null ? null : String(record.plant_image_asset_id),
    latestApproved: {
      heightCm: record.height_cm ?? record.heightCm ?? null,
      healthStatus: record.health_status ?? record.healthStatus ?? "Not recorded",
      lifeStage: record.life_stage ?? record.lifeStage ?? "Not recorded",
      date: record.observed_at ?? record.observation_date ?? record.verified_at ?? null,
      morphology: record.morphology ?? "",
      notes: record.notes ?? "",
    },
    hasApprovedObservation: record.latest_approved !== null && typeof record.latest_approved === "object",
    // The API exposes this only to authorized staff. For a plant without an
    // approved version, show saved botanical fields as submitted information.
    // Never flatten submitted location values into the approved location.
    latestSubmission: plantStatus !== "Approved" && submittedContent ? {
      heightCm: submittedContent.height_cm ?? submittedContent.heightCm ?? null,
      healthStatus: submittedContent.health_status ?? submittedContent.healthStatus ?? "Not recorded",
      lifeStage: submittedContent.life_stage ?? submittedContent.lifeStage ?? "Not recorded",
      morphology: submittedContent.morphology ?? "",
      notes: submittedContent.notes ?? "",
      taxonomy: submittedContent.taxonomy ?? "",
      status: record.observation_status ?? record.latest_submission.status ?? null,
    } : null,
    location: {
      restricted: record.gps_access_restricted === true,
      zone: hasProjectedField("zone") ? record.zone : record.zone ?? record.location?.zone ?? "Not recorded",
      latitude: hasProjectedField("latitude") ? record.latitude : record.latitude ?? record.location?.latitude ?? null,
      longitude: hasProjectedField("longitude") ? record.longitude : record.longitude ?? record.location?.longitude ?? null,
      altitudeM: hasProjectedField("altitude_m") ? record.altitude_m : record.altitude_m ?? record.altitudeM ?? record.location?.altitudeM ?? null,
      accuracyM: hasProjectedField("accuracy_m") ? record.accuracy_m : record.accuracy_m ?? record.location?.accuracyM ?? null,
    },
    qr: {
      code: record.qr_token ?? record.qr_code ?? record.qr?.code ?? "Not recorded",
      label: record.qr_id != null ? `QR-${String(record.qr_id).padStart(4, "0")}` : null,
      status: record.qr_status ?? record.qr?.status ?? "Not recorded",
    },
    registeredBy: record.registered_subject ?? record.registered_by ?? record.registeredBy ?? "Not recorded",
    registeredAt,
    observations: [],
  };
  return plant;
}

export function getPlantDisplayObservation(plant) {
  return plant?.currentStatus === "Approved"
    ? plant.latestApproved
    : plant?.latestSubmission || plant?.latestApproved;
}

export function isOwnedPendingPlant(plant, accountId) {
  return accountId != null && plant?.currentStatus === "Pending Review" &&
    String(plant.registeredBy) === `staff:${accountId}`;
}

// The public/role catalogue projects approved location only. Reuse the
// owner-scoped list projection solely for the submitting Botanist's initial
// pending records; never replace data on approved or other-owned plants.
export function mergeOwnedPendingPlantZones(records, ownerRecords, accountId) {
  const zonesByPlantId = new Map((Array.isArray(ownerRecords) ? ownerRecords : [])
    .filter((plant) => isOwnedPendingPlant(plant, accountId))
    .map((plant) => [String(plant.id ?? plant.plantId), plant]));

  return (Array.isArray(records) ? records : []).map((plant) => {
    if (!isOwnedPendingPlant(plant, accountId)) return plant;
    const ownerRecord = zonesByPlantId.get(String(plant.id ?? plant.plantId));
    if (!ownerRecord) return plant;
    const zone = ownerRecord.location?.zone;
    const savedZone = typeof zone === "string" && zone.trim() && zone !== "Not recorded"
      ? zone
      : "Not recorded";
    return {
      ...plant,
      location: {
        ...plant.location,
        restricted: ownerRecord.location?.restricted === true,
        zone: savedZone,
      },
    };
  });
}

export function isPlantVisibleInRoleCatalog(plant, role, accountId) {
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "visitor") return plant?.currentStatus === "Approved";
  if (normalizedRole === "botanist") return plant?.currentStatus === "Approved" || isOwnedPendingPlant(plant, accountId);
  return true;
}

// Public catalogue endpoints already enforce approval and species visibility
// server-side. Their response intentionally redacts rbac_status, so do not
// re-check that field on the client for Guest/Visitor catalogue results.
export function filterPlantRecordsForRole(records, role, accountId, { publicOnly = false } = {}) {
  const rows = Array.isArray(records) ? records : [];
  if (publicOnly) return rows;
  return rows.filter((plant) => isPlantVisibleInRoleCatalog(plant, role, accountId));
}

export async function plantAssetSources(assets, accountId, { ownSubmission = false } = {}) {
  return faceSession.withToken(async (token, user) => {
    if (accountId != null && String(user.id) !== String(accountId)) throw Error("Sign in with the correct account.");
    return assets.map((asset) => ({ uri: mobileApiUrl("plant") + "/api/assets/" + encodeURIComponent(asset.id) + (ownSubmission ? "?scope=mine" : ""),
      headers: { Authorization: "Bearer " + token } }));
  });
}

export async function speciesRequestPhotoSources(requests, accountId) {
  return faceSession.withToken(async (token, user) => {
    if (String(user.id) !== String(accountId)) throw Object.assign(Error("Sign in with the correct account."), { code: "ACCOUNT_MISMATCH", status: 403 });
    return requests.map((request) => ({ uri: mobileApiUrl("plant") + "/api/species-requests/" + encodeURIComponent(request.request_id) + "/photo",
      headers: { Authorization: "Bearer " + token } }));
  });
}

export async function fetchPlantRecords(speciesCatalog = [], { scopeMine = false, publicOnly = false, ...options } = {}) {
  const payload = await getJson(`/api/plants${scopeMine ? "?scope=mine" : ""}`, { ...options, publicOnly });
  const rawRecords = unwrapList(payload, ["plants", "data", "results"]);
  const speciesById = new Map(speciesCatalog.map((species) => [String(species.id), species]));
  const plants = rawRecords.map((record) =>
    mapBackendPlant(record, speciesById)
  );
  const withPhotos = plants.filter((plant) => plant.plantImageAssetId);
  if (!withPhotos.length) return plants;
  const sourceByPlantId = new Map();
  for (const plant of withPhotos) {
    const ownPendingPreview = plant.currentStatus !== "Approved" &&
      String(plant.registeredBy) === `staff:${options.accountId}`;
    const source = faceSession.hasSession() && !publicOnly
      ? (await plantAssetSources([{ id: plant.plantImageAssetId }], options.accountId, { ownSubmission: ownPendingPreview }))[0]
      : { uri: mobileApiUrl("plant") + "/api/assets/" + encodeURIComponent(plant.plantImageAssetId) };
    sourceByPlantId.set(plant.id, source);
  }
  return plants.map((plant) => sourceByPlantId.has(plant.id)
    ? { ...plant, plantImage: sourceByPlantId.get(plant.id) }
    : plant);
}

export function filterUniqueSpeciesPlantRecords(records, speciesId, speciesSlug) {
  const seen = new Set();
  return records.filter((record) => {
    const belongsToSpecies = speciesId != null
      ? String(record.speciesId) === String(speciesId)
      : record.speciesSlug === speciesSlug;
    if (!belongsToSpecies) return false;
    const plantId = String(record.id ?? record.plantId ?? "");
    if (!plantId || seen.has(plantId)) return false;
    seen.add(plantId);
    return true;
  });
}

export async function fetchPlantDetail(plantId, { includeObservations = false, scopeMine = false, accountId } = {}) {
  const id = String(plantId ?? "");
  if (!/^\d+$/.test(id)) {
    throw new Error("The selected plant does not have a backend ID.");
  }

  const [plantPayload, catalog] = await Promise.all([
    getJson(`/api/plants/${encodeURIComponent(id)}${scopeMine ? "?scope=mine" : ""}`, { accountId }),
    fetchSpeciesCatalog({ accountId }),
  ]);
  const record = plantPayload?.plant ?? plantPayload;
  const speciesById = new Map(catalog.map((species) => [String(species.id), species]));
  const plant = mapBackendPlant(record, speciesById);
  try {
    const photoPayload = await getJson(`/api/assets?plant_id=${encodeURIComponent(id)}${scopeMine ? "&scope=mine" : ""}`, { accountId });
    const assets = (photoPayload?.assets || []).filter((asset) => asset?.id);
    const ownSubmission = scopeMine && plant.currentStatus !== "Approved" && String(plant.registeredBy) === `staff:${accountId}`;
    const sources = accountId
      ? await plantAssetSources(assets, accountId, { ownSubmission })
      : assets.map((asset) => ({ uri: mobileApiUrl("plant") + "/api/assets/" + encodeURIComponent(asset.id) }));
    plant.photos = assets.map((asset, index) => ({ id: asset.id, ...sources[index] }));
  } catch {
    // Plant detail remains usable if an older backend does not expose photo listing.
    plant.photos = [];
    plant.photoLoadError = true;
  }

  if (includeObservations) {
    const observationRows = [];
    const observationCursors = new Set();
    let observationCursor = null;
    do {
      const observationPath = observationCursor
        ? `/api/observations?limit=200&cursor=${encodeURIComponent(observationCursor)}`
        : "/api/observations?limit=200";
      const observationsPayload = await getJson(observationPath, { accountId });
      observationRows.push(...unwrapList(observationsPayload, ["observations", "data", "results"]));
      const nextCursor = observationsPayload?.page?.next_cursor;
      if (!nextCursor || observationCursors.has(nextCursor)) break;
      observationCursors.add(nextCursor);
      observationCursor = nextCursor;
    } while (true);
    let observations = observationRows
      .filter((observation) => String(observation.plant_id ?? observation.plantId) === id)
      .map(mapBackendObservation)
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    const latestApprovedId = selectLatestApprovedObservation(observations)?.observationId;
    const canReadObservationPhotos = (observation) => observation.status === "Approved"
      ? observation.observationId === latestApprovedId
      : accountId != null && observation.recordedBy === `staff:${accountId}`
        && ["Draft", "Pending Review", "Correction Required"].includes(observation.status);
    const observationPhotos = [...new Map(observations
      .filter(canReadObservationPhotos)
      .flatMap((observation) => observation.photos)
      .map((photo) => [photo.id, photo])).values()];
    let sourceById = new Map();
    if (observationPhotos.length) {
      try {
        const sources = await plantAssetSources(observationPhotos, accountId);
        sourceById = new Map(observationPhotos.map((photo, index) => [photo.id, sources[index]]));
      } catch {
        // Keep observation content available if an authorized photo source cannot be resolved.
      }
    }
    observations = observations.map((observation) => ({
      ...observation,
      photos: canReadObservationPhotos(observation)
        ? observation.photos.filter((photo) => sourceById.has(photo.id))
          .map((photo) => ({ ...photo, ...sourceById.get(photo.id) }))
        : [],
    }));
    const latestApproved = selectLatestApprovedObservation(observations);
    plant.observations = observations;
    // /api/plants selects the authoritative approved observation by updated_at.
    // The separate history request is owner-filtered and must not replace it
    // with an older observation from that owner.
    if (latestApproved && !plant.hasApprovedObservation)
      plant.latestApproved = { ...plant.latestApproved, ...latestApproved };
  }

  return plant;
}

export async function fetchPlantByQRCode(qrToken) {
  const token = String(qrToken ?? "").trim();
  if (!token || token.length > 200) {
    throw new Error("The scanned QR code does not contain a valid plant token.");
  }
  return getJson(`/api/qr/${encodeURIComponent(token)}`);
}
