import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import BackButton from "../components/BackButton";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { mobileApiUrl } from "../utils/apiConfiguration";
import { t, translateUIMessage, useAppTranslation } from "../translations/i18n";

const hidden = new Set(["plant_id", "request_id", "observation_id", "observation_revision", "photo_ids", "photo_refs", "photo_fingerprint", "species_version"]);
function values(snapshot) {
  const result = {};
  for (const [name, value] of Object.entries(snapshot || {})) {
    if (hidden.has(name)) continue;
    if (name === "content") Object.assign(result, value || {});
    else result[name] = value;
  }
  return result;
}
const display = (value) => value == null || value === "" ? "—" : String(value);
const statusLabel = (value) => t(`recordEdits.versionStatus.${String(value).replace(/\s+/g, "")}`);
const changed = (before, after) => [...new Set([...Object.keys(values(before)), ...Object.keys(values(after))])]
  .filter((name) => JSON.stringify(values(before)[name] ?? null) !== JSON.stringify(values(after)[name] ?? null));
function photoDifference(before, after) {
  const oldRefs = before?.photo_refs || [], newRefs = after?.photo_refs || [];
  const key = (item) => JSON.stringify(item);
  return { removed: oldRefs.filter((item) => !newRefs.some((other) => key(other) === key(item))),
    added: newRefs.filter((item) => !oldRefs.some((other) => key(other) === key(item))) };
}

export default function RecordVersionHistory({ route, navigation }) {
  useAppTranslation();
  const kind = route.params?.kind, targetId = String(route.params?.targetId || ""), accountId = route.params?.botanist?.id;
  const requestedVersionId = route.params?.versionId, requestedPriorChangeId = route.params?.priorChangeId;
  const requestedPriorBase = route.params?.priorChangeVersion === "original";
  const requestedVersionBase = route.params?.versionSnapshot === "previous";
  const submissionVersionDetail = route.params?.submissionVersionDetail === true;
  const [state, setState] = useState({ loading: true, error: "", available: false, versions: [], prior: [] });
  const [selected, setSelected] = useState(null), [detailError, setDetailError] = useState("");
  const [photos, setPhotos] = useState([]), [removedImages, setRemovedImages] = useState([]), [addedImages, setAddedImages] = useState([]);
  const openVersion = useCallback(async (versionId) => {
    setDetailError("");
    try {
      const response = await plantApi(`/record-versions/${encodeURIComponent(versionId)}`, { expectedAccountId: accountId });
      if (requestedVersionBase) {
        const original = response.version.previous_snapshot || {};
        const snapshot = kind === "plant" ? { ...original, photo_refs: (original.photo_ids || []).map((asset_id) => ({ asset_id })) } : original;
        setSelected({ ...response.version, originalSnapshot: true, status: route.params?.originalStatus,
          created_at: route.params?.originalCreatedAt, snapshot, previous_snapshot: null,
          has_species_photo: kind === "species" });
      } else setSelected(response.version);
    }
    catch (error) { setDetailError(error.message); }
  }, [accountId, requestedVersionBase, kind, route.params?.originalStatus, route.params?.originalCreatedAt]);
  const openPrior = useCallback((change, original = false) => {
    const base = change.base_snapshot || {}, proposed = change.proposed_snapshot || {};
    const kept = proposed.photo_ids ?? (Number(change.proposal_photo_count) ? [] : base.photo_ids || []);
    const snapshot = kind === "plant" ? { ...base, ...proposed, content: { ...base.content, ...proposed.content },
      photo_refs: [...kept.map((asset_id) => ({ asset_id })),
        ...Array.from({ length: Number(change.proposal_photo_count) || 0 }, (_, change_photo_index) =>
          ({ change_id: change.id, change_photo_index }))] } : { ...base, ...proposed };
    const originalSnapshot = kind === "plant"
      ? { ...base, content: { ...(base.content || {}) }, photo_refs: (base.photo_ids || []).map((asset_id) => ({ asset_id })) }
      : base;
    setDetailError("");
    setSelected({ ...change, record_type: kind, edited_by: change.owner_subject,
      legacy: !original, originalSnapshot: original, status: original ? route.params?.originalStatus : change.status,
      created_at: original ? route.params?.originalCreatedAt : change.created_at,
      originalDetailsLimited: original,
      snapshot: original ? originalSnapshot : snapshot, previous_snapshot: original ? null : kind === "plant"
        ? { ...base, photo_refs: (base.photo_ids || []).map((asset_id) => ({ asset_id })) } : base,
      has_species_photo: original ? kind === "species" : Number(change.proposal_photo_count) > 0 });
  }, [kind, route.params?.originalStatus, route.params?.originalCreatedAt]);
  const load = useCallback(async (active) => {
    try {
      const response = await plantApi(`/record-versions?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(targetId)}`,
        { expectedAccountId: accountId });
      if (active.current) setState({ loading: false, error: "", available: response.history_available,
        versions: response.versions || [], prior: response.prior_changes || [] });
      if (active.current && requestedVersionId) await openVersion(requestedVersionId);
      else if (active.current && requestedPriorChangeId) {
        const prior = (response.prior_changes || []).find((change) => String(change.id) === String(requestedPriorChangeId));
        if (prior) openPrior(prior, requestedPriorBase);
      }
    } catch (error) { if (active.current) setState((old) => ({ ...old, loading: false, error: error.message })); }
  }, [kind, targetId, accountId, requestedVersionId, requestedPriorChangeId, requestedPriorBase, openVersion, openPrior]);
  useFocusEffect(useCallback(() => { const active = { current: true }; void load(active);
    return () => { active.current = false; }; }, [load]));
  useEffect(() => {
    let active = true;
    setPhotos([]); setRemovedImages([]); setAddedImages([]);
    if (selected) faceSession.withToken(async (token) => {
      const base = mobileApiUrl("plant") + "/api";
      const source = (path) => ({ uri: base + path, headers: { Authorization: `Bearer ${token}` } });
      const fromRef = (ref) => ref.asset_id
        ? source(`/assets/${encodeURIComponent(ref.asset_id)}?scope=mine`)
        : source(`/record-changes/${encodeURIComponent(ref.change_id)}/photos/${ref.change_photo_index}`);
      const images = selected.record_type === "species"
        ? selected.has_species_photo ? [source(selected.originalSnapshot
          ? `/species-requests/${encodeURIComponent(selected.snapshot.request_id || targetId)}/photo`
          : selected.legacy ? `/record-changes/${encodeURIComponent(selected.id)}/photos/0`
          : `/record-versions/${encodeURIComponent(selected.id)}/photo`)] : []
        : (selected.snapshot?.photo_refs || []).map(fromRef);
      const difference = photoDifference(selected.previous_snapshot, selected.snapshot);
      if (active) { setPhotos(images); setRemovedImages(difference.removed.map(fromRef)); setAddedImages(difference.added.map(fromRef)); }
    }).catch(() => { if (active) setDetailError(t("recordEdits.photoLoadFailed")); });
    return () => { active = false; };
  }, [selected, targetId]);
  const diff = selected ? changed(selected.previous_snapshot, selected.snapshot) : [];
  const photoDiff = selected ? photoDifference(selected.previous_snapshot, selected.snapshot) : { added: [], removed: [] };
  const activeVersion = state.versions.find((version) => version.status === "Approved")?.version_number;
  if (submissionVersionDetail) {
    const title = selected?.originalSnapshot
      ? t(kind === "plant" ? "recordEdits.originalPlantRecord" : "recordEdits.originalSpeciesRequest")
      : `${route.params?.submissionVersionLabel || t("recordEdits.version")} · ${selected?.status ? statusLabel(selected.status) : ""}`;
    const availableValues = selected ? Object.entries(values(selected.snapshot)) : [];
    return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <BackButton label={t("common.goBack")} onPress={() => navigation.goBack()} style={styles.back} />
      <Text style={styles.title}>{title}</Text>
      {(kind === "plant" ? t("submissions.plantId") : t("submissions.requestId")) && <Text style={styles.muted}>
        {kind === "plant" ? t("submissions.plantId") : t("submissions.requestId")} {targetId}</Text>}
      {state.loading && <ActivityIndicator color="#468585" />}
      {!!state.error && <View style={styles.card}><Text style={styles.error}>{translateUIMessage(state.error)}</Text></View>}
      {!!detailError && <View style={styles.card}><Text style={styles.error}>{translateUIMessage(detailError)}</Text></View>}
      {!selected && !state.loading && !state.error && <View style={styles.card}><Text style={styles.muted}>{t("recordEdits.originalSnapshotUnavailable")}</Text></View>}
      {selected && <>
        <View style={styles.card}>
          {!!selected.status && <Text style={styles.badge}>{statusLabel(selected.status)}</Text>}
          {!!selected.created_at && <Text style={styles.muted}>{new Date(selected.created_at).toLocaleString()}</Text>}
          {!!selected.review_comment && <><Text style={styles.label}>{t("recordEdits.reviewComments")}</Text><Text style={styles.error}>{selected.review_comment}</Text></>}
          {!!selected.originalDetailsLimited && <Text style={styles.muted}>{t("recordEdits.priorProposalLimit")}</Text>}
        </View>
        <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.versionSnapshot")}</Text>
          {availableValues.length ? availableValues.map(([field, value]) => <View key={field} style={styles.valueRow}>
            <Text style={styles.label}>{t(`recordEdits.${field}`)}</Text><Text style={styles.value}>{display(value)}</Text></View>)
            : <Text style={styles.muted}>{t("recordEdits.originalSnapshotUnavailable")}</Text>}
        </View>
        <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.versionPhotos")}</Text>
          {photos.length ? <View style={styles.photoRow}>{photos.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View>
            : <Text style={styles.muted}>{t("recordEdits.noPhotos")}</Text>}
        </View>
      </>}
    </ScrollView>;
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <BackButton label={t("recordEdits.backToRecord")} onPress={() => selected ? setSelected(null) : navigation.goBack()} style={styles.back} />
    <Text style={styles.title}>{t("recordEdits.versionHistory")}</Text>
    {state.loading && <ActivityIndicator color="#468585" />}
    {!!state.error && <View style={styles.card}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
      <TouchableOpacity onPress={() => { setState((old) => ({ ...old, loading: true })); void load({ current: true }); }}><Text style={styles.backText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!state.loading && !state.error && !state.available && <Text style={styles.muted}>{t("recordEdits.historyMigrationRequired")}</Text>}
    {!state.loading && state.available && !state.versions.length && !state.prior.length && <Text style={styles.muted}>{t("recordEdits.noHistoryYet")}</Text>}
    {!!detailError && <Text style={styles.error}>{translateUIMessage(detailError)}</Text>}
    {!selected && state.versions.map((version) => <TouchableOpacity key={version.id} style={styles.card} onPress={() => openVersion(version.id)} accessibilityRole="button">
      <View style={styles.row}><Text style={styles.heading}>{t("recordEdits.version")} {version.version_number} · {t(version.record_type === "plant" ? "recordEdits.plantInformation" : "recordEdits.editSpecies")}</Text><Text style={styles.chevron}>›</Text></View>
      <Text style={styles.badge}>{statusLabel(version.status)}</Text><Text style={styles.muted}>{new Date(version.created_at).toLocaleString()}</Text>
      {version.version_number === activeVersion && <Text style={styles.badge}>{t("recordEdits.currentApprovedVersion")}</Text>}
      <Text style={styles.muted}>{t("recordEdits.editedBy")}: {version.edited_by}</Text>
      {version.reviewed_by && <Text style={styles.muted}>{t("recordEdits.reviewedBy")}: {version.reviewed_by}</Text>}
      {version.reviewed_at && <Text style={styles.muted}>{t("recordEdits.reviewedAt")}: {new Date(version.reviewed_at).toLocaleString()}</Text>}
      {version.review_comment && <Text style={styles.error}>{version.review_comment}</Text>}
      <Text style={styles.muted}>{changed(version.previous_snapshot, version.snapshot).map((field) => t(`recordEdits.${field}`)).join(", ") || t("recordEdits.originalVersion")}</Text>
    </TouchableOpacity>)}
    {!selected && !!state.prior.length && <Text style={styles.heading}>{t("recordEdits.priorProposals")}</Text>}
    {!selected && state.prior.map((change) => <TouchableOpacity key={change.id} style={styles.card} onPress={() => openPrior(change)} accessibilityRole="button">
      <View style={styles.row}><Text style={styles.heading}>{t("recordEdits.priorProposal")}</Text><Text style={styles.chevron}>›</Text></View>
      <Text style={styles.badge}>{statusLabel(change.status)}</Text><Text style={styles.muted}>{new Date(change.created_at).toLocaleString()}</Text>
      {!!change.review_comment && <Text style={styles.error}>{change.review_comment}</Text>}
    </TouchableOpacity>)}
    {selected && <>
      <View style={styles.card}><Text style={styles.heading}>{selected.originalSnapshot ? t("recordEdits.originalLabel") : selected.legacy ? t("recordEdits.priorProposal") : `${t("recordEdits.version")} ${selected.version_number}`}{selected.status ? ` · ${statusLabel(selected.status)}` : ""}</Text>
        {selected.legacy && !selected.originalSnapshot && <Text style={styles.muted}>{t("recordEdits.priorProposalLimit")}</Text>}
        {!selected.originalSnapshot && <Text style={styles.muted}>{t("recordEdits.editedBy")}: {selected.edited_by}</Text>}
        {!!selected.created_at && <Text style={styles.muted}>{new Date(selected.created_at).toLocaleString()}</Text>}
        {selected.reviewed_by && <Text style={styles.muted}>{t("recordEdits.reviewedBy")}: {selected.reviewed_by}</Text>}
        {selected.reviewed_at && <Text style={styles.muted}>{t("recordEdits.reviewedAt")}: {new Date(selected.reviewed_at).toLocaleString()}</Text>}
        {selected.review_comment && <Text style={styles.error}>{selected.review_comment}</Text>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.versionSnapshot")}</Text>
        {Object.entries(values(selected.snapshot)).map(([field, value]) => <View key={field} style={styles.valueRow}><Text style={styles.label}>{t(`recordEdits.${field}`)}</Text><Text style={styles.value}>{display(value)}</Text></View>)}
      </View>
      {!!selected.previous_snapshot && <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.changedFields")}</Text>
        {diff.length ? diff.map((field) => <View key={field} style={styles.valueRow}><Text style={styles.label}>{t(`recordEdits.${field}`)}</Text>
          <Text style={styles.muted}>{display(values(selected.previous_snapshot)[field])} → {display(values(selected.snapshot)[field])}</Text></View>)
          : <Text style={styles.muted}>{t("recordEdits.noFieldChanges")}</Text>}
        {selected.record_type === "plant" && (photoDiff.added.length || photoDiff.removed.length) > 0 && <Text style={styles.value}>
          {t("recordEdits.photosChanged", { removed: photoDiff.removed.length, added: photoDiff.added.length })}</Text>}
        {!!removedImages.length && <><Text style={styles.label}>{t("recordEdits.removedPhotos")}</Text><View style={styles.photoRow}>{removedImages.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View></>}
        {!!addedImages.length && <><Text style={styles.label}>{t("recordEdits.addedPhotos")}</Text><View style={styles.photoRow}>{addedImages.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View></>}
      </View>}
      <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.versionPhotos")}</Text>
        {photos.length ? <View style={styles.photoRow}>{photos.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View>
          : <Text style={styles.muted}>{t("recordEdits.noPhotos")}</Text>}
      </View>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F7FBF4" }, content: { width: "100%", maxWidth: 820, alignSelf: "center", padding: 20, paddingBottom: 50, gap: 14 },
  back: { alignSelf: "flex-start" }, backText: { color: "#28665E", fontWeight: "700" }, title: { fontSize: 26, fontWeight: "800", color: "#234B3A" },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 18, padding: 18, gap: 10 }, heading: { fontSize: 17, fontWeight: "700", color: "#234B3A" },
  muted: { color: "#718078", lineHeight: 20 }, value: { color: "#234B3A", lineHeight: 21 }, label: { color: "#52665A", fontWeight: "700" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }, chevron: { fontSize: 25, color: "#468585" },
  badge: { alignSelf: "flex-start", color: "#28665E", backgroundColor: "#E4F5EC", borderRadius: 10, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 5 },
  valueRow: { borderTopWidth: 1, borderTopColor: "#EDF3EB", paddingTop: 8, gap: 3 }, photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 100, height: 100, borderRadius: 10 }, error: { color: "#A34436" } });
