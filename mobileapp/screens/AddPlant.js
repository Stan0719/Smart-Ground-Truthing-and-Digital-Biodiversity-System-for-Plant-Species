import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";

import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import QRCode from "react-native-qrcode-svg";
import Ionicons from "@expo/vector-icons/Ionicons";
import RefreshButton from "../components/RefreshButton";
import { fieldFormStyles } from "../components/fieldFormStyles";
import { plantApi, fetchSpeciesCatalog } from "../utils/plantApi";
import { validateSpeciesRequest, validatePlantDetails } from "../utils/addPlantValidation";
import { useFocusEffect } from "@react-navigation/native";
import { saveBotanistFormDraft, getBotanistFormDraft, findBotanistFormDraft, deleteBotanistFormDraft } from "../utils/botanistFormDrafts";
import { useBotanistDraftAutosave } from "../utils/botanistDraftAutosave";

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

export default function AddPlantScreen({
  route,
  navigation,
}) {
  useAppTranslation();

  const botanist = route.params?.botanist;
  const accountId = botanist?.id;
  const draftIdentity = useId();
  const clientKeyRef = useRef(createPlantClientKey());
  const [localFormDraftKey, setLocalFormDraftKey] = useState(() => route.params?.formDraftKey || `add-plant-${draftIdentity}`);
  const [draftKeyVersion, setDraftKeyVersion] = useState(0);
  const [recoveryResolved, setRecoveryResolved] = useState(false);
  const activeFormDraftKey = route.params?.formDraftKey || localFormDraftKey;
  const restoredDraftRef = useRef(null);
  const recoveryPromptedRef = useRef(false);
  const [draftSaving, setDraftSaving] = useState(false), [draftMessage, setDraftMessage] = useState(""), [draftError, setDraftError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionBusyRef = useRef(false);
  const [submittedQr, setSubmittedQr] = useState(null);
  const [availableQRCodes, setAvailableQRCodes] = useState([]);
  const [selectedQRCode, setSelectedQRCode] = useState(null);
  const [showQRDropdown, setShowQRDropdown] = useState(false);
  const [loadingQRCodes, setLoadingQRCodes] = useState(true);
  const [qrLoadError, setQrLoadError] = useState("");

  const loadAvailableQRCodes = useCallback(async () => {
    setLoadingQRCodes(true);
    setQrLoadError("");
    try {
      const result = await plantApi("/qr-codes");
      const codes = Array.isArray(result.qr_codes) ? result.qr_codes : [];
      setAvailableQRCodes(codes.filter((code) => code.status === "generated" && code.plant_id == null));
    } catch (error) {
      setQrLoadError(
        error instanceof Error ? error.message : "Could not load your QR inventory.",
      );
    } finally {
      setLoadingQRCodes(false);
    }
  }, []);


  // ===================================================
  // PLANT INFORMATION
  // ===================================================

  const [speciesCatalog, setSpeciesCatalog] = useState([]);
  const [selectedSpecies, setSelectedSpecies] = useState(null);
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [showSpeciesPicker, setShowSpeciesPicker] = useState(true);
  const [loadingSpeciesCatalog, setLoadingSpeciesCatalog] = useState(true);
  const [speciesCatalogError, setSpeciesCatalogError] = useState("");
  const speciesRequestRef = useRef(null);

  const loadSpeciesCatalog = useCallback(() => {
    if (speciesRequestRef.current) return speciesRequestRef.current;
    setLoadingSpeciesCatalog(true);
    setSpeciesCatalogError("");
    const request = (async () => {
      try {
        const catalog = await fetchSpeciesCatalog({ accountId });
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
    void loadSpeciesCatalog();
    void loadAvailableQRCodes();
  }, [loadSpeciesCatalog, loadAvailableQRCodes]));

  const filteredSpecies = speciesCatalog
    .filter((species) => {
      const term = speciesSearch.trim().toLowerCase();
      return !term ||
        species.scientificName.toLowerCase().includes(term) ||
        species.name.toLowerCase().includes(term);
    })
    .slice(0, 8);

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

  useEffect(() => {
    if (!accountId || route.params?.formDraftKey || recoveryPromptedRef.current) return;
    recoveryPromptedRef.current = true;
    let active = true;
    findBotanistFormDraft(accountId, "add-plant").then((draft) => {
      if (!active) return;
      if (!draft) { setRecoveryResolved(true); return; }
      Alert.alert(t("botanistDrafts.recoveryTitle"), t("botanistDrafts.recoveryMessage"), [
        { text: t("botanistDrafts.continueDraft"), onPress: () => navigation.setParams({ formDraftKey: draft.client_key }) },
        { text: t("botanistDrafts.startNewDraft"), style: "cancel", onPress: () => {
          setLocalFormDraftKey(`add-plant-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
          setDraftKeyVersion((value) => value + 1);
          setRecoveryResolved(true);
        } },
      ]);
    }).catch((error) => { if (active) { setDraftError(translateUIMessage(error.message) || t("botanistDrafts.restoreFailed")); setRecoveryResolved(true); } });
    return () => { active = false; };
  }, [accountId, navigation, route.params?.formDraftKey]);

  const buildDraftInput = (autoSaved = false) => {
    const photos = [
      ...Object.entries(guidedPhotos).filter(([, uri]) => uri).map(([slot, uri]) => ({ slot: `guided:${slot}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
      ...additionalPhotos.map((uri, index) => ({ slot: `additional:${String(index).padStart(2, "0")}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
      ...speciesImages.map((uri, index) => ({ slot: `species:${index}`, uri, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" })),
    ];
    return { client_key: activeFormDraftKey, form_type: "add-plant", submission_client_key: clientKeyRef.current,
      title: plantScientificName.trim() || selectedSpecies?.scientificName || selectedSpecies?.name || "",
      auto_saved: autoSaved,
      form: { selectedSpecies: selectedSpecies ? { id: selectedSpecies.id, scientificName: selectedSpecies.scientificName, commonName: selectedSpecies.commonName, name: selectedSpecies.name } : null,
        speciesSearch, plantScientificName, height, description, healthStatus, growthStage, morphology, zone, latitude, longitude, altitude, gpsAccuracy,
        selectedQRCode: selectedQRCode ? { qr_id: selectedQRCode.qr_id, qr_code: selectedQRCode.qr_code, label: selectedQRCode.label } : null,
        showSpeciesForm, speciesScientificName, speciesCommonName, speciesGenus, speciesFamily, speciesConservationStatus, speciesDescription, speciesHabitat,
        submissionClientKey: clientKeyRef.current }, photos };
  };
  const autosaveSignature = JSON.stringify({ selectedSpecies: selectedSpecies?.id, plantScientificName, height, description, growthStage, morphology,
    zone, latitude, longitude, altitude, gpsAccuracy, selectedQRCode: selectedQRCode?.qr_id, showSpeciesForm, speciesScientificName,
    speciesCommonName, speciesGenus, speciesFamily, speciesConservationStatus, speciesDescription, speciesHabitat,
    photos: [...Object.values(guidedPhotos), ...additionalPhotos, ...speciesImages] });
  const hasMeaningfulDraft = Boolean(selectedSpecies || plantScientificName || height || description || growthStage || morphology || zone || latitude || longitude || altitude || gpsAccuracy || selectedQRCode || showSpeciesForm || speciesScientificName || speciesCommonName || speciesGenus || speciesFamily || speciesDescription || speciesHabitat || Object.values(guidedPhotos).some(Boolean) || additionalPhotos.length || speciesImages.length);
  const autosave = useBotanistDraftAutosave({ enabled: Boolean(accountId && recoveryResolved && hasMeaningfulDraft && !submittedQr),
    signature: autosaveSignature + draftKeyVersion, navigation, accountId, errorKey: accountId && route.key ? `${accountId}:${route.key}` : undefined,
    onSaving: () => setAutoSaveState("saving"),
    save: async ({ isMounted } = {}) => { const saved = await saveBotanistFormDraft(accountId, buildDraftInput(true)); restoredDraftRef.current = saved; if (isMounted?.()) setAutoSaveState("saved"); return saved; },
    onError: (error) => { setAutoSaveState("error"); setDraftError(translateUIMessage(error.message) || t("botanistDrafts.autoSaveFailed")); } });


  // ===================================================
  // GET CURRENT LOCATION
  // ===================================================

  async function handleGetLocation() {

    try {

      setLoadingLocation(true);


      const {
        status,
      } =
        await Location.requestForegroundPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          t("addPlant.permissionRequired"),
          t("addPlant.locationPermissionIsRequiredToGetThePlantLocation")
        );

        return;
      }


      const location =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });


      const lat = location.coords.latitude.toFixed(6);
      const lng = location.coords.longitude.toFixed(6);

      setLatitude(lat);
      setLongitude(lng);

      setAltitude(
        location.coords.altitude != null
          ? location.coords.altitude.toFixed(2)
          : ""
      );

      setGpsAccuracy(
        location.coords.accuracy != null
          ? location.coords.accuracy.toFixed(2)
          : ""
      );

    } catch (error) {

      console.log(
        "Location error:",
        error
      );

      Alert.alert(
        t("addPlant.locationError"),
        t("addPlant.unableToGetYourCurrentLocation")
      );

    } finally {

      setLoadingLocation(false);

    }
  }


  // ===================================================
  // TAKE PHOTO
  // ===================================================

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

        const uri =
          result.assets[0].uri;


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
        setAdditionalPhotos((current) => [
          ...current,
          result.assets[0].uri,
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
        setGuidedPhotos((current) => ({
          ...current,
          [photoKey]: result.assets[0].uri,
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

        const selectedPhotos =
          result.assets.map(
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
      setSpeciesImages([result.assets[0].uri]);
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
      setSpeciesImages([result.assets[0].uri]);
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
    if (draftSaving || submitting || submittedQr) return;
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

  async function handleSubmitPlant() {
    if (submissionBusyRef.current || submittedQr) return;
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
    if (!latitude || !longitude) {
      Alert.alert(t("addPlant.missingLocation"), t("addPlant.pleaseGetTheCurrentGpsLocationBeforeSubmitting"));
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
        guidedPhotos.wholePlant,
        guidedPhotos.leafCloseUp,
        guidedPhotos.stemBark,
        guidedPhotos.flowerFruit,
        ...additionalPhotos,
      ].filter(Boolean);
      const photos = [];
      for (const uri of photoUris) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (base64.length > 5592408) {
          throw Error("One of the photos is over 4 MB. Choose a smaller image and retry.");
        }
        const contentType = /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg";
        photos.push({ content_type: contentType, base64 });
      }
      let newSpecies;
      if (speciesData) {
        const uri = speciesImages[0];
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        if (base64.length > 5592408) throw Error(t("addPlantWorkflow.speciesPhotoTooLarge"));
        newSpecies = { ...speciesData, photo: { base64, content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg" } };
      }
      const created = await plantApi("/plant-submissions", {
        method: "POST",
        body: {
          ...(newSpecies ? { new_species: newSpecies } : { species_id: Number(selectedSpecies.id) }),
          scientific_name: plantScientificName.trim(), latitude: latitudeValue, longitude: longitudeValue,
          ...(accuracyValue === undefined ? {} : { accuracy_m: accuracyValue }),
          content, photos, client_key: clientKeyRef.current, qr_id: selectedQRCode.qr_id,
        },
      });
      const plantId = String(created.plant_id ?? "");
      if (!/^\d+$/.test(plantId) || !created.qr_token) throw Error(t("addPlantWorkflow.invalidCombinedResponse"));
      await autosave.stop();
      if (restoredDraftRef.current) {
        try {
          const removed = await deleteBotanistFormDraft(botanist.id, activeFormDraftKey, restoredDraftRef.current?.saved_at);
          if (!removed) setDraftError(t("botanistDrafts.newerDraftKept"));
          else restoredDraftRef.current = null;
        } catch { setDraftError(t("botanistDrafts.cleanupFailed")); }
      }
      setSubmittedQr({ plantId, token: created.qr_token });
      clientKeyRef.current = createPlantClientKey();
      Alert.alert(
        t("addPlant.plantSubmitted"),
        t(newSpecies ? "addPlantWorkflow.combinedSaved" : "addPlant.plantAndItsPhotosWereSavedTheQrCodeIs", { plantId }),
        [{ text: t("common.ok"), onPress: () => navigation.navigate("BotanistSubmissions", {
          botanist, openTarget: { kind: "plant", recordId: plantId },
        }) }],
      );
    } catch (error) {
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

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={
          styles.scrollContent
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >


        {/* =================================================
            PLANT INFORMATION
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >{t("addPlant.plantInformation")}</Text>

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
            <View style={styles.speciesSelectionRow}>
              <TextInput
                style={[styles.input, styles.speciesSelectionInput]}
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
              <RefreshButton
                onPress={loadSpeciesCatalog}
                loading={loadingSpeciesCatalog}
                label={t("addPlantWorkflow.refreshSpecies")}
                testID="add-plant-species-refresh"
              />
            </View>

            {!!speciesCatalogError && (
              <View style={styles.speciesPickerMessage}>
                <Text style={styles.speciesPickerError}>{translateUIMessage(speciesCatalogError)}</Text>
                <TouchableOpacity onPress={loadSpeciesCatalog} activeOpacity={0.8}>
                  <Text style={styles.speciesPickerRetry}>{t("addPlant.retryLoadingSpecies")}</Text>
                </TouchableOpacity>
              </View>
            )}

            {showSpeciesPicker && !loadingSpeciesCatalog && !speciesCatalogError && (
              <View style={styles.speciesPickerList}>
                {filteredSpecies.length ? (
                  filteredSpecies.map((species) => (
                    <TouchableOpacity
                      key={species.id}
                      style={styles.speciesPickerOption}
                      onPress={() => {
                        setSelectedSpecies(species);
                        setSpeciesSearch(species.scientificName);
                        setShowSpeciesPicker(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.speciesPickerScientific}>
                        {species.scientificName}
                      </Text>
                      <Text style={styles.speciesPickerCommon}>
                        {species.name}{species.family ? t("addPlant.label", { family: species.family }) : ""}
                      </Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.speciesPickerEmpty}>{t("addPlant.noMatchingSpeciesInTheDatabaseAskAConservationOfficer")}</Text>
                )}
              </View>
            )}

            {selectedSpecies && (
              <View style={styles.selectedSpeciesCard}>
                <Text style={styles.selectedSpeciesName}>{selectedSpecies.scientificName}</Text>
                <Text style={styles.speciesPickerCommon}>
                  {selectedSpecies.name}{selectedSpecies.family ? t("addPlant.label", { family: selectedSpecies.family }) : ""}
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
                  showsHorizontalScrollIndicator={false}
                  style={styles.speciesPhotoScroll}
                  contentContainerStyle={styles.speciesPhotoRow}
                >
                  {speciesImages.map((photo, index) => (
                    <View
                      key={`${photo}-${index}`}
                      style={styles.speciesPhotoItem}
                    >
                      <Image
                        source={{ uri: photo }}
                        style={styles.speciesPhotoPreview}
                        resizeMode="cover"
                      />

                      <TouchableOpacity
                        style={styles.removeSpeciesPhotoButton}
                        disabled={submitting}
                        onPress={() => handleRemoveSpeciesPhoto(index)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.removeSpeciesPhotoText}>{t("addPlant.remove")}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}




              {/* -------------------------------------------
                  SPECIES APPROVAL INFO
              ------------------------------------------- */}

              <View
                style={styles.approvalInfo}
              >

                <Text
                  style={
                    styles.approvalTitle
                  }
                >{t("addPlant.speciesApprovalRequired")}</Text>

                <Text
                  style={
                    styles.approvalText
                  }
                >{t("addPlantWorkflow.requestApprovalInfo")}</Text>

              </View>


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


          {/* =================================================
              SPECIES REQUEST SUMMARY
          ================================================= */}

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


          {/* Latitude */}

          <Text style={styles.label}>{t("addPlant.latitude")}</Text>

          <TextInput
            style={styles.input}
            value={latitude}
            onChangeText={
              setLatitude
            }
            placeholder="e.g. 3.812345"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />


          {/* Longitude */}

          <Text style={styles.label}>{t("addPlant.longitude")}</Text>

          <TextInput
            style={styles.input}
            value={longitude}
            onChangeText={
              setLongitude
            }
            placeholder="e.g. 113.812345"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          <Text style={styles.label}>{t("addPlant.altitudeM")}</Text>

          <TextInput
            style={styles.input}
            value={altitude}
            onChangeText={setAltitude}
            placeholder={t("addPlant.gpsAltitudeInMetres")}
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          <Text style={styles.label}>{t("addPlant.gpsAccuracyM")}</Text>

          <TextInput
            style={styles.input}
            value={gpsAccuracy}
            onChangeText={setGpsAccuracy}
            placeholder={t("addPlant.gpsAccuracyInMetres")}
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />


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
          <Text style={styles.sectionTitle}>{t("navigation.plantQrCode")}</Text>
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

              {showQRDropdown && (
                <View style={styles.qrDropdown}>
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
                        <Text style={styles.qrOptionText}>
                          {qrLabel(qr.qr_id)}
                        </Text>
                        <QRCode value={qr.qr_code} size={44} />
                      </TouchableOpacity>
                    ))
                  )}
                  <RefreshButton
                    style={styles.qrRefreshSpacing}
                    onPress={loadAvailableQRCodes}
                    loading={loadingQRCodes}
                    label={t("addPlant.refreshQrInventory")}
                  />
                </View>
              )}
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
                  <Image
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
                    onPress={() => handleRemoveGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.removePhotoText}>{t("common.remove")}</Text>
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

                    <Image
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
                      onPress={() =>
                        handleRemovePhoto(
                          index
                        )
                      }
                    >

                      <Text
                        style={
                          styles.removePhotoText
                        }
                      >{t("common.remove")}</Text>

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
            style={[styles.submitButton, (submitting || Boolean(submittedQr)) && styles.disabledAction]}
            onPress={handleSubmitPlant}
            disabled={submitting || Boolean(submittedQr)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting || Boolean(submittedQr) }}
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


      </ScrollView>

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

  speciesSelectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  speciesSelectionInput: {
    flex: 1,
    minWidth: 0,
  },
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
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2EA",
  },

  speciesPickerScientific: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
  },

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


  approvalInfo: {
    marginTop: 20,
    padding: 14,
    backgroundColor: "#E9F7E4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4EBD0",
  },


  approvalTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#234B3A",
  },


  approvalText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: "#5F7067",
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
        marginTop: 10,
        minHeight: 38,
        borderRadius: 8,
        backgroundColor: "#FFF0F0",
        alignItems: "center",
        justifyContent: "center",
      },

      removeSpeciesPhotoText: {
        color: "#C85C5C",
        fontSize: 12,
        fontWeight: "600",
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
    minHeight: 44,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
  },

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


  removePhotoText: {
    color: "#C85C5C",
    fontSize: 12,
    fontWeight: "600",
  },


  // ===================================================
  // QR CODE
  // ===================================================

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


  qrRefreshSpacing: {
    alignSelf: "flex-start",
    marginTop: 8,
  },

  qrDropdown: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },


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
