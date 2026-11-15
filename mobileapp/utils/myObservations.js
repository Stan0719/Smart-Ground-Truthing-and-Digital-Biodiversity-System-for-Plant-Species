const PAGE_SIZE = 200;
const SUBMITTED_STATUSES = new Set(["Pending Review", "Approved", "Rejected", "Correction Required", "Flagged"]);

function unwrapObservations(payload) {
  if (!Array.isArray(payload?.observations)) throw new Error("The observation service returned an invalid list.");
  return payload;
}

async function fetchObservationPages(accountId, api) {
  const rows = [];
  const cursors = new Set();
  let cursor = null;
  do {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), scope: "mine", ...(cursor ? { cursor } : {}) });
    const payload = unwrapObservations(await api(`/observations?${query.toString()}`, { expectedAccountId: accountId }));
    rows.push(...payload.observations);
    const next = payload.page?.next_cursor;
    if (!next || cursors.has(next)) break;
    cursors.add(next);
    cursor = next;
  } while (true);
  return rows;
}

export function displayObservationId(row, id) {
  const humanIdentifier = row?.observation_number ?? row?.observation_no ?? row?.display_id ?? row?.short_id;
  if (humanIdentifier != null && String(humanIdentifier).trim()) return String(humanIdentifier);
  return /^[\da-f]{8}-[\da-f-]{27}$/i.test(id) ? `${id.slice(0, 8)}…` : id;
}

function normalizeObservation(row, accountId, botanistName) {
  const owner = `staff:${accountId}`;
  if (row?.owner_subject !== owner || !SUBMITTED_STATUSES.has(row.status)) return null;
  const content = row.content && typeof row.content === "object" ? row.content : {};
  return {
    id: String(row.id),
    displayId: displayObservationId(row, String(row.id)),
    plantId: String(row.plant_id),
    plantName: row.common_name || row.scientific_name || "",
    scientificName: row.scientific_name || "",
    date: row.created_at || row.observed_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    recordedBy: botanistName || "",
    status: String(row.status || ""),
    healthStatus: content.healthStatus ?? row.health_status ?? "",
    content,
    heightCm: content.heightCm ?? row.height_cm ?? null,
    lifeStage: content.lifeStage ?? row.life_stage ?? "",
    morphology: content.morphology ?? row.morphology ?? "",
    notes: content.notes ?? row.notes ?? "",
    reviewComment: typeof row.review_comment === "string" ? row.review_comment : "",
    assets: Array.isArray(row.assets) ? row.assets.filter((asset) => asset?.id &&
      ["image/jpeg", "image/png"].includes(String(asset.content_type || "").toLowerCase())) : [],
  };
}

export async function withObservationPhotoSources(observations, accountId, resolveSources) {
  const assets = observations.flatMap((item) => item.assets || []);
  if (!assets.length) return observations.map((item) => ({ ...item, thumbnailSources: [] }));
  let sources;
  try {
    sources = await resolveSources(assets, accountId, { ownSubmission: true });
  } catch {
    // Observation cards remain usable when authenticated photo access is unavailable.
    sources = [];
  }
  if (!Array.isArray(sources)) sources = [];
  let offset = 0;
  return observations.map((item) => {
    const count = item.assets?.length || 0;
    const thumbnailSources = sources.slice(offset, offset + count).filter((source) => typeof source?.uri === "string" && source.uri);
    offset += count;
    return { ...item, thumbnailSources };
  });
}

export function buildObservationHistoryRows(observation, editHistory) {
  const requestById = new Map();
  for (const edit of [...(Array.isArray(editHistory?.edits) ? editHistory.edits : []), ...(observation.editRequests || [])])
    if (edit?.id != null) requestById.set(String(edit.id), edit);
  const requests = [...requestById.values()];
  const versions = Array.isArray(editHistory?.versions) ? editHistory.versions : [];
  const rows = versions.map((version) => {
    const original = Number(version.version_number) === 0;
    const edit = version.edit_request_id == null ? null : requestById.get(String(version.edit_request_id));
    return {
      key: `version:${version.id}`,
      kind: "version",
      versionId: String(version.id),
      editRequestId: edit?.id == null ? null : String(edit.id),
      original,
      versionNumber: Number(version.version_number),
      editNumber: edit?.version_number == null ? null : Number(edit.version_number),
      status: edit?.status || "Approved",
      reviewComment: edit?.review_comment || (original ? observation.reviewComment : ""),
      createdAt: edit?.created_at || version.approved_at || observation.date,
      content: version.content || {},
      photoIds: Array.isArray(version.photo_ids) ? version.photo_ids : [],
      current: false,
    };
  });
  const linkedRequestIds = new Set(rows.map((row) => row.editRequestId).filter(Boolean));
  for (const edit of requests) {
    if (edit?.id == null || linkedRequestIds.has(String(edit.id))) continue;
    rows.push({
      key: `edit:${edit.id}`,
      kind: "request",
      versionId: null,
      editRequestId: String(edit.id),
      original: false,
      versionNumber: null,
      editNumber: Number(edit.version_number) || null,
      status: String(edit.status || ""),
      reviewComment: edit.review_comment || "",
      createdAt: edit.created_at || edit.updated_at || null,
      content: edit.proposed_content || {},
      photoIds: [],
      current: false,
    });
  }

  if (!rows.some((row) => row.original)) {
    const firstEdit = requests.slice().sort((a, b) => Number(a.version_number) - Number(b.version_number))[0];
    const baseContent = firstEdit?.base_snapshot?.content;
    if (baseContent && typeof baseContent === "object") {
      rows.push({ key: `original:${observation.id}`, kind: "original", versionId: null, editRequestId: null,
        original: true, versionNumber: 0, editNumber: null, status: "Approved", reviewComment: "",
        createdAt: observation.date, content: baseContent, photoIds: firstEdit.base_snapshot.photo_ids || [], current: false });
    } else if (!requests.length && !versions.length) {
      rows.push({ key: `original:${observation.id}`, kind: "original", versionId: null, editRequestId: null,
        original: true, versionNumber: 0, editNumber: null, status: observation.status, reviewComment: observation.reviewComment,
        createdAt: observation.date, content: observation.content || {}, photoIds: [], current: false });
    }
  }

  const actualVersions = rows.filter((row) => row.kind !== "request" && row.status === "Approved").sort((a, b) =>
    Number(a.versionNumber ?? 0) - Number(b.versionNumber ?? 0));
  if (observation.status === "Approved" && actualVersions.length) {
    actualVersions[actualVersions.length - 1].current = true;
    for (const version of actualVersions) version.superseded = !version.current;
  }
  return rows.sort((a, b) => {
    if (a.original !== b.original) return a.original ? -1 : 1;
    const aNumber = a.editNumber ?? a.versionNumber ?? Number.MAX_SAFE_INTEGER;
    const bNumber = b.editNumber ?? b.versionNumber ?? Number.MAX_SAFE_INTEGER;
    if (aNumber !== bNumber) return aNumber - bNumber;
    return Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0);
  });
}

export function observationStatusSummary(observation) {
  const rows = observation.historyRows || [];
  const actualApproved = rows.filter((row) => row.kind !== "request" && row.status === "Approved");
  const pendingCount = rows.filter((row) => row.editRequestId && ["Pending Review", "Correction Required"].includes(row.status)).length;
  const rejectedCount = rows.filter((row) => row.editRequestId && row.status === "Rejected").length;
  if (actualApproved.length) {
    if (pendingCount) return { status: "Approved", detailKey: pendingCount === 1 ? "pendingEditOne" : "pendingEditMany", count: pendingCount };
    if (rejectedCount) return { status: "Approved", detailKey: rejectedCount === 1 ? "rejectedEditOne" : "rejectedEditMany", count: rejectedCount };
    const current = actualApproved.find((row) => row.current);
    if (current && !current.original) return { status: "Approved", detailKey: "currentEditSummary",
      editNumber: current.editNumber ?? current.versionNumber };
    return { status: "Approved" };
  }
  const latest = rows.slice().reverse().find((row) => row.status);
  return { status: latest?.status || observation.status || "" };
}

export function observationMatchesFilter(observation, filter) {
  if (filter === "all") return true;
  const statuses = [observation.status, ...(observation.historyRows || []).map((row) => row.status)];
  return statuses.some((status) => observationStatusMatchesFilter(status, filter));
}

export function observationStatusMatchesFilter(status, filter) {
  if (filter === "all") return true;
  if (filter === "pending") return ["Pending Review", "Correction Required"].includes(status);
  return status === (filter === "approved" ? "Approved" : "Rejected");
}

export function observationHistoryRoute(observation, row) {
  if (row.current && row.status === "Approved") return ["NotificationObservation", { observationId: observation.id }];
  return ["NotificationObservation", {
    observationId: observation.id,
    ...(row.editRequestId ? { editRequestId: row.editRequestId } : {}),
    ...(row.versionId ? { observationVersionId: row.versionId } : {}),
    observationVersionSnapshot: { content: row.content || {}, photoIds: row.photoIds || [], status: row.status,
      reviewComment: row.reviewComment || "",
      original: row.original, current: row.current, versionNumber: row.versionNumber,
      editNumber: row.editNumber, createdAt: row.createdAt, useCurrentPhotos: row.original && !(observation.editRequests || []).length },
  }];
}

export async function fetchMyObservations(accountId, botanistName, api) {
  if (!accountId) throw new Error("A signed-in Botanist account is required.");
  if (typeof api !== "function") throw new Error("The authenticated observation service is unavailable.");
  const ownRows = await fetchObservationPages(accountId, api);
  const capability = await api("/observation-edits/capabilities", { expectedAccountId: accountId }).catch((error) => {
    if ([404, 503].includes(error?.status)) return { available: false };
    throw error;
  });
  const editRows = capability.available ? (await api("/observation-edits", { expectedAccountId: accountId })).edits : [];
  if (!Array.isArray(editRows) || editRows.some((edit) => edit?.owner_subject !== `staff:${accountId}`))
    throw new Error("The owner-scoped observation edit list did not match this account.");
  const editsByObservation = new Map();
  for (const edit of editRows) {
    const key = String(edit.observation_id);
    const existing = editsByObservation.get(key) || [];
    existing.push(edit);
    editsByObservation.set(key, existing);
  }
  for (const edits of editsByObservation.values()) edits.sort((a, b) =>
    Number(a.version_number) - Number(b.version_number) || Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
  if (ownRows.some((row) => row?.owner_subject !== `staff:${accountId}`))
    throw new Error("The owner-scoped observation list did not match this account.");
  const byId = new Map();
  for (const row of ownRows) {
    const item = normalizeObservation(row, accountId, botanistName);
    if (!item) continue;
    item.editRequests = editsByObservation.get(item.id) || [];
    const prior = byId.get(item.id);
    if (!prior || Date.parse(item.updatedAt || 0) > Date.parse(prior.updatedAt || 0)) byId.set(item.id, item);
  }
  const observations = [...byId.values()].sort((a, b) =>
    Date.parse(b.updatedAt || b.date || 0) - Date.parse(a.updatedAt || a.date || 0) || b.id.localeCompare(a.id),
  );

  let versionHistoryError = false;
  const historyTargets = observations.filter((item) => item.editRequests.length);
  for (let offset = 0; offset < historyTargets.length; offset += 5) {
    await Promise.all(historyTargets.slice(offset, offset + 5).map(async (item) => {
      try {
        const payload = await api(`/observations/${encodeURIComponent(item.id)}/edit-history`, { expectedAccountId: accountId });
        if (!Array.isArray(payload?.versions) || !Array.isArray(payload?.edits) ||
          payload.edits.some((edit) => edit?.owner_subject !== `staff:${accountId}` || String(edit.observation_id) !== item.id))
          throw new Error("The observation history response did not match this account and observation.");
        item.historyRows = buildObservationHistoryRows(item, payload);
      } catch {
        versionHistoryError = true;
        item.historyRows = buildObservationHistoryRows(item, null);
      }
    }));
  }
  for (const item of observations) if (!item.historyRows) item.historyRows = buildObservationHistoryRows(item, null);

  return { observations, versionHistoryError };
}
