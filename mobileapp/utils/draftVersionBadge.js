// Draft badges are presentation only. Submitted edit IDs, never draft save times,
// determine the sequence; an incomplete history produces an unnumbered Edit.
export function draftBadgeTarget(draft) {
  const type = draft?.kind === "botanist-form" ? draft.form_type : draft?.method === "OBSERVATION_EDIT"
    ? "observation-edit" : draft?.method === "PATCH" ? "observation-correction"
      : draft?.path === "/plants" ? "field-plant" : "observation";
  const kind = ["add-plant", "edit-plant", "field-plant"].includes(type) ? "plant"
    : ["add-species", "edit-species"].includes(type) ? "species" : "observation";
  if (!["edit-plant", "edit-species", "observation-edit"].includes(type)) return { kind, original: true };
  const targetId = kind === "observation" ? draft.observation_id : draft.target_id;
  if (!targetId) return { kind, original: false };
  return { kind, original: false, targetId: String(targetId),
    existingId: kind === "observation" ? draft.edit_request?.id || draft.path?.match(/^\/observation-edits\/([^/]+)$/)?.[1]
      : draft.correction_change_id || undefined };
}

export function draftEditNumber(target, history) {
  if (!target?.targetId) return null;
  if (target.kind === "observation") {
    const edits = history?.edits, versions = history?.versions;
    if (!Array.isArray(edits) || !Array.isArray(versions) || !versions.length) return null;
    const unique = new Map();
    for (const edit of edits) {
      const number = Number(edit?.version_number);
      if (!edit?.id || !Number.isInteger(number) || number < 1) return null;
      if (unique.has(String(edit.id)) && unique.get(String(edit.id)) !== number) return null;
      unique.set(String(edit.id), number);
    }
    if (target.existingId) return unique.get(String(target.existingId)) ?? null;
    return Math.max(0, ...unique.values()) + 1;
  }
  const versions = history?.versions, prior = history?.prior_changes;
  if (!history?.history_available || !Array.isArray(versions) || !Array.isArray(prior) || versions.length >= 200 ||
      !versions.some((row) => Number(row?.version_number) === 1)) return null;
  const changes = new Map();
  for (const row of versions) {
    if (Number(row?.version_number) === 1 || row?.snapshot?.review_provenance?.evidence_type === "approval_capture") continue;
    if (!row?.change_id) return null;
    const id = String(row.change_id);
    const time = Date.parse(row.created_at || "");
    if (!Number.isFinite(time)) return null;
    if (!changes.has(id) || time < changes.get(id)) changes.set(id, time);
  }
  for (const row of prior) {
    const time = Date.parse(row?.created_at || "");
    if (!row?.id || !Number.isFinite(time)) return null;
    if (!changes.has(String(row.id))) changes.set(String(row.id), time);
  }
  // A unique change ID represents one submitted edit, including its correction
  // revisions. Approval captures and the original submission are excluded.
  if (target.existingId && !changes.has(String(target.existingId))) return null;
  if (target.existingId) {
    const order = [...changes.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    return order.findIndex(([id]) => id === String(target.existingId)) + 1;
  }
  return changes.size + 1;
}
