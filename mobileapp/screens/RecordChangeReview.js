import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { mobileApiUrl } from "../utils/apiConfiguration";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";

function flattened(snapshot) {
  const result = {};
  for (const [key, value] of Object.entries(snapshot || {})) {
    if (["plant_id", "request_id", "observation_id", "observation_revision", "photo_ids", "photo_fingerprint", "species_version"].includes(key)) continue;
    if (key === "content") Object.assign(result, value || {});
    else result[key] = value;
  }
  return result;
}
const displayValue = (field, value) => field === "qr_id" && value != null
  ? `QR-${String(value).padStart(4, "0")}` : String(value ?? "—");

export default function RecordChangeReview() {
  useAppTranslation();
  const [state, setState] = useState({ loading: true, error: "", changes: [], selected: null });
  const [comment, setComment] = useState(""), [busy, setBusy] = useState(false);
  const [images, setImages] = useState({ original: [], proposed: [], removed: [], added: [] });
  const submitting = useRef(false);
  const load = useCallback(async (active) => {
    try {
      const capabilities = await plantApi("/record-changes/capabilities");
      if (!capabilities.approved_edits_available) throw Error(t("recordEdits.migrationRequired"));
      const response = await plantApi("/record-changes");
      if (active.current) setState((old) => ({ ...old, loading: false, error: "", changes: response.changes || [] }));
    } catch (error) { if (active.current) setState((old) => ({ ...old, loading: false, error: error.message })); }
  }, []);
  useFocusEffect(useCallback(() => {
    const active = { current: true }; void load(active);
    return () => { active.current = false; };
  }, [load]));
  const selected = state.changes.find((change) => change.id === state.selected);
  useEffect(() => {
    let active = true;
    setImages({ original: [], proposed: [], removed: [], added: [] });
    if (selected) faceSession.withToken(async (token) => {
      const base = mobileApiUrl("plant") + "/api";
      const source = (path) => ({ uri: base + path, headers: { Authorization: `Bearer ${token}` } });
      let speciesPhotoPath = selected.base_snapshot?.request_id
        ? `/species-requests/${encodeURIComponent(selected.base_snapshot.request_id)}/photo` : null;
      if (selected.species_id && selected.base_snapshot?.request_id) {
        const history = await plantApi(`/record-versions?kind=species&id=${encodeURIComponent(selected.base_snapshot.request_id)}`);
        const proposalVersion = history.versions?.find((item) => item.change_id === selected.id);
        const originalVersion = history.versions?.find((item) => item.version_number === proposalVersion?.version_number - 1);
        if (originalVersion?.has_species_photo) speciesPhotoPath = `/record-versions/${encodeURIComponent(originalVersion.id)}/photo`;
      }
      const original = selected.plant_id
        ? (selected.base_snapshot?.photo_ids || []).map((id) => source(`/assets/${encodeURIComponent(id)}`))
        : speciesPhotoPath ? [source(speciesPhotoPath)] : [];
      const proposed = Array.from({ length: Number(selected.proposal_photo_count) || 0 }, (_, index) =>
        source(`/record-changes/${encodeURIComponent(selected.id)}/photos/${index}`));
      const retained = selected.proposed_snapshot?.photo_ids ?? (proposed.length ? [] : selected.base_snapshot?.photo_ids || []);
      const removed = selected.plant_id ? (selected.base_snapshot?.photo_ids || []).filter((id) => !retained.includes(id)).map((id) => source(`/assets/${encodeURIComponent(id)}?scope=mine`)) : [];
      if (active) setImages({ original, proposed, removed, added: proposed });
    }).catch(() => { if (active) setImages({ original: [], proposed: [], removed: [], added: [] }); });
    return () => { active = false; };
  }, [selected]);
  function select(id) { setState((old) => ({ ...old, selected: id })); setComment(""); }
  function review(decision) {
    if (submitting.current || !selected || !comment.trim()) return Alert.alert(t("common.error"), t("recordEdits.reviewReasonRequired"));
    Alert.alert(t("recordEdits.confirmTitle"), t(decision === "Approved" ? "recordEdits.approveConfirm" : "recordEdits.rejectConfirm"), [
      { text: t("common.cancel"), style: "cancel" }, { text: t(decision === "Approved" ? "recordEdits.approve" : "recordEdits.reject"), onPress: () => void submit(decision) },
    ]);
  }
  async function submit(decision) {
    if (submitting.current || !selected) return;
    submitting.current = true; setBusy(true);
    try {
      await plantApi(`/record-changes/${encodeURIComponent(selected.id)}/review`, { method: "POST", body: { decision, comment: comment.trim() } });
      const response = await plantApi("/record-changes");
      setState({ loading: false, error: "", changes: response.changes || [], selected: null });
      setComment("");
      Alert.alert(t("recordEdits.reviewSaved"));
    } catch (error) { Alert.alert(t("common.error"), translateUIMessage(error.message)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const original = flattened(selected?.base_snapshot);
  const proposed = selected?.plant_id ? { ...original, ...flattened(selected?.proposed_snapshot) } : flattened(selected?.proposed_snapshot);
  const labels = [...new Set([...Object.keys(original), ...Object.keys(proposed)])]
    .filter((field) => JSON.stringify(original[field] ?? null) !== JSON.stringify(proposed[field] ?? null));
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.title}>{t("recordEdits.reviewTitle")}</Text>
    {state.loading && <ActivityIndicator color="#468585" />}
    {!!state.error && <View style={styles.card}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
      <TouchableOpacity style={styles.secondary} onPress={() => { setState((old) => ({ ...old, loading: true })); void load({ current: true }); }}><Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!state.loading && !state.error && !state.changes.length && <Text style={styles.muted}>{t("recordEdits.noChanges")}</Text>}
    {!selected && state.changes.map((change) => <TouchableOpacity key={change.id} style={styles.card} onPress={() => select(change.id)} accessibilityRole="button">
      <Text style={styles.heading}>{t(change.plant_id ? "recordEdits.plantInformation" : "recordEdits.editSpecies")} #{change.plant_id || change.species_id}</Text>
      <Text style={styles.muted}>{change.status} · {new Date(change.created_at).toLocaleString()}</Text>
    </TouchableOpacity>)}
    {selected && <>
      <TouchableOpacity style={styles.secondary} onPress={() => select(null)}><Text style={styles.secondaryText}>{t("recordEdits.backToQueue")}</Text></TouchableOpacity>
      <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.compareTitle")}</Text>
        {labels.map((field) => <View key={field} style={[styles.compare, original[field] !== proposed[field] && styles.changed]}>
          <Text style={styles.label}>{t(`recordEdits.${field}`)}</Text>
          <Text style={styles.muted}>{t("recordEdits.original")}: {displayValue(field, original[field])}</Text>
          <Text style={styles.value}>{t("recordEdits.proposed")}: {displayValue(field, proposed[field])}</Text>
        </View>)}
        {Number(selected.proposal_photo_count) > 0 && <Text style={styles.value}>{t("recordEdits.photoReplacementProposed")}</Text>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.originalPhotos")}</Text>
        <View style={styles.photoRow}>{images.original.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View>
        <Text style={styles.heading}>{t("recordEdits.proposedPhotos")}</Text>
        {images.proposed.length ? <View style={styles.photoRow}>{images.proposed.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View>
          : <Text style={styles.muted}>{t("recordEdits.keepExistingPhotos")}</Text>}
      </View>
      {selected.plant_id && (images.removed.length > 0 || images.added.length > 0) && <View style={styles.card}>
        <Text style={styles.heading}>{t("recordEdits.photosChanged", { removed: images.removed.length, added: images.added.length })}</Text>
        {!!images.removed.length && <><Text style={styles.label}>{t("recordEdits.removedPhotos")}</Text><View style={styles.photoRow}>{images.removed.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View></>}
        {!!images.added.length && <><Text style={styles.label}>{t("recordEdits.addedPhotos")}</Text><View style={styles.photoRow}>{images.added.map((source, index) => <Image key={index} source={source} style={styles.photo} />)}</View></>}
      </View>}
      {!!selected.review_comment && <Text style={styles.muted}>{selected.review_comment}</Text>}
      {selected.status === "Pending Review" && <View style={styles.card}>
        <Text style={styles.label}>{t("recordEdits.reviewReason")}</Text>
        <TextInput style={styles.input} value={comment} onChangeText={setComment} multiline />
        <TouchableOpacity style={styles.primary} onPress={() => review("Approved")} disabled={busy}><Text style={styles.primaryText}>{t("recordEdits.approve")}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => review("Rejected")} disabled={busy}><Text style={styles.secondaryText}>{t("recordEdits.reject")}</Text></TouchableOpacity>
      </View>}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: "#F7FBF4" }, content: { width: "100%", maxWidth: 850, alignSelf: "center", padding: 20, paddingBottom: 50, gap: 14 },
  title: { fontSize: 26, fontWeight: "800", color: "#234B3A" }, card: { padding: 18, borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 18, backgroundColor: "#FFFFFF", gap: 12 },
  heading: { fontSize: 17, fontWeight: "700", color: "#234B3A" }, muted: { color: "#718078", lineHeight: 20 }, value: { color: "#234B3A", lineHeight: 21 },
  label: { color: "#52665A", fontWeight: "700" }, compare: { padding: 10, borderRadius: 10, gap: 5 }, changed: { backgroundColor: "#EFF8F4" },
  input: { borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 10, padding: 12, minHeight: 80, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, photo: { width: 96, height: 96, borderRadius: 10 },
  primary: { backgroundColor: "#468585", padding: 14, minHeight: 44, borderRadius: 12, alignItems: "center" }, primaryText: { color: "#FFFFFF", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: "#CDE3DC", padding: 13, minHeight: 44, borderRadius: 12, alignItems: "center" }, secondaryText: { color: "#28665E", fontWeight: "700" }, error: { color: "#A34436" } });
