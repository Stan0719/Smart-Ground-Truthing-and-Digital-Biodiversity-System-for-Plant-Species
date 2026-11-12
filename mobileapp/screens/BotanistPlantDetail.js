import { useAppTranslation, t, translateLabel, translateFieldValue, translateUIMessage } from "../translations/i18n";

import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { fetchBotanistPlant, fetchBotanistRecordChangeStatus } from "../utils/botanistRecords";
import EditAction from "../components/EditAction";
import OriginalUpdatedField from "../components/OriginalUpdatedField";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
  Modal,
  RefreshControl,
} from "react-native";
import { stepPhotoIndex } from "../utils/plantPhotoGallery";
import { fetchSpeciesDetail, getPlantRegisteredByDisplayName } from "../utils/plantApi";
import {
  botanistPlantRecords,
  botanistSpeciesRequests,
  plants,
} from "../data/mockData";

const COLORS = {
  background: "#F7FBF4",
  white: "#FFFFFF",
  light: "#E9F7E4",
  border: "#DCE8D6",
  primary: "#468585",
  dark: "#234B3A",
  text: "#52665A",
  muted: "#718078",
};

const PLANT_FIELDS = [
  {
    label: "Scientific Name",
    field: "scientificName",
  },
  {
    label: "Height (cm)",
    field: "height",
    numeric: true,
  },
  {
    label: "Health Status",
    field: "healthStatus",
  },
  {
    label: "Growth Stage",
    field: "growthStage",
  },
  {
    label: "Morphology",
    field: "morphology",
    multiline: true,
  },
  {
    label: "Location (Zone)",
    field: "zone",
  },
];

const GPS_FIELDS = [
  {
    label: "Latitude",
    field: "latitude",
    numeric: true,
  },
  {
    label: "Longitude",
    field: "longitude",
    numeric: true,
  },
  {
    label: "Altitude (m)",
    field: "altitude",
    numeric: true,
  },
  {
    label: "GPS Accuracy (m)",
    field: "gpsAccuracy",
    numeric: true,
  },
];

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function formatLabel(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (Array.isArray(value)) {
    return value.length
      ? value.map(formatValue).join(", ")
      : "Not provided";
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${formatLabel(key)}: ${formatValue(item)}`)
      .join("\n");
  }

  return String(value);
}


function getPlantFieldValue(plant, field) {
  if (!plant) return undefined;
  if (plant.isHistoricalVersion) {
    const content = plant.historicalContent || {};
    switch (field) {
      case "scientificName": return plant.scientificName;
      case "height": return content.heightCm ?? content.height_cm;
      case "healthStatus": return content.healthStatus ?? content.health_status;
      case "growthStage": return content.lifeStage ?? content.life_stage;
      case "morphology": return content.morphology;
      case "zone": return content.zone;
      case "latitude": return content.latitude;
      case "longitude": return content.longitude;
      case "altitude": return content.altitudeM ?? content.altitude_m;
      case "gpsAccuracy": return content.accuracyM ?? content.accuracy_m;
      default: return content[field];
    }
  }

  switch (field) {
    case "scientificName":
      return (
        plant.scientificName ||
        plant.speciesName ||
        plant.latestApproved?.scientificName
      );

    case "height":
      return (
        plant.height ??
        plant.latestApproved?.heightCm
      );

    
case "healthStatus":
  return (
    plant.healthStatus?.trim() ||
    plant.latestApproved?.healthStatus?.trim() ||
    plant.observations
      ?.filter((observation) => observation.status === "Approved")
      ?.slice(-1)[0]
      ?.healthStatus ||
    ""
  );


    case "growthStage":
      return (
        plant.growthStage ||
        plant.latestApproved?.lifeStage
      );

    case "morphology":
      return (
        plant.morphology ||
        plant.latestApproved?.morphology
      );

    case "zone":
      return plant.zone || plant.location?.zone;

    case "latitude":
      return plant.latitude ?? plant.location?.latitude;

    case "longitude":
      return plant.longitude ?? plant.location?.longitude;

    case "altitude":
      return plant.altitude ?? plant.location?.altitudeM;

    case "gpsAccuracy":
      return plant.gpsAccuracy ?? plant.location?.accuracyM;

    default:
      return plant[field];
  }
}


function getSpeciesDetails(plant) {
  if (!plant) return null;

  // 1. Use species information attached directly
  // to the plant record, if available.
  const linkedSpecies =
    plant.speciesDetails ||
    plant.speciesInfo ||
    (typeof plant.species === "object"
      ? plant.species
      : null);

  if (linkedSpecies) {
    return linkedSpecies;
  }

  // For live server records, never try to recover species details from
  // mock records or unrelated locally cached requests.
  if (plant.isServerRecord) return null;

  // 2. If this plant has a new species request,
  // display that request first.
  if (plant.speciesRequestId) {
    const request = botanistSpeciesRequests.find(
      (item) =>
        String(item.id) === String(plant.speciesRequestId)
    );

    if (request) {
      return request;
    }
  }

  // 3. Search the existing species catalogue.
  const identifiers = [
    plant.speciesId,
    plant.speciesID,
    plant.speciesName,
    plant.scientificName,
    typeof plant.species === "string"
      ? plant.species
      : null,
  ].filter(Boolean);

  const existingSpecies = plants.find((species) => {
    const speciesIdentifiers = [
      species.id,
      species.speciesId,
      species.speciesID,
      species.scientificName,
      species.speciesName,
      species.name,
    ].filter(Boolean);

    return identifiers.some((identifier) =>
      speciesIdentifiers.some(
        (speciesIdentifier) =>
          String(speciesIdentifier).trim().toLowerCase() ===
          String(identifier).trim().toLowerCase()
      )
    );
  });

  if (existingSpecies) {
    return existingSpecies;
  }

  // 4. A missing link stays unavailable rather than borrowing the
  // plant-level name, which is separate from the linked species name.
  return null;
}



function getPhotoUri(photo) {
  if (typeof photo === "string") {
    return photo;
  }

  if (photo && typeof photo === "object") {
    return (
      photo.uri ||
      photo.url ||
      photo.imageUri ||
      photo.imageUrl ||
      photo.path ||
      null
    );
  }

  return null;
}


// =====================================================
// MAIN SCREEN
// =====================================================

export default function BotanistPlantDetailScreen({
  route,
  navigation,
}) {
  useAppTranslation();
  const plantId = route.params?.plantId;
  const botanist = route.params?.botanist;
  const botanistId = botanist?.id;
  const botanistName = botanist?.name;
  const historicalDetail = route.params?.historicalRecordDetail === true;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [changeInfo, setChangeInfo] = useState(null);
  const [changeError, setChangeError] = useState("");
  const [editAvailability, setEditAvailability] = useState("checking");
  const [selectedPhotoUri, setSelectedPhotoUri] = useState(null);
  const [photoViewerVisible, setPhotoViewerVisible] = useState(false);
  const [failedPhotoUris, setFailedPhotoUris] = useState([]);
 
function findPlant() {
  return botanistPlantRecords.find(
    (item) =>
      String(item.id) === String(plantId) ||
      String(item.plantId) === String(plantId)
  );
}


  const [plant, setPlant] = useState(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    setPlant(null);
    setChangeInfo(null);
    setChangeError("");
    setEditAvailability("checking");
    setSelectedPhotoUri(null);
    setPhotoViewerVisible(false);
    setFailedPhotoUris([]);
    if (historicalDetail) {
      setEditAvailability("not-required");
      const suppliedSnapshot = route.params?.historicalSnapshot;
      const snapshot = suppliedSnapshot && typeof suppliedSnapshot === "object" ? suppliedSnapshot : {};
      const content = snapshot.content || {};
      const suppliedSpecies = snapshot.species_details || snapshot.speciesDetails;
      const historicalSpeciesId = snapshot.species_id ?? suppliedSpecies?.species_id ?? suppliedSpecies?.speciesId ?? null;
      const suppliedScientificName = suppliedSpecies?.scientific_name ?? suppliedSpecies?.scientificName;
      const canResolveHistoricalSpecies = !suppliedScientificName && historicalSpeciesId != null && botanistId != null;
      const speciesDetails = suppliedSpecies && Object.keys(suppliedSpecies).length ? suppliedSpecies : null;
      setPlant({
        id: String(snapshot.plant_id ?? plantId), plantId: String(snapshot.plant_id ?? plantId),
        isServerRecord: true, isHistoricalVersion: true, historicalSnapshotUnavailable: Object.keys(snapshot).length === 0,
        status: route.params?.historicalVersionStatus || "",
        historicalVersionLabel: route.params?.submissionVersionLabel || "",
        historicalCurrent: route.params?.historicalCurrent === true,
        historicalSuperseded: route.params?.historicalSuperseded === true,
        scientificName: snapshot.scientific_name, speciesName: snapshot.scientific_name,
        speciesId: historicalSpeciesId, historicalSpeciesDetails: speciesDetails,
        historicalSpeciesLoading: canResolveHistoricalSpecies,
        historicalContent: content,
        qrCode: snapshot.qr_id != null ? `QR-${String(snapshot.qr_id).padStart(4, "0")}` : snapshot.qr_token,
        botanist: getPlantRegisteredByDisplayName(
          { registeredBy: route.params?.historicalSubmittedBy },
          { id: botanistId, name: botanistName },
          t("plantDetail.unknownBotanist"),
        ),
        photos: Array.isArray(route.params?.historicalPhotos) ? route.params.historicalPhotos : [],
      });
      if (canResolveHistoricalSpecies) {
        fetchSpeciesDetail(historicalSpeciesId, undefined, { accountId: botanistId })
          .then((resolvedSpecies) => {
            if (active) setPlant((current) => current?.isHistoricalVersion &&
              String(current.speciesId) === String(historicalSpeciesId)
              ? { ...current, historicalSpeciesDetails: resolvedSpecies, historicalSpeciesLoading: false }
              : current);
          })
          .catch(() => {
            if (active) setPlant((current) => current?.isHistoricalVersion &&
              String(current.speciesId) === String(historicalSpeciesId)
              ? { ...current, historicalSpeciesLoading: false }
              : current);
          });
      }
      setLoading(false);
      return () => { active = false; };
    }
    fetchBotanistPlant(botanistId, plantId).then((record) => {
      if (active) setPlant({ ...record, botanist: getPlantRegisteredByDisplayName(record, { id: botanistId, name: botanistName }, t("plantDetail.unknownBotanist")) });
    }).catch((error) => { if (active) setLoadError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    fetchBotanistRecordChangeStatus(botanistId, "plant", plantId).then((result) => {
      if (!active) return;
      setChangeInfo(result.pending || result.latest);
      setEditAvailability(!result.available ? "unavailable" : result.pending ? "pending" : "clear");
    }).catch((error) => {
      if (!active) return;
      setChangeError(error.message);
      setEditAvailability("unavailable");
    });
    return () => { active = false; };
  }, [botanistId, botanistName, plantId, retry, historicalDetail, route.params?.historicalSnapshot,
    route.params?.historicalVersionStatus, route.params?.submissionVersionLabel, route.params?.historicalCurrent,
    route.params?.historicalSuperseded, route.params?.historicalSubmittedBy, route.params?.historicalPhotos]));


  const [isEditing, setIsEditing] = useState(false);

  const [form, setForm] = useState(() => {
    const item = findPlant();

    return {
      scientificName: item?.scientificName || "",
      height: String(item?.height ?? ""),
      healthStatus:
        item?.healthStatus?.trim() ||
        item?.latestApproved?.healthStatus?.trim() ||
        "",
      growthStage: item?.growthStage || "",
      morphology: item?.morphology || "",
      zone: item?.zone || "",
      latitude: String(item?.latitude ?? ""),
      longitude: String(item?.longitude ?? ""),
      altitude: String(item?.altitude ?? ""),
      gpsAccuracy: String(item?.gpsAccuracy ?? ""),
    };
  });

  // ===================================================
  // UPDATE FORM
  // ===================================================

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  // ===================================================
  // START EDITING
  // ===================================================

  function handleEdit() {
    if (plant?.isServerRecord) {
      if ((!plant.speciesRequest || plant.speciesRequest.request_status === "Approved") && ["Draft", "Correction Required", "Rejected"].includes(plant.latestObservation?.status))
        navigation.navigate("FieldCollectionEdit", { observation: plant.latestObservation, plantId: plant.id });
      return;
    }
    const currentPlant = findPlant();

    if (!currentPlant) {
      Alert.alert(t("common.error"), t("addObservation.plantRecordNotFound"));
      return;
    }

    setPlant(currentPlant);

    setForm({
      scientificName: currentPlant.scientificName || "",
      height: String(currentPlant.height ?? ""),
      healthStatus:
        currentPlant.healthStatus?.trim() ||
        currentPlant.latestApproved?.healthStatus?.trim() ||
        "",
      growthStage: currentPlant.growthStage || "",
      morphology: currentPlant.morphology || "",
      zone: currentPlant.zone || "",
      latitude: String(currentPlant.latitude ?? ""),
      longitude: String(currentPlant.longitude ?? ""),
      altitude: String(currentPlant.altitude ?? ""),
      gpsAccuracy: String(currentPlant.gpsAccuracy ?? ""),
    });

    setIsEditing(true);
  }

  
  // ===================================================
  // SAVE CHANGES
  // ===================================================

  function handleSave() {
    if (!form.scientificName.trim()) {
      Alert.alert(
        t("addObservation.missingInformation"),
        t("botanistPlantDetail.pleaseEnterTheScientificName")
      );
      return;
    }

    const index = botanistPlantRecords.findIndex(
      (item) => String(item.id) === String(plantId)
    );

    if (index === -1) {
      Alert.alert(t("common.error"), t("addObservation.plantRecordNotFound"));
      return;
    }

    const original = botanistPlantRecords[index];

    function convertNumber(value) {
      if (String(value).trim() === "") {
        return "";
      }

      const number = Number(value);
      return Number.isFinite(number) ? number : value;
    }

    const updatedHeight = convertNumber(form.height);
    const updatedLatitude = convertNumber(form.latitude);
    const updatedLongitude = convertNumber(form.longitude);
    const updatedAltitude = convertNumber(form.altitude);
    const updatedGpsAccuracy = convertNumber(form.gpsAccuracy);

    const updatedPlant = {
      ...original,

      // Plant information
      scientificName: form.scientificName.trim(),
      speciesName: form.scientificName.trim(),
      height: updatedHeight,
      healthStatus: form.healthStatus.trim(),
      growthStage: form.growthStage.trim(),
      morphology: form.morphology.trim(),
      zone: form.zone.trim(),

      // GPS information
      latitude: updatedLatitude,
      longitude: updatedLongitude,
      altitude: updatedAltitude,
      gpsAccuracy: updatedGpsAccuracy,

      // Keep the original website data in sync
      latestApproved: {
        ...(original.latestApproved || {}),
        heightCm: updatedHeight,
        healthStatus: form.healthStatus.trim(),
        lifeStage: form.growthStage.trim(),
        morphology: form.morphology.trim(),
      },

      location: {
        ...(original.location || {}),
        zone: form.zone.trim(),
        latitude: updatedLatitude,
        longitude: updatedLongitude,
        altitudeM: updatedAltitude,
        accuracyM: updatedGpsAccuracy,
      },

      updatedAt: new Date().toISOString(),
    };

    // Update the existing shared record
    Object.assign(
      botanistPlantRecords[index],
      updatedPlant
    );

    // Refresh the displayed information
    setPlant({ ...botanistPlantRecords[index] });

    setIsEditing(false);

    Alert.alert(
      t("botanistPlantDetail.changesSaved"),
      t("botanistPlantDetail.yourPlantRecordHasBeenUpdated")
    );
  }


  // ===================================================
  // CANCEL EDITING
  // ===================================================

  function handleCancelEdit() {
    Alert.alert(
      t("botanistPlantDetail.discardChanges"),
      t("botanistPlantDetail.discardYourUnsavedChanges"),
      [
        {
          text: t("botanistPlantDetail.continueEditing"),
          style: "cancel",
        },
        {
          text: t("botanistPlantDetail.discard"),
          style: "destructive",
          onPress: () => {
            setPlant(findPlant());
            setIsEditing(false);
          },
        },
      ]
    );
  }

  // ===================================================
  // REUSABLE FIELD
  // ===================================================

  function renderField({
    label,
    field,
    numeric = false,
    multiline = false,
  }) {
    const fieldValue = getPlantFieldValue(plant, field);
    const displayValue = plant?.isHistoricalVersion && (fieldValue == null || fieldValue === "")
      ? t("recordEdits.historicalFieldUnavailable")
      : translateFieldValue(field, formatValue(fieldValue));
    return (
      <View style={styles.field} key={field}>
        {isEditing ? (
          <OriginalUpdatedField
            label={translateLabel(label)}
            originalValue={displayValue}
          >
            <TextInput
              style={[styles.input, multiline && styles.multiline]}
              value={String(form[field] ?? "")}
              onChangeText={(value) => updateField(field, value)}
              placeholder={t("botanistPlantDetail.enter", { value0: label.toLowerCase() })}
              placeholderTextColor="#9AA7A0"
              keyboardType={numeric ? "numeric" : "default"}
              multiline={multiline}
              textAlignVertical={multiline ? "top" : "center"}
            />
          </OriginalUpdatedField>
        ) : (
          <>
            <Text style={styles.label}>{translateLabel(label)}</Text>
            <Text style={styles.value}>{displayValue}</Text>
          </>
        )}
      </View>
    );
  }

  // ===================================================
  // SECTION HEADER
  // ===================================================

  function renderSectionHeader(number, title, subtitle) {
    return (
      <View style={styles.sectionHeader}>
        <View style={styles.sectionNumber}>
          <Text style={styles.sectionNumberText}>
            {number}
          </Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>
            {translateLabel(title)}
          </Text>

          {subtitle ? (
            <Text style={styles.sectionSubtitle}>
              {translateLabel(subtitle)}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  // ===================================================
  // MISSING RECORD
  // ===================================================

  if (!plant) {
    if (loading) return <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={{ flexGrow: 1 }}>
      <DetailSkeletonContent label={t("plantDetail.loadingPlantRecord")} sections={4} />
    </ScrollView>;
    return (
      <View style={styles.notFoundContainer}>
        <Text style={styles.title}>{loadError ? t("plantDetail.plantDetailsUnavailable") : t("botanistPlantDetail.plantRecordNotFound")}</Text>

        <Text style={styles.mutedText}>{loadError ? translateUIMessage(loadError) : t("botanistPlantDetail.thisRecordMayHaveBeenRemoved")}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setRetry((value) => value + 1)}>
          <Text style={styles.secondaryButtonText}>{t("common.tryAgain")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ===================================================
  // SPECIES INFORMATION
  // ===================================================

  const species = plant.isHistoricalVersion ? plant.historicalSpeciesDetails : getSpeciesDetails(plant);

  const speciesScientificName = species?.scientific_name ?? species?.scientificName ?? species?.speciesScientificName;
  const speciesEntries = species ? [
    ["species", speciesScientificName || (plant.isHistoricalVersion ? t("recordEdits.historicalSpeciesUnavailable") : t("plant.notRecorded"))],
    ["commonName", species.common_name ?? species.commonName ?? species.name],
    ["genus", species.genus_name ?? species.genus],
    ["family", species.family_name ?? species.family],
    ["conservationStatus", species.conservation_status ?? species.conservationStatus],
    ["description", species.description],
    ["habitat", species.habitat],
  ].filter(([, value]) => value != null && value !== "") : [];

  // ===================================================
  // PLANT PHOTOS
  // ===================================================

  
const rawPhotos = Array.isArray(plant.photos)
  ? plant.photos
  : Array.isArray(plant.images)
    ? plant.images
    : plant.photo
      ? [plant.photo]
      : [];


  const allPhotos = rawPhotos
    .map((photo) => ({
      original: photo,
      uri: getPhotoUri(photo)?.trim(),
    }))
    .filter((photo, index, source) => photo.uri && source.findIndex((candidate) => candidate.uri === photo.uri) === index);
  const photos = allPhotos.filter((photo) => !failedPhotoUris.includes(photo.uri));
  const selectedPhoto = photos.find((photo) => photo.uri === selectedPhotoUri) || photos[0] || null;
  const selectedPhotoIndex = selectedPhoto ? photos.findIndex((photo) => photo.uri === selectedPhoto.uri) : 0;
  const stepSelectedPhoto = (direction) => setSelectedPhotoUri(photos[stepPhotoIndex(selectedPhotoIndex, direction, photos.length)]?.uri || null);
  const failPhoto = (uri) => {
    if (allPhotos.every((photo) => failedPhotoUris.includes(photo.uri) || photo.uri === uri)) setPhotoViewerVisible(false);
    setFailedPhotoUris((current) => current.includes(uri) ? current : [...current, uri]);
  };

  // ===================================================
  // UI
  // ===================================================

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={!historicalDetail ? <RefreshControl refreshing={loading} onRefresh={() => setRetry((value) => value + 1)} tintColor={COLORS.primary} /> : undefined}
      >
        {/* PAGE HEADER */}

        <View style={styles.editHeadingRow} testID={plant.isHistoricalVersion ? "historical-plant-heading" : undefined}>
          <Text style={styles.title}>
            {isEditing ? t("botanistPlantDetail.editPlantRecord") : t("botanistPlantDetail.plantRecord")}
          </Text>
          {!plant.isHistoricalVersion && plant.isServerRecord && ["Approved", "Pending Review", "Rejected", "Correction Required"].includes(plant.status) &&
            <EditAction testID="edit-own-plant" disabled={plant.status === "Approved" && editAvailability !== "clear"}
              labelKey={plant.status === "Approved" && editAvailability !== "clear" ? "recordEdits.editUnavailable" : undefined}
              onPress={() => navigation.navigate("EditPlant", { plantId: plant.id, botanist })} />}
        </View>

        <Text style={styles.subtitle}>{plant.isHistoricalVersion ? t("botanistPlantDetail.readOnlyVersionSubtitle") : t("botanistPlantDetail.reviewAndManageYourPlantDocumentation")}</Text>
        {plant.isHistoricalVersion && plant.historicalSnapshotUnavailable && <Text style={styles.mutedText}>{t("recordEdits.originalSnapshotUnavailable")}</Text>}
        {!plant.isHistoricalVersion && plant.status === "Approved" && editAvailability === "pending" && <View style={styles.editAvailabilityNote}>
          <Text style={styles.pendingEditLabel}>{t("recordEdits.pendingEdit")}</Text>
          <Text style={styles.changeNoticeText}>{t("recordEdits.pendingEditExplanation")}</Text>
          {!!changeInfo?.review_comment && <Text style={styles.changeNoticeText}>{changeInfo.review_comment}</Text>}
        </View>}
        {!plant.isHistoricalVersion && plant.status === "Approved" && editAvailability === "checking" && <Text style={styles.changeNoticeText}>{t("recordEdits.checkingEditAvailability")}</Text>}
        {!plant.isHistoricalVersion && plant.status === "Approved" && editAvailability === "unavailable" && <Text style={styles.changeError}>{t("recordEdits.editAvailabilityUnavailable")}</Text>}
        {!plant.isHistoricalVersion && changeInfo && !(plant.status === "Approved" && editAvailability === "pending") && <View style={styles.changeNotice}><Text style={styles.changeNoticeText}>
          {changeInfo.status === "Pending Review" ? t("recordEdits.changesPending") : changeInfo.status === "Rejected" ? t("recordEdits.changesRejected") : t("recordEdits.changesApproved")}
        </Text>{!!changeInfo.review_comment && <Text style={styles.changeNoticeText}>{changeInfo.review_comment}</Text>}</View>}
        {!plant.isHistoricalVersion && !!changeError && plant.status !== "Approved" && <Text style={styles.changeError}>{translateUIMessage(changeError)}</Text>}

        <View style={styles.recordMeta} testID={plant.isHistoricalVersion ? "historical-plant-record-meta" : "plant-record-meta"}>
          <View style={styles.recordMetaText}>
            <Text style={styles.recordId}>{t("botanistPlantDetail.recordId")}</Text>

            <Text style={styles.recordIdValue}>
              {String(plant.id)}
            </Text>
          </View>

          <View style={styles.recordMetaStatus}>
            <View style={[styles.statusBadge, !plant.isHistoricalVersion && (
              plant.status === "Approved" ? styles.approvedStatusBadge :
                plant.status === "Pending Review" ? styles.pendingStatusBadge : null
            )]}>
              <Text style={[styles.statusText, !plant.isHistoricalVersion && plant.status === "Pending Review" && styles.pendingStatusText]}>
                {plant.isHistoricalVersion
                  ? plant.status ? translateLabel(plant.status) : t("recordEdits.historicalFieldUnavailable")
                  : translateLabel(formatValue(plant.status || t("plant.notRecorded")))}
              </Text>
            </View>
          {plant.isHistoricalVersion && <View style={styles.versionMetaRow}>
            <Text style={styles.versionPill}>{plant.historicalVersionLabel}</Text>
            {plant.historicalCurrent && <Text style={styles.currentVersionPill}>{t("recordEdits.currentVersionLabel")}</Text>}
            {plant.historicalSuperseded && <Text style={styles.supersededVersionPill}>{t("recordEdits.supersededLabel")}</Text>}
          </View>}
          </View>
        </View>

        {/* =========================================== */}
        {/* SECTION 1: SPECIES */}
        {/* =========================================== */}

        <View style={styles.section}>
          {renderSectionHeader(
            "01",
            "Species",
            "Species classification and description"
          )}

          {plant.isHistoricalVersion && plant.historicalSpeciesLoading ? (
            <Text style={styles.mutedText}>{t("botanistRecords.loading")}</Text>
          ) : species ? (
            speciesEntries.length > 0 ? (
              speciesEntries.map(([key, value]) => (
                <View style={styles.speciesField} key={key}>
                  <Text style={styles.label}>
                    {key === "species" ? t("plantDetail.species") : translateLabel(formatLabel(key))}
                  </Text>

                  <Text style={styles.value}>
                    {formatValue(value)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.mutedText}>{t("botanistPlantDetail.speciesInformationIsAvailableButThereAreNoAdditionalFields")}</Text>
            )
          ) : (
            <View style={styles.emptyInfo}>
              {plant.isHistoricalVersion ? <Text style={styles.mutedText}>{t("recordEdits.historicalSpeciesUnavailable")}</Text> : <>
              <Text style={styles.emptyInfoTitle}>{t("botanistPlantDetail.noLinkedSpecies")}</Text>

              <Text style={styles.mutedText}>{t("botanistPlantDetail.noMatchingSpeciesInformationWasFoundForThisPlantRecord")}</Text>

              <Text style={styles.smallHint}>{t("botanistPlantDetail.linkTheRecordToASpeciesIdOrScientificName")}</Text>
              </>}
            </View>
          )}
        </View>

        {/* =========================================== */}
        {/* SECTION 2: PLANT INFORMATION */}
        {/* =========================================== */}

        <View style={styles.section}>
          {renderSectionHeader(
            "02",
            "Plant Information",
            "Details observed during the field survey"
          )}

          {PLANT_FIELDS.map((field) =>
            renderField(field)
          )}

          {plant.isHistoricalVersion && [
            ["notes", plant.historicalContent?.notes], ["taxonomy", plant.historicalContent?.taxonomy],
          ].filter(([, value]) => value != null && value !== "").map(([field, value]) => <View style={styles.field} key={`historical-${field}`}>
            <Text style={styles.label}>{translateLabel(formatLabel(field))}</Text><Text style={styles.value}>{formatValue(value)}</Text>
          </View>)}

        </View>

        {/* =========================================== */}
        {/* SECTION 3: STAFF RECORD */}
        {/* =========================================== */}

        <View style={styles.section}>
          {renderSectionHeader(
            "03",
            "Staff Record",
            "GPS coordinates and QR code assignment"
          )}

          {GPS_FIELDS.map((field) =>
            renderField(field)
          )}

          <View style={styles.qrCard}>
            <View style={styles.qrIcon}>
              <Text style={styles.qrIconText}>▦</Text>
            </View>

            <View style={styles.qrInfo}>
              <Text style={styles.label}>{t("botanistPlantDetail.assignedQrCode")}</Text>

              <Text style={styles.qrValue}>
                {plant.qrCode || (plant.isHistoricalVersion ? t("recordEdits.historicalFieldUnavailable") : t("botanistPlantDetail.notAssigned"))}
              </Text>

              <Text style={styles.smallHint}>{t("botanistPlantDetail.qrAssignmentIsManagedSeparately")}</Text>
            </View>
          </View>

        </View>

        {/* =========================================== */}
        {/* SECTION 4: PLANT PHOTOS */}
        {/* =========================================== */}

        <View style={styles.section}>
          {renderSectionHeader(
            "04",
            "Plant Photos",
            "Photos attached to this plant record"
          )}

          {photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.map((photo, index) => (
                <TouchableOpacity
                  style={styles.photoCard}
                  key={`${photo.uri}-${index}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("plantDetail.photoNumber", { value0: index + 1 })}, ${index + 1} / ${photos.length}`}
                  onPress={() => { setSelectedPhotoUri(photo.uri); setPhotoViewerVisible(true); }}
                >
                  <Image
                    source={{ uri: photo.uri, ...(photo.original?.headers ? { headers: photo.original.headers } : {}) }}
                    style={styles.photo}
                    resizeMode="cover"
                    onError={() => failPhoto(photo.uri)}
                  />

                  <Text style={styles.photoCaption}>
                    {photo.original?.caption || t("botanistPlantDetail.photo", { value0: index + 1 })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyInfo}>
              <Text style={styles.photoPlaceholder}>
                🌿
              </Text>

              <Text style={styles.emptyInfoTitle}>{plant.photoLoadError
                ? t("plantDetail.photoUnavailable")
                : plant.isHistoricalVersion ? t("recordEdits.noPhotos") : t("botanistPlantDetail.noPhotosAttached")}</Text>

              {!plant.isHistoricalVersion && !plant.photoLoadError && <Text style={styles.mutedText}>{t("botanistPlantDetail.thereAreNoDisplayablePhotosAttachedToThisPlantRecord")}</Text>}
            </View>
          )}
        </View>

        {/* =========================================== */}
        {/* ACTION BUTTONS */}
        {/* =========================================== */}

        {isEditing ? (
          <>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>{t("botanistPlantDetail.saveChanges")}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleCancelEdit}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>{t("botanistPlantDetail.cancelEditing")}</Text>
            </TouchableOpacity>
          </>
        ) : !plant.isHistoricalVersion && !plant.isServerRecord && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleEdit}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>{t("botanistPlantDetail.editPlantRecord")}</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
      <Modal visible={photoViewerVisible && Boolean(selectedPhoto)} animationType="fade" onRequestClose={() => setPhotoViewerVisible(false)}>
        <View style={styles.photoViewer}>
          <View style={styles.photoViewerTopBar}>
            <View />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.closeImageViewer")} onPress={() => setPhotoViewerVisible(false)} style={styles.photoViewerClose}>
              <Text style={styles.photoViewerCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.photoViewerStage}>
            {selectedPhoto && <Image
              key={selectedPhoto.uri}
              source={{ uri: selectedPhoto.uri, ...(selectedPhoto.original?.headers ? { headers: selectedPhoto.original.headers } : {}) }}
              style={styles.photoViewerImage}
              resizeMode="contain"
              onError={() => failPhoto(selectedPhoto.uri)}
            />}
            {photos.length > 1 && <>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.previousPhoto")} onPress={() => stepSelectedPhoto(-1)} style={[styles.photoViewerNav, styles.photoViewerPrevious]}><Text style={styles.photoViewerNavText}>‹</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("plantDetail.nextPhoto")} onPress={() => stepSelectedPhoto(1)} style={[styles.photoViewerNav, styles.photoViewerNext]}><Text style={styles.photoViewerNavText}>›</Text></TouchableOpacity>
            </>}
          </View>
          {photos.length > 1 && <Text style={styles.photoViewerCounter}>{selectedPhotoIndex + 1} / {photos.length}</Text>}
        </View>
      </Modal>
    </View>
  );
}

// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  content: {
    padding: 20,
    paddingBottom: 20,
  },

  editHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  changeNotice: { padding: 12, borderRadius: 12, backgroundColor: "#FFF1D6", marginBottom: 12, gap: 4 },
  editAvailabilityNote: { padding: 10, borderRadius: 10, backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#EAD9B5", marginBottom: 10, gap: 3 },
  pendingEditLabel: { color: "#77501D", fontSize: 12, fontWeight: "700" },
  changeNoticeText: { color: "#52665A", lineHeight: 20 },
  changeError: { color: "#A34436", marginBottom: 12 },

  title: {
    fontSize: 25,
    fontWeight: "700",
    color: COLORS.dark,
    flexShrink: 1,
  },

  subtitle: {
    marginTop: 6,
    marginBottom: 18,
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.muted,
  },

  recordMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    marginBottom: 18,
    borderRadius: 14,
    backgroundColor: COLORS.light,
  },

  recordMetaText: {
    flex: 1,
  },

  recordMetaStatus: { maxWidth: "58%", alignItems: "flex-end", gap: 6 },

  recordId: {
    fontSize: 11,
    color: COLORS.muted,
  },

  recordIdValue: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.dark,
  },

  statusBadge: {
    maxWidth: "100%",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },

  statusText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },

  approvedStatusBadge: { backgroundColor: "#D8EBD9" },
  pendingStatusBadge: { backgroundColor: "#F4E7D2" },
  pendingStatusText: { color: "#8A6939" },

  versionMetaRow: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 5 },
  versionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: COLORS.dark, backgroundColor: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  currentVersionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: "#FFFFFF", backgroundColor: COLORS.primary, fontSize: 10, fontWeight: "700" },
  supersededVersionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: "#56625A", backgroundColor: "#E7EBE6", fontSize: 10, fontWeight: "700" },

  section: {
    marginBottom: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2EDE0",
    backgroundColor: COLORS.white,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EAF0E6",
  },

  sectionNumber: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.light,
  },

  sectionNumberText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },

  sectionHeading: {
    flex: 1,
    marginLeft: 12,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.dark,
  },

  sectionSubtitle: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.muted,
  },

  field: {
    marginBottom: 16,
  },

  speciesField: {
    marginBottom: 15,
  },

  label: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.dark,
  },

  value: {
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.text,
  },

  input: {
    minHeight: 45,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FCFEFB",
    fontSize: 14,
    color: COLORS.dark,
  },

  multiline: {
    minHeight: 90,
    textAlignVertical: "top",
  },

  emptyInfo: {
    alignItems: "center",
    padding: 18,
    borderRadius: 12,
    backgroundColor: "#F6FAF3",
  },

  emptyInfoTitle: {
    marginBottom: 6,
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.dark,
    textAlign: "center",
  },

  mutedText: {
    fontSize: 12,
    lineHeight: 19,
    color: COLORS.muted,
    textAlign: "center",
  },

  smallHint: {
    marginTop: 7,
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.muted,
  },

  qrCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    marginTop: 2,
    marginBottom: 18,
    borderRadius: 12,
    backgroundColor: COLORS.light,
  },

  qrIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9CDBA6",
  },

  qrIconText: {
    fontSize: 25,
    fontWeight: "700",
    color: COLORS.dark,
  },

  qrInfo: {
    flex: 1,
    marginLeft: 12,
  },

  qrValue: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.primary,
  },

  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },

  photoCard: {
    width: "47%",
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#F6FAF3",
  },

  photo: {
    width: "100%",
    height: 140,
    backgroundColor: "#E9F0E5",
  },

  photoViewer: { flex: 1, paddingHorizontal: 12, paddingTop: 30, paddingBottom: 18, backgroundColor: "#101812" },
  photoViewerTopBar: { height: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoViewerClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF20" },
  photoViewerCloseText: { color: "#FFFFFF", fontSize: 30, lineHeight: 34 },
  photoViewerStage: { flex: 1, alignItems: "center", justifyContent: "center" },
  photoViewerImage: { width: "100%", height: "100%" },
  photoViewerNav: { position: "absolute", top: "45%", width: 46, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: "#FFFFFF35" },
  photoViewerPrevious: { left: 4 },
  photoViewerNext: { right: 4 },
  photoViewerNavText: { color: "#FFFFFF", fontSize: 36, lineHeight: 40, fontWeight: "600" },
  photoViewerCounter: { paddingVertical: 12, color: "#FFFFFF", textAlign: "center", fontSize: 14, fontWeight: "700" },

  photoCaption: {
    padding: 9,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.dark,
  },

  photoPlaceholder: {
    marginBottom: 8,
    fontSize: 36,
  },

  primaryButton: {
    minHeight: 50,
    marginTop: 4,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },

  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.white,
  },

  secondaryButton: {
    minHeight: 46,
    marginTop: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8EEE6",
  },

  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },
  notFoundContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: COLORS.background,
  },
});
