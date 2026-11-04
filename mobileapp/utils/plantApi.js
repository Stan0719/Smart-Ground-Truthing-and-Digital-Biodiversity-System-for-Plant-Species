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
async function getJson(path, { accountId } = {}) {
  const API_URL = mobileApiUrl("plant");
  if(accountId || faceSession.hasSession())return plantApi(path.replace(/^\/api/,''), { expectedAccountId: accountId });
  let response;
  try {
    response = await fetch(`${API_URL}${path}`);
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

async function speciesImageSources(species, { accountId } = {}) {
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
    date: record.observed_at ?? record.date ?? null,
    observedAt: record.observed_at ?? record.observedAt ?? null,
    status,
    heightCm: record.height_cm ?? record.heightCm ?? null,
    healthStatus: record.health_status ?? record.healthStatus ?? "Not recorded",
    lifeStage: record.life_stage ?? record.lifeStage ?? "Not recorded",
    morphology: record.morphology ?? "Not recorded",
    notes: record.notes ?? "",
    verificationStatus: verificationStatus ?? null,
    verifiedAt: record.verified_at ?? record.verifiedAt ?? null,
  };
}

export function mapBackendPlant(record, speciesById = new Map()) {
  const projectedLocation = Object.fromEntries(
    ["latitude", "longitude", "accuracy_m", "altitude_m", "zone"]
      .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
      .map((field) => [field, record[field]]),
  );
  const hasProjectedField = (field) => Object.prototype.hasOwnProperty.call(projectedLocation, field);
  record = { ...record, ...record.latest_approved };
  // The backend's top-level location fields are the authorized, approved
  // location projection. Do not let a different latest-observation payload
  // overwrite them during the general observation-field merge.
  Object.assign(record, projectedLocation);
  const speciesId = String(record.species_id ?? record.speciesId ?? "");
  const species = speciesById.get(speciesId) || (record.species_details ? {
    ...mapBackendSpecies(record.species_details), habitat: record.species_details.habitat || "",
  } : undefined);
  const registeredAt = record.registered_at ?? record.registeredAt ?? null;
  const plantId = String(record.plant_id ?? record.plantId ?? record.id ?? "");
  const plant = {
    ...record,
    id: plantId,
    plantId: plantId || "Unknown ID",
    speciesId,
    speciesSlug: species?.slug ?? record.species_slug ?? record.speciesSlug ?? `api-species-${speciesId}`,
    species,
    commonName: record.common_name ?? record.commonName ?? species?.name ?? "Unknown species",
    scientificName: record.scientific_name ?? record.scientificName ?? "",
    qrCode: record.qr_id != null ? `QR-${String(record.qr_id).padStart(4, "0")}` : (record.qr_token ?? record.qr_code ?? record.qrCode ?? record.qr?.code ?? ""),
    qrId: record.qr_id == null ? null : String(record.qr_id),
    genus: record.genus_name ?? record.genus ?? species?.genus ?? "",
    family: record.family_name ?? record.family ?? species?.family ?? "",
    currentStatus: record.rbac_status ?? record.status ?? record.current_status ?? record.currentStatus ?? "Not recorded",
    latestApproved: {
      heightCm: record.height_cm ?? record.heightCm ?? null,
      healthStatus: record.health_status ?? record.healthStatus ?? "Not recorded",
      lifeStage: record.life_stage ?? record.lifeStage ?? "Not recorded",
      date: record.observed_at ?? record.observation_date ?? record.verified_at ?? null,
      morphology: record.morphology ?? "",
      notes: record.notes ?? "",
    },
    location: {
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

export async function plantAssetSources(assets, accountId, { ownSubmission = false } = {}) {
  return faceSession.withToken(async (token, user) => {
    if (String(user.id) !== String(accountId)) throw Error("Sign in with the correct account.");
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

export async function fetchPlantRecords(speciesCatalog = [], { scopeMine = false, ...options } = {}) {
  const payload = await getJson(`/api/plants${scopeMine ? "?scope=mine" : ""}`, options);
  const speciesById = new Map(speciesCatalog.map((species) => [String(species.id), species]));
  return unwrapList(payload, ["plants", "data", "results"]).map((record) =>
    mapBackendPlant(record, speciesById)
  );
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
    const photoPayload = await getJson(`/api/assets?plant_id=${encodeURIComponent(id)}`, { accountId });
    const assets = (photoPayload?.assets || []).filter((asset) => asset?.id);
    const sources = accountId
      ? await plantAssetSources(assets, accountId)
      : assets.map((asset) => ({ uri: mobileApiUrl("plant") + "/api/assets/" + encodeURIComponent(asset.id) }));
    plant.photos = assets.map((asset, index) => ({ id: asset.id, ...sources[index] }));
  } catch {
    // Plant detail remains usable if an older backend does not expose photo listing.
    plant.photos = [];
  }

  if (includeObservations) {
    const observationsPayload = await getJson("/api/observations", { accountId });
    const observations = unwrapList(observationsPayload, ["observations", "data", "results"])
      .filter((observation) => String(observation.plant_id ?? observation.plantId) === id)
      .map(mapBackendObservation)
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    const latestApproved = observations.find((observation) => observation.status === "Approved");
    plant.observations = observations;
    if (latestApproved) plant.latestApproved = { ...plant.latestApproved, ...latestApproved };
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
