
import React, { useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  Alert,
} from "react-native";

import {
  botanistPlantRecords,
  botanistSpeciesRequests,
  plants,
} from "../data/mockData";

const CATEGORIES = ["Trees", "Flowers", "Ferns", "Climbers"];

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


function getSpeciesName(item) {
  if (!item) return "";

  return (
    item.scientificName ||
    item.speciesName ||
    item.name ||
    ""
  );
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

  // 4. If no catalogue record is found, still display
  // the species name selected in the plant form.
  if (plant.scientificName || plant.speciesName) {
    return {
      category: plant.category || "",
    };
  }

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
  const plantId = route.params?.plantId;

 
function findPlant() {
  return botanistPlantRecords.find(
    (item) =>
      String(item.id) === String(plantId) ||
      String(item.plantId) === String(plantId)
  );
}


  const [plant, setPlant] = useState(findPlant);

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
      category: item?.category || "",
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
    const currentPlant = findPlant();

    if (!currentPlant) {
      Alert.alert("Error", "Plant record not found.");
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
      category: currentPlant.category || "",
    });

    setIsEditing(true);
  }

  
  // ===================================================
  // SAVE CHANGES
  // ===================================================

  function handleSave() {
    if (!form.scientificName.trim()) {
      Alert.alert(
        "Missing Information",
        "Please enter the scientific name."
      );
      return;
    }

    if (!form.category) {
      Alert.alert(
        "Missing Information",
        "Please select a category."
      );
      return;
    }

    const index = botanistPlantRecords.findIndex(
      (item) => String(item.id) === String(plantId)
    );

    if (index === -1) {
      Alert.alert("Error", "Plant record not found.");
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
      category: form.category,
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
      "Changes Saved",
      "Your plant record has been updated."
    );
  }


  // ===================================================
  // CANCEL EDITING
  // ===================================================

  function handleCancelEdit() {
    Alert.alert(
      "Discard Changes",
      "Discard your unsaved changes?",
      [
        {
          text: "Continue Editing",
          style: "cancel",
        },
        {
          text: "Discard",
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
    return (
      <View style={styles.field} key={field}>
        <Text style={styles.label}>{label}</Text>

        {isEditing ? (
          <TextInput
            style={[
              styles.input,
              multiline && styles.multiline,
            ]}
            value={String(form[field] ?? "")}
            onChangeText={(value) =>
              updateField(field, value)
            }
            placeholder={`Enter ${label.toLowerCase()}`}
            placeholderTextColor="#9AA7A0"
            keyboardType={numeric ? "numeric" : "default"}
            multiline={multiline}
            textAlignVertical={
              multiline ? "top" : "center"
            }
          />
        ) : (
          <Text style={styles.value}>
            {formatValue(getPlantFieldValue(plant, field))}
          </Text>
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
            {title}
          </Text>

          {subtitle ? (
            <Text style={styles.sectionSubtitle}>
              {subtitle}
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
    return (
      <View style={styles.notFoundContainer}>
        <Text style={styles.title}>
          Plant Record Not Found
        </Text>

        <Text style={styles.mutedText}>
          This record may have been removed.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.primaryButtonText}>
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ===================================================
  // SPECIES INFORMATION
  // ===================================================

  const species = getSpeciesDetails(plant);

  // Do not display internal identifiers or duplicate
  // the four sections with nested species objects.
  const excludedSpeciesFields = [
    "id",
    "speciesId",
    "speciesID",
    "requestId",
    "speciesDetails",
    "speciesInfo",
    "species",
    "photos",
    "photo",
    "image",
    "imageUrl",
    "imageUri",
  ];

  const speciesEntries = species
    ? Object.entries(species).filter(
        ([key]) =>
          !excludedSpeciesFields.includes(key)
      )
    : [];

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


  const photos = rawPhotos
    .map((photo) => ({
      original: photo,
      uri: getPhotoUri(photo),
    }))
    .filter((photo) => photo.uri);

  // ===================================================
  // UI
  // ===================================================

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* PAGE HEADER */}

        <Text style={styles.title}>
          {isEditing
            ? "Edit Plant Record"
            : "Plant Record"}
        </Text>

        <Text style={styles.subtitle}>
          Review and manage your plant documentation.
        </Text>

        <View style={styles.recordMeta}>
          <View style={styles.recordMetaText}>
            <Text style={styles.recordId}>
              Record ID
            </Text>

            <Text style={styles.recordIdValue}>
              {String(plant.id)}
            </Text>
          </View>

          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>
              {formatValue(plant.status || "Pending")}
            </Text>
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

          {species ? (
            speciesEntries.length > 0 ? (
              speciesEntries.map(([key, value]) => (
                <View style={styles.speciesField} key={key}>
                  <Text style={styles.label}>
                    {formatLabel(key)}
                  </Text>

                  <Text style={styles.value}>
                    {formatValue(value)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.mutedText}>
                Species information is available, but
                there are no additional fields to display.
              </Text>
            )
          ) : (
            <View style={styles.emptyInfo}>
              <Text style={styles.emptyInfoTitle}>
                No Linked Species
              </Text>

              <Text style={styles.mutedText}>
                No matching species information was found
                for this plant record.
              </Text>

              <Text style={styles.smallHint}>
                Link the record to a species ID or scientific
                name in your data to display its information.
              </Text>
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

          <View style={styles.field}>
            <Text style={styles.label}>Category</Text>

            {isEditing ? (
              <View style={styles.categoryRow}>
                {CATEGORIES.map((category) => {
                  const selected =
                    form.category === category;

                  return (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryButton,
                        selected &&
                          styles.categoryButtonSelected,
                      ]}
                      onPress={() =>
                        updateField("category", category)
                      }
                    >
                      <Text
                        style={[
                          styles.categoryText,
                          selected &&
                            styles.categoryTextSelected,
                        ]}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.value}>
                {formatValue(plant.category)}
              </Text>
            )}
          </View>
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
              <Text style={styles.label}>
                Assigned QR Code
              </Text>

              <Text style={styles.qrValue}>
                {plant.qrCode || "Not assigned"}
              </Text>

              <Text style={styles.smallHint}>
                QR assignment is managed separately.
              </Text>
            </View>
          </View>

          <View style={styles.staffMeta}>
            <Text style={styles.label}>
              Submitted By
            </Text>

            <Text style={styles.value}>
              {formatValue(plant.botanist)}
            </Text>
          </View>

          <View style={styles.staffMeta}>
            <Text style={styles.label}>
              Sync Status
            </Text>

            <Text style={styles.value}>
              {formatValue(plant.syncStatus)}
            </Text>
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
                <View
                  style={styles.photoCard}
                  key={`${photo.uri}-${index}`}
                >
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.photo}
                    resizeMode="cover"
                  />

                  <Text style={styles.photoCaption}>
                    {photo.original?.caption || `Photo ${index + 1}`}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyInfo}>
              <Text style={styles.photoPlaceholder}>
                🌿
              </Text>

              <Text style={styles.emptyInfoTitle}>
                No Photos Attached
              </Text>

              <Text style={styles.mutedText}>
                There are no displayable photos attached
                to this plant record.
              </Text>
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
              <Text style={styles.primaryButtonText}>
                Save Changes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleCancelEdit}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>
                Cancel Editing
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleEdit}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              Edit Plant Record
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>
            Back to Dashboard
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingBottom: 40,
  },

  title: {
    fontSize: 25,
    fontWeight: "700",
    color: COLORS.dark,
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
    maxWidth: "50%",
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

  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  categoryButton: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },

  categoryButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },

  categoryText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },

  categoryTextSelected: {
    color: COLORS.white,
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

  staffMeta: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#EAF0E6",
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
