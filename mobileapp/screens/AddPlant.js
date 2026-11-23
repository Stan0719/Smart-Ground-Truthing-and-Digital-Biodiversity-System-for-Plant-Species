import PreviewableImage, { confirmPhotoRemoval } from "../components/PreviewableImage";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import Text, { ScaledTextInput as TextInput } from "../components/ScaledText";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  AppState,
  View,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";

import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import QRCode from "react-native-qrcode-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import RefreshButton from "../components/RefreshButton";
import GpsLocationPicker from "../components/GpsLocationPicker";
import { validGpsPoint, readGpsLocation } from "../utils/gpsLocation";
import { fieldFormStyles } from "../components/fieldFormStyles";
import { plantApi, fetchSpeciesCatalog, fetchSpeciesDetail } from "../utils/plantApi";
import { validateSpeciesRequest, validatePlantDetails, validatePlantGps } from "../utils/addPlantValidation";
import { normalizeSpeciesName } from "../utils/speciesNameNormalization";
import { useFocusEffect } from "@react-navigation/native";
import { saveBotanistFormDraft, getBotanistFormDraft, findBotanistFormDraft, deleteBotanistFormDraft, hasMeaningfulAddPlantDraft } from "../utils/botanistFormDrafts";
import { useBotanistDraftAutosave, stopBotanistDraftAutosave } from "../utils/botanistDraftAutosave";
import SpeciesDictionary from "../components/SpeciesDictionary";
import DiscoverableScrollView from "../components/DiscoverableScrollView";
import { inspectPickedImages, imageSizeAlert, base64Bytes, MAX_IMAGE_BYTES } from "../utils/imageSelection";

const createPlantClientKey = () =>
  `plant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const qrLabel = (id) => `QR-${String(id).padStart(4, "0")}`;

const CONSERVATION_STATUSES = [
  "Not Assessed",
  "Least Concern",
  "Near Threatened",
  "Vulnerable",
  "Endangered",
  "Critically Endangered",
];

const PHOTO_GUIDES = [
  {
    key: "wholePlant",
    title: "Whole Plant",
    description: "Capture the entire plant from a clear distance.",
    required: true,
  },
  {
    key: "leafCloseUp",
    title: "Leaf Close-up",
    description: "Capture the leaf shape and surface clearly.",
    required: true,
  },
  {
    key: "stemBark",
    title: "Stem / Bark",
    description: "Capture the stem, trunk, or bark texture clearly.",
    required: true,
  },
  {
    key: "flowerFruit",
    title: "Flower / Fruit",
    description: "Optional — capture only if currently present.",
    required: false,
  },
];

const REQUIRED_PHOTO_KEYS = PHOTO_GUIDES
  .filter((guide) => guide.required)
  .map((guide) => guide.key);

// =====================================================
// MAIN SCREEN
// =====================================================

export default function AddPlantScreen(props) {
  useAppTranslation();
  return <AddPlantSession key={props.route.params?.botanist?.id || "signed-out"} {...props} />;
}

function AddPlantSession({ route, navigation }) {
  useAppTranslation();
  const qrEntry = route.params?.entrySource === "qr-scan" && route.params?.scannedQrId &&
    route.params?.scannedQrToken && !route.params?.formDraftKey;
  const [session, setSession] = useState({ revision: 0, fresh: false });
  const freshOnFocus = useRef(false);
  const startFresh = useCallback(() => {
    navigation.setParams({ formDraftKey: undefined, entrySource: undefined, scannedQrId: undefined, scannedQrToken: undefined });
    setSession((current) => ({ revision: current.revision + 1, fresh: true }));
  }, [navigation]);
  useFocusEffect(useCallback(() => {
    if (freshOnFocus.current) {
      freshOnFocus.current = false;
      startFresh();
    }
  }, [startFresh]));
  return <AddPlantForm key={`${session.revision}:${route.params?.formDraftKey || "new"}:${qrEntry ? route.params.scannedQrToken : ""}`} route={route} navigation={navigation}
    skipRecovery={session.fresh || Boolean(qrEntry)} onStartNew={startFresh} onSubmitted={() => { freshOnFocus.current = true; }} />;
}

export function AddPlantForm({
  route,
  navigation,
  skipRecovery = false,
  onStartNew,
  onSubmitted,
}) {
  useAppTranslation();
  const { height: screenHeight } = useWindowDimensions();

  const botanist = route.params?.botanist;
  const accountId = botanist?.id;
  const clientKeyRef = useRef(createPlantClientKey());
  const [localFormDraftKey] = useState(() => `add-plant-${accountId}-${createPlantClientKey()}`);
  const [recoveryResolved, setRecoveryResolved] = useState(skipRecovery);
  const activeFormDraftKey = route.params?.formDraftKey || localFormDraftKey;
  const restoredDraftRef = useRef(null);
  const recoveryPromptedRef = useRef(skipRecovery);
  const draftEndedRef = useRef(false);
  const [draftSaving, setDraftSaving] = useState(false), [draftMessage, setDraftMessage] = useState(""), [draftError, setDraftError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionBusyRef = useRef(false);
  const [submittedQr, setSubmittedQr] = useState(null);
  const [availableQRCodes, setAvailableQRCodes] = useState([]);
  const [selectedQRCode, setSelectedQRCode] = useState(null);
  const [unavailableQr, setUnavailableQr] = useState(null);
  const qrFocus = useRef(false);
  const [showQRDropdown, setShowQRDropdown] = useState(false);
  const [loadingQRCodes, setLoadingQRCodes] = useState(true);
  const [qrLoadError, setQrLoadError] = useState("");
  const qrLoadPromiseRef = useRef(null);
  const scannedQrHandledRef = useRef(null);
  const [generatingQR, setGeneratingQR] = useState(false);
  const generatingQRRef = useRef(false);
  const [qrGenerationMessage, setQrGenerationMessage] = useState("");
  const [qrGenerationFailed, setQrGenerationFailed] = useState(false);

  const loadAvailableQRCodes = useCallback(() => {
    if (qrLoadPromiseRef.current) return qrLoadPromiseRef.current;
    const pending = (async () => {
      setLoadingQRCodes(true);
      setQrLoadError("");
      try {
        const result = await plantApi("/qr-codes");
        const codes = Array.isArray(result.qr_codes) ? result.qr_codes : [];
        const available = codes.filter((code) => code.status === "generated" && code.plant_id == null);
        setAvailableQRCodes(available);
        return available;
      } catch (error) {
        setQrLoadError(error instanceof Error ? error.message : "Could not load your QR inventory.");
        return null;
      } finally {
        setLoadingQRCodes(false);
      }
    })();
    qrLoadPromiseRef.current = pending;
    pending.then(() => { if (qrLoadPromiseRef.current === pending) qrLoadPromiseRef.current = null; });
    return pending;
  }, []);

  async function generateQRInForm() {
    if (generatingQRRef.current || loadingQRCodes || submitting || submittedQr || !accountId) return;
    generatingQRRef.current = true;
    setGeneratingQR(true);
    setQrGenerationMessage("");
    setQrGenerationFailed(false);
    try {
      const result = await plantApi("/qr-codes", {
        method: "POST", body: { count: 1 }, expectedAccountId: accountId,
      });
      const created = result?.qr_codes;
      if (!Array.isArray(created) || created.length !== 1 || created[0]?.qr_id == null ||
          !created[0]?.qr_code || created[0]?.status !== "generated" || created[0]?.plant_id != null)
        throw new Error(t("addPlantWorkflow.qrGenerationUnconfirmed"));
      const available = await loadAvailableQRCodes();
      const generated = available?.find((code) => String(code.qr_id) === String(created[0].qr_id));
      if (!generated) throw new Error(t("addPlantWorkflow.qrGenerationUnconfirmed"));
      setSelectedQRCode(generated);
      setShowQRDropdown(false);
      setQrGenerationMessage(t("addPlantWorkflow.qrGeneratedAndSelected", { id: qrLabel(generated.qr_id) }));
    } catch (error) {
      setQrGenerationFailed(true);
      setQrGenerationMessage(error instanceof Error ? translateUIMessage(error.message) : t("addPlantWorkflow.qrGenerationUnconfirmed"));
    } finally {
      generatingQRRef.current = false;
      setGeneratingQR(false);
    }
  }


  // ===================================================
  // PLANT INFORMATION
  // ===================================================

  const [speciesCatalog, setSpeciesCatalog] = useState([]);
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(true);
  const [loadingSpeciesCatalog, setLoadingSpeciesCatalog] = useState(true);
  const [speciesCatalogError, setSpeciesCatalogError] = useState("");
  const [pendingSpeciesError, setPendingSpeciesError] = useState(false);
  const [speciesDuplicate, setSpeciesDuplicate] = useState(null);
  const [checkingSpeciesDuplicate, setCheckingSpeciesDuplicate] = useState(false);
  const duplicateCheckSequence = useRef(0);
  const formScrollRef = useRef(null);
  const speciesWarningOffset = useRef(0);
  const speciesRequestRef = useRef(null);

  const loadSpeciesCatalog = useCallback(() => {
    if (speciesRequestRef.current) return speciesRequestRef.current;
    setLoadingSpeciesCatalog(true);
    setSpeciesCatalogError("");
    setPendingSpeciesError(false);
    const request = (async () => {
      try {
        const [approved, pendingResponse] = await Promise.all([
          fetchSpeciesCatalog({ accountId }),
          plantApi("/species-requests?scope=mine-pending", { expectedAccountId: accountId })
            .catch(() => { setPendingSpeciesError(true); return { species_requests: [] }; }),
        ]);
        const catalog = [
          ...approved.map((species) => ({ ...species, source: "approved" })),
          ...(pendingResponse.species_requests || [])
            .filter((request) => request.request_status === "Pending Review" && request.requested_by === `staff:${accountId}`)
            .map((request) => ({
              id: `request:${request.request_id}`, source: request.request_status === "Pending Review" ? "pending" : "correction",
              requestId: request.request_id, requestStatus: request.request_status,
              scientificName: request.scientific_name || "", name: request.common_name || "",
              commonName: request.common_name || "", family: request.family_name || "",
            })),
        ];
        setSpeciesCatalog(catalog);
        setSelectedSpecies((current) => current
          ? catalog.find((species) => String(species.id) === String(current.id)) || null : null);
      } catch (error) {
        setSpeciesCatalogError(
          error instanceof Error ? error.message : "Could not load species from the database.",
        );
      } finally {
        if (speciesRequestRef.current === request) speciesRequestRef.current = null;
        setLoadingSpeciesCatalog(false);
      }
    })();
    speciesRequestRef.current = request;
    return request;
  }, [accountId]);

  useFocusEffect(useCallback(() => {
    qrFocus.current = true;
    void loadSpeciesCatalog();
    void loadAvailableQRCodes();
    const subscription = AppState?.addEventListener("change", (state) => {
      if (state === "active") void loadAvailableQRCodes();
    });
    return () => { qrFocus.current = false; subscription?.remove(); };
  }, [loadSpeciesCatalog, loadAvailableQRCodes]));

  const selectedQrId = selectedQRCode?.qr_id;
  const selectedQrToken = selectedQRCode?.qr_code;
  useEffect(() => {
    if (!accountId || !selectedQrId || !selectedQrToken) return undefined;
    let active = true, pending = false;
    const check = async () => {
      if (!qrFocus.current || pending) return;
      pending = true;
      try {
        const result = await plantApi(`/qr-codes?qr_id=${encodeURIComponent(String(selectedQrId))}`, { expectedAccountId: accountId });
        if (!active || !Array.isArray(result?.qr_codes)) return;
        const available = result.qr_codes.some((code) => String(code.qr_id) === String(selectedQrId) &&
          code.qr_code === selectedQrToken && code.status === "generated" && code.plant_id == null);
        setUnavailableQr(available ? null : selectedQrId);
        if (!available) setAvailableQRCodes((codes) => codes.filter((code) => String(code.qr_id) !== String(selectedQrId)));
      } catch { /* Keep the selection until availability is confirmed. */ }
      finally { pending = false; }
    };
    if (String(restoredDraftRef.current?.form?.selectedQRCode?.qr_id) === String(selectedQrId)) void check();
    const subscription = AppState?.addEventListener("change", (state) => { if (state === "active") void check(); });
    return () => { active = false; subscription?.remove(); };
  }, [accountId, selectedQrId, selectedQrToken]);

  useEffect(() => {
    const scannedId = route.params?.scannedQrId;
    if (!scannedId || !recoveryResolved || route.params?.formDraftKey || scannedQrHandledRef.current === scannedId) return;
    let active = true;
    scannedQrHandledRef.current = scannedId;
    setSelectedQRCode(null);
    plantApi(`/qr-codes?qr_id=${encodeURIComponent(String(scannedId))}`, { expectedAccountId: accountId }).then((response) => {
      if (!active) return;
      const match = response?.qr_codes?.find((code) => String(code.qr_id) === String(scannedId) &&
        code.qr_code === route.params?.scannedQrToken && code.status === "generated" && code.plant_id == null);
      if (match) setSelectedQRCode(match);
      else {
        setSelectedQRCode(null);
        Alert.alert(t("addPlant.selectAQrCode"), t("addPlant.scannedQrUnavailable"));
      }
    }).catch(() => { if (active) Alert.alert(t("addPlant.selectAQrCode"), t("addPlant.scannedQrUnavailable")); });
    return () => { active = false; };
  }, [route.params?.scannedQrId, route.params?.scannedQrToken, route.params?.formDraftKey, recoveryResolved, accountId]);

  const filteredSpecies = speciesCatalog
    .filter((species) => {
      const term = speciesSearch.trim().toLowerCase();
      return !term ||
        species.scientificName.toLowerCase().includes(term) ||
        species.name.toLowerCase().includes(term);
    });

  // const [category, setCategory] =
  //   useState("");

  const [plantScientificName, setPlantScientificName] = useState("");

  const [height, setHeight] =
    useState("");

  const [description, setDescription] =
    useState("");


  const [healthStatus, setHealthStatus] = useState("Healthy");
  const [growthStage, setGrowthStage] = useState("");
  const [morphology, setMorphology] = useState("");
  const [zone, setZone] = useState("");

  // ===================================================
  // LOCATION
  // ===================================================

  const [latitude, setLatitude] =
    useState("");

  const [longitude, setLongitude] =
    useState("");

  const [loadingLocation, setLoadingLocation] =
    useState(false);
  
  const [altitude, setAltitude] = useState("");
  const [gpsAccuracy, setGpsAccuracy] = useState("");
  const [mapInteracting, setMapInteracting] = useState(false);
  const [gpsEditing, setGpsEditing] = useState(false);
  const gpsBusy = useRef(false);
  const [gpsRevision, setGpsRevision] = useState(0);

  // ===================================================
  // PHOTOS
  // ===================================================

  const [guidedPhotos, setGuidedPhotos] = useState({
    wholePlant: null,
    leafCloseUp: null,
    stemBark: null,
    flowerFruit: null,
  });

  const [additionalPhotos, setAdditionalPhotos] = useState([]);

  const completedRequiredPhotos = REQUIRED_PHOTO_KEYS.filter(
    (key) => Boolean(guidedPhotos[key])
  ).length;


  // ===================================================
  // NEW SPECIES REQUEST
  // ===================================================

  const [showSpeciesForm, setShowSpeciesForm] =
    useState(false);


  // These fields belong ONLY to the species request.

  const [speciesScientificName, setSpeciesScientificName] = useState("");
  const [speciesCommonName, setSpeciesCommonName] = useState("");
  const [speciesGenus, setSpeciesGenus] = useState("");
  const [speciesFamily, setSpeciesFamily] = useState("");

  const [showConservationDropdown, setShowConservationDropdown] =
    useState(false);

  const [speciesConservationStatus, setSpeciesConservationStatus] =
    useState("Not Assessed");

  const [speciesDescription, setSpeciesDescription] = useState("");
  const [speciesHabitat, setSpeciesHabitat] = useState("");
  const [speciesImages, setSpeciesImages] = useState([]);
  const [autoSaveState, setAutoSaveState] = useState("");

  useEffect(() => {
    const name = speciesScientificName;
    const normalized = normalizeSpeciesName(name);
    const sequence = ++duplicateCheckSequence.current;
    setSpeciesDuplicate(null);
    if (!showSpeciesForm || !normalized) { setCheckingSpeciesDuplicate(false); return undefined; }
    const timer = setTimeout(async () => {
      setCheckingSpeciesDuplicate(true);
      try {
        const catalog = await fetchSpeciesCatalog({ accountId });
        const requestResponse = await plantApi("/species-requests?scope=mine-active", { expectedAccountId: accountId });
        if (sequence !== duplicateCheckSequence.current) return;
        const approved = catalog.find((row) => normalizeSpeciesName(row.scientificName) === normalized);
        const ownRequests = (requestResponse.species_requests || [])
          .filter((row) => row.requested_by === `staff:${accountId}` &&
            ["Pending Review", "Correction Required"].includes(row.request_status) &&
            normalizeSpeciesName(row.scientific_name) === normalized)
          .sort((a, b) => (a.request_status === "Correction Required" ? -1 : 1) - (b.request_status === "Correction Required" ? -1 : 1));
        if (approved) setSpeciesDuplicate({ type: "approved", species: approved, normalizedName: normalized });
        else if (ownRequests.length) setSpeciesDuplicate({
          type: ownRequests[0].request_status === "Correction Required" ? "correction" : "pending", request: ownRequests[0], normalizedName: normalized,
        });
      } catch {
        if (sequence === duplicateCheckSequence.current) setSpeciesDuplicate({ type: "unavailable" });
      } finally {
        if (sequence === duplicateCheckSequence.current) setCheckingSpeciesDuplicate(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [accountId, showSpeciesForm, speciesScientificName]);

  useEffect(() => {
    let active = true;
    if (!route.params?.formDraftKey || !botanist?.id) return () => { active = false; };
    (async () => {
      try {
        const draft = await getBotanistFormDraft(botanist.id, route.params.formDraftKey, "add-plant");
        if (!active) return;
        restoredDraftRef.current = draft;
        const saved = draft.form;
        clientKeyRef.current = draft.submission_client_key || saved.submissionClientKey || clientKeyRef.current;
        setSelectedSpecies(saved.selectedSpecies || null); setSpeciesSearch(saved.speciesSearch || "");
        setPlantScientificName(saved.plantScientificName || ""); setHeight(saved.height || ""); setDescription(saved.description || "");
        setHealthStatus(saved.healthStatus || "Healthy"); setGrowthStage(saved.growthStage || ""); setMorphology(saved.morphology || ""); setZone(saved.zone || "");
        setLatitude(saved.latitude || ""); setLongitude(saved.longitude || ""); setAltitude(saved.altitude || ""); setGpsAccuracy(saved.gpsAccuracy || "");
        setShowSpeciesForm(Boolean(saved.showSpeciesForm)); setSpeciesScientificName(saved.speciesScientificName || "");
        setSpeciesCommonName(saved.speciesCommonName || ""); setSpeciesGenus(saved.speciesGenus || ""); setSpeciesFamily(saved.speciesFamily || "");
        setSpeciesConservationStatus(saved.speciesConservationStatus || "Not Assessed"); setSpeciesDescription(saved.speciesDescription || ""); setSpeciesHabitat(saved.speciesHabitat || "");
        const refs = draft.photo_refs || [];
        setGuidedPhotos(Object.fromEntries(REQUIRED_PHOTO_KEYS.concat("flowerFruit").map((slot) => [slot, refs.find((photo) => photo.slot === `guided:${slot}`)?.uri || null])));
        setAdditionalPhotos(refs.filter((photo) => photo.slot?.startsWith("additional:")).sort((a, b) => a.slot.localeCompare(b.slot)).map((photo) => photo.uri));
        setSpeciesImages(refs.filter((photo) => photo.slot?.startsWith("species:")).map((photo) => photo.uri));
        setSelectedQRCode(saved.selectedQRCode || null);
        setRecoveryResolved(true);
      } catch (error) { if (active) { setDraftError(error.message || t("botanistDrafts.restoreFailed")); setRecoveryResolved(true); } }
    })();
    return () => { active = false; };
  }, [botanist?.id, route.params?.formDraftKey]);

  const draftForm = {
    selectedSpecies: selectedSpecies ? { id: selectedSpecies.id, source: selectedSpecies.source, requestId: selectedSpecies.requestId,
      scientificName: selectedSpecies.scientificName, commonName: selectedSpecies.commonName, name: selectedSpecies.name, family: selectedSpecies.family } : null,
    speciesSearch, plantScientificName, height, description, healthStatus, growthStage, morphology, zone, latitude, longitude, altitude, gpsAccuracy,
    selectedQRCode: selectedQRCode ? { qr_id: selectedQRCode.qr_id, qr_code: selectedQRCode.qr_code, label: selectedQRCode.label } : null,
    showSpeciesForm, speciesScientificName, speciesCommonName, speciesGenus, speciesFamily, speciesConservationStatus, speciesDescription, speciesHabitat,
  };
  const draftPhotos = [
    ...Object.entries(guidedPhotos).filter(([, uri]) => uri).map(([slot, uri]) => ({ slot: `guided:${slot}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
    ...additionalPhotos.map((uri, index) => ({ slot: `additional:${String(index).padStart(2, "0")}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
    ...speciesImages.map((uri, index) => ({ slot: `species:${index}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
  ];
  const buildDraftInput = (autoSaved = false) => ({
    client_key: activeFormDraftKey, form_type: "add-plant", submission_client_key: clientKeyRef.current,
    title: plantScientificName.trim() || selectedSpecies?.scientificName || selectedSpecies?.name || "",
    auto_saved: autoSaved,
    form: { ...draftForm, submissionClientKey: clientKeyRef.current }, photos: draftPhotos,
  });
  const autosaveSignature = JSON.stringify({ selectedSpecies: selectedSpecies?.id, plantScientificName, height, description, healthStatus, growthStage, morphology,
    zone, latitude, longitude, altitude, gpsAccuracy, selectedQRCode: selectedQRCode?.qr_id, showSpeciesForm, speciesScientificName,
    speciesCommonName, speciesGenus, speciesFamily, speciesConservationStatus, speciesDescription, speciesHabitat,
    photos: [...Object.values(guidedPhotos), ...additionalPhotos, ...speciesImages] });
  const hasMeaningfulDraft = hasMeaningfulAddPlantDraft(draftForm, draftPhotos);
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(accountId && recoveryResolved && hasMeaningfulDraft && !submittedQr),
    signature: autosaveSignature, navigation, accountId, clientKey: activeFormDraftKey, errorKey: accountId && route.key ? `${accountId}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { if (draftEndedRef.current || !hasMeaningfulDraft) return; const saved = await saveBotanistFormDraft(accountId, buildDraftInput(true)); restoredDraftRef.current = saved; if (isMounted?.() && !draftEndedRef.current) setAutoSaveState("saved"); return saved; },
    onError: (error) => { setAutoSaveState("error"); setDraftError(translateUIMessage(error.message) || t("botanistDrafts.autoSaveFailed")); } });
  const stopAutosave = autosave.stop;

  useEffect(() => {
    if (!accountId || route.params?.formDraftKey || recoveryPromptedRef.current) return;
    recoveryPromptedRef.current = true;
    let active = true;
    let promptShown = false;
    findBotanistFormDraft(accountId, "add-plant").then((draft) => {
      if (!active) return;
      if (!draft) { setRecoveryResolved(true); return; }
      const discardDetectedDraft = async () => {
        if (!active) return;
        try {
          await stopAutosave();
          await stopBotanistDraftAutosave(accountId, draft.client_key);
          const removed = await deleteBotanistFormDraft(accountId, draft.client_key);
          if (!removed) throw Error(t("botanistDrafts.newerDraftKept"));
          if (!active) return;
          draftEndedRef.current = true;
          restoredDraftRef.current = null;
          onStartNew(); // A new form instance resets fields, photos, QR and autosave metadata together.
        } catch (error) {
          if (!active) return;
          setDraftError(translateUIMessage(error.message) || t("botanistDrafts.cleanupFailed"));
          Alert.alert(t("botanistDrafts.cleanupFailed"), translateUIMessage(error.message), [
            { text: t("common.tryAgain"), onPress: () => { void discardDetectedDraft(); } },
          ]);
        }
      };
      promptShown = true;
      Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
        { text: t("botanistDrafts.continueDraft"), onPress: () => { if (active) navigation.setParams({ formDraftKey: draft.client_key }); } },
        { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: discardDetectedDraft },
      ]);
    }).catch((error) => { if (active) { setDraftError(translateUIMessage(error.message) || t("botanistDrafts.restoreFailed")); setRecoveryResolved(true); } });
    return () => { active = false; if (!promptShown) recoveryPromptedRef.current = false; };
  }, [accountId, navigation, route.params?.formDraftKey, stopAutosave, onStartNew]);




  // ===================================================
  // GET CURRENT LOCATION
  // ===================================================

  async function handleGetLocation() {
    if (gpsBusy.current) return;
    gpsBusy.current = true;
    setLoadingLocation(true);
    try {
      const point = await readGpsLocation(Location, t);
      setGpsRevision((revision) => revision + 1);
      setLatitude(point.latitude); setLongitude(point.longitude);
      setGpsAccuracy(point.accuracy_m); setAltitude(point.altitude_m);
    } catch (error) {
      Alert.alert(t("addPlant.locationError"), error.message || t("gpsPicker.unableToGetLocation"));
    } finally { gpsBusy.current = false; setLoadingLocation(false); }
  }

  // ===================================================
  // TAKE PHOTO
  // ===================================================

  async function checkedPhotos(assets, labels) {
    const result = await inspectPickedImages(assets, labels, FileSystem.getInfoAsync);
    if (result.rejected.length) {
      const alert = imageSizeAlert(t, result.rejected);
      Alert.alert(alert.title, alert.message);
    }
    return result.accepted;
  }
  const guidedPhotoLabel = (key) => t(`imageSizeAlert.${({ wholePlant: "wholePlantPhoto", leafCloseUp: "leafPhoto", stemBark: "stemBarkPhoto", flowerFruit: "flowerFruitPhoto" })[key] || "plantPhoto"}`);

  async function handleTakeGuidedPhoto(photoKey) {

    try {

      const {
        status,
      } =
        await ImagePicker.requestCameraPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          t("addPlant.permissionRequired"),
          t("addPlant.cameraPermissionIsRequired")
        );

        return;
      }


      const result =
        await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.8,
        });


      if (!result.canceled) {

        const accepted = await checkedPhotos(result.assets, [guidedPhotoLabel(photoKey)]);
        if (!accepted.length) return;
        const uri = accepted[0].uri;


        setGuidedPhotos((current) => ({
          ...current,
          [photoKey]: uri,
        }));

      }

    } catch (error) {

      console.log(
        "Camera error:",
        error
      );

      Alert.alert(
        t("addPlant.cameraError"),
        t("addPlant.unableToOpenTheCamera")
      );

    }
  }

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(t("addPlant.permissionRequired"), t("addPlant.cameraPermissionIsRequired"));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });

      if (!result.canceled) {
        const accepted = await checkedPhotos(result.assets, [`${t("addPlant.additionalPhotos")} ${additionalPhotos.length + 1}`]);
        if (!accepted.length) return;
        setAdditionalPhotos((current) => [
          ...current,
          accepted[0].uri,
        ]);
      }
    } catch (error) {
      console.log("Camera error:", error);
      Alert.alert(t("addPlant.cameraError"), t("addPlant.unableToOpenTheCamera"));
    }
  }


  // ===================================================
  // PICK PHOTO FROM GALLERY
  // ===================================================

  async function handlePickGuidedPhoto(photoKey) {

    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(t("addPlant.permissionRequired"), t("addPlant.galleryPermissionIsRequired"));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (!result.canceled) {
        const accepted = await checkedPhotos(result.assets, [guidedPhotoLabel(photoKey)]);
        if (!accepted.length) return;
        setGuidedPhotos((current) => ({
          ...current,
          [photoKey]: accepted[0].uri,
        }));
      }
    } catch (error) {
      console.log("Gallery error:", error);
      Alert.alert(t("addPlant.galleryError"), t("addPlant.unableToOpenTheGallery"));
    }
  }

  async function handlePickPhoto() {

    try {

      const {
        status,
      } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          t("addPlant.permissionRequired"),
          t("addPlant.galleryPermissionIsRequired")
        );

        return;
      }


      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          quality: 0.8,
        });


      if (!result.canceled) {

        const accepted = await checkedPhotos(result.assets, result.assets.map((_, index) => `${t("addPlant.additionalPhotos")} ${additionalPhotos.length + index + 1}`));
        const selectedPhotos =
          accepted.map(
            (asset) => asset.uri
          );


        setAdditionalPhotos((current) => [
          ...current,
          ...selectedPhotos,
        ]);

      }

    } catch (error) {

      console.log(
        "Gallery error:",
        error
      );

      Alert.alert(
        t("addPlant.galleryError"),
        t("addPlant.unableToOpenTheGallery")
      );

    }
  }


  // ===================================================
  // REMOVE PHOTO
  // ===================================================

  function handleRemovePhoto(index) {

    setAdditionalPhotos((current) =>
      current.filter(
        (_, photoIndex) =>
          photoIndex !== index
      )
    );

  }

  function handleRemoveGuidedPhoto(photoKey) {
    setGuidedPhotos((current) => ({
      ...current,
      [photoKey]: null,
    }));
  }


  // ===================================================
  // Species photos and requests are independent of plant registration.
  // ===================================================

async function handleTakeSpeciesPhoto() {
  try {
    const { status } =
      await ImagePicker.requestCameraPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        t("addPlant.permissionRequired"),
        t("addPlant.cameraPermissionIsRequiredToTakeASpeciesPhoto")
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const accepted = await checkedPhotos(result.assets, [t("imageSizeAlert.speciesPhoto")]);
      if (accepted.length) setSpeciesImages([accepted[0].uri]);
    }
  } catch (error) {
    console.log("Species camera error:", error);
    Alert.alert(t("addPlant.cameraError"), t("addPlant.unableToOpenTheCamera"));
  }
}

async function handlePickSpeciesPhoto() {
  try {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        t("addPlant.permissionRequired"),
        t("addPlant.galleryPermissionIsRequiredToSelectSpeciesPhotos")
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const accepted = await checkedPhotos(result.assets, [t("imageSizeAlert.speciesPhoto")]);
      if (accepted.length) setSpeciesImages([accepted[0].uri]);
    }
  } catch (error) {
    console.log("Species gallery error:", error);
    Alert.alert(t("addPlant.galleryError"), t("addPlant.unableToOpenTheGallery"));
  }
}

function handleRemoveSpeciesPhoto(index) {
  setSpeciesImages((current) =>
    current.filter((_, imageIndex) => imageIndex !== index)
  );
}


  // One final action saves the species (when proposed), plant, photos and QR assignment.
  async function saveLocalDraft() {
    if (draftSaving || submitting || submittedQr || !recoveryResolved || draftEndedRef.current || !hasMeaningfulDraft) return;
    setDraftSaving(true); setDraftError(""); setDraftMessage("");
    try {
      if (!botanist?.id) throw Error(t("botanistDrafts.ownerRequired"));
      const draft = await saveBotanistFormDraft(botanist.id, buildDraftInput(false));
      restoredDraftRef.current = draft;
      await autosave.stop();
      Alert.alert(t("botanistDrafts.savedStatus"), t("botanistDrafts.saved"), [{
        text: t("common.ok"),
        onPress: () => navigation.navigate("BotanistMyDrafts", { botanist, openDraftKey: draft.client_key }),
      }]);
    } catch (error) { setDraftError(translateUIMessage(error.message) || t("botanistDrafts.saveFailed")); }
    finally { setDraftSaving(false); }
  }

  function selectSpeciesForPlant(species) {
    setSelectedSpecies(species);
    setSpeciesSearch(species.scientificName);
    setShowSpeciesForm(false);
    setShowSpeciesPicker(false);
    setSpeciesScientificName(""); setSpeciesCommonName(""); setSpeciesGenus(""); setSpeciesFamily("");
    setSpeciesDescription(""); setSpeciesHabitat(""); setSpeciesImages([]);
  }

  async function openSpeciesCorrection(request) {
    try {
      const draft = await saveBotanistFormDraft(accountId, buildDraftInput(false));
      restoredDraftRef.current = draft;
      await autosave.stop();
      navigation.navigate("EditSpeciesRequest", { botanist, requestId: String(request.request_id), correction: true });
    } catch (error) {
      Alert.alert(t("botanistDrafts.savedStatus"), translateUIMessage(error?.message) || t("botanistDrafts.saveFailed"));
    }
  }

  async function handleSubmitPlant() {
    if (submissionBusyRef.current || submittedQr || !recoveryResolved || draftEndedRef.current) return;
    if (showSpeciesForm && speciesDuplicate?.normalizedName === normalizeSpeciesName(speciesScientificName) &&
        ["approved", "pending", "correction", "pending-private"].includes(speciesDuplicate.type)) {
      formScrollRef.current?.scrollTo({ y: Math.max(0, speciesWarningOffset.current - 24), animated: true });
      Alert.alert(t("addPlantWorkflow.duplicateSubmissionBlocked"), t("addPlantWorkflow.duplicateSubmissionBlockedMessage"));
      return;
    }
    const speciesData = showSpeciesForm ? {
      scientific_name: speciesScientificName.trim(), common_name: speciesCommonName.trim(),
      genus_name: speciesGenus.trim(), family_name: speciesFamily.trim(),
      conservation_status: speciesConservationStatus.trim(), description: speciesDescription.trim(), habitat: speciesHabitat.trim(),
    } : null;
    if (speciesData) {
      const speciesProblem = validateSpeciesRequest({ ...speciesData, photoUri: speciesImages[0] });
      if (speciesProblem) {
        Alert.alert(t("addObservation.missingInformation"), t(`addPlantWorkflow.${speciesProblem}`));
        return;
      }
    }
    if (plantScientificName.trim().length > 200 || description.trim().length > 4000 || morphology.trim().length > 4000) {
      Alert.alert(t("addObservation.textTooLong"), t("addPlant.namesMustBe200CharactersOrFewerDescriptionsAndNotes"));
      return;
    }

    const problem = validatePlantDetails({ species: selectedSpecies, newSpecies: showSpeciesForm, plantScientificName, height, healthStatus, growthStage, morphology });
    if (problem) {
      Alert.alert(t("addObservation.missingInformation"), t(`addPlantWorkflow.${problem}`));
      return;
    }
    if (!selectedQRCode) {
      Alert.alert(t("addPlant.selectAQrCode"), t("addPlant.generateAndPrintAQrCodeFirstThenSelectIt"));
      return;
    }
    const gpsProblem = validatePlantGps(latitude, longitude);
    if (gpsProblem) {
      Alert.alert(t("addPlant.missingLocation"), t(`addPlantWorkflow.${gpsProblem}`));
      return;
    }
    if (!Number.isFinite(Number(height)) || Number(height) <= 0) {
      Alert.alert(t("addPlant.missingHeight"), t("addPlant.enterAPlantHeightGreaterThanZeroCentimetres"));
      return;
    }
    if (!growthStage.trim() || !morphology.trim()) {
      Alert.alert(t("addObservation.missingInformation"), t("addPlant.enterTheGrowthStageAndMorphology"));
      return;
    }
    if (completedRequiredPhotos !== REQUIRED_PHOTO_KEYS.length) {
      Alert.alert(t("addPlant.missingRequiredPhotos"), t("addPlant.captureTheWholePlantLeafCloseUpAndStemBark"));
      return;
    }

    submissionBusyRef.current = true;
    setSubmitting(true);
    try {
      const currentInventory = await plantApi(`/qr-codes?qr_id=${encodeURIComponent(String(selectedQRCode.qr_id))}`, { expectedAccountId: accountId });
      const availableQr = currentInventory?.qr_codes?.some((code) =>
        String(code.qr_id) === String(selectedQRCode.qr_id) &&
        code.qr_code === selectedQRCode.qr_code && code.status === "generated" && code.plant_id == null);
      if (!availableQr) throw Error(t("addPlant.scannedQrUnavailable"));
      const latitudeValue = Number(latitude);
      const longitudeValue = Number(longitude);
      const accuracyValue = gpsAccuracy.trim() ? Number(gpsAccuracy) : undefined;
      const content = {
        heightCm: Number(height),
        healthStatus: healthStatus.trim(),
        lifeStage: growthStage.trim(),
        morphology: morphology.trim(),
        notes: description.trim(),
        latitude: latitudeValue,
        longitude: longitudeValue,
        ...(accuracyValue === undefined ? {} : { accuracy_m: accuracyValue }),
        // category: category.trim(),
        ...(zone.trim() ? { zone: zone.trim() } : {}),
        ...(altitude.trim() ? { altitudeM: Number(altitude) } : {}),
      };

      const photoUris = [
        ...["wholePlant", "leafCloseUp", "stemBark", "flowerFruit"].map((key) => ({ uri: guidedPhotos[key], label: guidedPhotoLabel(key) })),
        ...additionalPhotos.map((uri, index) => ({ uri, label: `${t("addPlant.additionalPhotos")} ${index + 1}` })),
      ].filter((item) => item.uri);
      const photos = [];
      const oversizedPhotos = [];
      for (const { uri, label } of photoUris) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (base64Bytes(base64) > MAX_IMAGE_BYTES) { oversizedPhotos.push({ label, bytes: base64Bytes(base64) }); continue; }
        const contentType = /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg";
        photos.push({ content_type: contentType, base64 });
      }
      if (oversizedPhotos.length) { const error = Error("Image too large"); error.imageAlert = imageSizeAlert(t, oversizedPhotos); throw error; }
      let newSpecies;
      if (speciesData) {
        const uri = speciesImages[0];
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        if (base64Bytes(base64) > MAX_IMAGE_BYTES) { const error = Error("Image too large"); error.imageAlert = imageSizeAlert(t, [{ label: t("imageSizeAlert.speciesPhoto"), bytes: base64Bytes(base64) }]); throw error; }
        newSpecies = { ...speciesData, photo: { base64, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" } };
      }
      const created = await plantApi("/plant-submissions", {
        method: "POST",
        body: {
          ...(newSpecies ? { new_species: newSpecies } : selectedSpecies.source === "pending"
            ? { species_request_id: Number(selectedSpecies.requestId) } : { species_id: Number(selectedSpecies.id) }),
          scientific_name: plantScientificName.trim(), latitude: latitudeValue, longitude: longitudeValue,
          ...(accuracyValue === undefined ? {} : { accuracy_m: accuracyValue }),
          content, photos, client_key: clientKeyRef.current, qr_id: selectedQRCode.qr_id,
        },
      });
      const plantId = String(created.plant_id ?? "");
      if (!/^\d+$/.test(plantId) || !created.qr_token) throw Error(t("addPlantWorkflow.invalidCombinedResponse"));
      draftEndedRef.current = true;
      await autosave.stop();
      await stopBotanistDraftAutosave(accountId, activeFormDraftKey);
      try {
        const removed = await deleteBotanistFormDraft(botanist.id, activeFormDraftKey, restoredDraftRef.current?.saved_at);
        if (!removed) setDraftError(t("botanistDrafts.newerDraftKept"));
        else restoredDraftRef.current = null;
      } catch { setDraftError(t("botanistDrafts.cleanupFailed")); }
      setSubmittedQr({ plantId, token: created.qr_token });
      onSubmitted();
      clientKeyRef.current = createPlantClientKey();
      Alert.alert(
        t("addPlant.plantSubmitted"),
        t(newSpecies ? "addPlantWorkflow.combinedSaved" : "addPlant.plantAndItsPhotosWereSavedTheQrCodeIs", { plantId }),
        [{ text: t("common.ok"), onPress: () => navigation.navigate("BotanistSubmissions", {
          botanist, openTarget: { kind: "plant", recordId: plantId },
        }) }],
      );
    } catch (error) {
      await autosave.flush().catch(() => {});
      if (error?.imageAlert) { Alert.alert(error.imageAlert.title, error.imageAlert.message); return; }
      if (error?.duplicateType) {
        let match = error.speciesId ? speciesCatalog.find((row) => String(row.id) === String(error.speciesId)) :
          error.duplicateType === "approved" ? speciesCatalog.find((row) => normalizeSpeciesName(row.scientificName) === normalizeSpeciesName(speciesScientificName)) :
          error.requestId ? speciesCatalog.find((row) => String(row.requestId) === String(error.requestId)) : null;
        if (error.duplicateType === "approved" && error.speciesId && !match) {
          try { match = await fetchSpeciesDetail(error.speciesId, undefined, { accountId }); } catch { /* Keep the authoritative conflict; the catalog may be unavailable. */ }
        }
        let request = match?.requestId ? { request_id: match.requestId, request_status: match.requestStatus,
          requested_by: `staff:${accountId}`, scientific_name: match.scientificName, common_name: match.commonName, family_name: match.family } : null;
        if (error.requestId && !request) {
          try {
            const response = await plantApi(`/species-requests/${encodeURIComponent(error.requestId)}`, { expectedAccountId: accountId });
            const candidate = response?.species_request;
            if (String(candidate?.request_id) === String(error.requestId) && candidate.requested_by === `staff:${accountId}` &&
                ["Pending Review", "Correction Required"].includes(candidate.request_status)) request = candidate;
          } catch { /* Never expose or infer another owner's request from a duplicate response. */ }
        }
        setSpeciesDuplicate({
          type: error.duplicateType === "approved" ? "approved" : error.duplicateType === "correction_required" ? (request ? "correction" : "unavailable") : request ? "pending" : "pending-private",
          normalizedName: normalizeSpeciesName(speciesScientificName),
          ...(match?.id && error.duplicateType === "approved" ? { species: match } : {}),
          ...(request && error.duplicateType !== "approved" ? { request } : {}),
        });
        formScrollRef.current?.scrollTo({ y: Math.max(0, speciesWarningOffset.current - 24), animated: true });
        return;
      }
      Alert.alert(
        t("addPlant.submissionFailed"),
        error instanceof Error ? translateUIMessage(error.message) : t("addPlant.thePlantCouldNotBeSavedCheckYourConnectionAnd")
      );
    } finally {
      submissionBusyRef.current = false;
      setSubmitting(false);
    }
  }


  // ===================================================
  // CANCEL
  // ===================================================

  function handleCancel() {

    Alert.alert(
      t("common.cancel"),
      t("addPlant.areYouSureYouWantToLeaveYourEnteredInformation"),
      [
        {
          text: t("addPlant.stay"),
          style: "cancel",
        },

        {
          text: t("addPlant.leave"),
          style: "destructive",

          onPress: () =>
            navigation.goBack(),
        },
      ]
    );
  }


  // ===================================================
  // UI
  // ===================================================

  return (

    <View style={styles.container}>

      {/* =================================================
          SCROLL FORM
      ================================================= */}

      <DiscoverableScrollView scrollEnabled={!mapInteracting} ref={formScrollRef}
        style={styles.scrollView}
        contentContainerStyle={
          styles.scrollContent
        }
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator
      >


        {/* =================================================
            PLANT INFORMATION
        ================================================= */}

        <View style={styles.card}>

          <View style={styles.plantHeadingRow}>
            <Text style={[styles.sectionTitle, styles.plantHeadingTitle]}>{t("addPlant.plantInformation")}</Text>
            {!showSpeciesForm && <RefreshButton
              onPress={loadSpeciesCatalog}
              loading={loadingSpeciesCatalog}
              label={t("addPlantWorkflow.refreshSpecies")}
              testID="add-plant-species-refresh"
            />}
          </View>

          {/* ---------------------------------------------
              Category
          --------------------------------------------- */}

          {!showSpeciesForm && (

          <>
            {/* Plant category selection is retained for future use.
            <Text style={styles.label}>
              Plant Category *
            </Text>

            <View style={styles.categoryContainer}>

              {[
                "Trees",
                "Flowers",
                "Ferns",
                "Climbers",
              ].map((item) => (

                <TouchableOpacity
                  key={item}
                  style={[
                    styles.categoryOption,

                    category === item &&
                      styles.categoryOptionSelected,
                  ]}
                  onPress={() =>
                    setCategory(
                      category === item ? "" : item
                    )
                  }
                  activeOpacity={0.8}
                >

                  <Text
                    style={[
                      styles.categoryOptionText,

                      category === item &&
                        styles.categoryOptionTextSelected,
                    ]}
                  >
                    {item}
                  </Text>

                </TouchableOpacity>

              ))}

            </View>
            */}

            <Text style={styles.label}>{t("addPlantWorkflow.selectExistingSpecies")}</Text>
            <Text style={styles.speciesPickerHint}>{t("addPlant.chooseASpeciesThatIsAlreadyAvailableToYourAccount")}</Text>
              <TextInput
                style={styles.input}
                value={speciesSearch}
                onFocus={() => setShowSpeciesPicker(true)}
                onChangeText={(value) => {
                  setSpeciesSearch(value);
                  setSelectedSpecies(null);
                  setShowSpeciesPicker(true);
                }}
                placeholder={loadingSpeciesCatalog ? t("addPlant.loadingDatabaseSpecies") : t("addPlant.searchByScientificOrCommonName")}
                placeholderTextColor="#9AA7A0"
                editable={!loadingSpeciesCatalog}
                accessibilityLabel={t("addPlant.searchSpeciesInTheDatabase")}
              />

            {!!speciesCatalogError && (
              <View style={styles.speciesPickerMessage}>
                <Text style={styles.speciesPickerError}>{translateUIMessage(speciesCatalogError)}</Text>
                <TouchableOpacity onPress={loadSpeciesCatalog} activeOpacity={0.8}>
                  <Text style={styles.speciesPickerRetry}>{t("addPlant.retryLoadingSpecies")}</Text>
                </TouchableOpacity>
              </View>
            )}
            {pendingSpeciesError && (
              <View style={styles.speciesPickerMessage}>
                <Text style={styles.speciesPickerError}>{t("addPlantWorkflow.pendingUnavailable")}</Text>
                <TouchableOpacity onPress={loadSpeciesCatalog} activeOpacity={0.8}>
                  <Text style={styles.speciesPickerRetry}>{t("addPlant.retryLoadingSpecies")}</Text>
                </TouchableOpacity>
              </View>
            )}

            {showSpeciesPicker && !loadingSpeciesCatalog && !speciesCatalogError && (
              <DiscoverableScrollView nested hintKey="scrollHints.speciesList" style={[styles.speciesPickerList, { maxHeight: Math.min(280, Math.max(220, screenHeight * 0.32)) }]}
                nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
                {filteredSpecies.length ? (
                  filteredSpecies.map((species, index) => (
                    <React.Fragment key={species.id}>
                    {(index === 0 || filteredSpecies[index - 1].source !== species.source) && (
                      <Text style={styles.speciesPickerGroup}>{t(species.source === "pending"
                        ? "addPlantWorkflow.myPendingSpeciesRequests" : "addPlantWorkflow.approvedSpecies")}</Text>
                    )}
                    <TouchableOpacity
                      style={styles.speciesPickerOption}
                      onPress={() => {
                        setSelectedSpecies(species);
                        setSpeciesSearch(species.scientificName);
                        setShowSpeciesPicker(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.speciesPickerTitleRow}>
                        <Text style={styles.speciesPickerScientific} numberOfLines={1}>{species.scientificName}</Text>
                        <Text style={[styles.speciesPickerBadge, species.source === "pending" && styles.speciesPickerBadgePending]}>
                          {t(species.source === "pending" ? "common.pendingReview" : "addPlantWorkflow.approvedBadge")}
                        </Text>
                      </View>
                      <Text style={styles.speciesPickerCommon}>
                        {species.name}{species.family ? t("addPlant.label", { family: species.family }) : ""}
                      </Text>
                    </TouchableOpacity>
                    </React.Fragment>
                  ))
                ) : (
                  <Text style={styles.speciesPickerEmpty}>{t("addPlant.noMatchingSpeciesInTheDatabaseAskAConservationOfficer")}</Text>
                )}
              </DiscoverableScrollView>
            )}

            {selectedSpecies && (
              <View style={styles.selectedSpeciesCard}>
                <Text style={styles.selectedSpeciesName}>{selectedSpecies.scientificName}</Text>
                <Text style={styles.speciesPickerCommon}>
                  {selectedSpecies.name}{selectedSpecies.family ? t("addPlant.label", { family: selectedSpecies.family }) : ""}
                </Text>
                <Text style={[styles.speciesPickerBadge, selectedSpecies.source === "pending" && styles.speciesPickerBadgePending]}>
                  {t(selectedSpecies.source === "pending" ? "common.pendingReview" : "addPlantWorkflow.approvedBadge")}
                </Text>
              </View>
            )}
          {/* =================================================
              NEW SPECIES REQUEST
          ================================================= */}

          <View
            style={styles.speciesDivider}
          />


          <Text
            style={styles.speciesQuestion}
          >{t("addPlant.canTFindThisSpecies")}</Text>


          <Text
            style={
              styles.speciesQuestionDescription
            }
          >{t("addPlant.requestANewSpeciesToBeAddedToTheSystem")}</Text>


          <TouchableOpacity
            style={styles.requestSpeciesButton}
            disabled={submitting || Boolean(submittedQr)}
            onPress={() => {
              setShowSpeciesPicker(false);
              setShowSpeciesForm(true);

            }}
            activeOpacity={0.8}
          >
            <Text style={styles.requestSpeciesButtonText}>{t("addPlantWorkflow.requestNewSpecies")}</Text>
          </TouchableOpacity>
          </>
          )}

          {/* =================================================
              INLINE SPECIES REQUEST FORM
          ================================================= */}

          {showSpeciesForm && (

            <View
              style={
                styles.speciesRequestCard
              }
              onLayout={(event) => { speciesWarningOffset.current = event.nativeEvent.layout.y; }}
            >

              <Text
                style={
                  styles.speciesRequestTitle
                }
              >{t("addPlant.newSpeciesInformation")}</Text>


              <Text
                style={
                  styles.speciesRequestSubtitle
                }
              >{t("addPlant.enterInformationAboutTheSpeciesThatIsNotCurrentlyAvailable")}</Text>

              {/* -------------------------------------------
                  Species Scientific Name
              ------------------------------------------- */}

              <Text style={styles.label}>{t("addPlant.scientificName")}</Text>

              <TextInput
                editable={!submitting}
                style={styles.input}
                value={
                  speciesScientificName
                }
                onChangeText={
                  setSpeciesScientificName
                }
                placeholder={t("addPlant.eGNepenthesMirabilis")}
                placeholderTextColor="#9AA7A0"
              />

              {checkingSpeciesDuplicate && <Text style={styles.speciesDuplicateChecking}>{t("addPlantWorkflow.checkingDuplicate")}</Text>}
              {speciesDuplicate?.type === "unavailable" && <Text style={styles.speciesDuplicateChecking}>{t("addPlantWorkflow.duplicateCheckUnavailable")}</Text>}
              {speciesDuplicate?.type === "approved" && speciesDuplicate.species && (
                <View style={styles.speciesDuplicateCard}>
                  <View style={styles.approvedDuplicateHeading}>
                    <Ionicons name="alert-circle-outline" size={17} color="#795514" />
                    <Text style={styles.speciesDuplicateTitle}>{t("addPlantWorkflow.speciesAlreadyExists")}</Text>
                  </View>
                  <Text style={styles.speciesDuplicateMessage}>{t("addPlantWorkflow.approvedDuplicateMessage")}</Text>
                  <View style={styles.approvedSpeciesInfoCard}>
                    <View style={styles.approvedSpeciesInfoTop}>
                      <Text style={styles.approvedSpeciesName} numberOfLines={2}>{speciesDuplicate.species.scientificName}</Text>
                      <Text style={styles.approvedSpeciesBadge}>{t("addPlantWorkflow.approvedBadge")}</Text>
                    </View>
                    <Text style={styles.approvedSpeciesDetails}>{speciesDuplicate.species.name}{speciesDuplicate.species.family ? ` · ${speciesDuplicate.species.family}` : ""}</Text>
                  </View>
                  <TouchableOpacity style={styles.approvedSpeciesAction} onPress={() => selectSpeciesForPlant({ ...speciesDuplicate.species, source: "approved" })}
                    activeOpacity={0.8} accessibilityRole="button">
                    <Text style={styles.approvedSpeciesActionText}>{t("addPlantWorkflow.selectExistingSpeciesAction")}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#20583D" />
                  </TouchableOpacity>
                </View>
              )}
              {speciesDuplicate?.type === "approved" && !speciesDuplicate.species && (
                <View style={styles.speciesDuplicateCard}>
                  <Text style={styles.speciesDuplicateTitle}>{t("addPlantWorkflow.speciesAlreadyExists")}</Text>
                  <Text style={styles.speciesDuplicateMessage}>{t("addPlantWorkflow.approvedDuplicateMessage")}</Text>
                </View>
              )}
              {speciesDuplicate?.type === "pending" && (
                <View style={styles.speciesDuplicateCard}>
                  <View style={styles.approvedDuplicateHeading}>
                    <Ionicons name="alert-circle-outline" size={17} color="#795514" />
                    <Text style={styles.speciesDuplicateTitle}>{t("addPlantWorkflow.speciesRequestAlreadyPending")}</Text>
                  </View>
                  <Text style={styles.speciesDuplicateMessage}>{t("addPlantWorkflow.pendingDuplicateMessage")}</Text>
                  <View style={styles.approvedSpeciesInfoCard}>
                    <View style={styles.approvedSpeciesInfoTop}>
                      <Text style={styles.approvedSpeciesName} numberOfLines={2}>{speciesDuplicate.request.scientific_name}</Text>
                      <Text style={styles.pendingSpeciesBadge}>{translateLabel(speciesDuplicate.request.request_status)}</Text>
                    </View>
                    <Text style={styles.approvedSpeciesDetails}>{t("addPlantWorkflow.requestReference", { id: speciesDuplicate.request.request_id })}</Text>
                  </View>
                  <TouchableOpacity style={styles.approvedSpeciesAction} activeOpacity={0.8} accessibilityRole="button" onPress={() => selectSpeciesForPlant({
                    id: `request:${speciesDuplicate.request.request_id}`, source: "pending", requestId: speciesDuplicate.request.request_id,
                    scientificName: speciesDuplicate.request.scientific_name, name: speciesDuplicate.request.common_name || "",
                    family: speciesDuplicate.request.family_name || "",
                  })}>
                    <Text style={styles.approvedSpeciesActionText}>{t("addPlantWorkflow.usePendingSpecies")}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#20583D" />
                  </TouchableOpacity>
                </View>
              )}
              {speciesDuplicate?.type === "pending-private" && (
                <View style={styles.speciesDuplicateCard}>
                  <Text style={styles.speciesDuplicateTitle}>{t("addPlantWorkflow.speciesRequestAlreadyPending")}</Text>
                  <Text style={styles.speciesDuplicateMessage}>{t("addPlantWorkflow.duplicatePendingUnavailable")}</Text>
                </View>
              )}
              {speciesDuplicate?.type === "correction" && (
                <View style={styles.speciesDuplicateCard}>
                  <Text style={styles.speciesDuplicateTitle}>{t("addPlantWorkflow.speciesRequestRequiresCorrection")}</Text>
                  <Text style={styles.speciesDuplicateMessage}>{t("addPlantWorkflow.correctionDuplicateMessage")}</Text>
                  <Text style={styles.speciesDuplicateDetails}>{t("addPlantWorkflow.requestReference", { id: speciesDuplicate.request.request_id })} · {translateLabel("Correction Required")}</Text>
                  <TouchableOpacity style={styles.speciesDuplicateAction} onPress={() => openSpeciesCorrection(speciesDuplicate.request)}>
                    <Text style={styles.speciesDuplicateActionText}>{t("addPlantWorkflow.viewCorrectSpeciesRequest")}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!(speciesDuplicate?.normalizedName === normalizeSpeciesName(speciesScientificName) &&
                ["approved", "pending", "correction"].includes(speciesDuplicate.type)) && <>

              {/* -------------------------------------------
                  Species Common Name
              ------------------------------------------- */}

              <Text style={styles.label}>{t("addPlant.commonName")}</Text>

              <TextInput
                editable={!submitting}
                style={styles.input}
                value={
                  speciesCommonName
                }
                onChangeText={
                  setSpeciesCommonName
                }
                placeholder={t("addPlant.eGSwampPitcherPlant")}
                placeholderTextColor="#9AA7A0"
              />

              {/* Species Genus */}

              <Text style={styles.label}>{t("addPlant.genus")}</Text>

              <TextInput
                editable={!submitting}
                style={styles.input}
                value={speciesGenus}
                onChangeText={setSpeciesGenus}
                placeholder={t("addPlant.eGNepenthes")}
                placeholderTextColor="#9AA7A0"
              />


              {/* -------------------------------------------
                  Species Family
              ------------------------------------------- */}

              <Text style={styles.label}>{t("addPlant.family")}</Text>

              <TextInput
                editable={!submitting}
                style={styles.input}
                value={
                  speciesFamily
                }
                onChangeText={
                  setSpeciesFamily
                }
                placeholder={t("addPlant.eGNepenthaceae")}
                placeholderTextColor="#9AA7A0"
              />

              
              <Text style={styles.label}>{t("addPlant.conservationStatus")} *</Text>

              <TouchableOpacity
                style={styles.qrSelector}
                disabled={submitting}
                onPress={() =>
                  setShowConservationDropdown((current) => !current)
                }
                activeOpacity={0.8}
              >
                <Text style={styles.qrSelectedText}>
                  {translateLabel(speciesConservationStatus)}
                </Text>

                <Text style={styles.dropdownArrow}>
                  {showConservationDropdown ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>

              {showConservationDropdown && (
                <View style={styles.qrDropdown}>
                  {CONSERVATION_STATUSES.map((status) => (
                    <TouchableOpacity
                      key={status}
                      style={styles.qrOption}
                      onPress={() => {
                        setSpeciesConservationStatus(status);
                        setShowConservationDropdown(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.qrOptionText}>
                        {translateLabel(status)}
                      </Text>

                      <Text style={styles.dropdownArrow}>
                        {speciesConservationStatus === status ? "✓" : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}



              
              {/* Species Description */}

              <Text style={styles.label}>{t("addPlant.description")} *</Text>

              <TextInput
                editable={!submitting}
                style={styles.textArea}
                value={speciesDescription}
                onChangeText={setSpeciesDescription}
                placeholder={t("addPlant.describeTheSpeciesAndItsIdentifyingFeatures")}
                placeholderTextColor="#9AA7A0"
                multiline
                textAlignVertical="top"
              />

              {/* Habitat / Ecological Information */}

              <Text style={styles.label}>{t("addPlant.habitatEcologicalInformation")} *</Text>

              <TextInput
                editable={!submitting}
                style={styles.textArea}
                value={speciesHabitat}
                onChangeText={setSpeciesHabitat}
                placeholder={t("addPlant.describeItsNaturalHabitatGrowingConditionsAndEcologicalRole")}
                placeholderTextColor="#9AA7A0"
                multiline
                textAlignVertical="top"
              />

              
              {/* Species Photos */}

              <Text style={styles.label}>{t("addPlant.speciesPhotos")} *</Text>

              <View style={styles.photoButtonRow}>
                <TouchableOpacity
                  style={styles.photoButton}
                  disabled={submitting}
                  onPress={handleTakeSpeciesPhoto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.photoButtonText}>{t("addPlant.camera")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.photoButton}
                  disabled={submitting}
                  onPress={handlePickSpeciesPhoto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.photoButtonText}>{t("addPlant.gallery")}</Text>
                </TouchableOpacity>
              </View>

              {speciesImages.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  style={styles.speciesPhotoScroll}
                  contentContainerStyle={styles.speciesPhotoRow}
                >
                  {speciesImages.map((photo, index) => (
                    <View
                      key={`${photo}-${index}`}
                      style={styles.speciesPhotoItem}
                    >
                      <PreviewableImage
                        source={{ uri: photo }}
                        style={styles.speciesPhotoPreview}
                        resizeMode="cover"
                      />

                      <TouchableOpacity
                        style={styles.removeSpeciesPhotoButton}
                        disabled={submitting}
                        onPress={() => confirmPhotoRemoval(t, () => handleRemoveSpeciesPhoto(index))}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={t("recordEdits.removePhoto")}
                      >
                        <Ionicons name="trash-outline" size={21} color="#B42318" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              </>}




              {/* -------------------------------------------
                  ADD SPECIES REQUEST
              ------------------------------------------- */}

              <TouchableOpacity style={styles.cancelButton} disabled={submitting}
                accessibilityLabel={t("addPlantWorkflow.cancelSpeciesRequest")}
                onPress={() => setShowSpeciesForm(false)} activeOpacity={0.8}>
                <Text style={styles.cancelButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>

            </View>

          )}

          <View
            style={styles.speciesDivider}
          />


          {/* =================================================
              SPECIES REQUEST SUMMARY
          ================================================= */}

            <SpeciesDictionary reviewPresentation="modal" fields={{
              plantScientificName: { value: plantScientificName, setValue: setPlantScientificName, label: t("addPlantWorkflow.plantScientificName") },
              ...(showSpeciesForm ? {
                speciesScientificName: { value: speciesScientificName, setValue: setSpeciesScientificName, label: t("addPlant.scientificName") },
                speciesCommonName: { value: speciesCommonName, setValue: setSpeciesCommonName, label: t("addPlant.commonName") },
                speciesGenus: { value: speciesGenus, setValue: setSpeciesGenus, label: t("addPlant.genus") },
                speciesFamily: { value: speciesFamily, setValue: setSpeciesFamily, label: t("addPlant.family") },
              } : {}),
            }} />

            <Text style={styles.label}>{t("addPlantWorkflow.plantScientificName")}</Text>
            <TextInput style={styles.input} value={plantScientificName}
              onChangeText={setPlantScientificName} accessibilityLabel={t("addPlantWorkflow.plantScientificName")}
              placeholder={t("addPlantWorkflow.scientificNameHint")} placeholderTextColor="#9AA7A0" />
            <Text style={styles.speciesPickerHint}>{t("addPlantWorkflow.scientificNameHint")}</Text>

          {/* Height */}

          <Text style={styles.label}>{t("addPlant.heightCm")} *</Text>

          <TextInput
            style={styles.input}
            value={height}
            onChangeText={setHeight}
            placeholder="e.g. 80"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          {/* Health Status */}

          <Text style={styles.label}>{t("addPlant.healthStatus")}</Text>

          <TextInput
            style={styles.input}
            value={healthStatus}
            onChangeText={setHealthStatus}
            placeholder={t("addPlant.eGHealthyMonitoringPoor")}
            placeholderTextColor="#9AA7A0"
          />

          {/* Growth Stage */}

          <Text style={styles.label}>{t("addPlant.growthStage")}</Text>

          <TextInput
            style={styles.input}
            value={growthStage}
            onChangeText={setGrowthStage}
            placeholder={t("addPlant.eGSeedlingJuvenileMatureFlowering")}
            placeholderTextColor="#9AA7A0"
          />

          {/* Morphology */}

          <Text style={styles.label}>{t("addPlant.morphology")}</Text>

          <TextInput
            style={styles.textArea}
            value={morphology}
            onChangeText={setMorphology}
            placeholder={t("addPlant.describeThePlantSPhysicalCharacteristics")}
            placeholderTextColor="#9AA7A0"
            multiline
            textAlignVertical="top"
          />

          {/* Location Zone */}

          <Text style={styles.label}>{t("addPlant.locationZone")}</Text>

          <TextInput
            style={styles.input}
            value={zone}
            onChangeText={setZone}
            placeholder={t("addPlant.eGZoneA")}
            placeholderTextColor="#9AA7A0"
          />


          

        </View>


        {/* =================================================
            ADDITIONAL PLANT INFORMATION
        ================================================= */}

        <View style={styles.card}>

          <Text style={styles.sectionTitle}>{t("addPlant.staffRecord")}</Text>

          <Text style={styles.sectionDescription}>{t("addPlant.recordTheGpsInformationTheBackendAssignsAUniqueQr")}</Text>

          
        {/* =================================================
            LOCATION
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >{t("addPlant.gpsInformation")}</Text>


          <Text
            style={styles.sectionDescription}
          >{t("addPlant.useYourCurrentGpsLocationToRecordWhereThisPlant")}</Text>


          {[
            ["latitude", t("addPlant.latitude"), latitude, setLatitude],
            ["longitude", t("addPlant.longitude"), longitude, setLongitude],
            ["altitude", t("addPlant.altitudeM"), altitude, setAltitude],
            ["accuracy", t("addPlant.gpsAccuracyM"), gpsAccuracy, setGpsAccuracy],
          ].map(([key, label, value, setter]) => <View key={key}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              style={styles.input} accessibilityLabel={label} value={value}
              onFocus={() => setGpsEditing(true)} onBlur={() => setGpsEditing(false)}
              onChangeText={setter}
              placeholder={t("gpsPicker.notAvailable")} placeholderTextColor="#9AA7A0" keyboardType="decimal-pad" />
          </View>)}
          {validGpsPoint({ latitude, longitude }) && <GpsLocationPicker key={gpsRevision}
            location={{ latitude, longitude }} inputActive={gpsEditing} onInteractionChange={setMapInteracting}
            onChange={(point) => { setLatitude(point.latitude); setLongitude(point.longitude); setGpsAccuracy(""); }} />}

          <TouchableOpacity
            style={
              styles.locationButton
            }
            onPress={
              handleGetLocation
            }
            disabled={
              loadingLocation
            }
            activeOpacity={0.8}
          >

            {loadingLocation ? (

              <ActivityIndicator
                color="#FFFFFF"
              />

            ) : (

              <Text
                style={
                  styles.locationButtonText
                }
              >{t("addPlant.getCurrentLocation")}</Text>

            )}

          </TouchableOpacity>

          

        </View>

         {/* =================================================
            QR CODE
        ================================================= */}

        <View style={styles.card}>
          <View style={styles.qrHeadingRow}>
            <Text style={[styles.sectionTitle, styles.qrHeadingTitle]}>{t("navigation.plantQrCode")} *</Text>
            <TouchableOpacity
              style={styles.qrRefreshButton}
              onPress={loadAvailableQRCodes}
              disabled={loadingQRCodes || generatingQR || submitting}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={t("addPlant.refreshQrInventory")}
              accessibilityState={{ disabled: loadingQRCodes || generatingQR || submitting, busy: loadingQRCodes }}
              testID="add-plant-qr-refresh"
            >
              {loadingQRCodes ? <ActivityIndicator size="small" color="#397C69" />
                : <Ionicons name="refresh-outline" size={20} color="#397C69" />}
            </TouchableOpacity>
          </View>
          <Text style={styles.sectionDescription}>{t("addPlant.chooseAQrCodeYouGeneratedAndPrintedBeforeThe")}</Text>
          {!submittedQr && (
            <>
              <TouchableOpacity
                style={styles.qrSelector}
                onPress={() => setShowQRDropdown((open) => !open)}
                disabled={loadingQRCodes || submitting}
                activeOpacity={0.8}
              >
                <Text style={selectedQRCode ? styles.qrSelectedText : styles.qrPlaceholder}>
                  {loadingQRCodes
                    ? t("addPlant.loadingUnusedQrCodes")
                    : selectedQRCode
                      ? t("addPlant.selected", { value0: qrLabel(selectedQRCode.qr_id) })
                      : t("addPlant.selectAPreprintedQrCode")}
                </Text>
                <Ionicons
                  name={showQRDropdown ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={styles.dropdownArrow.color}
                />
              </TouchableOpacity>

              {selectedQrId != null && unavailableQr === selectedQrId &&
                <Text accessibilityRole="alert" style={styles.noQRText}>{t("addPlant.scannedQrUnavailable")}</Text>}
              {showQRDropdown && (
                <View style={styles.qrDropdown}>
                  <DiscoverableScrollView nested hintKey="scrollHints.qrList" style={[styles.qrOptionsList, { maxHeight: Math.min(270, Math.max(240, screenHeight * 0.3)) }]}
                    nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator>
                    {availableQRCodes.length === 0 ? (
                      <Text style={styles.noQRText}>
                        {qrLoadError || t("addPlant.noUnusedCodesGenerateAndPrintOneFromQrCode")}
                      </Text>
                    ) : (
                      availableQRCodes.map((qr) => (
                        <TouchableOpacity
                          key={qr.qr_id}
                          style={styles.qrOption}
                          onPress={() => {
                            setSelectedQRCode(qr);
                            setShowQRDropdown(false);
                          }}
                        >
                          <Text style={styles.qrOptionText}>{qrLabel(qr.qr_id)}</Text>
                          <QRCode value={qr.qr_code} size={44} />
                        </TouchableOpacity>
                      ))
                    )}
                  </DiscoverableScrollView>
                  <TouchableOpacity
                    style={[styles.qrGenerateButton, (generatingQR || submitting) && styles.disabledAction]}
                    onPress={generateQRInForm}
                    disabled={generatingQR || loadingQRCodes || submitting || !accountId}
                    accessibilityRole="button"
                    accessibilityLabel={t("addPlantWorkflow.generateQrCode")}
                    accessibilityState={{ disabled: generatingQR || loadingQRCodes || submitting || !accountId, busy: generatingQR }}
                    testID="add-plant-generate-qr"
                  >
                    {generatingQR ? <ActivityIndicator size="small" color="#20583D" />
                      : <Ionicons name="add" size={17} color="#20583D" />}
                    <Text style={styles.qrGenerateButtonText}>{generatingQR ? t("addPlantWorkflow.generatingQrCode") : t("addPlantWorkflow.generateQrCode")}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!!qrGenerationMessage && <Text accessibilityRole="alert" style={qrGenerationFailed ? styles.qrGenerationError : styles.qrGenerationSuccess}>{qrGenerationMessage}</Text>}
            </>
          )}
          {submittedQr ? (
            <View style={styles.qrResult}>
              <QRCode value={submittedQr.token} size={220} />
              <Text style={styles.qrResultId}>{t("addPlant.plantId")}{submittedQr.plantId}</Text>
              <Text style={styles.qrResultHint}>{t("addPlant.thisIsTheCodeYouSelectedItWillResolveAfter")}</Text>
            </View>
          ) : (
            <Text style={styles.qrPendingText}>
              {selectedQRCode
                ? t("addPlant.thisPrintedCodeWillBeAssignedToThePlantWhen")
                : t("addPlant.selectOneOfYourUnusedPrintedCodesBeforeSubmitting")}
            </Text>
          )}
        </View>
        </View>





        {/* =================================================
            PHOTOS
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >{t("addPlant.plantPhotos")}</Text>


          <Text
            style={styles.sectionDescription}
          >{t("addPlant.captureTheRequiredViewsToSupportPlantIdentificationAndVerification")}</Text>

          <View style={styles.photoProgress}>
            <Text style={styles.photoProgressText}>
              {completedRequiredPhotos}{t("addPlant.of")}{REQUIRED_PHOTO_KEYS.length}{t("addPlant.requiredPhotosCompleted")}</Text>
          </View>

          {PHOTO_GUIDES.map((item) => {
            const photo = guidedPhotos[item.key];

            return (
              <View key={item.key} style={styles.photoGuideCard}>
                <View style={styles.photoGuideHeader}>
                  <Text style={styles.photoGuideTitle}>{translateLabel(item.title)}</Text>
                  <Text
                    style={
                      photo
                        ? styles.photoGuideCompleteBadge
                        : item.required
                          ? styles.photoGuideRequiredBadge
                          : styles.photoGuideOptionalBadge
                    }
                  >
                    {photo ? t("addPlant.captured") : item.required ? t("addPlant.required") : t("addPlant.optional")}
                  </Text>
                </View>

                <Text style={styles.photoGuideDescription}>
                  {translateLabel(item.description)}
                </Text>

                {photo && (
                  <PreviewableImage
                    source={{ uri: photo }}
                    style={styles.guidedPhotoPreview}
                    resizeMode="cover"
                  />
                )}

                <View style={styles.guidedPhotoActions}>
                  <TouchableOpacity
                    style={styles.guidedPhotoActionButton}
                    onPress={() => handleTakeGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.photoButtonText}>
                      {photo ? t("addPlant.retake") : t("addPlant.takePhoto")}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.guidedPhotoActionButton}
                    onPress={() => handlePickGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.photoButtonText}>
                      {photo ? t("addPlant.chooseAnother") : t("addPlant.gallery2")}
                    </Text>
                  </TouchableOpacity>
                </View>

                {photo && (
                  <TouchableOpacity
                    style={styles.removeGuidedPhotoButton}
                    onPress={() => confirmPhotoRemoval(t, () => handleRemoveGuidedPhoto(item.key))}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={t("recordEdits.removePhoto")}
                  >
                    <Ionicons name="trash-outline" size={21} color="#B42318" />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          <View style={styles.additionalPhotosHeader}>
            <Text style={styles.additionalPhotosTitle}>{t("addPlant.additionalPhotos")}</Text>
            <Text style={styles.photoGuideDescription}>{t("addPlant.optionalAddAnyOtherUsefulPlantViews")}</Text>
          </View>


          <View
            style={styles.photoButtonRow}
          >

            <TouchableOpacity
              style={styles.photoButton}
              onPress={
                handleTakePhoto
              }
              activeOpacity={0.8}
            >

              <Text
                style={
                  styles.photoButtonText
                }
              >{t("addPlant.camera")}</Text>

            </TouchableOpacity>


            <TouchableOpacity
              style={styles.photoButton}
              onPress={
                handlePickPhoto
              }
              activeOpacity={0.8}
            >

              <Text
                style={
                  styles.photoButtonText
                }
              >{t("addPlant.gallery")}</Text>

            </TouchableOpacity>

          </View>


          {additionalPhotos.length > 0 && (

            <View
              style={styles.photoList}
            >

              {additionalPhotos.map(
                (photo, index) => (

                  <View
                    key={`${photo}-${index}`}
                    style={
                      styles.photoItem
                    }
                  >

                    <PreviewableImage
                      source={{ uri: photo }}
                      style={styles.additionalPhotoPreview}
                      resizeMode="cover"
                    />

                    <Text
                      style={
                        styles.photoName
                      }
                      numberOfLines={1}
                    >{t("addPlant.photo")}{index + 1}
                    </Text>


                    <TouchableOpacity
                      style={styles.removeAdditionalPhotoButton}
                      accessibilityRole="button"
                      accessibilityLabel={t("recordEdits.removePhoto")}
                      onPress={() => confirmPhotoRemoval(t, () => handleRemovePhoto(index))}
                    >

                      <Ionicons name="trash-outline" size={21} color="#B42318" />

                    </TouchableOpacity>

                  </View>

                )
              )}

            </View>

          )}

        </View>





        {/* =================================================
            FINAL APPROVAL INFORMATION
        ================================================= */}

        <View
          style={
            styles.finalApprovalCard
          }
        >

          <Text
            style={
              styles.finalApprovalTitle
            }
          >{t("addPlant.approvalRequired")}</Text>


          <Text
            style={
              styles.finalApprovalText
            }
          >{t("addPlant.thisPlantRecordWillBeSubmittedForAdministratorApproval")}</Text>



        </View>


        {/* =================================================
            FINAL SUBMIT
        ================================================= */}

        {autoSaveState === "saving" ? <Text style={styles.draftSuccess}>{t("botanistDrafts.autoSaving")}</Text> : null}
        {autoSaveState === "saved" ? <Text style={styles.draftSuccess}>{t("botanistDrafts.autoSaved")}</Text> : null}
        {draftMessage ? <Text style={styles.draftSuccess}>{draftMessage}</Text> : null}
        {draftError ? <Text style={styles.draftError}>{draftError}</Text> : null}
        {autoSaveState === "error" ? <TouchableOpacity onPress={() => { setDraftError(""); void autosave.retry().catch(() => {}); }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button"><Text style={styles.saveDraftText}>{t("common.tryAgain")}</Text></TouchableOpacity> : null}
        <View style={styles.formActionRow}>
          <TouchableOpacity style={[styles.saveDraftButton, (draftSaving || submitting || Boolean(submittedQr)) && styles.disabledAction]} onPress={saveLocalDraft} disabled={draftSaving || submitting || Boolean(submittedQr)} accessibilityRole="button" accessibilityState={{ disabled: draftSaving || submitting || Boolean(submittedQr) }}>
            {draftSaving ? <ActivityIndicator color="#2F6B4F" /> : <Text style={styles.saveDraftText}>{t("botanistDrafts.saveDraft")}</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.submitButton, (submitting || Boolean(submittedQr) || (showSpeciesForm && speciesDuplicate?.normalizedName === normalizeSpeciesName(speciesScientificName) && ["approved", "pending", "correction", "pending-private"].includes(speciesDuplicate.type))) && styles.disabledAction]}
            onPress={handleSubmitPlant}
            disabled={submitting || Boolean(submittedQr)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting || Boolean(submittedQr) || (showSpeciesForm && speciesDuplicate?.normalizedName === normalizeSpeciesName(speciesScientificName) && ["approved", "pending", "correction", "pending-private"].includes(speciesDuplicate.type)) }}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitButtonText}>
                {submittedQr ? t("addPlant.plantSaved") : t("addPlantWorkflow.addPlantRecord")}
              </Text>
            )}
          </TouchableOpacity>
        </View>


        {/* =================================================
            CANCEL
        ================================================= */}

        <TouchableOpacity
          style={
            styles.cancelButton
          }
          onPress={
            handleCancel
          }
          activeOpacity={0.8}
        >

          <Text
            style={
              styles.cancelButtonText
            }
          >{t("common.cancel")}</Text>

        </TouchableOpacity>


      </DiscoverableScrollView>


    </View>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  // ===================================================
  // MAIN
  // ===================================================

  container: fieldFormStyles.container,


  scrollView: fieldFormStyles.scrollView,


  scrollContent: fieldFormStyles.scrollContent,


  // ===================================================
  // CARD
  // ===================================================

  card: fieldFormStyles.card,


  sectionTitle: fieldFormStyles.sectionTitle,


  sectionDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
    marginBottom: 12,
  },


  // ===================================================
  // FORM
  // ===================================================

  label: fieldFormStyles.label,


  input: fieldFormStyles.input,


  textArea: fieldFormStyles.textArea,

  // ===================================================
  // CATEGORY
  // ===================================================

  categoryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },


  categoryOption: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE8D6",
  },


  categoryOptionSelected: {
    backgroundColor: "#468585",
    borderColor: "#468585",
  },


  categoryOptionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#468585",
  },


  categoryOptionTextSelected: {
    color: "#FFFFFF",
  },

  plantHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  plantHeadingTitle: { flex: 1, minWidth: 0, marginBottom: 0 },
  speciesPickerHint: {
    color: "#6D7F75",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 8,
  },

  speciesPickerLoading: {
    marginVertical: 12,
  },

  speciesPickerMessage: {
    padding: 12,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: "#FFF6E8",
  },

  speciesPickerError: {
    color: "#A65335",
    fontSize: 12,
  },

  speciesPickerRetry: {
    color: "#356C5F",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
  },

  speciesPickerList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },

  speciesPickerOption: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2EA",
  },

  speciesPickerScientific: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },

  speciesPickerGroup: {
    paddingHorizontal: 13, paddingTop: 9, paddingBottom: 5,
    color: "#356C5F", fontSize: 12, fontWeight: "700", backgroundColor: "#F3F8F1",
  },
  speciesPickerTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  speciesPickerBadge: {
    color: "#226843", backgroundColor: "#DFF2E4", overflow: "hidden",
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, fontWeight: "700",
  },
  speciesPickerBadgePending: { color: "#8A5712", backgroundColor: "#FFF0CC" },
  speciesDuplicateCard: { marginTop: 7, marginBottom: 9, padding: 10, borderRadius: 9, borderWidth: 1,
    borderColor: "#E7C985", backgroundColor: "#FFF8E8" },
  speciesDuplicateTitle: { color: "#795514", fontSize: 13, fontWeight: "800" },
  speciesDuplicateMessage: { color: "#67573A", fontSize: 12, lineHeight: 17, marginTop: 3 },
  speciesDuplicateName: { color: "#234B3A", fontSize: 13, fontWeight: "700", marginTop: 5 },
  speciesDuplicateDetails: { color: "#6D6658", fontSize: 11, marginTop: 2 },
  speciesDuplicateChecking: { color: "#6D7F75", fontSize: 11, marginTop: 4 },
  speciesDuplicateAction: { alignSelf: "flex-start", marginTop: 7, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 7, backgroundColor: "#DCEED9" },
  speciesDuplicateActionText: { color: "#285840", fontWeight: "700", fontSize: 12 },
  approvedDuplicateHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  approvedSpeciesInfoCard: { marginTop: 9, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, backgroundColor: "#FFFFFF" },
  approvedSpeciesInfoTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  approvedSpeciesName: { flex: 1, color: "#20583D", fontSize: 13, fontWeight: "600" },
  approvedSpeciesDetails: { color: "#6D7F75", fontSize: 11, marginTop: 4 },
  approvedSpeciesBadge: { color: "#226843", backgroundColor: "#DFF2E4", overflow: "hidden",
    borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10, fontWeight: "700" },
  pendingSpeciesBadge: { color: "#8A5712", backgroundColor: "#FFF0CC", overflow: "hidden",
    borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10, fontWeight: "700" },
  approvedSpeciesAction: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, minHeight: 44, marginTop: 8, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#468B67", borderRadius: 11, backgroundColor: "#B7E2C5" },
  approvedSpeciesActionText: { color: "#20583D", fontWeight: "600", fontSize: 13 },

  speciesPickerCommon: {
    color: "#6D7F75",
    fontSize: 12,
    marginTop: 3,
  },

  speciesPickerEmpty: {
    padding: 13,
    color: "#6D7F75",
    fontSize: 12,
    lineHeight: 18,
  },

  selectedSpeciesCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#EAF6E7",
    borderWidth: 1,
    borderColor: "#D5E8D1",
  },

  selectedSpeciesName: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
  },


  // ===================================================
  // SPECIES REQUEST
  // ===================================================

  speciesDivider: {
    height: 1,
    backgroundColor: "#E5ECE2",
    marginTop: 22,
    marginBottom: 18,
  },


  speciesQuestion: {
    fontSize: 15,
    fontWeight: "700",
    color: "#234B3A",
  },


  speciesQuestionDescription: {
    marginTop: 5,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
  },


  requestSpeciesButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#468585",
    backgroundColor: "#F2FAF0",
    alignItems: "center",
    justifyContent: "center",
  },


  requestSpeciesButtonText: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "700",
  },


  speciesRequestCard: {
    marginTop: 15,
    padding: 18,
    backgroundColor: "#F8FBF7",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DCE8D6",
  },


  speciesRequestTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#234B3A",
  },


  speciesRequestSubtitle: {
    marginTop: 5,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
  },


  useSpeciesButton: {
    marginTop: 15,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },


  useSpeciesButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },


  // ===================================================
  // SPECIES REQUEST SUMMARY
  // ===================================================

  pendingSpeciesCard: {
    marginTop: 15,
    padding: 15,
    backgroundColor: "#E9F7E4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4EBD0",
  },


  pendingSpeciesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },


  pendingSpeciesTitle: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
  },


  pendingBadge: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: "#FFF1C9",
  },


  pendingBadgeText: {
    color: "#77612A",
    fontSize: 10,
    fontWeight: "700",
  },


  pendingSpeciesName: {
    marginTop: 12,
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },


  pendingSpeciesScientific: {
    marginTop: 3,
    color: "#6D7F75",
    fontSize: 12,
    fontStyle: "italic",
  },


  pendingSpeciesText: {
    marginTop: 8,
    color: "#5F7067",
    fontSize: 12,
    lineHeight: 18,
  },


  speciesActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },


  editSpeciesButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },


  editSpeciesText: {
    color: "#468585",
    fontSize: 12,
    fontWeight: "700",
  },


  removeSpeciesButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#FFF0F0",
    borderWidth: 1,
    borderColor: "#E6BABA",
    alignItems: "center",
    justifyContent: "center",
  },


  removeSpeciesText: {
    color: "#C85C5C",
    fontSize: 12,
    fontWeight: "700",
  },

  
      speciesPhotoScroll: {
        marginTop: 15,
      },

      speciesPhotoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingRight: 5,
      },

      speciesPhotoItem: {
        width: 240,
        padding: 10,
        backgroundColor: "#F5F9F3",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#DCE8D6",
      },

      speciesPhotoPreview: {
        width: "100%",
        height: 220,
        borderRadius: 8,
        backgroundColor: "#E8EEE6",
      },

      removeSpeciesPhotoButton: {
        marginTop: 10, width: 44, height: 44, alignSelf: "flex-end",
        borderRadius: 11, borderWidth: 1, borderColor: "#F2B9B4", backgroundColor: "#FDE9E7",
        alignItems: "center",
        justifyContent: "center",
      },



  // ===================================================
  // LOCATION
  // ===================================================

  locationButton: fieldFormStyles.locationButton,


  locationButtonText: fieldFormStyles.locationButtonText,


  // ===================================================
  // PHOTOS
  // ===================================================

  photoProgress: {
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#EAF6E7",
  },

  photoProgressText: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "700",
  },

  photoGuideCard: {
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D5E8D1",
    borderRadius: 12,
    backgroundColor: "#FAFCF9",
  },

  photoGuideHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  photoGuideTitle: {
    flex: 1,
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },

  photoGuideDescription: {
    marginTop: 6,
    color: "#6D7F75",
    fontSize: 12,
    lineHeight: 18,
  },

  photoGuideRequiredBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#6E5A24",
    backgroundColor: "#FFF8E8",
    fontSize: 11,
    fontWeight: "700",
  },

  photoGuideOptionalBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#6D7F75",
    backgroundColor: "#EDF2EA",
    fontSize: 11,
    fontWeight: "700",
  },

  photoGuideCompleteBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#FFFFFF",
    backgroundColor: "#50B498",
    fontSize: 11,
    fontWeight: "700",
  },

  guidedPhotoPreview: {
    width: "100%",
    height: 180,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: "#E8EEE6",
  },

  guidedPhotoActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },

  guidedPhotoActionButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D5E8D1",
    backgroundColor: "#EAF6E7",
    alignItems: "center",
    justifyContent: "center",
  },

  removeGuidedPhotoButton: {
    width: 44, height: 44, marginTop: 8, alignSelf: "flex-end",
    alignItems: "center", justifyContent: "center", borderRadius: 11,
    backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4",
  },
  removeAdditionalPhotoButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4" },

  additionalPhotosHeader: {
    marginTop: 6,
  },

  additionalPhotosTitle: {
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },

  photoButtonRow: fieldFormStyles.photoButtonRow,


  photoButton: fieldFormStyles.photoButton,


  photoButtonText: fieldFormStyles.photoButtonText,


  photoList: {
    marginTop: 15,
  },


  photoItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#F5F9F3",
    borderRadius: 10,
    marginBottom: 8,
  },

  additionalPhotoPreview: {
    width: 54,
    height: 54,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: "#E8EEE6",
  },


  photoName: {
    flex: 1,
    marginRight: 10,
    color: "#234B3A",
    fontSize: 12,
  },




  // ===================================================
  // QR CODE
  // ===================================================

  qrHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  qrHeadingTitle: { flex: 1, marginBottom: 0 },

  qrSelector: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    backgroundColor: "#FAFCF9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  qrGenerateButton: {
    alignSelf: "flex-end", minHeight: 44, margin: 9, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#B7E2C5", borderColor: "#468B67", borderWidth: 1, borderRadius: 11,
  },
  qrGenerateButtonText: { color: "#20583D", fontWeight: "600", fontSize: 13 },
  qrGenerationSuccess: { color: "#20583D", fontSize: 12, marginTop: 6 },
  qrGenerationError: { color: "#A34436", fontSize: 12, marginTop: 6 },

  qrResult: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },

  qrResultId: {
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },

  qrResultHint: {
    color: "#61736A",
    fontSize: 13,
    textAlign: "center",
  },

  qrPendingText: {
    color: "#61736A",
    fontSize: 13,
    paddingVertical: 12,
  },


  qrSelectedText: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "600",
  },


  qrPlaceholder: {
    color: "#9AA7A0",
    fontSize: 14,
  },


  dropdownArrow: {
    color: "#468585",
    fontSize: 12,
  },


  qrRefreshButton: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
    backgroundColor: "#EDF6F1", borderColor: "#C9E2D6", borderWidth: 1, borderRadius: 11,
  },

  qrDropdown: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  qrOptionsList: { flexGrow: 0 },


  qrOption: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2EA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },


  qrOptionText: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "600",
  },


  qrAvailableText: {
    color: "#50B498",
    fontSize: 11,
    fontWeight: "600",
  },


  noQRText: {
    padding: 15,
    color: "#7C8A82",
    fontSize: 12,
  },


  // ===================================================
  // FINAL APPROVAL
  // ===================================================

  finalApprovalCard: {
    marginBottom: 15,
    padding: 15,
    backgroundColor: "#FFF8E8",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F0DFB1",
  },


  finalApprovalTitle: {
    color: "#6E5A24",
    fontSize: 14,
    fontWeight: "700",
  },


  finalApprovalText: {
    marginTop: 5,
    color: "#776B4C",
    fontSize: 12,
    lineHeight: 18,
  },


  // ===================================================
  // SUBMIT
  // ===================================================

  formActionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 8 },
  saveDraftButton: { flexGrow: 1, flexBasis: "45%", minWidth: 145, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#AFCBB7", backgroundColor: "#E8EDDA", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8 },
  disabledAction: { opacity: 0.58 },
  saveDraftText: { color: "#2F6B4F", fontSize: 14, fontWeight: "700", textAlign: "center" },
  draftSuccess: { color: "#2F6B4F", fontSize: 13, textAlign: "center" },
  draftError: { color: "#A34436", fontSize: 13, lineHeight: 19 },

  submitButton: [fieldFormStyles.submitButton, { flexGrow: 1, flexBasis: "45%", minWidth: 145, marginTop: 0, minHeight: 48, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }],


  submitButtonText: fieldFormStyles.submitButtonText,


  // ===================================================
  // CANCEL
  // ===================================================

  cancelButton: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#E8EEE6",
    alignItems: "center",
    justifyContent: "center",
  },


  cancelButtonText: {
    color: "#468585",
    fontSize: 14,
    fontWeight: "600",
  },

});
