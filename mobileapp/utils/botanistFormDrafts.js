import * as FileSystem from "expo-file-system/legacy";
import { readDrafts, saveDraft, removeDraft } from "./fieldStorage";

const KIND = "botanist-form";
const privateRoot = () => `${FileSystem.documentDirectory}botanist-form-drafts/`;
const safeSegment = (value) => String(value).replace(/[^a-zA-Z0-9._-]/g, "_");
const isPrivatePhoto = (uri) => typeof uri === "string" && uri.startsWith(privateRoot());
const randomPart = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const writeQueues = new Map();

// Default selections and submission metadata alone do not make an unfinished form.
export function hasMeaningfulAddPlantDraft(form, photos = []) {
  if (!form || typeof form !== "object" || Array.isArray(form)) return false;
  const fields = ["plantScientificName", "height", "description", "growthStage", "morphology", "zone",
    "latitude", "longitude", "altitude", "gpsAccuracy", "speciesScientificName", "speciesCommonName",
    "speciesGenus", "speciesFamily", "speciesDescription", "speciesHabitat"];
  return fields.some((key) => String(form[key] ?? "").trim()) ||
    Boolean(form.selectedSpecies?.id || form.selectedQRCode?.qr_id) ||
    Boolean(form.healthStatus && form.healthStatus !== "Healthy") ||
    Boolean(form.speciesConservationStatus && form.speciesConservationStatus !== "Not Assessed") ||
    (Array.isArray(photos) && photos.some((photo) => Boolean(photo?.uri)));
}

function serialDraft(key, operation) {
  const prior = writeQueues.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(operation);
  writeQueues.set(key, next);
  return next.finally(() => { if (writeQueues.get(key) === next) writeQueues.delete(key); });
}

async function cleanupUnreferenced(candidates, drafts) {
  const referenced = new Set(drafts.filter((draft) => draft.kind === KIND)
    .flatMap((draft) => (draft.photo_refs || []).map((photo) => photo.uri)));
  for (const uri of new Set(candidates.filter(isPrivatePhoto))) {
    if (referenced.has(uri)) continue;
    try { if ((await FileSystem.getInfoAsync(uri)).exists) await FileSystem.deleteAsync(uri, { idempotent: true }); }
    catch { /* Orphan cleanup is best-effort; it never changes a saved draft. */ }
  }
}

export async function getBotanistFormDraft(accountId, clientKey, formType, targetId) {
  if (!accountId || !clientKey) throw Error("Sign in with the Botanist account that owns this draft.");
  const draft = (await readDrafts(accountId)).find((row) => row.kind === KIND && row.client_key === clientKey);
  if (!draft || draft.form_type !== formType || String(draft.target_id ?? "") !== String(targetId ?? ""))
    throw Error("This draft is unavailable for the selected form or record.");
  for (const photo of draft.photo_refs || []) {
    if (!isPrivatePhoto(photo.uri) || !(await FileSystem.getInfoAsync(photo.uri)).exists)
      throw Error("A saved draft photo is unavailable on this device. Keep the draft and add the missing photo again before submitting.");
  }
  return draft;
}

export async function findBotanistFormDraft(accountId, formType, targetId) {
  if (!accountId) throw Error("Sign in with the Botanist account that owns this draft.");
  const rows = await readDrafts(accountId);
  return rows.filter((row) => row.kind === KIND && row.form_type === formType &&
    (formType !== "add-plant" || hasMeaningfulAddPlantDraft(row.form, row.photo_refs)) &&
    (targetId === undefined || String(row.target_id ?? "") === String(targetId)))
    .sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0))[0] || null;
}

export async function saveBotanistFormDraft(accountId, input) {
  if (!accountId || !input?.client_key || !input?.form_type || !input?.form)
    throw Error("Draft information is incomplete. Keep this form open and try again.");
  return serialDraft(`${accountId}:${input.client_key}`, () => saveBotanistFormDraftUnlocked(accountId, input));
}

async function saveBotanistFormDraftUnlocked(accountId, input) {
  if (!accountId || !input?.client_key || !input?.form_type || !input?.form)
    throw Error("Draft information is incomplete. Keep this form open and try again.");
  const rows = await readDrafts(accountId);
  const previous = rows.find((row) => row.kind === KIND && row.client_key === input.client_key);
  const oldPhotos = previous?.photo_refs || [];
  const savedPhotos = [];
  try {
    if (!FileSystem.documentDirectory) throw Error("Private device storage is unavailable. Keep this form open and try again.");
    const accountDirectory = `${privateRoot()}${safeSegment(accountId)}/`;
    const directory = `${accountDirectory}${safeSegment(input.client_key)}/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    for (const photo of input.photos || []) {
      if (!photo?.uri) continue;
      const existingPhoto = oldPhotos.find((old) => old.slot === photo.slot &&
        (old.uri === photo.uri || old.source_uri === photo.uri));
      if (existingPhoto && isPrivatePhoto(existingPhoto.uri) && (await FileSystem.getInfoAsync(existingPhoto.uri)).exists) {
        savedPhotos.push({ ...existingPhoto, slot: photo.slot, content_type: photo.content_type || existingPhoto.content_type });
        continue;
      }
      if (isPrivatePhoto(photo.uri)) {
        if (!photo.uri.startsWith(accountDirectory)) throw Error("This photo belongs to another Botanist account and cannot be added to the draft.");
        if (!(await FileSystem.getInfoAsync(photo.uri)).exists) throw Error("A selected photo is no longer available. Add it again before saving.");
        savedPhotos.push({ slot: photo.slot, content_type: photo.content_type, uri: photo.uri, source_uri: photo.uri });
        continue;
      }
      const info = await FileSystem.getInfoAsync(photo.uri);
      if (!info.exists || info.isDirectory) throw Error("A selected photo is no longer available. Add it again before saving.");
      const destination = `${directory}${randomPart()}.${photo.content_type === "image/png" ? "png" : "jpg"}`;
      savedPhotos.push({ slot: photo.slot, content_type: photo.content_type, uri: destination, source_uri: photo.uri });
      try { await FileSystem.copyAsync({ from: photo.uri, to: destination }); }
      catch { throw Error("Device storage is full or unavailable. The previous saved draft is unchanged."); }
    }
    const draft = { ...input, kind: KIND, saved_at: new Date().toISOString(), photo_refs: savedPhotos };
    delete draft.photos;
    await saveDraft(accountId, draft);
    const after = await readDrafts(accountId);
    await cleanupUnreferenced(oldPhotos.map((photo) => photo.uri), after);
    return draft;
  } catch (error) {
    await cleanupUnreferenced(savedPhotos.map((photo) => photo.uri), rows);
    throw error;
  }
}

export async function deleteBotanistFormDraft(accountId, clientKey, expectedSavedAt) {
  if (!accountId || !clientKey) return true;
  return serialDraft(`${accountId}:${clientKey}`, () => deleteBotanistFormDraftUnlocked(accountId, clientKey, expectedSavedAt));
}

async function deleteBotanistFormDraftUnlocked(accountId, clientKey, expectedSavedAt) {
  const rows = await readDrafts(accountId);
  const draft = rows.find((row) => row.kind === KIND && row.client_key === clientKey);
  if (!draft) return true;
  if (expectedSavedAt && draft.saved_at !== expectedSavedAt) return false;
  const removed = await removeDraft(accountId, clientKey, draft);
  if (!removed) return false;
  const remaining = await readDrafts(accountId);
  await cleanupUnreferenced((draft.photo_refs || []).map((photo) => photo.uri), remaining);
  return true;
}

export const botanistFormDraftKind = KIND;
