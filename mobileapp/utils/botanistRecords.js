import { plantApi, mapBackendPlant, plantAssetSources, speciesRequestPhotoSources } from "./plantApi";

const authenticationError = (error) => [401, 403].includes(error?.status) || ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error?.code);
export function submissionStatus(status) {
  const value = String(status || "").toLowerCase();
  return value === "approved" ? "approved" : value === "rejected" ? "rejected" : ["pending", "pending review"].includes(value) ? "pending" : value;
}
export function resolvePlantRecordStatus(storedStatus, initialObservation) {
  // The Plant row can retain Pending Review after an Officer rejects or
  // requests correction on the initial Observation. Keep an approved current
  // Plant and a withdrawn submission distinct from that historical decision.
  if (storedStatus === "Approved" || storedStatus === "Withdrawn") return storedStatus;
  return initialObservation?.status || storedStatus;
}
export function canWithdrawOriginalPlant(plant, accountId) {
  if (!plant?.isServerRecord || !["Pending Review", "Correction Required"].includes(plant.status) ||
      String(plant.registeredBy) !== `staff:${accountId}` || plant.hasApprovedObservation ||
      !["Pending Review", "Correction Required"].includes(plant.initialSubmissionStatus) ||
      !plant.initialObservationId || plant.observations?.length !== 1) return false;
  const original = plant.observations[0];
  return String(original.id) === String(plant.initialObservationId) &&
    ["initial_registration", "unknown"].includes(original.origin_type) &&
    !["Approved", "Rejected", "Flagged"].includes(original.review_decision);
}

export function canWithdrawOriginalSpecies(request, accountId, historical = false) {
  if (historical || !request || !accountId || (request.requested_by ?? request.owner_subject) !== `staff:${accountId}` ||
      request.approved_species_id || request.withdrawn_at || request.request_status === "Withdrawn") return false;
  if (request.request_status === "Correction Required") return true;
  return request.request_status === "Pending Review" && !request.reviewed_at &&
    (request.review_cycle == null || Number(request.review_cycle) === 1);
}

function list(payload, key) {
  if (!Array.isArray(payload?.[key])) throw Error("The backend returned an invalid plant records response.");
  return payload[key];
}
function editList(payload) {
  const edits = payload?.edits;
  if (!Array.isArray(edits) || edits.some((row) => !row || typeof row !== "object" ||
      typeof row.id !== "string" || !row.id || typeof row.owner_subject !== "string" ||
      !["Pending Review", "Correction Required", "Approved", "Rejected", "Cancelled"].includes(row.status)))
    throw Object.assign(Error("The backend returned an invalid observation edits response."), { code: "INVALID_EDIT_RESPONSE" });
  return edits;
}
function editRefreshDiagnostic(error) {
  // Never include server messages, URLs, account identifiers or photo evidence.
  const reason = error?.code === "API_TIMEOUT" ? "timeout"
    : error?.code === "API_UNREACHABLE" ? "network"
    : error?.code === "API_NOT_JSON" || error?.code === "INVALID_EDIT_RESPONSE" ? "invalid_response"
    : Number.isInteger(error?.status) ? "http" : "unavailable";
  return { reason, ...(Number.isInteger(error?.status) ? { status: error.status } : {}) };
}
export function projectBotanistRecords(accountId, rows, observations, requests) {
  const owner = `staff:${accountId}`;
  const ownedObservations = observations.filter((row) => row.owner_subject === owner);
  const ownedRequests = requests.filter((row) => (row.requested_by ?? row.owner_subject) === owner);
  const plants = rows.filter((row) => row.registered_subject === owner).map((row) => {
    const mapped = mapBackendPlant(row);
    const history = ownedObservations.filter((o) => String(o.plant_id) === String(row.plant_id))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const latest = history[0];
    const initialObservation = history.find((observation) => observation.origin_type === "initial_registration") ||
      (history.length === 1 ? history[0] : null);
    const currentStatus = resolvePlantRecordStatus(mapped.currentStatus, initialObservation);
    // A pending edit must not replace the live, approved values on Plant Details.
    // For an unapproved initial registration, show the owner's latest submitted data.
    const content = currentStatus === "Approved"
      ? mapped.registration || {}
      : latest?.content || row.latest_submission || row.latest_approved || {};
    const request = ownedRequests.find((r) => String(r.proposed_species_id ?? r.approved_species_id) === String(row.species_id));
    // For a restricted catalogue entry, use only the botanist's own submitted request snapshot.
    const submittedSpecies = request ? { id: String(row.species_id), scientificName: request.scientific_name,
      commonName: request.common_name, genus: request.genus_name, family: request.family_name,
      conservationStatus: request.conservation_status, description: request.description, habitat: request.habitat } : undefined;
    return { ...mapped, isServerRecord: true, currentStatus, status: currentStatus, name: mapped.commonName,
      height: content.heightCm, healthStatus: content.healthStatus, growthStage: content.lifeStage,
      morphology: content.morphology, zone: content.zone, altitude: content.altitudeM,
      latestObservation: latest, observationStatus: latest?.status || row.observation_status,
      initialObservation,
      initialSubmissionStatus: initialObservation?.status || null,
      initialObservationId: initialObservation?.id || null,
      speciesRequest: request, speciesRequestId: request?.request_id, syncStatus: "Synced",
      speciesDetails: mapped.species || submittedSpecies, observations: history };
  });
  return { plants, observations: ownedObservations, requests: ownedRequests };
}
async function fetchRecords(accountId, plantId) {
  if (!accountId) throw Error("Sign in as the Botanist who submitted this record.");
  const options = { expectedAccountId: accountId };
  const [plantsResult, observationsResult, requestsResult, editsResult, recordChangesResult] = await Promise.allSettled([
    plantApi((plantId ? `/plants/${encodeURIComponent(plantId)}` : "/plants") + "?scope=mine", options).then((payload) => {
      if (plantId ? !payload?.plant : !Array.isArray(payload?.plants)) throw Error("The backend returned an invalid plant records response.");
      return payload;
    }),
    plantApi("/observations?scope=mine", options).then((payload) => { list(payload, "observations"); return payload; }),
    plantApi("/species-requests", options).then((payload) => { list(payload, "species_requests"); return payload; }),
    plantApi("/observation-edits/capabilities", options).then((capability) => capability?.available
      ? plantApi("/observation-edits", options).then((payload) => { editList(payload); return payload; }) : { edits: [] }),
    plantApi("/record-changes/capabilities", options).then((capability) => capability?.approved_edits_available
      ? plantApi("/record-changes", options).then((payload) => { list(payload, "changes"); return payload; }) : { changes: [] }),
  ]);
  for (const result of [plantsResult, observationsResult, requestsResult, editsResult, recordChangesResult]) {
    if (result.status === "rejected" && authenticationError(result.reason)) throw result.reason;
  }
  if (plantId && plantsResult.status === "rejected") throw plantsResult.reason;
  const plants = plantsResult.status === "fulfilled" ? plantsResult.value : null;
  const warnings = [];
  if (plantsResult.status === "rejected") warnings.push(plantsResult.reason.message || "Unable to load plant records.");
  if (observationsResult.status === "rejected") warnings.push("Plant records loaded, but observation updates could not be refreshed. Pull to refresh and retry.");
  if (requestsResult.status === "rejected") warnings.push("Plant records loaded, but species requests could not be refreshed. Pull to refresh and retry.");
  if (editsResult.status === "rejected")
    warnings.push("Observation edits could not be refreshed. Pull to refresh and retry.");
  if (recordChangesResult.status === "rejected" && recordChangesResult.reason?.status !== 404 && recordChangesResult.reason?.status !== 503)
    warnings.push("Plant and species edits could not be refreshed. Pull to refresh and retry.");
  const result = projectBotanistRecords(accountId, plants ? (plantId ? [plants.plant] : list(plants, "plants")) : [],
    observationsResult.status === "fulfilled" ? list(observationsResult.value, "observations") : [],
    requestsResult.status === "fulfilled" ? list(requestsResult.value, "species_requests") : []);
  result.warnings = warnings;
  result.editsStale = editsResult.status === "rejected";
  result.editsRefreshError = result.editsStale ? editRefreshDiagnostic(editsResult.reason) : null;
  if (result.editsStale && typeof __DEV__ === "boolean" && __DEV__)
    console.info("[botanist-records]", { phase: "observation_edits_refresh_failed", ...result.editsRefreshError });
  result.edits = editsResult.status === "fulfilled" ? editsResult.value.edits.filter((row) => row.owner_subject === `staff:${accountId}`) : [];
  result.recordChanges = recordChangesResult.status === "fulfilled" ? recordChangesResult.value.changes.filter((row) => row.owner_subject === `staff:${accountId}`) : [];
  // Omit failed sections so the same-account loader retains their last successful read.
  if (plantsResult.status === "rejected") delete result.plants;
  if (observationsResult.status === "rejected") delete result.observations;
  if (requestsResult.status === "rejected") delete result.requests;
  if (editsResult.status === "rejected") delete result.edits;
  if (recordChangesResult.status === "rejected") delete result.recordChanges;
  const previews = (result.plants || []).flatMap((plant) => {
    const asset = plant.status === "Approved"
      ? (plant.registrationPhotoIds.length ? { id: plant.registrationPhotoIds[0] } : null)
      : plant.latestObservation?.assets?.[0];
    return asset ? [{ plant, asset }] : [];
  });
  const photoResults = await Promise.allSettled([
    previews.length ? plantAssetSources(previews.map(({ asset }) => asset), accountId, { ownSubmission: true }).then((sources) => {
      previews.forEach(({ plant }, index) => { plant.thumbnail = sources[index]; });
    }) : Promise.resolve(),
    result.requests?.length ? speciesRequestPhotoSources(result.requests, accountId).then((sources) => {
      result.requests.forEach((request, index) => { request.thumbnail = sources[index]; });
    }) : Promise.resolve(),
  ]);
  for (const photo of photoResults) if (photo.status === "rejected" && authenticationError(photo.reason)) throw photo.reason;
  if (typeof __DEV__ === "boolean" && __DEV__) console.info("[botanist-records]", {
    phase: "loaded", accountIdAvailable: Boolean(accountId), plantCount: result.plants?.length,
    requestCount: result.requests?.length, observationCount: result.observations?.length,
  });
  return result;
}

export async function fetchBotanistRecordChange(accountId, changeId, { kind, targetId, status = "Correction Required" } = {}) {
  if (!accountId || !changeId) throw Error("Record change proposal unavailable.");
  const payload = await plantApi(`/record-changes/${encodeURIComponent(changeId)}`, { expectedAccountId: accountId });
  const change = payload?.change;
  if (!change || String(change.id) !== String(changeId) || change.owner_subject !== `staff:${accountId}` || (status !== "any" && change.status !== status) ||
      (kind === "plant" && (!change.plant_id || (targetId != null && String(change.plant_id) !== String(targetId)))) ||
      (kind === "species" && (!change.species_id || (targetId != null && String(change.base_snapshot?.request_id) !== String(targetId)))) ||
      (kind && !["plant", "species"].includes(kind))) throw Error("Record change proposal unavailable.");
  return change;
}
export const fetchBotanistRecords = (accountId) => fetchRecords(accountId);
export async function fetchBotanistSpeciesRequest(accountId, requestId) {
  if (!accountId) throw Object.assign(Error("Your session is no longer available. Sign in again."), { code: "SESSION_REQUIRED", status: 401 });
  const payload = await plantApi(`/species-requests/${encodeURIComponent(requestId)}`, { expectedAccountId: accountId });
  const request = payload.species_request;
  if (!request || String(request.request_id) !== String(requestId) || (request.requested_by ?? request.owner_subject) !== `staff:${accountId}`)
    throw Error("Species request unavailable.");
  return { ...request, photo: (await speciesRequestPhotoSources([request], accountId))[0] };
}
export async function fetchBotanistPlant(accountId, plantId) {
  const result = await fetchRecords(accountId, String(plantId));
  const plant = result.plants[0];
  if (!plant) throw Error("Plant record unavailable for this account.");
  try {
    const payload = await plantApi(`/assets?plant_id=${encodeURIComponent(plantId)}&scope=mine`, { expectedAccountId: accountId });
    const assets = Array.isArray(payload?.assets) ? payload.assets.filter((asset) => asset?.id) : [];
    const ownSubmission = plant.currentStatus !== "Approved" && plant.registeredBy === `staff:${accountId}`;
    plant.photos = await plantAssetSources(assets, accountId, { ownSubmission });
  } catch {
    // Keep record details visible if the authorized photo listing is unavailable.
    plant.photos = [];
    plant.photoLoadError = true;
  }
  return plant;
}

export async function fetchBotanistRecordChanges(accountId) {
  return (await loadBotanistRecordChanges(accountId)).changes;
}

function findPendingReviewedChange(changes, kind, targetId) {
  const target = String(targetId);
  return changes.find((change) => {
    if (!["pending review", "correction required"].includes(String(change.status || "").trim().toLowerCase())) return false;
    return kind === "plant"
      ? change.plant_id != null && String(change.plant_id) === target
      : change.base_snapshot?.request_id != null && String(change.base_snapshot.request_id) === target;
  }) || null;
}

async function loadBotanistRecordChanges(accountId) {
  if (!accountId) throw Error("Sign in with the Botanist account that owns this record.");
  const options = { expectedAccountId: accountId };
  const capabilities = await plantApi("/record-changes/capabilities", options);
  if (!capabilities.approved_edits_available) return { available: false, changes: [] };
  const payload = await plantApi("/record-changes", options);
  if (!Array.isArray(payload.changes)) throw Error("The backend returned an invalid record changes response.");
  return { available: true, changes: payload.changes.filter((change) => change.owner_subject === `staff:${accountId}`) };
}

export async function fetchBotanistRecordChangeStatus(accountId, kind, targetId) {
  const { available, changes } = await loadBotanistRecordChanges(accountId);
  const matching = changes.filter((change) => kind === "plant"
    ? change.plant_id != null && String(change.plant_id) === String(targetId)
    : change.base_snapshot?.request_id != null && String(change.base_snapshot.request_id) === String(targetId));
  return { available, pending: available ? findPendingReviewedChange(matching, kind, targetId) : null,
    latest: matching[0] || null };
}

export function createBotanistRecordsLoader(load, changed) {
  const empty = () => ({ plants: [], observations: [], requests: [], edits: [], editsStale: true, editsRefreshError: null, recordChanges: [], loaded: false, loading: false, error: "" });
  let state = empty();
  let pending = null, visit = 0;
  const publish = (next) => { state = next; changed(state); };
  return {
    getState: () => state,
    cancel() { visit += 1; pending = null; },
    clear() { visit += 1; pending = null; publish(empty()); },
    refresh() {
      if (pending) return pending;
      const current = visit;
      publish({ ...state, editsStale: true, loading: true, error: "" });
      const task = Promise.resolve().then(load).then((result) => {
        if (visit === current) publish({ ...state, ...result, loaded: true, loading: false, error: (result.warnings || []).join("\n") });
      }).catch((error) => {
        if (visit === current) publish({ ...state,
          ...(authenticationError(error)
            ? empty() : { editsStale: true }),
          loading: false, error: error.message || "Unable to load plant records." });
      }).finally(() => { if (pending === task) pending = null; });
      pending = task;
      return task;
    },
  };
}
