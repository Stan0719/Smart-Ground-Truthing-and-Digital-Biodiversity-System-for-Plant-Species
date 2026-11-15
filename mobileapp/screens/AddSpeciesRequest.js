import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import { validateSpeciesRequest } from "../utils/addPlantValidation";
import { plantApi } from "../utils/plantApi";
import { deleteBotanistFormDraft, findBotanistFormDraft, getBotanistFormDraft, saveBotanistFormDraft } from "../utils/botanistFormDrafts";
import { useBotanistDraftAutosave } from "../utils/botanistDraftAutosave";

const conservationStatuses = ["Not Assessed", "Least Concern", "Near Threatened", "Vulnerable", "Endangered", "Critically Endangered"];
const makeKey = () => `species-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const requiredLabel = (label) => label.trim().endsWith("*") ? label : `${label} *`;

export default function AddSpeciesRequest({ route, navigation }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const draftKey = useRef(route.params?.formDraftKey || makeKey());
  const [draftKeyVersion, setDraftKeyVersion] = useState(0), [recoveryResolved, setRecoveryResolved] = useState(Boolean(route.params?.formDraftKey));
  const [autoSaveState, setAutoSaveState] = useState("");
  const restoredDraftRef = useRef(null), recoveryPromptedRef = useRef(false);
  const clientKey = useRef(makeKey());
  const attemptedPayload = useRef(null);
  const busy = useRef(false);
  const [form, setForm] = useState({ scientific_name: "", common_name: "", genus_name: "", family_name: "", conservation_status: "Not Assessed", description: "", habitat: "" });
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!accountId || !route.params?.formDraftKey) return;
    let active = true;
    getBotanistFormDraft(accountId, route.params.formDraftKey, "add-species").then((draft) => {
      if (!active) return;
      restoredDraftRef.current = draft; draftKey.current = draft.client_key; clientKey.current = draft.submission_client_key || clientKey.current;
      setForm(draft.form || {}); setPhoto(draft.photo_refs?.find((item) => item.slot === "species:photo")?.uri || null); setRecoveryResolved(true);
    }).catch((restoreError) => { if (active) { setError(restoreError.message || t("botanistDrafts.restoreFailed")); setRecoveryResolved(true); } });
    return () => { active = false; };
  }, [accountId, route.params?.formDraftKey]);

  useEffect(() => {
    if (!accountId || route.params?.formDraftKey || recoveryPromptedRef.current) return;
    recoveryPromptedRef.current = true;
    let active = true;
    findBotanistFormDraft(accountId, "add-species").then((draft) => {
      if (!active || !draft) { if (active) setRecoveryResolved(true); return; }
      Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
        { text: t("botanistDrafts.continueDraft"), onPress: () => navigation.setParams({ formDraftKey: draft.client_key }) },
        { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: () => { draftKey.current = makeKey(); setDraftKeyVersion((v) => v + 1); setRecoveryResolved(true); } },
      ]);
    }).catch((restoreError) => { if (active) { setError(restoreError.message || t("botanistDrafts.restoreFailed")); setRecoveryResolved(true); } });
    return () => { active = false; };
  }, [accountId, navigation, route.params?.formDraftKey]);

  const makeDraftInput = (autoSaved = false) => ({ client_key: draftKey.current, form_type: "add-species", submission_client_key: clientKey.current, auto_saved: autoSaved,
    title: form.scientific_name || "", form: { ...form },
    photos: photo ? [{ slot: "species:photo", uri: photo, content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg" }] : [] });
  const meaningful = Object.entries(form).some(([key, value]) => key !== "conservation_status" && String(value || "").trim()) || Boolean(photo);
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(accountId && recoveryResolved && meaningful && !submitted),
    signature: JSON.stringify({ form, photo, draftKeyVersion }), navigation, accountId, errorKey: accountId && route.key ? `${accountId}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { restoredDraftRef.current = await saveBotanistFormDraft(accountId, makeDraftInput(true)); if (isMounted?.()) setAutoSaveState("saved"); return restoredDraftRef.current; },
    onError: (saveError) => { setAutoSaveState("error"); setError(saveError.message || t("botanistDrafts.autoSaveFailed")); } });

  async function choosePhoto(camera) {
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert(t("addPlant.permissionRequired"), camera ? t("addPlant.cameraPermissionIsRequiredToTakeASpeciesPhoto") : t("addPlant.galleryPermissionIsRequiredToSelectSpeciesPhotos"));
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled && result.assets?.[0]?.uri) setPhoto(result.assets[0].uri);
    } catch { Alert.alert(t("common.error"), camera ? t("addPlant.unableToOpenTheCamera") : t("addPlant.unableToOpenTheGallery")); }
  }

  async function submit() {
    if (busy.current || submitted) return;
    const problem = validateSpeciesRequest({ ...form, photoUri: photo });
    if (problem) return Alert.alert(t("addObservation.missingInformation"), t(`addPlantWorkflow.${problem}`));
    if (!accountId) return Alert.alert(t("common.error"), t("botanistDrafts.ownerRequired"));
    busy.current = true; setSaving(true); setError("");
    try {
      const base64 = await FileSystem.readAsStringAsync(photo, { encoding: FileSystem.EncodingType.Base64 });
      if (base64.length > 5592408) throw Error(t("addPlantWorkflow.speciesPhotoTooLarge"));
      const body = {
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])),
        photo: { base64, content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg" },
      };
      const signature = JSON.stringify(body);
      if (attemptedPayload.current && attemptedPayload.current !== signature) clientKey.current = makeKey();
      attemptedPayload.current = signature;
      const result = await plantApi("/species-requests", { method: "POST", expectedAccountId: accountId, body: { ...body, client_key: clientKey.current } });
      if (!result?.species_request?.request_id) throw Error(t("addPlantWorkflow.invalidRequestResponse"));
      await autosave.stop();
      if (restoredDraftRef.current) {
        try { await deleteBotanistFormDraft(accountId, draftKey.current, restoredDraftRef.current.saved_at); restoredDraftRef.current = null; }
        catch { /* Submission success remains true; an undeleted draft remains recoverable in My Drafts. */ }
      }
      setSubmitted(true);
      Alert.alert(t("speciesRequestForm.submittedTitle"), t("speciesRequestForm.submittedMessage"), [
        { text: t("common.ok"), onPress: () => navigation.navigate("BotanistSubmissions", {
          botanist: route.params?.botanist,
          openTarget: { kind: "species", recordId: String(result.species_request.request_id) },
        }) },
      ]);
    } catch (requestError) {
      const message = translateUIMessage(requestError.message);
      const translated = requestError.status === 409
        ? t("speciesRequestForm.duplicateRequest")
        : message || t("speciesRequestForm.submitFailed");
      setError(translated);
    } finally { busy.current = false; setSaving(false); }
  }

  const textFields = [
        ["scientific_name", "scientificName", "eGNepenthesMirabilis"], ["common_name", "commonName", "eGSwampPitcherPlant"],
    ["genus_name", "genus", "eGNepenthes"], ["family_name", "family", "eGNepenthaceae"],
  ];
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{t("speciesRequestForm.title")}</Text>
    <Text style={styles.note}>{t("speciesRequestForm.description")}</Text>
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{t("addPlant.newSpeciesInformation")}</Text>
      {textFields.map(([field, label, placeholder]) => <View key={field} style={styles.field}>
        <Text style={styles.label}>{requiredLabel(t(`addPlant.${label}`))}</Text>
        <TextInput style={styles.input} value={form[field]} onChangeText={(value) => change(field, value)} editable={!saving}
          maxLength={200} placeholder={t(`addPlant.${placeholder}`)} placeholderTextColor="#89978D" />
      </View>)}
      <Text style={styles.label}>{t("addPlant.conservationStatus")} *</Text>
      <View style={styles.statusList}>{conservationStatuses.map((status) => <TouchableOpacity key={status}
        style={[styles.statusOption, form.conservation_status === status && styles.statusSelected]}
        onPress={() => change("conservation_status", status)} disabled={saving} accessibilityRole="radio"
        accessibilityState={{ selected: form.conservation_status === status }}>
        <Text style={[styles.statusText, form.conservation_status === status && styles.statusTextSelected]}>{translateLabel(status)}</Text>
      </TouchableOpacity>)}</View>
      {[["description", "description", "describeTheSpeciesAndItsIdentifyingFeatures"], ["habitat", "habitatEcologicalInformation", "describeItsNaturalHabitatGrowingConditionsAndEcologicalRole"]].map(([field, label, placeholder]) => <View key={field} style={styles.field}>
        <Text style={styles.label}>{requiredLabel(t(`addPlant.${label}`))}</Text>
        <TextInput style={[styles.input, styles.multiline]} value={form[field]} onChangeText={(value) => change(field, value)} editable={!saving}
          multiline maxLength={4000} textAlignVertical="top" placeholder={t(`addPlant.${placeholder}`)} placeholderTextColor="#89978D" />
      </View>)}
    </View>
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{requiredLabel(t("addPlant.speciesPhotos"))}</Text>
      <Text style={styles.note}>{t("speciesRequestForm.photoRequirements")}</Text>
      <View style={styles.photoActions}>
        <TouchableOpacity style={styles.secondary} onPress={() => choosePhoto(true)} disabled={saving} accessibilityRole="button"><Ionicons name="camera-outline" size={18} color="#2F6B4F" /><Text style={styles.secondaryText}>{t("addPlant.camera")}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => choosePhoto(false)} disabled={saving} accessibilityRole="button"><Ionicons name="images-outline" size={18} color="#2F6B4F" /><Text style={styles.secondaryText}>{t("addPlant.gallery")}</Text></TouchableOpacity>
      </View>
      {photo && <View style={styles.photoPreview}>
        <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
        <TouchableOpacity style={styles.removePhoto} onPress={() => setPhoto(null)} disabled={saving} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}><Ionicons name="close" size={19} color="#FFFFFF" /></TouchableOpacity>
      </View>}
      <View style={styles.approvalInfo}><Text style={styles.approvalTitle}>{t("addPlant.speciesApprovalRequired")}</Text><Text style={styles.note}>{t("speciesRequestForm.approvalNotice")}</Text></View>
    </View>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {autoSaveState === "error" ? <TouchableOpacity onPress={() => { setError(""); void autosave.retry().catch(() => {}); }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button"><Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity> : null}
    <View style={styles.actions}>
      {autoSaveState === "saving" ? <Text style={styles.note}>{t("botanistDrafts.autoSaving")}</Text> : null}
      {autoSaveState === "saved" ? <Text style={styles.note}>{t("botanistDrafts.autoSaved")}</Text> : null}
      <TouchableOpacity style={styles.primary} onPress={submit} disabled={saving || submitted} accessibilityRole="button" accessibilityState={{ disabled: saving || submitted }}>
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{t("addPlantWorkflow.submitSpeciesRequest")}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancel} onPress={() => navigation.goBack()} disabled={saving} accessibilityRole="button"><Text style={styles.cancelText}>{t("common.cancel")}</Text></TouchableOpacity>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FAFBF7" }, content: { width: "100%", maxWidth: 760, alignSelf: "center", padding: 18, paddingBottom: 40, gap: 14 },
  title: { color: "#234B3A", fontSize: 25, fontWeight: "800" }, note: { color: "#52665A", lineHeight: 21 },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E2EDE0", borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  sectionTitle: { color: "#234B3A", fontSize: 18, fontWeight: "700" }, field: { gap: 5 }, label: { color: "#52665A", fontWeight: "600", fontSize: 13 },
  input: { minHeight: 46, borderColor: "#CDE3DC", borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, color: "#234B3A", backgroundColor: "#FFFFFF" },
  multiline: { minHeight: 105, textAlignVertical: "top" }, statusList: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, statusOption: { minHeight: 40, justifyContent: "center", borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 10, paddingHorizontal: 11, backgroundColor: "#FAFBF7" },
  statusSelected: { backgroundColor: "#D6E9D9", borderColor: "#2F6B4F" }, statusText: { color: "#52665A" }, statusTextSelected: { color: "#2F6B4F", fontWeight: "700" },
  photoActions: { flexDirection: "row", gap: 9 }, secondary: { minHeight: 46, flexGrow: 1, flexBasis: 130, borderWidth: 1, borderColor: "#AFCBB7", borderRadius: 11, backgroundColor: "#E8EDDA", flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }, secondaryText: { color: "#2F6B4F", fontWeight: "700" },
  photoPreview: { width: 120, height: 120, borderRadius: 13, overflow: "visible", position: "relative" }, photo: { width: "100%", height: "100%", borderRadius: 13 }, removePhoto: { position: "absolute", top: -7, right: -7, width: 34, height: 34, borderRadius: 17, backgroundColor: "#A34436", alignItems: "center", justifyContent: "center" },
  approvalInfo: { backgroundColor: "#F5F8F1", borderRadius: 11, padding: 12, gap: 5 }, approvalTitle: { color: "#2F6B4F", fontWeight: "700" }, error: { color: "#A34436", lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 9 }, primary: { flexGrow: 1, flexBasis: 220, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#2F6B4F" }, primaryText: { color: "#FFFFFF", fontWeight: "700" }, cancel: { flexGrow: 1, flexBasis: 130, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#AFCBB7", borderRadius: 12, backgroundColor: "#E8EDDA" }, cancelText: { color: "#2F6B4F", fontWeight: "700" },
});
