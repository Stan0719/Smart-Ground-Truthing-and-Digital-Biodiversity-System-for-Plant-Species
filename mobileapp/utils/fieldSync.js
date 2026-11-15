import { readDrafts, removeDraft } from "./fieldStorage";
import { plantApi } from "./plantApi";
import { faceSession } from "./faceSession";
import { botanistNotifications } from "./botanistNotifications";
const running = new Map();

function invalid(message, field) {
  const error = Error(message);
  error.field = field;
  throw error;
}

const plantObservationEligibilityMessages = {
  pending: "This plant is awaiting approval. You can add observations after it has been approved.",
  rejected: "This plant was rejected. You can add observations after the plant record is approved.",
  correctionRequired: "This plant requires correction. You can add observations after the plant record is approved.",
  unavailable: "Unable to verify this plant's approval status. Refresh the plant record before submitting an observation.",
};

export function getPlantObservationEligibility(plant, expectedPlantId) {
  const plantId = plant?.plant_id ?? plant?.id;
  if (!/^\d+$/.test(String(expectedPlantId ?? "")) || String(plantId ?? "") !== String(expectedPlantId))
    return "unavailable";
  switch (String(plant.rbac_status ?? plant.current_status ?? plant.status ?? "").trim().toLowerCase()) {
    case "approved": return "approved";
    case "pending review": return "pending";
    case "rejected": return "rejected";
    case "correction required": return "correctionRequired";
    default: return "unavailable";
  }
}

export async function fetchPlantObservationEligibility(accountId, plantId) {
  const id = String(plantId ?? "");
  if (!/^\d+$/.test(id)) return "unavailable";
  try {
    const payload = await plantApi(`/plants/${encodeURIComponent(id)}/qr`, { expectedAccountId: accountId });
    const plant = { plant_id: id, rbac_status: payload?.rbac_status };
    return getPlantObservationEligibility(plant, id);
  } catch (error) {
    // The QR status endpoint is owner-only. For a non-owner, a successful
    // public plant read is sufficient: the API exposes non-owned Botanist
    // records only when the plant record itself is approved.
    if (error?.status === 404) {
      try {
        const ownedPayload = await plantApi(`/plants/${encodeURIComponent(id)}?scope=mine`, { expectedAccountId: accountId });
        const ownedPlant = ownedPayload?.plant;
        const ownedEligibility = getPlantObservationEligibility(ownedPlant, id);
        if (ownedEligibility !== "unavailable") return ownedEligibility;
        // A Botanist-owned record without a status field is not safe to infer.
        if (ownedPlant && String(ownedPlant.plant_id ?? ownedPlant.id ?? "") === id) return "unavailable";
      } catch (ownedError) {
        if (ownedError?.status !== 404) return "unavailable";
      }
      try {
        const payload = await plantApi(`/plants/${encodeURIComponent(id)}`, { expectedAccountId: accountId });
        const plant = payload?.plant;
        const eligibility = getPlantObservationEligibility(plant, id);
        if (eligibility === "approved") return eligibility;
        if (plant && String(plant.plant_id ?? plant.id ?? "") === id &&
            ![plant.rbac_status, plant.current_status, plant.status].some((value) => value != null))
          return "approved";
        return eligibility;
      } catch {
        return "unavailable";
      }
    }
    return "unavailable";
  }
}

export async function verifyApprovedPlantForObservation(accountId, plantId) {
  const eligibility = await fetchPlantObservationEligibility(accountId, plantId);
  if (eligibility === "approved") return eligibility;
  throw eligibilityError(eligibility);
}

function eligibilityError(eligibility) {
  const error = Error(plantObservationEligibilityMessages[eligibility] || plantObservationEligibilityMessages.unavailable);
  error.code = `PLANT_OBSERVATION_${eligibility.toUpperCase()}`;
  error.observationEligibility = eligibility;
  return error;
}

// Validate and normalize before any observation, photo, or submission request.
// This also protects drafts submitted from the dashboard sync action.
export function validateObservationDraft(draft) {
  const body = draft?.body;
  const content = body?.content;
  if (!content || typeof content !== "object" || Array.isArray(content))
    invalid("Observation information is incomplete.");

  const allowed = new Set([
    "heightCm", "healthStatus", "lifeStage", "morphology", "notes", "taxonomy",
    "latitude", "longitude", "accuracy_m", "zone", "altitudeM",
  ]);
  if (Object.keys(content).some((key) => !allowed.has(key)))
    invalid("Observation contains an unsupported field.");

  const heightText = String(content.heightCm ?? "").trim();
  if (!heightText) invalid("Enter a valid plant height.", "heightCm");
  const heightCm = Number(heightText);
  if (!Number.isFinite(heightCm)) invalid("Enter a valid plant height.", "heightCm");
  if (heightCm <= 0) invalid("Plant height must be greater than 0 cm.", "heightCm");
  if (heightCm > 100000) invalid("Plant height cannot exceed 100,000 cm.", "heightCm");

  const textFields = [
    ["healthStatus", 100], ["lifeStage", 100], ["morphology", 4000],
    ["notes", 4000], ["taxonomy", 1000],
  ];
  for (const [field, max] of textFields) {
    const value = content[field] == null ? "" : content[field];
    if (typeof value !== "string") invalid("Observation text fields must contain text.", field);
    if (value.length > max) invalid(`Observation field cannot exceed ${max} characters.`, field);
  }
  if (!content.healthStatus.trim()) invalid("Enter health status.", "healthStatus");
  if (!content.lifeStage.trim()) invalid("Enter life stage.", "lifeStage");
  if (!content.morphology.trim()) invalid("Enter morphology.", "morphology");

  const isPlantRegistration = draft.path === "/plants";
  const result = {
    ...content,
    heightCm,
    healthStatus: content.healthStatus.trim(),
    lifeStage: content.lifeStage.trim(),
    morphology: content.morphology.trim(),
    notes: (content.notes || "").trim(),
  };
  if (content.taxonomy?.trim()) result.taxonomy = content.taxonomy.trim();
  else delete result.taxonomy;

  const latitudeValue = isPlantRegistration ? (body.latitude ?? content.latitude) : content.latitude;
  const longitudeValue = isPlantRegistration ? (body.longitude ?? content.longitude) : content.longitude;
  const latitudeText = String(latitudeValue ?? "").trim();
  const longitudeText = String(longitudeValue ?? "").trim();
  if (isPlantRegistration && (!latitudeText || !longitudeText))
    invalid("Record GPS before registering this plant.", !latitudeText ? "latitude" : "longitude");
  if (Boolean(latitudeText) !== Boolean(longitudeText))
    invalid("Enter both latitude and longitude.", !latitudeText ? "latitude" : "longitude");
  if (latitudeText) {
    result.latitude = Number(latitudeText);
    result.longitude = Number(longitudeText);
    if (!Number.isFinite(result.latitude) || Math.abs(result.latitude) > 90 ||
        !Number.isFinite(result.longitude) || Math.abs(result.longitude) > 180)
      invalid("Enter valid latitude and longitude.", "latitude");
  } else {
    delete result.latitude;
    delete result.longitude;
  }

  const accuracyValue = isPlantRegistration ? (body.accuracy_m ?? content.accuracy_m) : content.accuracy_m;
  if (accuracyValue !== undefined && accuracyValue !== null && String(accuracyValue).trim() !== "") {
    result.accuracy_m = Number(accuracyValue);
    if (!Number.isFinite(result.accuracy_m) || result.accuracy_m < 0)
      invalid("Accuracy must be a nonnegative number.", "accuracy_m");
  } else {
    delete result.accuracy_m;
  }
  if (result.altitudeM !== undefined && result.altitudeM !== null && result.altitudeM !== "") {
    result.altitudeM = Number(result.altitudeM);
    if (!Number.isFinite(result.altitudeM)) invalid("Enter a valid altitude.", "altitudeM");
  } else delete result.altitudeM;
  if (result.zone !== undefined && result.zone !== null) {
    result.zone = String(result.zone).trim();
    if (!result.zone) delete result.zone;
  }

  let normalizedBody = { ...body, content: result };
  if (isPlantRegistration) {
    const speciesId = Number(body.species_id);
    if (!Number.isInteger(speciesId) || speciesId <= 0)
      invalid("Select a species before registering this plant.", "species_id");
    const registrationBody = { ...normalizedBody };
    delete registrationBody.accuracy_m;
    normalizedBody = {
      ...registrationBody,
      species_id: speciesId,
      latitude: result.latitude,
      longitude: result.longitude,
      ...(result.accuracy_m === undefined ? {} : { accuracy_m: result.accuracy_m }),
    };
  }
  if (draft.method === "PATCH" && (!Number.isInteger(body.revision) || body.revision <= 0 || !/^\/observations\/[A-Za-z0-9-]+$/.test(draft.path || "")))
    invalid("The correction target or revision is unavailable.");
  if (!isPlantRegistration && draft.method !== "PATCH" && !/^\/plants\/\d+\/observations$/.test(draft.path || ""))
    invalid("Observation information is incomplete.");
  return { ...draft, body: normalizedBody };
}

export function syncDrafts(accountId, { onSubmitted } = {}) {
  if (running.has(accountId)) return running.get(accountId);
  const task = (async () => {
    const user = await faceSession.restore();
    if (user?.id !== accountId || user.role !== "botanist")
      throw Error("Sign in with the draft owner account to synchronize.");
    let synced = 0;
    const completedKeys = [];
    let activeDraft = null;
    try {
      const queued = (await readDrafts(accountId)).filter((draft) => draft.kind !== "botanist-form");
      // Validate the complete queue before starting any upload. A partial draft
      // must never be submitted or have its photos uploaded by a bulk sync.
      const validated = queued.map((draft) => ({
        original: draft,
        draft: validateObservationDraft(draft),
      }));
      for (const { original, draft } of validated) {
        const storedDraft = original;
        activeDraft = draft;
        const current = await faceSession.restore();
        if (current?.id !== accountId || current.role !== "botanist")
          throw Error("The draft owner session changed.");
        let saved;
        const changed = (row) =>
          row.content &&
          Object.keys({ ...row.content, ...draft.body.content }).some(
            (key) => row.content[key] !== draft.body.content[key],
          );
        if (draft.method === "PATCH") {
          const result = await plantApi("/observations", {
            expectedAccountId: accountId,
          });
          saved = result.observations.find(
            (row) => row.id === draft.path.split("/").pop(),
          );
          if (!saved)
            throw Error(
              "The owned observation is unavailable. Its correction remains saved locally.",
            );
          if (
            changed(saved) ||
            (saved.status !== "Draft" && saved.revision === draft.body.revision)
          ) {
            saved = await plantApi(draft.path, {
              method: "PATCH",
              body: draft.body,
              expectedAccountId: accountId,
            });
          }
        } else {
          if (/^\/plants\/\d+\/observations$/.test(draft.path || ""))
            await verifyApprovedPlantForObservation(accountId, draft.plant_id || draft.path.split("/")[2]);
          saved = await plantApi(draft.path, {
            method: "POST",
            body: draft.body,
            expectedAccountId: accountId,
          });
          if (changed(saved)) {
            if (saved.status !== "Draft")
              throw Error(
                "The server has a submitted version of this draft. Local changes remain saved; refresh observations before editing.",
              );
            saved = await plantApi(`/observations/${saved.id}`, {
              method: "PATCH",
              body: { content: draft.body.content, revision: saved.revision },
              expectedAccountId: accountId,
            });
          }
        }
        for (const asset of draft.assets || [])
          await plantApi("/assets", {
            method: "POST",
            body: {
              ...asset,
              plant_id: saved.plant_id,
              observation_id: saved.id,
            },
            expectedAccountId: accountId,
          });
        const submission = await plantApi(`/observations/${saved.id}/submit`, {
          method: "POST",
          body: {},
          expectedAccountId: accountId,
        });
        onSubmitted?.({
          clientKey: storedDraft.client_key,
          id: String(storedDraft.path === "/plants" ? saved.plant_id ?? saved.id : saved.id),
          plantId: String(saved.plant_id ?? storedDraft.plant_id ?? ""),
          status: submission?.submitted ? "Pending Review" : null,
          type: storedDraft.path === "/plants" ? "plant" : draft.method === "PATCH" ? "correction" : "observation",
        });
        if ((await removeDraft(accountId, storedDraft.client_key, storedDraft)) !== false) {
          synced++;
          completedKeys.push(storedDraft.client_key);
        }
      }
      return synced;
    } catch (error) {
      if (activeDraft) {
        // Notification storage must never change the outcome of synchronization.
        await botanistNotifications.recordSync(accountId, { type: "sync_failed", key: activeDraft.client_key }).catch(() => {});
      }
      throw error;
    } finally {
      if (completedKeys.length) {
        await botanistNotifications.recordSync(accountId, {
          type: "sync_completed", key: JSON.stringify(completedKeys.sort()), count: completedKeys.length,
        }).catch(() => {});
      }
    }
  })().finally(() => running.delete(accountId));
  running.set(accountId, task);
  return task;
}
