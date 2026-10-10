// screens/PlantDetail.js

import React, { useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from "react-native";

import {
  getPlantById,
  getSpeciesBySlug,
} from "../data/mockData";


export default function PlantDetail({
  route,
  navigation,
}) {
  const { plantId } = route.params || {};

  const plant = getPlantById(plantId);

  // =====================================================
  // PLANT NOT FOUND
  // =====================================================

  if (!plant) {
    return (
      <View style={styles.notFoundContainer}>

        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>
          Plant record not found
        </Text>

        <Text style={styles.notFoundText}>
          The plant record you are looking for
          does not exist.
        </Text>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>
            Go Back
          </Text>
        </TouchableOpacity>

      </View>
    );
  }


  // =====================================================
  // FIND SPECIES
  // =====================================================

  const selectedSpecies = getSpeciesBySlug(
    plant.speciesSlug
  );


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
    >

      {/* =================================================
    PLANT HERO
================================================= */}

<View style={styles.header}>
  <View style={styles.heroGrid}>
    {/* Plant image */}
    <View style={styles.imageFrame}>
      {selectedSpecies?.image ? (
        <Image
          source={{ uri: selectedSpecies.image }}
          style={styles.plantImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Text style={styles.placeholderIcon}>🌿</Text>
          <Text style={styles.placeholderText}>
            Field photograph coming soon
          </Text>
        </View>
      )}
    </View>

    {/* Plant information */}
    <View style={styles.heroCopy}>
      <Text style={styles.headerLabel}>
        VERIFIED PLANT RECORD
      </Text>

      <Text style={styles.plantId}>
        Plant {plant.plantId}
      </Text>

      <Text style={styles.speciesName}>
        {selectedSpecies?.name || plant.speciesSlug}
      </Text>

      <Text style={styles.scientificName}>
        {selectedSpecies?.scientificName || ""}
      </Text>

      <View style={styles.heroBadges}>
        <Text style={styles.heroBadge}>
          {plant.latestApproved.healthStatus}
        </Text>

        <Text style={styles.heroBadge}>
          {plant.latestApproved.lifeStage}
        </Text>

        <Text style={styles.heroBadge}>
          {plant.location.zone}
        </Text>
      </View>
    </View>
  </View>
</View>


      {/* =================================================
          CURRENT VERIFIED RECORD
      ================================================= */}

      <View style={styles.section}>

        <Text style={styles.sectionLabel}>
          CURRENT VERIFIED RECORD
        </Text>

        <Text style={styles.sectionTitle}>
          Plant information
        </Text>


        <View style={styles.card}>

          <InfoRow
            label="Plant ID"
            value={plant.plantId}
          />

          <InfoRow
            label="Species"
            value={
              selectedSpecies
                ? selectedSpecies.name
                : plant.speciesSlug
            }
          />

          <InfoRow
            label="Scientific name"
            value={
              selectedSpecies
                ? selectedSpecies.scientificName
                : "-"
            }
            italic
          />

          <InfoRow
            label="Height"
            value={`${plant.latestApproved.heightCm} cm`}
          />

          <InfoRow
            label="Health status"
            value={
              plant.latestApproved.healthStatus
            }
          />

          <InfoRow
            label="Life stage"
            value={
              plant.latestApproved.lifeStage
            }
          />

          <InfoRow
            label="Location zone"
            value={plant.location.zone}
          />

          <InfoRow
            label="Morphology"
            value={
              plant.latestApproved.morphology
            }
          />

        </View>

      </View>


      {/* =================================================
          STAFF RECORD
      ================================================= */}

      <View style={styles.staffSection}>

        <Text style={styles.sectionLabel}>
          STAFF RECORD
        </Text>


        {/* GPS */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>
            GPS information
          </Text>


          <InfoRow
            label="Latitude"
            value={plant.location.latitude.toFixed(6)}
          />

          <InfoRow
            label="Longitude"
            value={plant.location.longitude.toFixed(6)}
          />

          <InfoRow
            label="Altitude"
            value={`${plant.location.altitudeM} m`}
          />

          <InfoRow
            label="GPS accuracy"
            value={`± ${plant.location.accuracyM} m`}
          />

        </View>


        {/* QR CODE */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>
            QR tag
          </Text>


          <InfoRow
            label="QR code"
            value={plant.qr.code}
          />


          <View
            style={[
              styles.qrStatus,
              plant.qr.status === "Active"
                ? styles.qrActive
                : styles.qrInactive,
            ]}
          >

            <Text
              style={[
                styles.qrStatusText,
                plant.qr.status === "Active"
                  ? styles.qrActiveText
                  : styles.qrInactiveText,
              ]}
            >
              {plant.qr.status}
            </Text>

          </View>

        </View>


        {/* REGISTRATION */}

        <View style={styles.subSection}>

          <Text style={styles.subSectionTitle}>
            Registration
          </Text>


          <InfoRow
            label="Registered by"
            value={plant.registeredBy}
          />

          <InfoRow
            label="Registered at"
            value={formatDate(
              plant.registeredAt
            )}
          />

        </View>

      </View>


      {/* =================================================
          LATEST VERIFIED OBSERVATION
      ================================================= */}

      {latestApprovedObservation && (
        <View style={styles.observesection}>

          <Text style={styles.sectionLabel}>
            LATEST VERIFIED OBSERVATION
          </Text>

          <Text style={styles.sectionTitle}>
            Observation details
          </Text>


          <View style={styles.observationCard}>

            <InfoRow
              label="Observation ID"
              value={
                latestApprovedObservation.observationId
              }
            />

            <InfoRow
              label="Recorded by"
              value={
                latestApprovedObservation.recordedBy
              }
            />

            <InfoRow
              label="Date"
              value={formatDate(
                latestApprovedObservation.date
              )}
            />

            <InfoRow
              label="Height"
              value={`${latestApprovedObservation.heightCm} cm`}
            />

            <InfoRow
              label="Health status"
              value={
                latestApprovedObservation.healthStatus
              }
            />

            <InfoRow
              label="Life stage"
              value={
                latestApprovedObservation.lifeStage
              }
            />

            <InfoRow
              label="Morphology"
              value={
                latestApprovedObservation.morphology
              }
            />

            <InfoRow
              label="Notes"
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

      <View style={styles.historySection}>

        <Text style={styles.sectionLabel}>
          OBSERVATION HISTORY
        </Text>

        <Text style={styles.sectionTitle}>
          Field record timeline
        </Text>


        {sortedObservations.length === 0 ? (

          <View style={styles.emptyHistory}>

            <Text style={styles.emptyText}>
              No observation history available.
            </Text>

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
  return (
    <View style={styles.infoRow}>

      <Text style={styles.infoLabel}>
        {label}
      </Text>

      <Text
        style={[
          styles.infoValue,
          italic && styles.italicValue,
        ]}
      >
        {value || "-"}
      </Text>

    </View>
  );
}


// =====================================================
// OBSERVATION CARD
// =====================================================

function ObservationCard({ observation }) {
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

          <Text style={styles.recordedBy}>
            Recorded by {observation.recordedBy}
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
              {observation.status}
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
            {observation.heightCm} cm
            {" • "}
            {observation.healthStatus}
            {" • "}
            {observation.lifeStage}
          </Text>

          <Text style={styles.historyLabel}>
            Morphology
          </Text>

          <Text style={styles.historyValue}>
            {observation.morphology}
          </Text>

          {observation.notes && (
            <>
              <Text style={styles.historyLabel}>
                Notes
              </Text>

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

  const parts = dateString.split("-");

  if (parts.length !== 3) {
    return dateString;
  }

  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const monthIndex = Number(month) - 1;

  if (
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    return dateString;
  }

  return `${day} ${months[monthIndex]} ${year}`;
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
  paddingTop: 16,
  paddingBottom: 30,
  backgroundColor: "#E8EFE3",
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