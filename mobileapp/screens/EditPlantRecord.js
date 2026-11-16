import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { fetchBotanistPlant, fetchBotanistRecordChangeStatus, fetchBotanistRecordChange } from "../utils/botanistRecords";
import { fetchSpeciesCatalog, plantApi, plantAssetSources, recordChangePhotoSource } from "../utils/plantApi";
import { normalizeQRCodes } from "../utils/qrInventory";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import OriginalUpdatedField from "../components/OriginalUpdatedField";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";
import { saveBotanistFormDraft, getBotanistFormDraft, findBotanistFormDraft, deleteBotanistFormDraft } from "../utils/botanistFormDrafts";
import { useBotanistDraftAutosave } from "../utils/botanistDraftAutosave";
import { fieldFormStyles } from "../components/fieldFormStyles";

const fields = ["scientific_name", "heightCm", "healthStatus", "lifeStage", "morphology", "notes", "zone", "latitude", "longitude", "accuracy_m", "altitudeM"];
const requiredFields = new Set(["scientific_name", "heightCm", "healthStatus", "lifeStage", "morphology", "latitude", "longitude"]);
const numeric = new Set(["heightCm", "latitude", "longitude", "accuracy_m", "altitudeM"]);
const str = (value) => value == null ? "" : String(value);
const key = () => `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const baseSnapshot = (plant) => {
  const observation = plant.status === "Approved" ? plant.observations?.find((row) => row.status === "Approved") : plant.latestObservation;
  return { status: plant.status, revision: observation?.revision ?? null, scientific_name: plant.scientificName,
    species_id: plant.speciesId, qr_id: plant.qrId, content: observation?.content || plant.latest_submission || plant.latest_approved || {},
    photo_ids: (observation?.assets || []).map((asset) => asset.id) };
};
const plantSignature = (plant) => JSON.stringify(baseSnapshot(plant));

export default function EditPlantRecord({ route, navigation }) {
  useAppTranslation();
  const plantId = String(route.params?.plantId || ""), accountId = route.params?.botanist?.id;
  const [state, setState] = useState({ loading: true, error: "", plant: null, species: [], available: false, correctionChange: null, correctionPhotos: [] });
  const [form, setForm] = useState(null), [selectedOriginalPhotos, setSelectedOriginalPhotos] = useState([]), [photoSelectionTouched, setPhotoSelectionTouched] = useState(false), [newPhotos, setNewPhotos] = useState([]), [unavailableOriginalPhotos, setUnavailableOriginalPhotos] = useState([]);
  const [loadingOriginalPhotos, setLoadingOriginalPhotos] = useState([]);
  const [qrList, setQrList] = useState([]), [qrError, setQrError] = useState(""), [qrLoading, setQrLoading] = useState(false);
  const [saving, setSaving] = useState(false), [locating, setLocating] = useState(false), [draftSaving, setDraftSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draftMessage, setDraftMessage] = useState(""), [draftError, setDraftError] = useState(""), [draftConflict, setDraftConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [editAvailability, setEditAvailability] = useState("checking");
  const [speciesAction, setSpeciesAction] = useState("existing");
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [originalPhotoRetry, setOriginalPhotoRetry] = useState(0);
  const [speciesRequestId, setSpeciesRequestId] = useState(null), [speciesRequestStatus, setSpeciesRequestStatus] = useState("none"), [speciesRequestApprovedId, setSpeciesRequestApprovedId] = useState(null);
  const [recoveryResolved, setRecoveryResolved] = useState(Boolean(route.params?.formDraftKey)), [autoSaveState, setAutoSaveState] = useState("");
  const busy = useRef(false), clientKey = useRef(key()), formDraftKey = useRef(route.params?.formDraftKey || `edit-plant-${accountId}-${plantId}`), restoredDraftRef = useRef(null), recoveryPromptedRef = useRef(false), initialFormRef = useRef(null);
  const activeFormDraftKey = route.params?.formDraftKey || formDraftKey.current;
  const originalObservation = state.plant?.status === "Approved"
    ? state.plant.observations?.find((observation) => observation.status === "Approved")
    : state.plant?.latestObservation;
  const originalPhotoIds = state.correctionChange?.base_snapshot?.photo_ids || (originalObservation?.assets || []).map((asset) => asset.id);
  const originalPhotoAssets = originalPhotoIds.map((id) => ({ id }));
  const originalContent = originalObservation?.content || state.plant?.latest_submission || state.plant?.latest_approved || {};
  const originalFallbacks = {
    latitude: state.plant?.location?.latitude,
    longitude: state.plant?.location?.longitude,
    accuracy_m: state.plant?.location?.accuracyM,
    altitudeM: state.plant?.location?.altitudeM,
  };
  const originalFieldValue = (field) => field === "scientific_name"
    ? state.plant?.scientificName
    : originalContent[field] ?? originalFallbacks[field];
  const originalSpecies = state.plant?.speciesDetails?.scientificName || state.plant?.scientificName ||
    state.species.find((item) => String(item.id) === String(state.plant?.speciesId))?.scientificName;
  const restoreDraft = (draft) => {
    restoredDraftRef.current = draft;
    setSpeciesRequestId(draft.species_request_id || null);
    clientKey.current = draft.submission_client_key || clientKey.current;
    setForm(draft.form);
    setSelectedOriginalPhotos(draft.form.selectedOriginalPhotos || []);
    setPhotoSelectionTouched(Boolean(draft.form.photoSelectionTouched));
    setNewPhotos((draft.photo_refs || []).filter((photo) => photo.slot?.startsWith("new:")).sort((a, b) => a.slot.localeCompare(b.slot)).map((photo) => photo.uri));
  };
  const refreshQr = useCallback(async () => {
    setQrLoading(true); setQrError("");
    try { const result = await plantApi("/qr-codes", { expectedAccountId: accountId }); setQrList(normalizeQRCodes(result)); }
    catch (error) { setQrError(error.message || t("recordEdits.qrLoadFailed")); }
    finally { setQrLoading(false); }
  }, [accountId]);
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const plant = await fetchBotanistPlant(accountId, plantId);
        if (route.params?.pendingRevision != null &&
            (plant.status !== route.params.pendingStatus ||
              !["Pending Review", "Correction Required"].includes(plant.status) ||
              String(plant.latestObservation?.id) !== String(route.params.pendingObservationId) ||
              Number(plant.latestObservation?.revision) !== Number(route.params.pendingRevision)))
          throw Error(t("botanistDrafts.editConflict"));
        const [species, capabilities] = await Promise.all([fetchSpeciesCatalog({ accountId }), plantApi("/record-changes/capabilities", { expectedAccountId: accountId })]);
        if (!active) return;
        const content = (plant.status === "Approved"
          ? plant.observations?.find((observation) => observation.status === "Approved")?.content
          : plant.latestObservation?.content) || plant.latest_submission || plant.latest_approved || {};
        const correctionChange = route.params?.correctionChangeId ? await fetchBotanistRecordChange(accountId, route.params.correctionChangeId, { kind: "plant", targetId: plantId }) : null;
        const correctionWorkflow = Boolean(correctionChange || route.params?.correction);
        const proposal = correctionChange?.proposed_snapshot || {};
        const baselineObservation = plant.status === "Approved"
          ? plant.observations?.find((observation) => observation.status === "Approved") : plant.latestObservation;
        const baselinePhotoIds = correctionChange?.base_snapshot?.photo_ids || (baselineObservation?.assets || []).map((asset) => asset.id);
        let originalPhotoSources = {}, originalPhotoError = "";
        try {
          const sources = await plantAssetSources(baselinePhotoIds.map((id) => ({ id })), accountId, { ownSubmission: true });
          originalPhotoSources = Object.fromEntries(baselinePhotoIds.map((id, index) => [String(id), sources[index]]));
        } catch (photoError) { originalPhotoError = photoError.message || t("recordEdits.originalPhotoUnavailable"); }
        const basePhotoSources = new Map(Object.entries(originalPhotoSources));
        const correctionPhotos = correctionChange ? [
          ...(proposal.photo_ids || []).map((id) => basePhotoSources.get(String(id))).filter(Boolean),
          ...await Promise.all(Array.from({ length: Number(correctionChange.proposal_photo_count) || 0 }, (_, index) => recordChangePhotoSource(correctionChange.id, index, accountId))),
        ] : [];
        const initialForm = { scientific_name: str(proposal.scientific_name ?? (Object.hasOwn(plant, "plantScientificNameValue") ? plant.plantScientificNameValue : plant.scientificName)), species_id: str(proposal.species_id ?? plant.speciesId), qr_id: str(proposal.qr_id ?? plant.qrId),
          ...Object.fromEntries(fields.slice(1).map((field) => [field, str(proposal.content?.[field] ?? content[field] ??
            ({ latitude: plant.location?.latitude, longitude: plant.location?.longitude,
              accuracy_m: plant.location?.accuracyM, altitudeM: plant.location?.altitudeM })[field])])) };
        const sameDraft = Boolean(route.params?.formDraftKey && restoredDraftRef.current?.client_key === route.params.formDraftKey);
        initialFormRef.current = initialForm;
        if (!sameDraft) {
          setForm(initialForm);
          setSelectedOriginalPhotos([]); setPhotoSelectionTouched(false); setNewPhotos([]); setUnavailableOriginalPhotos([]);
        }
        const ownPendingSpecies = plant.speciesDetails && !species.some((item) => String(item.id) === String(plant.speciesId))
          ? [{ ...plant.speciesDetails, id: String(plant.speciesId) }] : [];
        let restored = null;
        if (route.params?.formDraftKey) {
          restored = await getBotanistFormDraft(accountId, route.params.formDraftKey, "edit-plant", plantId);
          const belongsToCorrection = !correctionWorkflow || (correctionChange
            ? String(restored.correction_change_id || "") === String(correctionChange.id)
            : !restored.correction_change_id && restored.baseline?.plant?.latestObservation?.status === "Correction Required" &&
              String(restored.baseline?.plant?.latestObservation?.id || "") === String(plant.latestObservation?.id || ""));
          if (belongsToCorrection) {
            if (!sameDraft) restoreDraft(restored);
            setDraftConflict(restored.base_signature !== plantSignature(plant));
          } else {
            restored = null;
            formDraftKey.current = key();
            navigation.setParams({ formDraftKey: undefined });
            setDraftError(t("botanistDrafts.restoreFailed"));
            setDraftConflict(false);
          }
        } else {
          setDraftConflict(false);
          if (correctionWorkflow) {
            recoveryPromptedRef.current = true;
            let candidate = null;
            try {
              candidate = await findBotanistFormDraft(accountId, "edit-plant", plantId, (draft) => correctionChange
                ? String(draft.correction_change_id || "") === String(correctionChange.id)
                : !draft.correction_change_id && draft.baseline?.plant?.latestObservation?.status === "Correction Required" &&
                  String(draft.baseline?.plant?.latestObservation?.id || "") === String(plant.latestObservation?.id || ""));
            } catch (draftError) {
              if (active) setDraftError(translateUIMessage(draftError.message) || t("botanistDrafts.restoreFailed"));
            }
            if (active && candidate) {
              try {
                const saved = await getBotanistFormDraft(accountId, candidate.client_key, "edit-plant", plantId);
                if (correctionChange
                  ? String(saved.correction_change_id || "") !== String(correctionChange.id)
                  : Boolean(saved.correction_change_id) || saved.baseline?.plant?.latestObservation?.status !== "Correction Required" ||
                    String(saved.baseline?.plant?.latestObservation?.id || "") !== String(plant.latestObservation?.id || ""))
                  throw Error("This draft does not belong to the selected correction request.");
                restoreDraft(saved);
                setDraftConflict(saved.base_signature !== plantSignature(plant));
              } catch (restoreError) {
                setDraftError(translateUIMessage(restoreError.message) || t("botanistDrafts.restoreFailed"));
              }
            }
            setRecoveryResolved(true);
          } else if (!recoveryPromptedRef.current) {
            recoveryPromptedRef.current = true;
            let candidate = null;
            try { candidate = await findBotanistFormDraft(accountId, "edit-plant", plantId); }
            catch (draftError) { if (active) setDraftError(translateUIMessage(draftError.message) || t("botanistDrafts.restoreFailed")); }
            if (active && candidate) Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
              { text: t("botanistDrafts.continueDraft"), onPress: async () => {
                try { const saved = await getBotanistFormDraft(accountId, candidate.client_key, "edit-plant", plantId); restoreDraft(saved); setDraftConflict(saved.base_signature !== plantSignature(plant)); }
                catch (restoreError) { setDraftError(translateUIMessage(restoreError.message) || t("botanistDrafts.restoreFailed")); }
                setRecoveryResolved(true);
              } },
              { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: () => {
                formDraftKey.current = key(); setForm(initialForm); setSelectedOriginalPhotos([]); setPhotoSelectionTouched(false); setNewPhotos([]); setRecoveryResolved(true);
              } },
            ]);
            else setRecoveryResolved(true);
          }
        }
        setState({ loading: false, error: "", plant, species: [...ownPendingSpecies, ...species], catalogSpecies: species, available: capabilities.approved_edits_available, offlineDraft: false, correctionChange, correctionPhotos, originalPhotoSources, originalPhotoError });
        const trackedRequestId = route.params?.speciesRequestId || restored?.species_request_id || restoredDraftRef.current?.species_request_id;
        setSpeciesRequestId(trackedRequestId ? String(trackedRequestId) : null);
        if (route.params?.speciesRequestId && restored && String(restored.species_request_id || "") !== String(route.params.speciesRequestId)) {
          try {
            restoredDraftRef.current = await saveBotanistFormDraft(accountId, { ...restored, species_request_id: String(route.params.speciesRequestId),
              photos: (restored.photo_refs || []).map(({ slot, content_type, uri }) => ({ slot, content_type, uri })) });
          } catch { if (active) setDraftError(t("botanistDrafts.saveFailed")); }
        }
        if (trackedRequestId) {
          setSpeciesRequestStatus("checking");
          try {
            const payload = await plantApi(`/species-requests/${encodeURIComponent(trackedRequestId)}`, { expectedAccountId: accountId });
            if (active) {
              setSpeciesRequestStatus(payload?.species_request?.request_status || "unavailable");
              setSpeciesRequestApprovedId(payload?.species_request?.approved_species_id || null);
            }
          } catch { if (active) { setSpeciesRequestStatus("unavailable"); setSpeciesRequestApprovedId(null); } }
        } else { setSpeciesRequestStatus("none"); setSpeciesRequestApprovedId(null); }
        if (plant.status === "Approved") {
          setEditAvailability("checking");
          fetchBotanistRecordChangeStatus(accountId, "plant", plantId).then((result) => {
            if (active) setEditAvailability(!result.available ? "unavailable" : result.pending ? "pending" : "clear");
          }).catch(() => { if (active) setEditAvailability("unavailable"); });
        } else setEditAvailability("not-required");
        void refreshQr();
      } catch (error) {
        if (!active) return;
        if (route.params?.formDraftKey) {
          try {
            const draft = await getBotanistFormDraft(accountId, route.params.formDraftKey, "edit-plant", plantId);
            const baseline = draft.baseline;
            if (!baseline?.plant) throw error;
            if (restoredDraftRef.current?.client_key !== route.params.formDraftKey) restoreDraft(draft);
            setDraftConflict(false);
            setState({ loading: false, error: "", plant: baseline.plant, species: baseline.species || [], available: false, offlineDraft: true });
            setDraftError(t("botanistDrafts.offlineReadOnlyNotice"));
            return;
          } catch (restoreError) { setState((old) => ({ ...old, loading: false, error: restoreError.message || error.message })); return; }
        }
        setState((old) => ({ ...old, loading: false, error: error.message }));
      }
    })();
    return () => { active = false; };
  // `reload` intentionally changes the focus callback when the user presses Retry.
  }, [accountId, plantId, reload, route.params?.formDraftKey, route.params?.speciesRequestId, route.params?.correctionChangeId, refreshQr])); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (field, value) => setForm((old) => ({ ...old, [field]: value }));
  async function retryOriginalPhotos() {
    setUnavailableOriginalPhotos([]);
    setLoadingOriginalPhotos([]);
    setState((old) => ({ ...old, originalPhotoLoading: true, originalPhotoError: "" }));
    try {
      const sources = await plantAssetSources(originalPhotoAssets, accountId, { ownSubmission: true });
      setState((old) => ({ ...old, originalPhotoLoading: false, originalPhotoSources: Object.fromEntries(originalPhotoIds.map((id, index) => [String(id), sources[index]])) }));
      setOriginalPhotoRetry((count) => count + 1);
    } catch (error) { setState((old) => ({ ...old, originalPhotoLoading: false, originalPhotoError: error.message || t("recordEdits.originalPhotoUnavailable") })); }
  }
  async function detectLocation() {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return Alert.alert(t("addPlant.permissionRequired"), t("addPlant.locationPermissionIsRequiredToGetThePlantLocation"));
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm((old) => ({ ...old, latitude: location.coords.latitude.toFixed(6), longitude: location.coords.longitude.toFixed(6),
        altitudeM: location.coords.altitude == null ? old.altitudeM : location.coords.altitude.toFixed(2),
        accuracy_m: location.coords.accuracy == null ? old.accuracy_m : location.coords.accuracy.toFixed(2) }));
    } catch { Alert.alert(t("addPlant.locationError"), t("addPlant.unableToGetYourCurrentLocation")); }
    finally { setLocating(false); }
  }
  function addPicked(assets) {
    const retainedCount = photoSelectionTouched ? selectedOriginalPhotos.length : originalPhotoIds.length;
    const existingCount = retainedCount + newPhotos.length;
    if (existingCount + assets.length > 8) return Alert.alert(t("common.error"), t("recordEdits.maxPhotos"));
    setNewPhotos((current) => [...current, ...assets.map((asset) => asset.uri)]);
  }
  function reusePhoto(id) {
    if (selectedOriginalPhotos.includes(id)) return;
    setSelectedOriginalPhotos((current) => {
      if (current.includes(id)) return current;
      if (current.length + newPhotos.length >= 8) {
        Alert.alert(t("common.error"), t("recordEdits.maxPhotos"));
        return current;
      }
      return [...current, id];
    });
    setPhotoSelectionTouched(true);
  }
  async function pickPhotos(camera) {
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert(t("addPlant.permissionRequired"), camera ? t("addPlant.cameraPermissionIsRequired") : t("addPlant.galleryPermissionIsRequired"));
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8, quality: 0.8 });
      if (!result.canceled) addPicked(result.assets);
    } catch { Alert.alert(t("common.error"), camera ? t("addPlant.unableToOpenTheCamera") : t("addPlant.unableToOpenTheGallery")); }
  }
  function validate() {
    if (!form?.species_id || !state.species.some((item) => String(item.id) === form.species_id)) return t("recordEdits.selectSpecies");
    if (!form.scientific_name.trim() || form.scientific_name.length > 200) return t("recordEdits.plantNameRequired");
    if (!Number.isFinite(Number(form.heightCm)) || Number(form.heightCm) <= 0 || !form.healthStatus.trim() || !form.lifeStage.trim() || !form.morphology.trim()) return t("recordEdits.plantFieldsRequired");
    if (!form.latitude.trim() || !form.longitude.trim() || !Number.isFinite(Number(form.latitude)) || Math.abs(Number(form.latitude)) > 90 ||
      !Number.isFinite(Number(form.longitude)) || Math.abs(Number(form.longitude)) > 180) return t("recordEdits.locationRequired");
    if ((form.altitudeM.trim() && !Number.isFinite(Number(form.altitudeM))) ||
      (form.accuracy_m.trim() && (!Number.isFinite(Number(form.accuracy_m)) || Number(form.accuracy_m) < 0))) return t("recordEdits.locationRequired");
    const originalCount = (state.plant?.latestObservation?.assets || []).length;
    const count = (photoSelectionTouched ? selectedOriginalPhotos.length : originalCount) + newPhotos.length;
    if ((photoSelectionTouched || newPhotos.length) && (count < 3 || count > 8)) return t("recordEdits.threePhotos");
    if (form.qr_id !== str(state.plant.qrId) && !qrList.some((qr) => qr.id === form.qr_id && qr.status === "generated" && qr.plantId == null))
      return t("recordEdits.qrUnavailable");
    return "";
  }
  async function saveLocalDraft({ showSuccessPrompt = true } = {}) {
    if (draftSaving || saving || submitted || !form || !state.plant) return false;
    setDraftSaving(true); setDraftError(""); setDraftMessage("");
    try {
      const draft = await saveBotanistFormDraft(accountId, makeDraftInput(false));
      restoredDraftRef.current = draft;
      if (showSuccessPrompt) await autosave.stop();
      if (showSuccessPrompt) Alert.alert(t("botanistDrafts.savedStatus"), t("botanistDrafts.saved"), [{
        text: t("common.ok"),
        onPress: () => navigation.navigate("BotanistMyDrafts", { botanist: route.params?.botanist, openDraftKey: draft.client_key }),
      }]);
      return true;
    } catch (error) { setDraftError(translateUIMessage(error.message) || t("botanistDrafts.saveFailed")); return false; }
    finally { setDraftSaving(false); }
  }
  const makeDraftInput = (autoSaved = false) => {
    const plant = state.plant;
    const baseline = { plant: { id: plant.id, plantId: plant.plantId, scientificName: plant.scientificName, commonName: plant.commonName,
      speciesId: plant.speciesId, speciesDetails: plant.speciesDetails, status: plant.status, qrId: plant.qrId, qrCode: plant.qrCode,
      location: plant.location, latest_submission: plant.latest_submission, latest_approved: plant.latest_approved,
      latestObservation: plant.latestObservation ? { ...plant.latestObservation, assets: (plant.latestObservation.assets || []).map(({ id }) => ({ id })) } : null,
      observations: (plant.observations || []).map((observation) => ({ ...observation, assets: (observation.assets || []).map(({ id }) => ({ id })) })),
    }, species: state.species.filter((item) => String(item.id) === String(form.species_id)).map(({ id, scientificName, commonName, name, genus, family }) => ({ id, scientificName, commonName, name, genus, family })) };
    return { client_key: activeFormDraftKey, form_type: "edit-plant", target_id: plantId, correction_change_id: state.correctionChange?.id || restoredDraftRef.current?.correction_change_id || null, title: plant.scientificName || `Plant ${plantId}`,
      auto_saved: autoSaved, base_signature: restoredDraftRef.current?.base_signature || plantSignature(plant),
      base_revision: plant.latestObservation?.revision ?? null, baseline, submission_client_key: clientKey.current,
      species_request_id: speciesRequestId || route.params?.speciesRequestId || restoredDraftRef.current?.species_request_id || null,
      form: { ...form, selectedOriginalPhotos, photoSelectionTouched },
      photos: newPhotos.map((uri, index) => ({ slot: `new:${String(index).padStart(2, "0")}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })) };
  };
  const autoSaveSignature = JSON.stringify({ form, selectedOriginalPhotos, photoSelectionTouched, newPhotos });
  const hasMeaningfulChanges = Boolean(form && initialFormRef.current && JSON.stringify(form) !== JSON.stringify(initialFormRef.current)) || newPhotos.length > 0 || photoSelectionTouched;
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(accountId && form && state.plant && recoveryResolved && !submitted && hasMeaningfulChanges),
    signature: autoSaveSignature, navigation, accountId, errorKey: accountId && route.key ? `${accountId}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { const saved = await saveBotanistFormDraft(accountId, makeDraftInput(true)); restoredDraftRef.current = saved; if (isMounted?.()) setAutoSaveState("saved"); return saved; },
    onError: (error) => { setAutoSaveState("error"); setDraftError(translateUIMessage(error.message) || t("botanistDrafts.autoSaveFailed")); } });
  async function openSpeciesRequest() {
    const saved = await saveLocalDraft({ showSuccessPrompt: false });
    if (!saved) return;
    navigation.setParams({ formDraftKey: activeFormDraftKey });
    navigation.navigate("AddSpeciesRequest", { botanist: route.params?.botanist, returnToPlantId: plantId, returnPlantDraftKey: activeFormDraftKey });
  }
  function submit() {
    if (state.plant.status === "Rejected" || (state.plant.status !== "Approved" && state.plant.latestObservation?.status === "Rejected")) return Alert.alert(t("common.error"), t("recordEdits.finalRejected"));
    if (busy.current || submitted) return;
    if (draftConflict || state.offlineDraft) return Alert.alert(t("common.error"), t("botanistDrafts.editConflict"));
    const error = validate();
    if (error) return Alert.alert(t("common.error"), error);
    if (state.plant.status === "Approved" && !state.available) return Alert.alert(t("common.error"), t("recordEdits.migrationRequired"));
    showSubmitConfirmation();
  }
  function showSubmitConfirmation() {
    Alert.alert(t("recordEdits.confirmTitle"), t("recordEdits.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" }, { text: t("recordEdits.submitChanges"), onPress: save },
    ]);
  }
  async function refreshEditAvailability() {
    if (state.plant.status !== "Approved") return "not-required";
    setEditAvailability("checking");
    try {
      const result = await fetchBotanistRecordChangeStatus(accountId, "plant", plantId);
      const availability = !result.available ? "unavailable" : result.pending ? "pending" : "clear";
      setEditAvailability(availability);
      return availability;
    } catch { setEditAvailability("unavailable"); return "unavailable"; }
  }
  function confirmLeave() {
    Alert.alert(t("botanistDrafts.leaveTitle"), t("botanistDrafts.leaveWarning"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("botanistDrafts.leaveForm"), style: "destructive", onPress: () => navigation.goBack() },
    ]);
  }
  async function save() {
    if (state.plant.status === "Rejected" || (state.plant.status !== "Approved" && state.plant.latestObservation?.status === "Rejected")) return Alert.alert(t("common.error"), t("recordEdits.finalRejected"));
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      if (state.plant.status === "Approved" && !state.correctionChange) {
        const availability = await refreshEditAvailability();
        if (availability !== "clear") {
          const error = new Error(availability === "pending" ? t("recordEdits.pendingEditExplanation") : t("recordEdits.editAvailabilityUnavailable"));
          error.code = availability === "pending" ? "EDIT_PENDING" : "EDIT_AVAILABILITY_UNKNOWN";
          throw error;
        }
      }
      if (restoredDraftRef.current) {
        const latest = await fetchBotanistPlant(accountId, plantId);
        if (plantSignature(latest) !== restoredDraftRef.current.base_signature) {
          setDraftConflict(true);
          throw Error(t("botanistDrafts.editConflict"));
        }
      }
      const content = { heightCm: Number(form.heightCm), healthStatus: form.healthStatus.trim(), lifeStage: form.lifeStage.trim(),
        morphology: form.morphology.trim(), notes: form.notes.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude),
        zone: form.zone.trim() || null, accuracy_m: form.accuracy_m.trim() ? Number(form.accuracy_m) : null,
        altitudeM: form.altitudeM.trim() ? Number(form.altitudeM) : null };
      const proposed = { species_id: Number(form.species_id), scientific_name: form.scientific_name.trim(), content };
      if (form.qr_id !== str(state.plant.qrId)) proposed.qr_id = Number(form.qr_id);
      if (photoSelectionTouched || newPhotos.length) {
        proposed.photo_ids = photoSelectionTouched
          ? selectedOriginalPhotos
          : originalPhotoIds;
        proposed.photos = [];
        for (const uri of newPhotos) proposed.photos.push({ content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg",
          base64: await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }) });
      }
      if (state.correctionChange) {
        await plantApi(`/record-changes/${encodeURIComponent(state.correctionChange.id)}`, { method: "PATCH", expectedAccountId: accountId,
          body: { revision: state.correctionChange.revision, proposed } });
      } else if (state.plant.status === "Approved") {
        const response = await plantApi("/record-changes", { method: "POST", expectedAccountId: accountId,
          body: { kind: "plant", target_id: Number(plantId), proposed, client_key: clientKey.current } });
        const receipt = response?.change;
        if (!receipt || typeof receipt.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(receipt.id) ||
          (receipt.status !== undefined && receipt.status !== "Pending Review"))
          throw Error("The server did not confirm a pending change proposal. Refresh your submissions before trying again.");
      } else await plantApi(`/my-plants/${encodeURIComponent(plantId)}`, { method: "PATCH", expectedAccountId: accountId,
        body: { ...proposed, expected_revision: state.plant.latestObservation?.revision } });
      await autosave.stop();
      if (restoredDraftRef.current) {
        try {
          const removed = await deleteBotanistFormDraft(accountId, activeFormDraftKey, restoredDraftRef.current.saved_at);
          if (!removed) setDraftError(t("botanistDrafts.newerDraftKept"));
          else restoredDraftRef.current = null;
        } catch { setDraftError(t("botanistDrafts.cleanupFailed")); }
      }
      setSubmitted(true);
      Alert.alert(t("recordEdits.savedTitle"), t("recordEdits.savedMessage"), [{ text: t("common.ok"), onPress: () => navigation.navigate("BotanistSubmissions", {
        botanist: route.params?.botanist, openTarget: { kind: "plant", recordId: plantId },
      }) }]);
    } catch (error) {
      if (error.code === "SUBMISSION_REJECTED") {
        setState(old => ({ ...old, plant: { ...old.plant, status: "Rejected" } }));
        Alert.alert(t("common.error"), t("recordEdits.finalRejected"));
        return;
      }
      if (error.status === 409 && /already pending review/i.test(error.message || "")) setEditAvailability("pending");
      Alert.alert(t("common.error"), error.code === "EDIT_PENDING" || (error.status === 409 && /already pending review/i.test(error.message || ""))
        ? t("recordEdits.pendingEditExplanation") : error.code === "EDIT_AVAILABILITY_UNKNOWN" ? t("recordEdits.editAvailabilityUnavailable") : translateUIMessage(error.message));
    }
    finally { busy.current = false; setSaving(false); }
  }
  if (state.loading) return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <DetailSkeletonContent label={t("plantDetail.loadingPlantRecord")} sections={4} />
  </ScrollView>;
  if (state.error || !form) return <View style={styles.center}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
    <TouchableOpacity style={styles.secondary} onPress={() => { setState((old) => ({ ...old, loading: true, error: "" })); setReload((old) => old + 1); }}>
      <Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>;
  if (state.plant.status === "Rejected" || (state.plant.status !== "Approved" && state.plant.latestObservation?.status === "Rejected")) return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{t("recordEdits.finalRejected")}</Text><TouchableOpacity style={styles.secondary} onPress={() => navigation.goBack()}><Text style={styles.secondaryText}>{t("common.cancel")}</Text></TouchableOpacity></View>;
  const currentQrId = str(state.plant.qrId);
  const qrOptions = qrList.filter((qr) => qr.id === currentQrId || (qr.status === "generated" && qr.plantId == null));
  if (currentQrId && !qrOptions.some((qr) => qr.id === currentQrId))
    qrOptions.unshift({ id: currentQrId, label: `QR-${currentQrId.padStart(4, "0")}` });
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{t(state.correctionChange || (route.params?.correction && state.plant.status !== "Approved") ? "recordEdits.correctPlantRegistration" : "recordEdits.editPlant")}</Text>
    {(state.correctionChange?.review_comment || (route.params?.correction && state.plant.status !== "Approved" && state.plant.latestObservation?.review_comment)) ? <View style={styles.feedbackPanel}>
      <View style={styles.feedbackHeading}><Ionicons name="chatbox-ellipses-outline" size={19} color="#8A5A13" /><Text style={styles.feedbackTitle}>{t("recordEdits.officerFeedback")}</Text></View>
      <Text style={styles.feedbackText}>{state.correctionChange?.review_comment || state.plant.latestObservation.review_comment}</Text>
    </View> : null}
    {state.plant.status === "Approved" && editAvailability === "pending" && <View style={styles.pendingEditNote}><Text style={styles.pendingEditLabel}>{t("recordEdits.pendingEdit")}</Text><Text style={styles.note}>{t("recordEdits.pendingEditExplanation")}</Text></View>}
    {state.plant.status === "Approved" && editAvailability === "checking" && <Text style={styles.note}>{t("recordEdits.checkingEditAvailability")}</Text>}
    {state.plant.status === "Approved" && editAvailability === "unavailable" && <Text style={styles.error}>{t("recordEdits.editAvailabilityUnavailable")}</Text>}
    {(state.offlineDraft || draftConflict) && <Text style={styles.error}>{t(state.offlineDraft ? "botanistDrafts.offlineReadOnlyNotice" : "botanistDrafts.editConflict")}</Text>}
    {autoSaveState === "saving" ? <Text style={styles.draftSuccess}>{t("botanistDrafts.autoSaving")}</Text> : null}{autoSaveState === "saved" ? <Text style={styles.draftSuccess}>{t("botanistDrafts.autoSaved")}</Text> : null}{draftMessage ? <Text style={styles.draftSuccess}>{draftMessage}</Text> : null}{draftError ? <Text style={styles.error}>{draftError}</Text> : null}
    {autoSaveState === "error" ? <TouchableOpacity onPress={() => { setDraftError(""); void autosave.retry().catch(() => {}); }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button"><Text style={styles.pendingEditLabel}>{t("common.tryAgain")}</Text></TouchableOpacity> : null}
    {speciesRequestStatus !== "none" && <View style={styles.speciesRequestInfo}>
      <Text style={styles.pendingEditLabel}>{speciesRequestStatus === "checking" ? t("recordEdits.checkingSpeciesRequest") : speciesRequestStatus === "unavailable" ? t("recordEdits.speciesRequestStatusUnavailable") : speciesRequestStatus === "Pending Review" ? t("recordEdits.speciesRequestPending") : speciesRequestStatus === "Approved" ? t(state.catalogSpecies?.some((item) => String(item.id) === String(speciesRequestApprovedId)) ? "recordEdits.speciesRequestApproved" : "recordEdits.speciesRequestUnavailable") : speciesRequestStatus === "Rejected" ? t("recordEdits.speciesRequestRejected") : t("recordEdits.speciesRequestStatusUnavailable")}</Text>
      <Text style={styles.note}>{speciesRequestStatus === "Pending Review" ? t("recordEdits.speciesRequestPendingMessage") : speciesRequestStatus === "Approved" ? t(state.catalogSpecies?.some((item) => String(item.id) === String(speciesRequestApprovedId)) ? "recordEdits.speciesRequestApprovedMessage" : "recordEdits.speciesRequestUnavailableMessage") : speciesRequestStatus === "Rejected" ? t("recordEdits.speciesRequestRejectedMessage") : speciesRequestStatus === "checking" ? t("recordEdits.checkingSpeciesRequestMessage") : t("recordEdits.speciesRequestStatusUnavailableMessage")}</Text>
    </View>}
    {state.plant.status === "Approved" && !state.available && <Text style={styles.error}>{t("recordEdits.migrationRequired")}</Text>}
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.plantInformation")}</Text>
      <View style={styles.speciesModeRow}>
        <TouchableOpacity style={[styles.speciesModeOption, speciesAction === "existing" && styles.speciesModeSelected]}
          onPress={() => setSpeciesAction("existing")} accessibilityRole="radio" accessibilityState={{ selected: speciesAction === "existing" }}>
          <Text style={[styles.speciesModeText, speciesAction === "existing" && styles.speciesModeTextSelected]}>{t("recordEdits.selectExistingSpecies")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.speciesModeOption, speciesAction === "request" && styles.speciesModeSelected]}
          onPress={() => setSpeciesAction("request")} accessibilityRole="radio" accessibilityState={{ selected: speciesAction === "request" }}>
          <Text style={[styles.speciesModeText, speciesAction === "request" && styles.speciesModeTextSelected]}>{t("recordEdits.requestNewSpecies")}</Text>
        </TouchableOpacity>
      </View>
      {speciesAction === "request" ? <View style={styles.speciesRequestInfo}>
        <Text style={styles.note}>{t("recordEdits.newSpeciesApprovalNotice")}</Text>
        <TouchableOpacity style={styles.requestSpeciesButton} onPress={openSpeciesRequest} disabled={draftSaving || saving || submitted || state.offlineDraft}
          accessibilityRole="button" accessibilityState={{ disabled: draftSaving || saving || submitted || state.offlineDraft }}>
          <Ionicons name="leaf-outline" size={18} color="#2F6B4F" />
          <Text style={styles.requestSpeciesText}>{draftSaving ? t("botanistDrafts.saving") : t("recordEdits.openSpeciesRequest")}</Text>
        </TouchableOpacity>
      </View> : <OriginalUpdatedField label={`${t("addPlantWorkflow.approvedSpecies")} *`} originalValue={originalSpecies}>
      <TextInput style={styles.input} value={speciesSearch} onChangeText={setSpeciesSearch}
        placeholder={t("addPlant.searchByScientificOrCommonName")} accessibilityLabel={t("addPlant.searchSpeciesInTheDatabase")} />
      <ScrollView style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
      {(state.catalogSpecies || []).filter((item) => !speciesSearch.trim() || `${item.scientificName} ${item.commonName}`.toLocaleLowerCase().includes(speciesSearch.trim().toLocaleLowerCase()) || form.species_id === String(item.id)).map((item) => <TouchableOpacity key={item.id} style={[styles.speciesOption, form.species_id === String(item.id) && styles.selected]} onPress={() => change("species_id", String(item.id))} accessibilityRole="radio" accessibilityState={{ selected: form.species_id === String(item.id) }}>
        <Text style={styles.optionText}>{item.scientificName} · {item.commonName}</Text></TouchableOpacity>)}
      </ScrollView>
      </OriginalUpdatedField>}
      <Text style={styles.note}>{t("recordEdits.associatedSpeciesName")}: {state.plant.speciesScientificName || state.plant.speciesDetails?.scientificName || t("recordEdits.informationNotAvailable")}</Text>
      {fields.map((field) => <OriginalUpdatedField key={field} label={`${t(field === "scientific_name" ? "recordEdits.plantScientificName" : `recordEdits.${field}`)}${requiredFields.has(field) ? " *" : ""}`} originalValue={originalFieldValue(field)}>
        <TextInput style={[styles.input, ["morphology", "notes"].includes(field) && styles.multiline]} value={form[field]} onChangeText={(next) => change(field, next)}
          multiline={["morphology", "notes"].includes(field)} keyboardType={numeric.has(field) ? "decimal-pad" : "default"} />
        {field === "altitudeM" && <TouchableOpacity style={fieldFormStyles.locationButton} onPress={detectLocation} disabled={locating} accessibilityRole="button" accessibilityLabel={t("addPlant.getCurrentLocation")} accessibilityState={{ disabled: locating, busy: locating }}>
          {locating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={fieldFormStyles.locationButtonText}>{t("addPlant.getCurrentLocation")}</Text>}
        </TouchableOpacity>}
      </OriginalUpdatedField>)}
    </View>
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.qrAssignment")}</Text>
      <Text style={styles.note}>{t("recordEdits.currentQr")}: {state.plant.qrCode || t("botanistPlantDetail.notAssigned")}</Text>
      {!!qrError && <Text style={styles.error}>{translateUIMessage(qrError)}</Text>}
      <TouchableOpacity style={styles.qrRefreshButton} onPress={refreshQr} disabled={qrLoading} accessibilityRole="button" accessibilityLabel={t("recordEdits.refreshQr")} accessibilityState={{ disabled: qrLoading, busy: qrLoading }}>
        {qrLoading ? <ActivityIndicator size="small" color="#28665E" /> : <Ionicons name="refresh-outline" size={18} color="#28665E" />}
        <Text style={styles.qrRefreshText}>{t("recordEdits.refreshQr")}</Text></TouchableOpacity>
      <OriginalUpdatedField label={t("recordEdits.qr_id")} originalValue={state.plant.qrCode || state.plant.qrId}>
      <ScrollView style={styles.optionList} nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
        {!qrOptions.some((qr) => qr.id !== currentQrId) && <Text style={styles.optionEmpty}>{t("recordEdits.noReplacementQr")}</Text>}
        {qrOptions.map((qr) => <TouchableOpacity key={qr.id} style={[styles.speciesOption, form.qr_id === qr.id && styles.selected]}
          onPress={() => change("qr_id", qr.id)} accessibilityRole="radio" accessibilityState={{ selected: form.qr_id === qr.id }}>
          <Text style={styles.optionText}>{qr.label} · {qr.id === currentQrId ? t("recordEdits.currentQr") : t("recordEdits.availableQr")}</Text>
        </TouchableOpacity>)}
      </ScrollView>
      </OriginalUpdatedField>
    </View>
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.plantPhotos")}</Text>
      {state.correctionPhotos.length > 0 && <View style={styles.updatedPhotoGrid}>{state.correctionPhotos.map((source, index) => <View key={`proposal-photo-${index}`} style={styles.originalPhotoChoice}><Image source={source} style={styles.photo} resizeMode="cover" /></View>)}</View>}
      <OriginalUpdatedField label={t("recordEdits.plantPhotos")}
        originalContent={originalPhotoAssets.length > 0
          ? <View>
            {state.originalPhotoLoading && <ActivityIndicator color="#2F6B4F" />}
            {!!state.originalPhotoError && <Text style={styles.error}>{translateUIMessage(state.originalPhotoError)}</Text>}
            <View style={styles.photoGrid}>{originalPhotoAssets.map((asset, index) => {
              const selected = selectedOriginalPhotos.includes(asset.id);
              const unavailable = unavailableOriginalPhotos.includes(asset.id);
              return <TouchableOpacity key={asset.id} style={styles.originalPhotoChoice} onPress={() => reusePhoto(asset.id)} accessibilityRole="checkbox"
                accessibilityLabel={`${t("recordEdits.originalPhoto")} ${index + 1}`} accessibilityState={{ checked: selected }}>
                <View style={[styles.photoThumbFrame, selected && styles.photoThumbFrameSelected]}>
                  {state.originalPhotoSources?.[String(asset.id)] && !unavailable ? <>
                    <Image key={`${asset.id}:${originalPhotoRetry}`} source={state.originalPhotoSources[String(asset.id)]} style={styles.photo} resizeMode="cover"
                      onLoadStart={() => setLoadingOriginalPhotos((current) => current.includes(asset.id) ? current : [...current, asset.id])}
                      onLoadEnd={() => setLoadingOriginalPhotos((current) => current.filter((id) => id !== asset.id))}
                      onError={() => setUnavailableOriginalPhotos((current) => current.includes(asset.id) ? current : [...current, asset.id])} />
                    {loadingOriginalPhotos.includes(asset.id) && <ActivityIndicator style={styles.photoLoading} color="#2F6B4F" />}
                  </> : <View style={styles.photoUnavailable}><Text style={styles.photoUnavailableText}>{t("recordEdits.originalPhotoUnavailable")}</Text></View>}
                  {selected && <View style={styles.photoSelectedOverlay}><Ionicons name="checkmark-circle" size={25} color="#FFFFFF" /></View>}
                </View>
                {unavailable && <Text style={styles.photoUnavailableText}>{t("recordEdits.originalPhotoUnavailable")}</Text>}
              </TouchableOpacity>;
            })}</View>
            {(state.originalPhotoError || unavailableOriginalPhotos.length > 0) && <TouchableOpacity style={styles.photoRetryButton} onPress={() => { void retryOriginalPhotos(); }} accessibilityRole="button"><Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity>}
          </View>
          : null}>
      <View style={styles.updatedPhotoGrid}>{originalPhotoAssets.map((asset) => !selectedOriginalPhotos.includes(asset.id) ? null :
        <View key={asset.id} style={styles.updatedPhotoTile}>{state.originalPhotoSources?.[String(asset.id)] && <Image source={state.originalPhotoSources[String(asset.id)]} style={styles.photo} resizeMode="cover" />}
          <TouchableOpacity style={styles.removePhoto} onPress={() => setSelectedOriginalPhotos((current) => current.filter((id) => id !== asset.id))} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}>
            <Ionicons name="trash-outline" size={21} color="#B42318" /></TouchableOpacity></View>)}
        {newPhotos.map((uri, index) => <View key={`${uri}-${index}`} style={styles.updatedPhotoTile}><Image source={{ uri }} style={styles.photo} resizeMode="cover" />
          <TouchableOpacity style={styles.removePhoto} onPress={() => setNewPhotos((current) => current.filter((_, item) => item !== index))} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}>
            <Ionicons name="trash-outline" size={21} color="#B42318" /></TouchableOpacity></View>)}</View>
      <View style={styles.photoActions}><TouchableOpacity style={styles.photoActionButton} onPress={() => pickPhotos(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t("recordEdits.takePhoto")}><Text style={styles.photoActionText}>{t("recordEdits.takePhoto")}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.photoActionButton} onPress={() => pickPhotos(false)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t("recordEdits.addGallery")}><Text style={styles.photoActionText}>{t("recordEdits.addGallery")}</Text></TouchableOpacity></View>
      </OriginalUpdatedField>
    </View>
    <View style={styles.formActionRow}>
      <TouchableOpacity style={[styles.secondary, (draftSaving || saving || submitted) && styles.disabled]} onPress={saveLocalDraft} disabled={draftSaving || saving || submitted} accessibilityRole="button" accessibilityState={{ disabled: draftSaving || saving || submitted }}><Text style={styles.secondaryText}>{draftSaving ? t("botanistDrafts.saving") : t("botanistDrafts.saveDraft")}</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.primary, (saving || submitted || state.offlineDraft || draftConflict) && styles.disabled]} onPress={submit} disabled={saving || submitted || state.offlineDraft || draftConflict} accessibilityRole="button" accessibilityState={{ disabled: saving || submitted || state.offlineDraft || draftConflict }}><Text style={styles.primaryText}>{saving ? t("recordEdits.saving") : t("recordEdits.submitChanges")}</Text></TouchableOpacity>
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
  heading: { color: "#234B3A", fontSize: 18, fontWeight: "700" }, label: { color: "#52665A", fontSize: 13, fontWeight: "600", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#FFFFFF", borderRadius: 11, padding: 12, color: "#234B3A", minHeight: 44 },
  multiline: { minHeight: 90, textAlignVertical: "top" }, speciesOption: { minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: "#EDF2EA", paddingHorizontal: 13, paddingVertical: 11 },
  optionList: { maxHeight: 220, borderWidth: 1, borderColor: "#DCE8D6", borderRadius: 10, backgroundColor: "#FFFFFF", overflow: "hidden" },
  optionEmpty: { color: "#52665A", fontSize: 13, lineHeight: 19, padding: 12 },
  feedbackPanel: { gap: 9, backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#E9CD91", borderRadius: 14, padding: 14, marginBottom: 4 },
  feedbackHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  feedbackTitle: { color: "#76500F", fontSize: 15, fontWeight: "700" },
  feedbackText: { color: "#4D4434", fontSize: 16, lineHeight: 23 },
  selected: { backgroundColor: "#E4F5EC", borderColor: "#468585" }, optionText: { color: "#234B3A" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, originalPhotoChoice: { width: 94, height: 94 }, photoThumbFrame: { width: 90, height: 90, borderRadius: 14, borderWidth: 2, borderColor: "#E2EDE0", overflow: "hidden", position: "relative" }, photoThumbFrameSelected: { borderColor: "#468585" }, photo: { width: "100%", height: "100%", borderRadius: 12 }, photoSelectedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "#234B3A35", alignItems: "flex-end", justifyContent: "flex-start", padding: 4 }, photoUnavailableText: { color: "#A34436", fontSize: 10, textAlign: "center" }, photoUnavailable: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#F2F4EF", padding: 5 },
  speciesModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, speciesModeOption: { flexGrow: 1, flexBasis: 150, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#FAFBF7" }, speciesModeSelected: { backgroundColor: "#D6E9D9", borderColor: "#2F6B4F" }, speciesModeText: { color: "#52665A", fontWeight: "600", textAlign: "center" }, speciesModeTextSelected: { color: "#2F6B4F", fontWeight: "700" }, speciesRequestInfo: { gap: 10, padding: 12, backgroundColor: "#F5F8F1", borderRadius: 12 }, requestSpeciesButton: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#AFCBB7", backgroundColor: "#E8EDDA", borderRadius: 11, paddingHorizontal: 14 }, requestSpeciesText: { color: "#2F6B4F", fontWeight: "700" },
  updatedPhotoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, updatedPhotoTile: { width: 90, height: 90, position: "relative", borderRadius: 12 },
  removePhoto: { position: "absolute", top: -4, right: -4, width: 44, height: 44, borderRadius: 11, backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4", alignItems: "center", justifyContent: "center" },
  photoActions: fieldFormStyles.photoButtonRow, photoActionButton: fieldFormStyles.photoButton, photoActionText: fieldFormStyles.photoButtonText,
  photoRetryButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  photoLoading: { position: "absolute", alignSelf: "center", top: 34 },
  qrRefreshButton: fieldFormStyles.qrRefreshButton,
  qrRefreshText: fieldFormStyles.qrRefreshText,
  formActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  primary: { flexGrow: 1, flexBasis: "45%", minWidth: 145, backgroundColor: "#2F6B4F", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#FFFFFF", fontWeight: "700", textAlign: "center" },
  secondary: { flexGrow: 1, flexBasis: "45%", minWidth: 145, borderWidth: 1, borderColor: "#AFCBB7", backgroundColor: "#E8EDDA", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, minHeight: 48, alignItems: "center", justifyContent: "center" }, secondaryText: { color: "#2F6B4F", fontWeight: "700", textAlign: "center" },
  draftSuccess: { color: "#2F6B4F", textAlign: "center", fontSize: 13 }, disabled: { opacity: 0.6 }, error: { color: "#A34436", lineHeight: 21 },
});
