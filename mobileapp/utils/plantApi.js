import { plants as mockSpecies } from "../data/mockData";

const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  "https://smart-ground-truthing-and-digital.onrender.com"
).replace(/\/$/, "");

async function getJson(path) {
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
  const commonName = species.common_name ?? species.name ?? "Unknown species";
  const existingSpecies = mockSpecies.find((plant) =>
    (plant.scientificName || "").toLowerCase() === scientificName.toLowerCase() ||
    (plant.name || "").toLowerCase() === commonName.toLowerCase()
  );
  const id = String(species.species_id ?? species.id ?? scientificName ?? commonName);

  return {
    ...existingSpecies,
    id,
    speciesId: id,
    slug: existingSpecies?.slug ?? `api-species-${id}`,
    name: commonName,
    scientificName: scientificName || existingSpecies?.scientificName || "",
    genus: species.genus_name ?? species.genus ?? existingSpecies?.genus ?? "",
    family: species.family_name ?? species.family ?? existingSpecies?.family ?? "",
    category: species.category ?? existingSpecies?.category ?? "Other",
    conservationStatus:
      species.conservation_status ??
      species.conservationStatus ??
      existingSpecies?.conservationStatus ??
      "Not recorded",
    description: species.description ?? existingSpecies?.description ?? "",
    registeredAt: species.registered_at ?? species.registeredAt ?? null,
  };
}

export async function fetchSpeciesCatalog() {
  const payload = await getJson("/api/species");
  return unwrapList(payload, ["species", "data", "results", "plants"]).map(mapBackendSpecies);
}

export async function fetchSpeciesDetail(speciesId, slug) {
  const id = String(speciesId ?? "");
  if (/^\d+$/.test(id)) {
    const payload = await getJson(`/api/species/${encodeURIComponent(id)}`);
    return mapBackendSpecies(payload?.species ?? payload);
  }

  const catalog = await fetchSpeciesCatalog();
  return catalog.find((species) => species.slug === slug) ?? null;
}

function mapBackendObservation(record) {
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

function mapBackendPlant(record, speciesById) {
  const speciesId = String(record.species_id ?? record.speciesId ?? "");
  const species = speciesById.get(speciesId);
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
    scientificName: record.scientific_name ?? record.scientificName ?? species?.scientificName ?? "",
    genus: record.genus_name ?? record.genus ?? species?.genus ?? "",
    family: record.family_name ?? record.family ?? species?.family ?? "",
    currentStatus: record.current_status ?? record.currentStatus ?? "Not recorded",
    latestApproved: {
      heightCm: record.height_cm ?? record.heightCm ?? null,
      healthStatus: record.health_status ?? record.healthStatus ?? "Not recorded",
      lifeStage: record.life_stage ?? record.lifeStage ?? "Not recorded",
      date: record.observation_date ?? record.verified_at ?? null,
      morphology: record.morphology ?? "",
      notes: record.notes ?? "",
    },
    location: {
      zone: record.zone ?? record.location?.zone ?? "Not recorded",
      latitude: record.latitude ?? record.location?.latitude ?? null,
      longitude: record.longitude ?? record.location?.longitude ?? null,
      altitudeM: record.altitude_m ?? record.altitudeM ?? record.location?.altitudeM ?? null,
      accuracyM: record.accuracy_m ?? record.location?.accuracyM ?? null,
    },
    qr: {
      code: record.qr_code ?? record.qr?.code ?? "Not recorded",
      status: record.qr_status ?? record.qr?.status ?? "Not recorded",
    },
    registeredBy: record.registered_by ?? record.registeredBy ?? "Not recorded",
    registeredAt,
    observations: [],
  };
  return plant;
}

export async function fetchPlantRecords(speciesCatalog = []) {
  const payload = await getJson("/api/plants");
  const speciesById = new Map(speciesCatalog.map((species) => [String(species.id), species]));
  return unwrapList(payload, ["plants", "data", "results"]).map((record) =>
    mapBackendPlant(record, speciesById)
  );
}

export async function fetchPlantDetail(plantId, { includeObservations = false } = {}) {
  const id = String(plantId ?? "");
  if (!/^\d+$/.test(id)) {
    throw new Error("The selected plant does not have a backend ID.");
  }

  const [plantPayload, catalog] = await Promise.all([
    getJson(`/api/plants/${encodeURIComponent(id)}`),
    fetchSpeciesCatalog(),
  ]);
  const record = plantPayload?.plant ?? plantPayload;
  const speciesById = new Map(catalog.map((species) => [String(species.id), species]));
  const plant = mapBackendPlant(record, speciesById);

  if (includeObservations) {
    const observationsPayload = await getJson("/api/observations");
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
