import { t, translateLabel, translateUIMessage, dateLocale, useAppTranslation, translateFieldValue } from "../translations/i18n";
// screens/PlantDetail.js

import React, { useCallback, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import {
  getPlantById,
  getSpeciesBySlug,
} from "../data/mockData";
import { getSpeciesImageSource } from "../data/speciesImages";
import { fetchPlantDetail } from "../utils/plantApi";
import RefreshButton from "../components/RefreshButton";


export default function PlantDetail({
  route,
  navigation,
  user,
}) {
  useAppTranslation();
  const { plantId } = route.params || {};
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const [plant, setPlant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(null);

  const loadPlant = useCallback((isRefresh = false) => {
    if (requestRef.current) return requestRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");

    if (!/^\d+$/.test(String(plantId ?? ""))) {
      setPlant(getPlantById(plantId) || null);
      setLoading(false);
      setRefreshing(false);
      return Promise.resolve();
    }

    const request = (async () => {
      try {
        const backendPlant = await fetchPlantDetail(plantId, {
          includeObservations: isBotanist,
          accountId: user?.id,
        });
        setPlant(backendPlant);
      } catch (error) {
        setErrorMessage(error.message || "Unable to load this plant record.");
      } finally {
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    })();
    requestRef.current = request;
    return request;
  }, [plantId, isBotanist, user?.id]);

  useFocusEffect(useCallback(() => {
    void loadPlant(false);
  }, [loadPlant]));

  // =====================================================
  // PLANT NOT FOUND
  // =====================================================

  if (loading && !plant) {
    return (
      <View style={styles.notFoundContainer}>
        <Text style={styles.notFoundTitle}>{t("plantDetail.loadingPlantRecord")}</Text>
      </View>
    );
  }

  if (!plant) {
    return (
      <View style={styles.notFoundContainer}>

        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>{t("plantDetail.plantRecordNotFound")}</Text>

        <Text style={styles.notFoundText}>
          {errorMessage || t("plantDetail.thePlantRecordYouAreLookingForDoesNotExist")}
        </Text>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>{t("common.goBack")}</Text>
        </TouchableOpacity>

      </View>
    );
  }


  // =====================================================
  // FIND SPECIES
  // =====================================================

  const selectedSpecies = plant.species || getSpeciesBySlug(plant.speciesSlug) || {
    name: plant.commonName,
    scientificName: plant.scientificName,
    genus: plant.genus,
  };
  const speciesImageSource = getSpeciesImageSource(selectedSpecies);


  // =====================================================
  // SORT OBSERVATIONS
  // =====================================================

  const sortedObservations = [
    ...(plant.observations || []),
  ].sort((a, b) => {
    return (
      new Date(b.date).getTime() -
      new Date(a.date).getTime()
    );
  });


  // =====================================================
  // LATEST APPROVED OBSERVATION
  // =====================================================

  const latestApprovedObservation =
    sortedObservations.find(
      (observation) =>
        observation.status === "Approved"
    );


  // =====================================================
  // SCREEN
  // =====================================================

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void loadPlant(true)}
          tintColor="#315B49"
          colors={["#315B49"]}
        />
      }
    >

      {/* =================================================
    PLANT HERO
================================================= */}

<View style={styles.header}>
  {!!errorMessage && (
    <Text style={styles.refreshError}>{translateUIMessage(errorMessage)}</Text>
  )}
  <View style={styles.heroToolbar}>
  <TouchableOpacity
    style={styles.heroBackButton}
    onPress={() => navigation.goBack()}
    activeOpacity={0.8}
  >
    <Text style={styles.heroBackText}>{t("plant.back")}</Text>
  </TouchableOpacity>
  <RefreshButton
    onPress={() => void loadPlant(true)}
    loading={loading || refreshing}
    label={t("common.refresh")}
    testID="plant-detail-refresh"
  />
  </View>

  <View style={styles.heroGrid}>
    {/* Plant image */}
    <View style={styles.imageFrame}>
      {speciesImageSource ? (
        <Image
          source={speciesImageSource}
          style={styles.plantImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.placeholderIcon}>🌿</Text>
          <Text style={styles.placeholderText}>{t("plantDetail.fieldPhotographComingSoon")}</Text>
        </View>
      )}
    </View>

    {/* Plant information */}
    <View style={styles.heroCopy}>
      <Text style={styles.headerLabel}>{t("plantDetail.plantRecord")}</Text>

      <Text style={styles.plantId}>{t("fieldCollection.plant")}{plant.plantId}
      </Text>

      <Text style={styles.speciesName}>
        {selectedSpecies?.name || plant.speciesSlug}
      </Text>

      <Text style={styles.scientificName}>
        {selectedSpecies?.scientificName || ""}
      </Text>

      <View style={styles.heroBadges}>
        {isBotanist && (
          <Text style={styles.heroBadge}>
            {translateLabel(plant.latestApproved?.healthStatus || t("plant.notRecorded"))}
          </Text>
        )}

        <Text style={styles.heroBadge}>
          {translateLabel(plant.latestApproved?.lifeStage || t("plant.notRecorded"))}
        </Text>

        {isBotanist && (
          <Text style={styles.heroBadge}>
            {plant.location?.zone || t("plant.notRecorded")}
          </Text>
        )}
      </View>
    </View>
  </View>
</View>


      {/* =================================================
          CURRENT PLANT RECORD
      ================================================= */}

      <View style={styles.section}>

        <Text style={styles.sectionLabel}>{t("plantDetail.currentVerifiedRecord")}</Text>

        <Text style={styles.sectionTitle}>{t("plantDetail.plantInformation")}</Text>


        <View style={styles.card}>

          <InfoRow
            label={t("plantDetail.plantId")}
            value={plant.plantId}
          />

          <InfoRow
            label={t("plantDetail.species")}
            value={
              selectedSpecies
                ? selectedSpecies.name
                : plant.speciesSlug
            }
          />

          <InfoRow
            label={t("plantDetail.scientificName")}
            value={
              selectedSpecies
                ? selectedSpecies.scientificName
                : "-"
            }
            italic
          />

          <InfoRow
            label={t("plant.height")}
            value={plant.latestApproved?.heightCm != null ? `${plant.latestApproved.heightCm} cm` : t("plant.notRecorded")}
          />

          {isBotanist && (
            <InfoRow
              label={t("plantDetail.healthStatus")}
              value={plant.latestApproved?.healthStatus || t("plant.notRecorded")}
            />
          )}

          <InfoRow
            label={t("plant.lifeStage")}
            value={
              plant.latestApproved?.lifeStage || t("plant.notRecorded")
            }
          />

          <InfoRow
            label={t("plant.genus")}
              value={selectedSpecies?.genus || t("plant.notRecorded")}
          />

          <InfoRow
            label={t("plantDetail.lastVerified")}
            value={formatDate(plant.latestApproved?.date)}
          />

          {isBotanist && (
            <InfoRow
              label={t("plantDetail.locationZone")}
              value={plant.location?.zone || t("plant.notRecorded")}
            />
          )}

          <InfoRow
            label={t("botanistPlantDetail.morphology")}
            value={
              plant.latestApproved?.morphology || t("plant.notRecorded")
            }
          />

        </View>

      </View>

      {isBotanist && (
        <View style={styles.addObservationSection}>
          <TouchableOpacity
            style={styles.addObservationButton}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate("AddObservation", {
                plantId: plant.plantId,
              })
            }
          >
            <Text style={styles.addObservationButtonText}>{t("plantDetail.addNewObservation")}</Text>
          </TouchableOpacity>
        </View>
      )}


      {/* =================================================
          STAFF RECORD
      ================================================= */}

      {isBotanist && (
      <View style={styles.staffSection}>

        <Text style={styles.sectionLabel}>{t("plantDetail.staffRecord")}</Text>


        {/* GPS */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.gpsInformation")}</Text>


          <InfoRow
            label={t("botanistPlantDetail.latitude")}
            value={formatCoordinate(plant.location?.latitude)}
          />

          <InfoRow
            label={t("botanistPlantDetail.longitude")}
            value={formatCoordinate(plant.location?.longitude)}
          />

          <InfoRow
            label={t("plantDetail.altitude")}
            value={plant.location?.altitudeM != null ? `${plant.location.altitudeM} m` : t("plant.notRecorded")}
          />

          <InfoRow
            label={t("plantDetail.gpsAccuracy")}
            value={plant.location?.accuracyM != null ? `± ${plant.location.accuracyM} m` : t("plant.notRecorded")}
          />

        </View>


        {/* QR CODE */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.qrTag")}</Text>


          <InfoRow
            label={t("plantDetail.qrCode")}
            value={plant.qr?.label || plant.qr?.code || t("plant.notRecorded")}
          />


          <View
            style={[
              styles.qrStatus,
              plant.qr?.status === "Active"
                ? styles.qrActive
                : styles.qrInactive,
            ]}
          >

            <Text
              style={[
                styles.qrStatusText,
                plant.qr?.status === "Active"
                  ? styles.qrActiveText
                  : styles.qrInactiveText,
              ]}
            >
              {translateLabel(plant.qr?.status || t("plant.notRecorded"))}
            </Text>

          </View>

        </View>


        {/* REGISTRATION */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>{t("plantDetail.registration")}</Text>


          <InfoRow
            label={t("plantDetail.registeredBy")}
            value={plant.registeredBy ?? t("plant.notRecorded")}
          />

          <InfoRow
            label={t("plantDetail.registeredAt")}
            value={formatDate(
              plant.registeredAt
            )}
          />

        </View>

      </View>
      )}


      {/* =================================================
          LATEST VERIFIED OBSERVATION
      ================================================= */}

      {isBotanist && latestApprovedObservation && (
        <View style={styles.observesection}>

          <Text style={styles.sectionLabel}>{t("plantDetail.latestVerifiedObservation")}</Text>

          <Text style={styles.sectionTitle}>{t("plantDetail.observationDetails")}</Text>


          <View style={styles.observationCard}>

            <InfoRow
              label={t("plantDetail.observationId")}
              value={
                latestApprovedObservation.observationId
              }
            />

            <InfoRow
              label={t("plantDetail.recordedBy")}
              value={
                latestApprovedObservation.recordedBy
              }
            />

            <InfoRow
              label={t("plantDetail.date")}
              value={formatDate(
                latestApprovedObservation.date
              )}
            />

            <InfoRow
              label={t("plant.height")}
              value={latestApprovedObservation.heightCm != null ? `${latestApprovedObservation.heightCm} cm` : t("plant.notRecorded")}
            />

            <InfoRow
              label={t("plantDetail.healthStatus")}
              value={
                latestApprovedObservation.healthStatus
              }
            />

            <InfoRow
              label={t("plant.lifeStage")}
              value={
                latestApprovedObservation.lifeStage
              }
            />

            <InfoRow
              label={t("botanistPlantDetail.morphology")}
              value={
                latestApprovedObservation.morphology
              }
            />

            <InfoRow
              label={t("plantDetail.notes")}
              value={
                latestApprovedObservation.notes
              }
            />

          </View>

        </View>
      )}


      {/* =================================================
          OBSERVATION HISTORY
      ================================================= */}

      {isBotanist && (
      <View style={styles.historySection}>

        <Text style={styles.sectionLabel}>{t("plantDetail.observationHistory")}</Text>

        <Text style={styles.sectionTitle}>{t("plantDetail.fieldRecordTimeline")}</Text>


        {sortedObservations.length === 0 ? (

          <View style={styles.emptyHistory}>

            <Text style={styles.emptyText}>{t("plantDetail.noObservationHistoryAvailable")}</Text>

          </View>

        ) : (

          sortedObservations.map(
            (observation) => (
              <ObservationCard
                key={observation.observationId}
                observation={observation}
              />
            )
          )

        )}

      </View>
      )}

    </ScrollView>
  );
}


// =====================================================
// INFO ROW
// =====================================================

function InfoRow({
  label,
  value,
  italic = false,
}) {
  useAppTranslation();
  return (
    <View style={styles.infoRow}>

      <Text style={styles.infoLabel}>
        {translateLabel(label)}
      </Text>

      <Text
        style={[
          styles.infoValue,
          italic && styles.italicValue,
        ]}
      >
        {translateFieldValue(label, value || "-")}
      </Text>

    </View>
  );
}


// =====================================================
// OBSERVATION CARD
// =====================================================

function ObservationCard({ observation }) {
  useAppTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View style={styles.historyCard}>
      <TouchableOpacity
        style={styles.historyHeader}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.8}
      >
        <View style={styles.historyHeaderText}>
          <Text style={styles.observationDate}>
            {formatDate(observation.date)}
          </Text>

          <Text style={styles.recordedBy}>{t("plantDetail.recordedBy2")}{observation.recordedBy}
          </Text>
        </View>

        <View style={styles.observationHeaderRight}>
          <View
            style={[
              styles.statusBadge,
              observation.status === "Approved"
                ? styles.approvedBadge
                : styles.pendingBadge,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                observation.status === "Approved"
                  ? styles.approvedText
                  : styles.pendingText,
              ]}
            >
              {translateLabel(observation.status)}
            </Text>
          </View>

          <Text style={styles.observationArrow}>
            {isOpen ? "▲" : "▼"}
          </Text>
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View>
          <View style={styles.divider} />

          <Text style={styles.observationId}>
            {observation.observationId}
          </Text>

          <Text style={styles.observationSummary}>
            {observation.heightCm != null ? t("plantDetail.cm", { heightCm: observation.heightCm }) : t("plantDetail.heightNotRecorded")}
            {" • "}
            {observation.healthStatus || t("plant.notRecorded")}
            {" • "}
            {observation.lifeStage || t("plant.notRecorded")}
          </Text>

          <Text style={styles.historyLabel}>{t("botanistPlantDetail.morphology")}</Text>

          <Text style={styles.historyValue}>
            {observation.morphology || t("plant.notRecorded")}
          </Text>

          {observation.notes && (
            <>
              <Text style={styles.historyLabel}>{t("plantDetail.notes")}</Text>

              <Text style={styles.notes}>
                {observation.notes}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}


// =====================================================
// DATE FORMAT
// =====================================================

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCoordinate(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toFixed(6)
    : "Not recorded";
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },


  // ===================================================
  // HEADER
  // ===================================================

  
header: {
  paddingHorizontal: 20,
  paddingTop: 50,
  paddingBottom: 30,
  backgroundColor: "#E8EFE3",
},

refreshError: {
  marginBottom: 14,
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 12,
  color: "#8A2D2D",
  backgroundColor: "#FCE8E6",
  fontSize: 12,
  lineHeight: 18,
},

heroToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },

heroBackButton: {
  alignSelf: "flex-start",
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: "#FFFFFFAA",
},

heroBackText: {
  color: "#315B49",
  fontSize: 12,
  fontWeight: "700",
},

heroGrid: {
  flexDirection: "column",
  gap: 22,
},

imageFrame: {
  width: "100%",
  height: 260,
  borderRadius: 20,
  overflow: "hidden",
  backgroundColor: "#DCE8D6",
},

plantImage: {
  width: "100%",
  height: "100%",
},

imagePlaceholder: {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  backgroundColor: "#DCE8D6",
},

placeholderIcon: {
  fontSize: 42,
  marginBottom: 12,
},

placeholderText: {
  color: "#577265",
  fontSize: 12,
  textAlign: "center",
},

heroCopy: {
  paddingHorizontal: 2,
},

headerLabel: {
  alignSelf: "flex-start",
  marginBottom: 10,
  color: "#438565",
  fontSize: 10,
  fontWeight: "700",
  letterSpacing: 1.5,
},

plantId: {
  color: "#234A3C",
  fontSize: 30,
  fontWeight: "700",
  letterSpacing: -0.6,
},

speciesName: {
  marginTop: 8,
  color: "#405F56",
  fontSize: 19,
  fontWeight: "600",
  lineHeight: 26,
},

scientificName: {
  marginTop: 5,
  color: "#7C6955",
  fontSize: 14,
  fontStyle: "italic",
  lineHeight: 21,
},

heroBadges: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 18,
},

heroBadge: {
  overflow: "hidden",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 20,
  backgroundColor: "#D2E4D0",
  color: "#315B49",
  fontSize: 11,
  fontWeight: "600",
},


  // ===================================================
  // SECTION
  // ===================================================

  section: {
    padding: 22,
  },

  observesection: {
    padding: 22,
    paddingTop:30,
    paddingBottom: 50,
    marginBottom:20,
    backgroundColor: "#E0EBDD",
  }, 

  sectionLabel: {
    marginBottom: 8,
    color: "#50A078",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },

  sectionTitle: {
    marginBottom: 18,
    color: "#234A3C",
    fontSize: 27,
    fontWeight: "600",
  },


  // ===================================================
  // CARD
  // ===================================================

  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  addObservationSection: {
    paddingHorizontal: 22,
    paddingBottom: 26,
  },

  addObservationButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#315B49",
  },

  addObservationButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  infoRow: {
    marginBottom: 17,
  },

  infoLabel: {
    marginBottom: 4,
    color: "#7C8982",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  infoValue: {
    color: "#315447",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },

  italicValue: {
    fontStyle: "italic",
  },


  // ===================================================
  // STAFF
  // ===================================================

  staffSection: {
    marginHorizontal: 20,
    marginBottom: 50,
    padding: 20,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  subSection: {
    marginTop: 8,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "#E6E8E0",
  },

  subSectionTitle: {
    marginBottom: 15,
    color: "#315F4E",
    fontSize: 16,
    fontWeight: "700",
  },


  // ===================================================
  // QR STATUS
  // ===================================================

  qrStatus: {
    alignSelf: "flex-start",
    marginTop: -5,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  qrActive: {
    backgroundColor: "#D8EBD9",
  },

  qrInactive: {
    backgroundColor: "#F4E0DE",
  },

  qrStatusText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  qrActiveText: {
    color: "#34785D",
  },

  qrInactiveText: {
    color: "#A34E45",
  },


  // ===================================================
  // LATEST OBSERVATION
  // ===================================================

  observationCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },

  observationHeaderRight: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

observationArrow: {
  color: "#315B49",
  fontSize: 10,
  fontWeight: "700",
},


  // ===================================================
  // HISTORY
  // ===================================================

  historySection: {
    padding: 22,
  },

  historyCard: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#21392C",
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },

  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  historyHeaderText: {
    flex: 1,
  },

  observationDate: {
    color: "#315447",
    fontSize: 13,
    fontWeight: "700",
  },

  recordedBy: {
    marginTop: 4,
    color: "#7C8982",
    fontSize: 10,
  },

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },

  approvedBadge: {
    backgroundColor: "#D8EBD9",
  },

  pendingBadge: {
    backgroundColor: "#F4E7D2",
  },

  statusText: {
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  approvedText: {
    color: "#34785D",
  },

  pendingText: {
    color: "#8A6939",
  },

  divider: {
    height: 1,
    marginVertical: 13,
    backgroundColor: "#E7E8E1",
  },

  observationId: {
    color: "#234A3C",
    fontSize: 12,
    fontWeight: "700",
  },

  observationSummary: {
    marginTop: 6,
    color: "#50675D",
    fontSize: 11,
    fontWeight: "600",
  },

  historyLabel: {
    marginTop: 13,
    marginBottom: 4,
    color: "#7C8982",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  historyValue: {
    color: "#405F56",
    fontSize: 11,
    lineHeight: 17,
  },

  notes: {
    color: "#6C7973",
    fontSize: 11,
    lineHeight: 17,
    fontStyle: "italic",
  },

  emptyHistory: {
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BDC8BD",
    borderRadius: 15,
  },

  emptyText: {
    color: "#6A7B73",
    fontSize: 12,
  },

  // ===================================================
  // NOT FOUND
  // ===================================================

  notFoundContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    backgroundColor: "#F8F6EE",
  },

  notFoundIcon: {
    fontSize: 50,
  },

  notFoundTitle: {
    marginTop: 15,
    color: "#234A3C",
    fontSize: 24,
    fontWeight: "600",
  },

  notFoundText: {
    marginTop: 8,
    color: "#63736A",
    fontSize: 12,
    textAlign: "center",
  },

  backButton: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  backButtonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

});
