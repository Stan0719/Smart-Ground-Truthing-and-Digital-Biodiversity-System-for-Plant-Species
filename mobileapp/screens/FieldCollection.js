import { t, translateLabel, translateUIMessage, useAppTranslation, translateFieldLabel } from "../translations/i18n";
import { canCollectDrafts } from "../utils/rbac";
import React, { useEffect, useState, useRef } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { plantApi, plantAssetSources } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { saveDraft, readDrafts } from "../utils/fieldStorage";
import { fetchPlantObservationEligibility, syncDrafts, validateObservationDraft, verifyApprovedPlantForObservation } from "../utils/fieldSync";
import { createFieldCapture } from "../utils/fieldCapture";
import { useBotanistDraftAutosave } from "../utils/botanistDraftAutosave";
import { fieldFormStyles } from "../components/fieldFormStyles";
import OriginalUpdatedField from "../components/OriginalUpdatedField";
import RefreshButton from "../components/RefreshButton";
const fieldCapture = createFieldCapture({
  imagePicker: ImagePicker,
  location: Location,
});
const newFieldDraftKey = () => `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blankForm = (plantId = "") => ({
  species_id: "", plant_id: String(plantId || ""), heightCm: "", healthStatus: "",
  lifeStage: "", morphology: "", taxonomy: "", notes: "", latitude: "", longitude: "", accuracy_m: "",
});
const observationFields = ["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes", "latitude", "longitude", "accuracy_m"];
const requiredObservationFields = new Set(["heightCm", "healthStatus", "lifeStage", "morphology"]);
export default function FieldCollection({ route, navigation, onLogout }) {
  useAppTranslation();
  const [user, setUser] = useState(null),
    [species, setSpecies] = useState([]),
    [rows, setRows] = useState([]),
    [plantStatuses, setPlantStatuses] = useState({}),
    [draftCount, setDraftCount] = useState(0);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [completed, setCompleted] = useState(false),
    [loading, setLoading] = useState(false),
    [photos, setPhotos] = useState([]),
    [qr, setQr] = useState(""),
    [plantRecord, setPlantRecord] = useState(null),
    [locating, setLocating] = useState(false);
  const [form, setForm] = useState(() => blankForm(route.params?.plantId));
  const [initialForm, setInitialForm] = useState(() => blankForm(route.params?.plantId));
  const [invalidField, setInvalidField] = useState("");
  const [plantEligibility, setPlantEligibility] = useState("checking");
  const capturing = useRef(false);
  const recoveryPromptedRef = useRef(false);
  const [recoveryResolved, setRecoveryResolved] = useState(Boolean(route.params?.draft || !["AddObservation", "FieldCollectionPlant", "FieldCollectionEdit"].includes(route.name)));
  const [autoSaveState, setAutoSaveState] = useState("");
  const draftKey = useRef(
    route.params?.draftKey || newFieldDraftKey(),
  );
  const mode = route.name,
    edit = mode === "EditPlant" || mode === "FieldCollectionEdit",
    newPlant = mode === "AddPlant" || mode === "FieldCollectionPlant",
    dashboard = mode === "BotanistDashboard" || mode === "AccountTab" ||
      (mode === "FieldCollection" && !route.params?.draft);
  const updateDraftCount = (saved) => setDraftCount(saved.filter((draft) => draft.kind !== "botanist-form").length);
  const observationDraft = route.params?.draft?.path?.match(/^\/plants\/\d+\/observations$/);
  const observationForm = mode === "AddObservation" || edit || Boolean(observationDraft);
  const isNewObservation = mode === "AddObservation" || Boolean(observationDraft);
  const eligibilityMessageKey = (status) => ({
    checking: "fieldCollection.checkingPlantApproval",
    pending: "fieldCollection.plantObservationPendingApproval",
    rejected: "fieldCollection.plantObservationRejected",
    correctionRequired: "fieldCollection.plantObservationCorrectionRequired",
    unavailable: "fieldCollection.plantObservationEligibilityUnavailable",
  }[status] || "fieldCollection.plantObservationEligibilityUnavailable");
  const draftObservationId = route.params?.draft?.method === "PATCH" ? route.params.draft.path.split("/").pop() : null;
  const originalObservation = route.params?.observation || rows.find((row) => String(row.id) === String(draftObservationId)) || null;
  const originalObservationContent = originalObservation?.content || {};
  const selectedPlantId = route.params?.observation?.plant_id || route.params?.draft?.plant_id ||
    route.params?.plantId || route.params?.draft?.path?.match(/^\/plants\/(\d+)\//)?.[1] || form.plant_id;
  const linkedSpecies = species.find((item) => String(item.species_id) === String(plantRecord?.species_id ?? originalObservation?.species_id));
  const speciesDetails = plantRecord?.species_details || {};
  const registeredLocation = plantRecord?.location || {};
  const notAvailable = t("recordEdits.informationNotAvailable");
  const displayPlantValue = (...values) => {
    const value = values.find((item) => item !== null && item !== undefined && String(item).trim() !== "");
    return value === undefined ? notAvailable : String(value);
  };
  const registeredPlantLocation = plantRecord?.gps_access_restricted === true || registeredLocation.restricted === true
    ? t("map.locationRestricted")
    : [
        [plantRecord?.latitude ?? registeredLocation.latitude, plantRecord?.longitude ?? registeredLocation.longitude]
          .every((value) => value !== null && value !== undefined && value !== "")
          ? `${plantRecord?.latitude ?? registeredLocation.latitude}, ${plantRecord?.longitude ?? registeredLocation.longitude}`
          : null,
        (plantRecord?.zone ?? registeredLocation.zone) ? `${t("recordEdits.zone")}: ${plantRecord?.zone ?? registeredLocation.zone}` : null,
        (plantRecord?.altitude_m ?? plantRecord?.altitudeM ?? registeredLocation.altitudeM) != null
          ? `${t("recordEdits.altitudeM")}: ${plantRecord?.altitude_m ?? plantRecord?.altitudeM ?? registeredLocation.altitudeM}` : null,
      ].filter(Boolean).join(" · ") || notAvailable;
  const originalAssets = originalObservation?.assets;
  const originalAssetKey = (originalAssets || []).map((asset) => asset.id).join(",");
  const originalPhotoStateKey = `${user?.id || ""}:${originalAssetKey}`;
  const [originalPhotoState, setOriginalPhotoState] = useState({ key: "", sources: [] });
  const originalPhotos = originalPhotoState.key === originalPhotoStateKey ? originalPhotoState.sources : [];
  const change = (key, value) => {
    setForm((old) => ({ ...old, [key]: value }));
    setInvalidField((old) => old === key ? "" : old);
    setError("");
  };
  /* eslint-disable react-hooks/set-state-in-effect -- load and route hydration initialize this screen. */
  useEffect(() => {
    let active = true;
    if (!edit || !user?.id || !originalAssets?.length) return () => { active = false; };
    plantAssetSources(originalAssets, user.id, { ownSubmission: true })
      .then((sources) => { if (active) setOriginalPhotoState({ key: originalPhotoStateKey, sources }); })
      .catch(() => { if (active) setOriginalPhotoState({ key: originalPhotoStateKey, sources: [] }); });
    return () => { active = false; };
  }, [edit, user?.id, originalObservation?.id, originalAssets, originalPhotoStateKey]);
  async function load() {
    setLoading(true);
    setError("");
    if (dashboard || mode === "PlantQRCode") setPlantStatuses({});
    if (isNewObservation) setPlantEligibility("checking");
    try {
      const verified = await faceSession.restore({ allowOffline: true });
      if (!canCollectDrafts(verified))
        throw Error("An active Botanist account is required.");
      setUser(verified);
      const saved = await readDrafts(verified.id);
      updateDraftCount(saved);
      if (!route.params?.draft && !recoveryPromptedRef.current && (observationForm || newPlant)) {
        recoveryPromptedRef.current = true;
        const plantId = String(route.params?.plantId || "");
        const observationId = String(route.params?.observation?.id || "");
        const candidate = saved.filter((draft) => draft.kind !== "botanist-form" && (
          edit ? draft.method === "PATCH" && String(draft.path || "").split("/").pop() === (observationId || plantId)
            : newPlant ? draft.path === "/plants"
              : draft.path === `/plants/${plantId}/observations`
        )).sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0))[0];
        if (candidate) Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
          { text: t("botanistDrafts.continueDraft"), onPress: () => navigation.setParams({ draft: candidate }) },
          { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: () => { draftKey.current = newFieldDraftKey(); setRecoveryResolved(true); } },
        ]);
        else setRecoveryResolved(true);
      } else if (!route.params?.draft && !route.params?.observation && !observationForm && !newPlant) setRecoveryResolved(true);
      if (verified.offline) {
        setSpecies([]);
        setRows([]);
        setPlantStatuses({});
        if (isNewObservation) setPlantEligibility("unavailable");
        setMessage(
          "Offline draft mode: local drafts only. Reconnect to synchronize; access expires after 15 minutes from the last online verification.",
        );
        return;
      }
      const [catalog, observations] = await Promise.all([
        plantApi("/species?scope=scientific"),
        plantApi("/observations"),
      ]);
      setSpecies(catalog.species);
      setRows(observations.observations);
      if (dashboard || mode === "PlantQRCode") {
        const plantIds = [...new Set((observations.observations || []).map((row) => String(row.plant_id)).filter((id) => /^\d+$/.test(id)))];
        const statuses = await Promise.all(plantIds.map(async (id) => [id, await fetchPlantObservationEligibility(verified.id, id)]));
        setPlantStatuses(Object.fromEntries(statuses));
      } else setPlantStatuses({});
      const draftPlantId = route.params?.draft?.plant_id || route.params?.draft?.path?.match(/^\/plants\/(\d+)\//)?.[1];
      const targetPlantId = route.params?.observation?.plant_id || route.params?.plantId || draftPlantId || form.plant_id;
      if (observationForm && targetPlantId) {
        setPlantRecord(null);
        try {
          const result = await plantApi(`/plants/${encodeURIComponent(targetPlantId)}`);
          const record = result.plant || null;
          setPlantRecord(record);
          if (isNewObservation) setPlantEligibility(await fetchPlantObservationEligibility(verified.id, targetPlantId));
        } catch {
          if (isNewObservation) setPlantEligibility("unavailable");
        }
      } else if (isNewObservation) setPlantEligibility("unavailable");
    } catch (e) {
      setUser(null);
      if (dashboard || mode === "PlantQRCode") setPlantStatuses({});
      if (isNewObservation) setPlantEligibility("unavailable");
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    if (route.params?.observation) {
      const observation = route.params.observation;
      draftKey.current = newFieldDraftKey();
      const values = Object.fromEntries(observationFields.map((field) => [
        field, observation.content?.[field] == null ? "" : String(observation.content[field]),
      ]));
      setForm({ ...blankForm(observation.plant_id), ...values });
      setInitialForm({ ...blankForm(observation.plant_id), ...values });
      setPhotos([]);
      setInvalidField("");
    }
    if (!route.params?.observation && !route.params?.draft) {
      draftKey.current = route.params?.draftKey || newFieldDraftKey();
      setForm(blankForm(route.params?.plantId));
      setInitialForm(blankForm(route.params?.plantId));
      setPhotos([]);
      setInvalidField("");
    }
    if (route.params?.draft) {
      const draft = route.params.draft;
      draftKey.current = draft.client_key;
      const values = Object.fromEntries(observationFields.map((field) => [
        field, draft.body?.content?.[field] == null ? "" : String(draft.body.content[field]),
      ]));
      setForm({
        ...blankForm(draft.plant_id || draft.path?.match(/^\/plants\/(\d+)\//)?.[1]),
        ...values,
        species_id: String(draft.body?.species_id ?? ""),
        plant_id: String(draft.plant_id || draft.path?.match(/^\/plants\/(\d+)\//)?.[1] || ""),
      });
      setInitialForm({ ...blankForm(draft.plant_id || draft.path?.match(/^\/plants\/(\d+)\//)?.[1]), ...values,
        species_id: String(draft.body?.species_id ?? ""), plant_id: String(draft.plant_id || draft.path?.match(/^\/plants\/(\d+)\//)?.[1] || "") });
      setPhotos(
        (draft.assets || []).map((a) => ({
          ...a,
          uri: `data:${a.content_type};base64,${a.base64}`,
        })),
      );
      setInvalidField("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the selected observation, draft, or plant changes.
  }, [route.params?.observation?.id, route.params?.draft?.client_key, route.params?.plantId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const owner = user.id;
    const timer = setInterval(async () => {
      try {
        const verified = await faceSession.restore({ allowOffline: true });
        if (!active) return;
        if (verified?.id !== owner) throw Error("Owner session changed.");
        setUser(verified);
      } catch {
        if (active) {
          setUser(null);
          setError(
            "Offline access expired or the session was rejected. Reconnect and sign in to recover saved drafts. Your current form remains in memory.",
          );
        }
      }
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  async function locate() {
    setLocating(true);
    try {
      const coordinates = await fieldCapture.coordinates();
      setForm((old) => ({ ...old, ...coordinates }));
      setInvalidField("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }
  async function capture(camera) {
    if (capturing.current) return;
    capturing.current = true;
    setError("");
    try {
      const asset = await fieldCapture.photo(camera, photos.length);
      if (asset)
        setPhotos((old) => [
          ...old,
          {
            ...asset,
            client_key: `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ]);
    } catch (e) {
      setError(e.message);
    } finally {
      capturing.current = false;
    }
  }
  function createDraft() {
    const data = Object.fromEntries(observationFields.map((field) => [field, String(form[field] ?? "")]));
    const assets = photos.map(({ uri, ...asset }) => asset);
    if (edit) {
      const recovered = route.params?.draft;
      const observation = recovered?.method === "PATCH"
        ? { id: recovered.path.split("/").pop(), plant_id: recovered.plant_id, revision: recovered.body.revision }
        : route.params?.observation;
      if (!observation?.id || !Number.isInteger(observation.revision))
        throw Error("Select an owned editable observation from the dashboard.");
      return {
        client_key: draftKey.current,
        method: "PATCH",
        path: `/observations/${observation.id}`,
        plant_id: observation.plant_id,
        body: { content: data, revision: observation.revision },
        assets,
      };
    }
    if (newPlant) {
      return {
        client_key: draftKey.current,
        path: "/plants",
        body: {
          species_id: String(form.species_id),
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy_m: data.accuracy_m,
          content: data,
          client_key: draftKey.current,
        },
        assets,
      };
    }
    const plantId = String(form.plant_id || selectedPlantId || "").trim();
    if (!/^\d+$/.test(plantId)) throw Error("Select a registered plant before saving this observation.");
    return {
      client_key: draftKey.current,
      path: `/plants/${plantId}/observations`,
      plant_id: plantId,
      body: { content: data, client_key: draftKey.current },
      assets,
    };
  }
  const autoSaveMeaningful = Boolean(form && initialForm && JSON.stringify(form) !== JSON.stringify(initialForm)) || photos.length > 0;
  const autoSaveSignature = JSON.stringify({ form, photos: photos.map(({ client_key, uri }) => ({ client_key, uri })) });
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(user?.id && (observationForm || newPlant)) && recoveryResolved && autoSaveMeaningful && !completed,
    signature: autoSaveSignature, navigation, accountId: user?.id, errorKey: user?.id && route.key ? `${user.id}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { const draft = createDraft(); await saveDraft(user.id, draft); if (isMounted?.()) { setAutoSaveState("saved"); const all = await readDrafts(user.id); if (isMounted()) updateDraftCount(all); } return draft; },
    onError: (saveError) => { setAutoSaveState("error"); setError(saveError.message || t("botanistDrafts.autoSaveFailed")); } });
  async function save(online) {
    if (!user || completed) return;
    let currentValidationFailed = false;
    setBusy(true);
    setError("");
    setMessage("");
    if (!online) setInvalidField("");
    try {
      const active = await faceSession.restore({ allowOffline: !online });
      if (active?.id !== user.id || !canCollectDrafts(active))
        throw Error("Sign in with the observation owner account.");
      if (online && isNewObservation) {
        const plantId = String(form.plant_id || selectedPlantId || "").trim();
        try {
          await verifyApprovedPlantForObservation(user.id, plantId);
          setPlantEligibility("approved");
        } catch (eligibilityError) {
          setPlantEligibility(eligibilityError.observationEligibility || "unavailable");
          throw eligibilityError;
        }
      }
      const draft = createDraft();
      if (online) {
        try { validateObservationDraft(draft); }
        catch (validationError) { currentValidationFailed = true; throw validationError; }
      }
      await saveDraft(user.id, draft);
      await autosave.flush();
      setMessage(edit ? "Correction draft saved on this device." : "Draft saved on this device.");
      let submittedItem = null;
      if (online) {
        const synced = await syncDrafts(user.id, { onSubmitted: (item) => {
          if (item.clientKey === draft.client_key) submittedItem = item;
        } });
        setMessage(t("fieldCollection.recordSSynchronizedForOfficerReview", { synced }));
        if (submittedItem) {
          await autosave.stop();
          setCompleted(true);
          draftKey.current = `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setPhotos([]);
        }
      }
      const saved = await readDrafts(user.id);
      updateDraftCount(saved);
      if (!online) {
        await autosave.stop();
        Alert.alert(t("botanistDrafts.savedStatus"), t("botanistDrafts.saved"), [{ text: t("common.ok"), onPress: () => navigation.navigate("BotanistMyDrafts", {
          botanist: user, openDraftKey: draft.client_key,
        }) }]);
      } else if (submittedItem?.id) {
        const message = submittedItem.type === "plant"
          ? t("addPlant.plantAndItsPhotosWereSavedTheQrCodeIs", { plantId: submittedItem.id })
          : edit ? t("fieldCollection.observationResubmittedForReview") : t("fieldCollection.observationSubmittedForReview");
        Alert.alert(t("fieldCollection.submissionSuccessful"), message, [{ text: t("common.ok"), onPress: () => submittedItem.type === "plant"
          ? navigation.navigate("BotanistSubmissions", { botanist: user, openTarget: { kind: "plant", recordId: submittedItem.id } })
          : navigation.navigate("MainTabs", { screen: "PlantsTab", params: { screen: "PlantDetails", params: { plantId: submittedItem.plantId, focusObservationId: submittedItem.id } } }) }]);
      }
    } catch (e) {
      setInvalidField(currentValidationFailed ? e.field || "" : "");
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function synchronize() {
    setBusy(true);
    try {
      const count = await syncDrafts(user.id);
      setMessage(`${count} draft(s) synchronized.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function showQr(row) {
    try {
      const result = await plantApi(`/plants/${row.plant_id}/qr`);
      setQr(result.qr_token);
      setMessage(`QR status: ${result.rbac_status}`);
    } catch (e) {
      setError(e.message);
    }
  }
  function fieldLabel(field, required = requiredObservationFields.has(field)) {
    const label = translateFieldLabel(field);
    if (required || (newPlant && ["latitude", "longitude"].includes(field)))
      return t("fieldCollection.requiredField", { field: label });
    if (["notes", "taxonomy", "accuracy_m", "latitude", "longitude"].includes(field))
      return t("fieldCollection.optionalField", { field: label });
    return label;
  }
  function renderObservationField(field) {
    const multiline = ["notes", "morphology", "taxonomy"].includes(field);
    const label = fieldLabel(field);
    const maxLength = { healthStatus: 100, lifeStage: 100, morphology: 4000, notes: 4000, taxonomy: 1000 }[field];
    const keyboardType = field === "heightCm" ? "decimal-pad" : "default";
    const placeholder = field === "taxonomy" ? t("fieldCollection.taxonomyPlaceholder") : undefined;
    return (
      <View key={field} style={styles.fieldGroup}>
        {edit ? <OriginalUpdatedField label={label} originalValue={originalObservationContent[field] ?? originalObservation?.[field]}>
          <TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline, invalidField === field && styles.invalidInput]}
            multiline={multiline} textAlignVertical={multiline ? "top" : "center"} keyboardType={keyboardType}
            maxLength={maxLength} placeholder={placeholder} value={form[field]} onChangeText={(value) => change(field, value)} />
        </OriginalUpdatedField> : <>
          <Text style={[styles.label, invalidField === field && styles.invalidLabel]}>{label}</Text>
          <TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline, invalidField === field && styles.invalidInput]}
            multiline={multiline} textAlignVertical={multiline ? "top" : "center"} keyboardType={keyboardType}
            maxLength={maxLength} placeholder={placeholder} value={form[field]} onChangeText={(value) => change(field, value)} />
        </>}
      </View>
    );
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.page}>
      <View style={styles.pageHeadingRow}>
      <Text style={styles.pageTitle}>
        {dashboard
          ? t("fieldCollection.botanistDashboard")
          : mode === "PlantQRCode"
            ? t("fieldCollection.plantQrCodes")
            : edit
              ? t("fieldCollection.correctObservation")
              : newPlant
                ? t("fieldCollection.registerPlant")
                : t("fieldCollection.addObservation")}
      </Text>
      <RefreshButton onPress={load} loading={loading} label={t("common.refresh")} />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
          {translateUIMessage(error)}
        </Text>
      )}
      {autoSaveState === "saving" && (observationForm || newPlant) && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t("botanistDrafts.autoSaving")}</Text>}
      {autoSaveState === "saved" && (observationForm || newPlant) && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t("botanistDrafts.autoSaved")}</Text>}
      {autoSaveState === "error" && (observationForm || newPlant) && <TouchableOpacity onPress={() => { setError(""); void autosave.retry().catch(() => {}); }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button"><Text style={styles.muted}>{t("common.tryAgain")}</Text></TouchableOpacity>}
      {!!message && <Text accessibilityLiveRegion="polite">{translateUIMessage(message)}</Text>}
      {isNewObservation && plantEligibility !== "approved" && <View style={styles.plantEligibilityNotice} accessibilityRole={plantEligibility === "checking" ? undefined : "alert"}>
        <Text style={styles.plantEligibilityText}>{t(eligibilityMessageKey(plantEligibility))}</Text>
      </View>}
      {user && dashboard && (
        <>
          {onLogout && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onLogout}>
              <Text>{t("fieldCollection.signOut")}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("AddPlant", { botanist: user })}
          >
            <Text>{t("fieldCollection.registerNewPlant")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            disabled={busy}
            onPress={synchronize}
          >
            <Text>{t("fieldCollection.synchronize")}{draftCount}{t("fieldCollection.savedDrafts")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate("BotanistMyDrafts", { botanist: user })}>
            <Text>{t("botanistDrafts.openDrafts")}</Text>
          </TouchableOpacity>
        </>
      )}
      {user && !dashboard && mode !== "PlantQRCode" && (
        <>
          <View style={styles.card}>
          {observationForm ? (
            <>
              <Text style={styles.sectionTitle}>{t("fieldCollection.plantInformation")}</Text>
              <Text style={styles.sectionHint}>{t("fieldCollection.readOnlyPlantInformation")}</Text>
              {edit && !!originalObservation?.review_comment && (
                <View style={styles.officerFeedback}>
                  <Text style={styles.officerFeedbackLabel}>{t("notificationObservation.officerFeedback")}</Text>
                  <Text style={styles.plantInfoValue}>{originalObservation.review_comment}</Text>
                </View>
              )}
              {[
                [t("fieldCollection.plantId"), displayPlantValue(plantRecord?.plant_id, plantRecord?.id, selectedPlantId)],
                [t("recordEdits.scientific_name"), displayPlantValue(plantRecord?.scientific_name, speciesDetails.scientific_name, linkedSpecies?.scientific_name, originalObservation?.scientific_name)],
                [t("recordEdits.common_name"), displayPlantValue(plantRecord?.plant_common_name, plantRecord?.common_name, speciesDetails.common_name, linkedSpecies?.common_name)],
                [t("fieldCollection.genusFamily"), [
                  displayPlantValue(plantRecord?.genus_name, plantRecord?.genus, speciesDetails.genus_name, speciesDetails.genus, linkedSpecies?.genus_name, linkedSpecies?.genus),
                  displayPlantValue(plantRecord?.family_name, plantRecord?.family, speciesDetails.family_name, speciesDetails.family, linkedSpecies?.family_name, linkedSpecies?.family),
                ].join(" / ")],
                [t("fieldCollection.registeredPlantLocation"), registeredPlantLocation],
                [t("fieldCollection.observer"), displayPlantValue(user?.name, user?.email, user?.id)],
              ].map(([label, value]) => (
                <View key={label} style={styles.plantInfoRow}>
                  <Text style={styles.plantInfoLabel}>{label}</Text>
                  <Text style={styles.plantInfoValue}>{value}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>{t("fieldCollection.plantSpeciesSection")}</Text>
              <Text style={styles.label}>{t("fieldCollection.speciesReference")}</Text>
              {user.offline && newPlant && (
                <TextInput style={styles.input}
                  accessibilityLabel={t("fieldCollection.speciesIdFromYourFieldReference")}
                  placeholder={t("fieldCollection.knownSpeciesId")} value={form.species_id}
                  onChangeText={(value) => change("species_id", value)} />
              )}
              {species.map((s) => (
                <TouchableOpacity key={s.species_id} onPress={() => change("species_id", s.species_id)}
                  style={[styles.choiceButton, String(form.species_id) === s.species_id && styles.selectedChoice]}
                  accessibilityRole="button" accessibilityState={{ selected: String(form.species_id) === s.species_id }}>
                  <Text>{String(form.species_id) === s.species_id ? "✓ " : ""}{s.scientific_name} · {s.common_name}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t(observationForm ? "fieldCollection.plantCondition" : "fieldCollection.observationSection")}</Text>
          {(observationForm ? ["healthStatus", "lifeStage", "heightCm", "morphology"] : ["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes"]).map(renderObservationField)}
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t(observationForm ? "fieldCollection.observationLocation" : "fieldCollection.locationSection")}</Text>
          {["latitude", "longitude", "accuracy_m"].map((field) => {
            const label = fieldLabel(field, newPlant && ["latitude", "longitude"].includes(field));
            return <View key={field} style={styles.fieldGroup}>
              {edit ? <OriginalUpdatedField label={label} originalValue={originalObservationContent[field] ?? originalObservation?.[field]}>
                <TextInput accessibilityLabel={label} style={[styles.input, invalidField === field && styles.invalidInput]} value={form[field]} onChangeText={(v) => change(field, v)} keyboardType="decimal-pad" />
              </OriginalUpdatedField> : <>
                <Text style={[styles.label, invalidField === field && styles.invalidLabel]}>{label}</Text>
                <TextInput accessibilityLabel={label} style={[styles.input, invalidField === field && styles.invalidInput]} value={form[field]} onChangeText={(v) => change(field, v)} keyboardType="decimal-pad" />
              </>}
            </View>;
          })}
          <TouchableOpacity style={styles.locationButton} onPress={locate} disabled={locating} accessibilityRole="button" accessibilityState={{ disabled: locating }}>
            {locating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.locationButtonText}>{t("addPlant.getCurrentLocation")}</Text>}
          </TouchableOpacity>
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t(observationForm ? "fieldCollection.fieldNotesPhotoEvidence" : "fieldCollection.photosSection")}</Text>
          {observationForm && ["taxonomy", "notes"].map(renderObservationField)}
          {edit && <>
            <Text style={styles.originalInformationLabel}>{t("recordEdits.originalInformation")}</Text>
            {originalPhotos.length ? <View style={styles.photoList}>{originalPhotos.map((source, index) => <Image key={`${originalAssetKey}-${index}`} source={source} style={styles.photoPreview} resizeMode="cover" />)}</View>
              : <Text style={styles.originalInformationValue}>{t("recordEdits.informationNotAvailable")}</Text>}
            <Text style={styles.originalInformationValue}>{t("fieldCollection.photoReuseUnavailable")}</Text>
            <Text style={styles.originalInformationLabel}>{t("recordEdits.updatedInformation")}</Text>
          </>}
          <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.photoButton, styles.actionFlex]} onPress={() => capture(true)} accessibilityRole="button">
            <Text style={styles.photoButtonText}>{t("addPlant.camera")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.photoButton, styles.actionFlex]} onPress={() => capture(false)} accessibilityRole="button">
            <Text style={styles.photoButtonText}>{t("addPlant.gallery")}</Text>
          </TouchableOpacity>
          </View>
          <View style={styles.photoList}>
          {photos.map((p) => (
            <View key={p.client_key} style={styles.photoItem}>
              <Image source={{ uri: p.uri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhotoButton}
                accessibilityRole="button" accessibilityLabel={t("fieldCollection.removeAttachedPhoto")}
                onPress={() => setPhotos((old) => old.filter((photo) => photo.client_key !== p.client_key))}>
                <Ionicons name="close" size={18} color="#C85C5C" />
              </TouchableOpacity>
            </View>
          ))}
          </View>
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fieldCollection.submissionSection")}</Text>
          <View style={styles.formActionRow}>
            <TouchableOpacity style={[styles.secondaryAction, (busy || completed) && styles.disabledButton]} disabled={busy || completed} onPress={() => save(false)} accessibilityRole="button" accessibilityState={{ disabled: busy || completed }}>
              <Text style={styles.secondaryActionText}>{t("fieldCollection.saveOfflineDraft")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, (busy || completed || (isNewObservation && plantEligibility !== "approved")) && styles.disabledButton]} disabled={busy || completed || (isNewObservation && plantEligibility !== "approved")} onPress={() => save(true)} accessibilityRole="button" accessibilityState={{ disabled: busy || completed || (isNewObservation && plantEligibility !== "approved") }}>
              <Text style={styles.primaryButtonText}>{t("fieldCollection.submitAndSynchronize")}</Text>
            </TouchableOpacity>
          </View>
          </View>
        </>
      )}
      {user &&
        (dashboard || mode === "PlantQRCode") &&
        rows.map((row) => {
          const eligibility = plantStatuses[String(row.plant_id)] || "unavailable";
          return <View key={row.id} style={styles.card}>
            <Text>{t("fieldCollection.plant")}{row.plant_id} · {translateLabel(row.status)}
            </Text>
            <Text>{row.content.morphology}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => showQr(row)}>
              <Text>{t("fieldCollection.viewPersistentQrCode")}</Text>
            </TouchableOpacity>
            {["Draft", "Correction Required", "Rejected"].includes(
              row.status,
            ) && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setForm((old) => ({
                    ...old,
                    ...Object.fromEntries(
                      Object.entries(row.content).map(([k, v]) => [
                        k,
                        String(v),
                      ]),
                    ),
                  }));
                  navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id });
                }}
              >
                <Text>{t("fieldCollection.correctAndResubmitOwnObservation")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.secondaryButton, eligibility !== "approved" && styles.disabledButton]}
              disabled={eligibility !== "approved"}
              accessibilityState={{ disabled: eligibility !== "approved" }}
              onPress={() =>
                navigation.navigate("AddObservation", { plantId: row.plant_id })
              }
            >
              <Text>{t("fieldCollection.addObservation")}</Text>
            </TouchableOpacity>
            {eligibility !== "approved" && <Text style={styles.plantEligibilityText}>{t(eligibilityMessageKey(eligibility))}</Text>}
          </View>;
        })}
      {!!qr && <QrDisplay value={qr} />}
      </View>
    </ScrollView>
  );
}
function QrDisplay({ value }) {
  useAppTranslation();
  const QRCode = require("react-native-qrcode-svg").default;
  return (
    <View style={{ padding: 20, backgroundColor: "white" }}>
      <QRCode value={value} size={220} />
      <Text>{t("fieldCollection.codeIsUsableAfterOfficerApproval")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: fieldFormStyles.container,
  scrollContent: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 36 },
  page: { width: "100%", maxWidth: 900, gap: 12 },
  pageHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  pageTitle: { flex: 1, minWidth: 0, fontSize: 27, fontWeight: "700", color: "#234B3A", marginBottom: 2 },
  plantEligibilityNotice: { padding: 12, borderRadius: 12, backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#EAD9B5" },
  plantEligibilityText: { color: "#77501D", fontSize: 13, lineHeight: 19 },
  card: fieldFormStyles.card,
  sectionTitle: fieldFormStyles.sectionTitle,
  label: fieldFormStyles.label,
  fieldGroup: { marginBottom: 7 },
  originalInformationLabel: { marginTop: 5, color: "#718078", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  originalInformationValue: { minHeight: 40, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: "#E2EDE0", backgroundColor: "#F7FBF4", color: "#52665A", fontSize: 14, lineHeight: 20, textAlignVertical: "center" },
  plantInfoRow: { marginTop: 10 },
  plantInfoLabel: { marginBottom: 3, color: "#718078", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  plantInfoValue: { color: "#52665A", fontSize: 14, lineHeight: 20 },
  officerFeedback: { marginBottom: 10, padding: 12, borderRadius: 10, backgroundColor: "#EEF7EF", borderWidth: 1, borderColor: "#D8EBDD" },
  officerFeedbackLabel: { marginBottom: 5, color: "#315B49", fontSize: 12, fontWeight: "700" },
  input: [fieldFormStyles.input, { width: "100%", marginTop: 6 }],
  multiline: fieldFormStyles.textArea,
  sectionHint: { marginTop: -5, marginBottom: 5, color: "#718078", fontSize: 12, lineHeight: 17 },
  invalidLabel: { color: "#A34436" },
  invalidInput: { borderWidth: 1, borderColor: "#C85C5C" },
  choiceButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 11, marginTop: 7, borderRadius: 11, backgroundColor: "#f3f8f4", borderWidth: 1, borderColor: "#e0ebe3" },
  selectedChoice: { backgroundColor: "#e4f2e9", borderColor: "#468585" },
  secondaryButton: { minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, marginVertical: 4, borderRadius: 12, backgroundColor: "#e8f2eb", borderWidth: 1, borderColor: "#d4e5d9" },
  savedDraftRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  savedDraftResume: { flex: 1, marginVertical: 0 },
  deleteDraftButton: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center", marginVertical: 0, borderRadius: 12, backgroundColor: "#FDF1EF", borderWidth: 1, borderColor: "#F2D5D1" },
  secondaryButtonText: { color: "#2b5948", fontWeight: "600", fontSize: 15, textAlign: "center" },
  formActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 8 },
  secondaryAction: { flexGrow: 1, flexBasis: "45%", minWidth: 145, minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "#E8EDDA", borderWidth: 1, borderColor: "#AFCBB7" },
  secondaryActionText: { color: "#2F6B4F", fontWeight: "700", fontSize: 14, textAlign: "center" },
  primaryButton: [fieldFormStyles.submitButton, { flexGrow: 1, flexBasis: "45%", minWidth: 145, marginTop: 0, paddingHorizontal: 12, paddingVertical: 8 }],
  disabledButton: { opacity: 0.55 },
  primaryButtonText: [fieldFormStyles.submitButtonText, { fontSize: 16, textAlign: "center" }],
  locationButton: fieldFormStyles.locationButton,
  locationButtonText: fieldFormStyles.locationButtonText,
  photoButton: [fieldFormStyles.photoButton, { flexDirection: "row", gap: 7 }],
  photoButtonText: fieldFormStyles.photoButtonText,
  actionRow: fieldFormStyles.photoButtonRow,
  actionFlex: { flex: 1 },
  photoList: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 },
  photoItem: { width: 112, position: "relative" },
  photoPreview: fieldFormStyles.photoPreview,
  removePhotoButton: fieldFormStyles.removePhotoButton,
  plantSummary: { padding: 14, borderRadius: 12, backgroundColor: "#F5F9F3", borderWidth: 1, borderColor: "#E0EADF", marginVertical: 6 },
  summaryLabel: { color: "#234B3A", fontSize: 15, fontWeight: "700" },
  summaryName: { color: "#234B3A", fontSize: 17, fontWeight: "700", marginTop: 5 },
  summaryCommon: { color: "#6D7F75", fontSize: 14, marginTop: 2 },
  summaryStatus: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: "hidden", color: "#2C6956", backgroundColor: "#EAF6E7", fontSize: 12, fontWeight: "700" },
});
