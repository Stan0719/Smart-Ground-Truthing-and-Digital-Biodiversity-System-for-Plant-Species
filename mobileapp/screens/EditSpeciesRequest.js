import React, { useCallback, useRef, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { fetchBotanistSpeciesRequest, fetchBotanistRecordChangeStatus } from "../utils/botanistRecords";
import { plantApi } from "../utils/plantApi";
import { downloadPhotoForReuse } from "../utils/photoReuse";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import OriginalUpdatedField from "../components/OriginalUpdatedField";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";
import { saveBotanistFormDraft, getBotanistFormDraft, findBotanistFormDraft, deleteBotanistFormDraft } from "../utils/botanistFormDrafts";
import { useBotanistDraftAutosave } from "../utils/botanistDraftAutosave";

const fields = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"];
const makeKey = () => `species-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function EditSpeciesRequest({ route, navigation }) {
  useAppTranslation();
  const requestId = String(route.params?.requestId || ""), accountId = route.params?.botanist?.id;
  const [state, setState] = useState({ loading: true, error: "", request: null, available: false });
  const [form, setForm] = useState(null), [photo, setPhoto] = useState(null), [reuseOriginalPhoto, setReuseOriginalPhoto] = useState(false), [originalPhotoUnavailable, setOriginalPhotoUnavailable] = useState(false), [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false), [draftMessage, setDraftMessage] = useState(""), [draftError, setDraftError] = useState(""), [draftConflict, setDraftConflict] = useState(false), [offlineDraft, setOfflineDraft] = useState(false);
  const [reload, setReload] = useState(0);
  const [editAvailability, setEditAvailability] = useState("checking");
  const [recoveryResolved, setRecoveryResolved] = useState(Boolean(route.params?.formDraftKey)), [autoSaveState, setAutoSaveState] = useState("");
  const busy = useRef(false), clientKey = useRef(makeKey()), formDraftKey = useRef(route.params?.formDraftKey || `edit-species-${accountId}-${requestId}`), restoredDraftRef = useRef(null), recoveryPromptedRef = useRef(false), initialFormRef = useRef(null);
  const activeFormDraftKey = route.params?.formDraftKey || formDraftKey.current;
  const signature = (request) => JSON.stringify({ request_status: request.request_status, submitted_at: request.submitted_at,
    ...Object.fromEntries(fields.map((field) => [field, request[field] ?? ""])) });
  const restoreDraft = (draft) => {
    restoredDraftRef.current = draft; clientKey.current = draft.submission_client_key || clientKey.current;
    setForm(draft.form); setReuseOriginalPhoto(Boolean(draft.form.reuseOriginalPhoto));
    setPhoto(draft.photo_refs?.find((item) => item.slot === "new:photo")?.uri || null);
  };
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const [request, capabilities] = await Promise.all([fetchBotanistSpeciesRequest(accountId, requestId),
          plantApi("/record-changes/capabilities", { expectedAccountId: accountId })]);
        if (!active) return;
        const originalForm = Object.fromEntries(fields.map((field) => [field, String(request[field] ?? "")]));
        initialFormRef.current = originalForm;
        const sameDraft = Boolean(route.params?.formDraftKey && restoredDraftRef.current?.client_key === route.params.formDraftKey);
        if (!sameDraft) {
          setForm(originalForm);
          setPhoto(null); setReuseOriginalPhoto(false); setOriginalPhotoUnavailable(false);
        }
        if (route.params?.formDraftKey) {
          const restored = await getBotanistFormDraft(accountId, route.params.formDraftKey, "edit-species", requestId);
          if (!sameDraft) restoreDraft(restored);
          setDraftConflict(restored.base_signature !== signature(request));
        } else {
          setForm(originalForm); setPhoto(null); setReuseOriginalPhoto(false); setOriginalPhotoUnavailable(false); setDraftConflict(false);
          if (!recoveryPromptedRef.current) {
            recoveryPromptedRef.current = true;
            let candidate = null;
            try { candidate = await findBotanistFormDraft(accountId, "edit-species", requestId); }
            catch (draftError) { if (active) setDraftError(translateUIMessage(draftError.message) || t("botanistDrafts.restoreFailed")); }
            if (active && candidate) Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
              { text: t("botanistDrafts.continueDraft"), onPress: async () => {
                try { const saved = await getBotanistFormDraft(accountId, candidate.client_key, "edit-species", requestId); restoreDraft(saved); setDraftConflict(saved.base_signature !== signature(request)); }
                catch (restoreError) { setDraftError(translateUIMessage(restoreError.message) || t("botanistDrafts.restoreFailed")); }
                setRecoveryResolved(true);
              } },
              { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: () => {
                formDraftKey.current = makeKey(); setForm(originalForm); setPhoto(null); setReuseOriginalPhoto(false); setRecoveryResolved(true);
              } },
            ]);
            else setRecoveryResolved(true);
          }
        }
        setOfflineDraft(false);
        setState({ loading: false, error: "", request, available: capabilities.approved_edits_available });
        if (request.request_status === "Approved") {
          setEditAvailability("checking");
          fetchBotanistRecordChangeStatus(accountId, "species", requestId).then((result) => {
            if (active) setEditAvailability(!result.available ? "unavailable" : result.pending ? "pending" : "clear");
          }).catch(() => { if (active) setEditAvailability("unavailable"); });
        } else setEditAvailability("not-required");
      } catch (error) {
        if (!active) return;
        if (route.params?.formDraftKey) {
          try {
            const draft = await getBotanistFormDraft(accountId, route.params.formDraftKey, "edit-species", requestId);
            const baseline = draft.baseline;
            if (!baseline?.request) throw error;
            if (restoredDraftRef.current?.client_key !== route.params.formDraftKey) restoreDraft(draft);
            setOfflineDraft(true); setDraftConflict(false);
            setState({ loading: false, error: "", request: { ...baseline.request, photo: null }, available: false });
            setDraftError(t("botanistDrafts.offlineReadOnlyNotice")); return;
          } catch (restoreError) { setState((old) => ({ ...old, loading: false, error: restoreError.message || error.message })); return; }
        }
        setState((old) => ({ ...old, loading: false, error: error.message }));
      }
    })();
    return () => { active = false; };
  // `reload` intentionally changes the focus callback when the user presses Retry.
  }, [accountId, requestId, reload, route.params?.formDraftKey])); // eslint-disable-line react-hooks/exhaustive-deps
  async function pickPhoto(camera) {
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert(t("common.error"), t(camera ? "addPlant.cameraPermissionIsRequired" : "recordEdits.photoPermission"));
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
      if (!result.canceled && result.assets?.[0]) { setPhoto(result.assets[0].uri); setReuseOriginalPhoto(false); }
    } catch { Alert.alert(t("common.error"), t("recordEdits.photoUnavailable")); }
  }
  async function saveLocalDraft() {
    if (draftSaving || saving || submitted || !form || !state.request) return;
    setDraftSaving(true); setDraftError(""); setDraftMessage("");
    try {
      const request = state.request;
      const baseline = { request: { request_id: request.request_id, request_status: request.request_status, submitted_at: request.submitted_at,
        ...Object.fromEntries(fields.map((field) => [field, request[field] ?? ""])) } };
      const draft = await saveBotanistFormDraft(accountId, { client_key: activeFormDraftKey, form_type: "edit-species", target_id: requestId,
        title: form.scientific_name || request.scientific_name || "", base_signature: restoredDraftRef.current?.base_signature || signature(request), baseline,
        submission_client_key: clientKey.current, auto_saved: false, form: { ...form, reuseOriginalPhoto },
        photos: photo ? [{ slot: "new:photo", uri: photo, content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg" }] : [] });
      restoredDraftRef.current = draft;
      await autosave.stop();
      Alert.alert(t("botanistDrafts.savedStatus"), t("botanistDrafts.saved"), [{
        text: t("common.ok"),
        onPress: () => navigation.navigate("BotanistMyDrafts", { botanist: route.params?.botanist, openDraftKey: draft.client_key }),
      }]);
    } catch (error) { setDraftError(translateUIMessage(error.message) || t("botanistDrafts.saveFailed")); }
    finally { setDraftSaving(false); }
  }
  const makeDraftInput = (autoSaved = false) => {
    const request = state.request;
    const baseline = { request: { request_id: request.request_id, request_status: request.request_status, submitted_at: request.submitted_at,
      ...Object.fromEntries(fields.map((field) => [field, request[field] ?? ""])) } };
    return { client_key: activeFormDraftKey, form_type: "edit-species", target_id: requestId, title: form.scientific_name || request.scientific_name || "",
      base_signature: restoredDraftRef.current?.base_signature || signature(request), baseline, submission_client_key: clientKey.current,
      auto_saved: autoSaved, form: { ...form, reuseOriginalPhoto },
      photos: photo ? [{ slot: "new:photo", uri: photo, content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg" }] : [] };
  };
  const hasMeaningfulChanges = Boolean(form && initialFormRef.current && JSON.stringify(form) !== JSON.stringify(initialFormRef.current)) || Boolean(photo) || reuseOriginalPhoto;
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(accountId && form && state.request && recoveryResolved && !submitted && hasMeaningfulChanges),
    signature: JSON.stringify({ form, photo, reuseOriginalPhoto }), navigation, accountId, errorKey: accountId && route.key ? `${accountId}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { const draft = await saveBotanistFormDraft(accountId, makeDraftInput(true)); restoredDraftRef.current = draft; if (isMounted?.()) setAutoSaveState("saved"); return draft; },
    onError: (error) => { setAutoSaveState("error"); setDraftError(translateUIMessage(error.message) || t("botanistDrafts.autoSaveFailed")); } });
  function confirmLeave() {
    Alert.alert(t("botanistDrafts.leaveTitle"), t("botanistDrafts.leaveWarning"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("botanistDrafts.leaveForm"), style: "destructive", onPress: () => navigation.goBack() },
    ]);
  }
  function submit() {
    if (busy.current || submitted) return;
    if (offlineDraft || draftConflict) return Alert.alert(t("common.error"), t("botanistDrafts.editConflict"));
    if (fields.some((field) => !form[field].trim() || form[field].length > (["description", "habitat"].includes(field) ? 4000 : 200)))
      return Alert.alert(t("common.error"), t("recordEdits.speciesFieldsRequired"));
    if (state.request.request_status === "Approved" && !state.available)
      return Alert.alert(t("common.error"), t("recordEdits.migrationRequired"));
    showSubmitConfirmation();
  }
  function showSubmitConfirmation() {
    Alert.alert(t("recordEdits.confirmTitle"), t("recordEdits.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" }, { text: t("recordEdits.submitChanges"), onPress: save },
    ]);
  }
  async function refreshEditAvailability() {
    if (state.request.request_status !== "Approved") return "not-required";
    setEditAvailability("checking");
    try {
      const result = await fetchBotanistRecordChangeStatus(accountId, "species", requestId);
      const availability = !result.available ? "unavailable" : result.pending ? "pending" : "clear";
      setEditAvailability(availability);
      return availability;
    } catch { setEditAvailability("unavailable"); return "unavailable"; }
  }
  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    let reusedFile;
    try {
      if (state.request.request_status === "Approved") {
        const availability = await refreshEditAvailability();
        if (availability !== "clear") {
          const error = new Error(availability === "pending" ? t("recordEdits.pendingEditExplanation") : t("recordEdits.editAvailabilityUnavailable"));
          error.code = availability === "pending" ? "EDIT_PENDING" : "EDIT_AVAILABILITY_UNKNOWN";
          throw error;
        }
      }
      if (restoredDraftRef.current) {
        const latest = await fetchBotanistSpeciesRequest(accountId, requestId);
        if (signature(latest) !== restoredDraftRef.current.base_signature) {
          setDraftConflict(true); throw Error(t("botanistDrafts.editConflict"));
        }
      }
      const proposed = Object.fromEntries(fields.map((field) => [field, form[field].trim()]));
      if (photo) proposed.photo = { content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg",
        base64: await FileSystem.readAsStringAsync(photo, { encoding: FileSystem.EncodingType.Base64 }) };
      else if (reuseOriginalPhoto) {
        reusedFile = await downloadPhotoForReuse(FileSystem, state.request.photo);
        proposed.photo = reusedFile.photo;
      }
      let changeId = null;
      if (state.request.request_status === "Approved") {
        const response = await plantApi("/record-changes", { method: "POST", expectedAccountId: accountId,
          body: { kind: "species", target_id: Number(requestId), proposed, client_key: clientKey.current } });
        changeId = response?.change?.id ?? null;
      } else await plantApi(`/my-species-requests/${encodeURIComponent(requestId)}`, { method: "PATCH", expectedAccountId: accountId, body: proposed });
      await autosave.stop();
      if (restoredDraftRef.current) {
        try {
          const removed = await deleteBotanistFormDraft(accountId, activeFormDraftKey, restoredDraftRef.current.saved_at);
          if (!removed) setDraftError(t("botanistDrafts.newerDraftKept")); else restoredDraftRef.current = null;
        } catch { setDraftError(t("botanistDrafts.cleanupFailed")); }
      }
      setSubmitted(true);
      Alert.alert(t("recordEdits.savedTitle"), t("recordEdits.savedMessage"), [{ text: t("common.ok"), onPress: () => navigation.navigate("BotanistSubmissions", {
        botanist: route.params?.botanist, openTarget: { kind: "species", recordId: requestId, ...(changeId ? { changeId } : {}) },
      }) }]);
    } catch (error) {
      if (error.status === 409 && /already pending review/i.test(error.message || "")) setEditAvailability("pending");
      const reuseMessages = { PHOTO_REUSE_UNAVAILABLE: "recordEdits.photoReuseUnavailable", PHOTO_REUSE_DOWNLOAD_FAILED: "recordEdits.photoReuseDownloadFailed",
        PHOTO_REUSE_UNSUPPORTED_FORMAT: "recordEdits.photoReuseUnsupportedFormat", PHOTO_REUSE_TOO_LARGE: "recordEdits.photoReuseTooLarge" };
      Alert.alert(t("common.error"), error.code === "EDIT_PENDING" || (error.status === 409 && /already pending review/i.test(error.message || ""))
        ? t("recordEdits.pendingEditExplanation") : error.code === "EDIT_AVAILABILITY_UNKNOWN" ? t("recordEdits.editAvailabilityUnavailable")
          : reuseMessages[error.code] ? t(reuseMessages[error.code]) : translateUIMessage(error.message));
    }
    finally { await reusedFile?.cleanup().catch(() => {}); busy.current = false; setSaving(false); }
  }
  if (state.loading) return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <DetailSkeletonContent label={t("submissions.loadingRequestDetails")} sections={3} />
  </ScrollView>;
  if (state.error || !form) return <View style={styles.center}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
    <TouchableOpacity style={styles.secondary} onPress={() => { setState((old) => ({ ...old, loading: true, error: "" })); setReload((old) => old + 1); }}>
      <Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{t("recordEdits.editSpecies")}</Text>
    <Text style={styles.note}>{state.request.request_status === "Approved" ? t("recordEdits.approvedNotice") : t("recordEdits.pendingNotice")}</Text>
    {state.request.request_status === "Approved" && editAvailability === "pending" && <View style={styles.pendingEditNote}><Text style={styles.pendingEditLabel}>{t("recordEdits.pendingEdit")}</Text><Text style={styles.note}>{t("recordEdits.pendingEditExplanation")}</Text></View>}
    {state.request.request_status === "Approved" && editAvailability === "checking" && <Text style={styles.note}>{t("recordEdits.checkingEditAvailability")}</Text>}
    {state.request.request_status === "Approved" && editAvailability === "unavailable" && <Text style={styles.error}>{t("recordEdits.editAvailabilityUnavailable")}</Text>}
    {(offlineDraft || draftConflict) && <Text style={styles.error}>{t(offlineDraft ? "botanistDrafts.offlineReadOnlyNotice" : "botanistDrafts.editConflict")}</Text>}
    {autoSaveState === "saving" ? <Text style={styles.note}>{t("botanistDrafts.autoSaving")}</Text> : null}{autoSaveState === "saved" ? <Text style={styles.note}>{t("botanistDrafts.autoSaved")}</Text> : null}{draftMessage ? <Text style={styles.draftSuccess}>{draftMessage}</Text> : null}{draftError ? <Text style={styles.error}>{draftError}</Text> : null}
    {autoSaveState === "error" ? <TouchableOpacity onPress={() => { setDraftError(""); void autosave.retry().catch(() => {}); }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button"><Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity> : null}
    {state.request.request_status === "Approved" && !state.available && <Text style={styles.error}>{t("recordEdits.migrationRequired")}</Text>}
    <View style={styles.card}>{fields.map((field) => <OriginalUpdatedField key={field} label={t(`recordEdits.${field}`)} originalValue={state.request[field]}>
      <TextInput style={[styles.input, ["description", "habitat"].includes(field) && styles.multiline]} value={form[field]}
        onChangeText={(next) => setForm((old) => ({ ...old, [field]: next }))} multiline={["description", "habitat"].includes(field)} />
    </OriginalUpdatedField>)}
      <OriginalUpdatedField label={t("recordEdits.speciesPhoto")}
        originalContent={state.request.photo ? <View style={styles.photoCard}>
          <TouchableOpacity style={[styles.photoFrame, reuseOriginalPhoto && styles.photoFrameSelected]} onPress={() => { if (!reuseOriginalPhoto) { setReuseOriginalPhoto(true); setPhoto(null); } }}
            accessibilityRole="checkbox" accessibilityLabel={t("recordEdits.originalPhoto")} accessibilityState={{ checked: reuseOriginalPhoto }}>
            <Image source={state.request.photo} style={styles.photo} resizeMode="cover" onError={() => setOriginalPhotoUnavailable(true)} />
            {reuseOriginalPhoto && <View style={styles.photoSelectionMark}><Text style={styles.photoSelectionCheck}>✓</Text></View>}
          </TouchableOpacity>
          {originalPhotoUnavailable && <Text style={styles.error}>{t("recordEdits.originalPhotoUnavailable")}</Text>}
        </View> : <Text style={styles.secondaryText}>{t("recordEdits.informationNotAvailable")}</Text>}>
        <Text style={styles.photoNote}>{t("recordEdits.speciesPhotoSingleLimit")}</Text>
        {(photo || (reuseOriginalPhoto && state.request.photo)) && <View style={styles.photoCard}><View style={[styles.photoFrame, reuseOriginalPhoto && !photo && styles.photoFrameSelected]}>
          <Image source={photo ? { uri: photo } : state.request.photo} style={styles.photo} resizeMode="cover" /></View>
          <TouchableOpacity style={styles.removeSelection} onPress={() => { setPhoto(null); setReuseOriginalPhoto(false); }} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}><Text style={styles.removeSelectionText}>×</Text></TouchableOpacity>
        </View>}
        <View style={styles.photoActions}>
          <TouchableOpacity style={styles.photoActionButton} onPress={() => pickPhoto(true)} accessibilityRole="button" accessibilityLabel={t("recordEdits.takePhoto")}><Text style={styles.secondaryText}>{t("recordEdits.takePhoto")}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.photoActionButton} onPress={() => pickPhoto(false)} accessibilityRole="button" accessibilityLabel={t("recordEdits.addGallery")}><Text style={styles.secondaryText}>{t("recordEdits.addGallery")}</Text></TouchableOpacity>
        </View>
      </OriginalUpdatedField>
    </View>
    <View style={styles.formActionRow}>
      <TouchableOpacity style={[styles.secondary, (draftSaving || saving || submitted) && styles.disabled]} onPress={saveLocalDraft} disabled={draftSaving || saving || submitted} accessibilityRole="button" accessibilityState={{ disabled: draftSaving || saving || submitted }}><Text style={styles.secondaryText}>{draftSaving ? t("botanistDrafts.saving") : t("botanistDrafts.saveDraft")}</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.primary, (saving || submitted || offlineDraft || draftConflict) && styles.disabled]} onPress={submit} disabled={saving || submitted || offlineDraft || draftConflict} accessibilityRole="button" accessibilityState={{ disabled: saving || submitted || offlineDraft || draftConflict }}><Text style={styles.primaryText}>{saving ? t("recordEdits.saving") : t("recordEdits.submitChanges")}</Text></TouchableOpacity>
    </View>
    <TouchableOpacity style={styles.secondary} onPress={confirmLeave} disabled={saving}><Text style={styles.secondaryText}>{t("common.cancel")}</Text></TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F7FBF4" }, content: { padding: 20, paddingBottom: 50, gap: 16, width: "100%", maxWidth: 820, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F7FBF4" },
  title: { color: "#234B3A", fontSize: 26, fontWeight: "800" }, note: { color: "#52665A", lineHeight: 21 },
  pendingEditNote: { backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#EAD9B5", borderRadius: 12, padding: 12, gap: 5 },
  pendingEditLabel: { color: "#77501D", fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 18, padding: 18, gap: 10 },
  label: { color: "#52665A", fontSize: 13, fontWeight: "600", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#FFFFFF", borderRadius: 11, padding: 12, color: "#234B3A", minHeight: 44 },
  multiline: { minHeight: 90, textAlignVertical: "top" }, photo: { width: "100%", height: "100%", borderRadius: 12 },
  photoCard: { position: "relative", width: 140 }, photoFrame: { width: 140, height: 126, borderRadius: 14, borderWidth: 2, borderColor: "#E2EDE0", overflow: "hidden", position: "relative" }, photoFrameSelected: { borderColor: "#468585" }, photoSelectionMark: { ...StyleSheet.absoluteFillObject, backgroundColor: "#234B3A35", alignItems: "flex-end", padding: 8 }, photoSelectionCheck: { color: "#FFFFFF", fontSize: 22, fontWeight: "800" }, removeSelection: { position: "absolute", right: -7, top: -7, backgroundColor: "#A34436", width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }, removeSelectionText: { color: "#FFFFFF", fontSize: 20, fontWeight: "600" }, photoActions: { flexDirection: "row", gap: 9 }, photoActionButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F8F2", borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 11, paddingHorizontal: 10 },
  formActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  primary: { flexGrow: 1, flexBasis: "45%", minWidth: 145, backgroundColor: "#2F6B4F", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#FFFFFF", fontWeight: "700", textAlign: "center" },
  secondary: { flexGrow: 1, flexBasis: "45%", minWidth: 145, borderWidth: 1, borderColor: "#AFCBB7", backgroundColor: "#E8EDDA", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, alignItems: "center", justifyContent: "center" }, secondaryText: { color: "#2F6B4F", fontWeight: "700", textAlign: "center" },
  draftSuccess: { color: "#2F6B4F", textAlign: "center", fontSize: 13 }, disabled: { opacity: 0.6 }, error: { color: "#A34436", lineHeight: 21 },
});
