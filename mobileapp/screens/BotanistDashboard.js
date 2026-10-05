import React, { useCallback, useState } from "react";

import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";

import { useFocusEffect } from "@react-navigation/native";

import { plants } from "../data/mockData";

export default function BotanistDashboardScreen({
  route,
  navigation,
  onLogout,
}) {
  const botanist = route.params?.botanist;

  const [myPlants, setMyPlants] = useState([]);

  // Refresh plant records whenever this screen becomes active
  useFocusEffect(
    useCallback(() => {
      const updatedPlants = plants.filter(
        (plant) =>
          plant.botanist === botanist?.name
      );

      setMyPlants(updatedPlants);
    }, [botanist?.name])
  );

  // Pending approval records
  const pendingApproval = myPlants.filter(
    (plant) =>
      plant.status === "pending" ||
      plant.status === "Pending Approval" ||
      plant.status === "pending_approval" ||
      plant.syncStatus === "Pending Sync" ||
      plant.syncStatus === "pending"
  );

  // Approved records
  const approvedPlants = myPlants.filter(
    (plant) =>
      plant.status === "approved" ||
      plant.status === "Approved"
  );

  function handleLogout() {
    if (onLogout) {
      onLogout();
      return;
    }

    navigation.goBack();
  }

  function handlePlantPress(plant) {
    navigation.navigate("PlantDetail", {
      id: plant.id,
      slug: plant.slug,
      plant,
      botanist,
    });
  }

  function handleAddPlant() {
    navigation.navigate("AddPlant", {
      botanist,
    });
  }

  function handleQRCodeManagement() {
    navigation.navigate("PlantQRCode", {
      botanist,
    });
  }

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>

        <View style={styles.headerText}>

          <Text style={styles.greeting}>
            Hello, {botanist?.name || "Botanist"} 👋
          </Text>

          <Text style={styles.subtitle}>
            Manage your plant records
          </Text>

        </View>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.75}
        >
          <Text style={styles.logoutText}>
            Logout
          </Text>
        </TouchableOpacity>

      </View>


      {/* Statistics */}
      <View style={styles.statsRow}>

        {/* My Plants */}
        <View style={styles.statCard}>

          <View style={styles.statIcon}>
            <Text>🌿</Text>
          </View>

          <Text style={styles.statNumber}>
            {myPlants.length}
          </Text>

          <Text style={styles.statLabel}>
            My Plants
          </Text>

        </View>


        {/* Pending Approval */}
        <View style={styles.statCard}>

          <View style={styles.statIcon}>
            <Text>⏳</Text>
          </View>

          <Text style={styles.statNumber}>
            {pendingApproval.length}
          </Text>

          <Text style={styles.statLabel}>
            Pending Approval
          </Text>

        </View>


        {/* Approved */}
        <View style={styles.statCard}>

          <View style={styles.statIcon}>
            <Text>✓</Text>
          </View>

          <Text style={styles.statNumber}>
            {approvedPlants.length}
          </Text>

          <Text style={styles.statLabel}>
            Approved
          </Text>

        </View>

      </View>


      {/* QR Code Management */}
      <TouchableOpacity
        style={styles.qrButton}
        activeOpacity={0.8}
        onPress={handleQRCodeManagement}
      >

        <View style={styles.qrButtonIcon}>
          <Text style={styles.qrIconText}>
            ▦
          </Text>
        </View>

        <View style={styles.qrButtonInfo}>

          <Text style={styles.qrButtonTitle}>
            QR Code Management
          </Text>

          <Text style={styles.qrButtonSubtitle}>
            Generate and print QR codes before your field survey
          </Text>

        </View>

        <Text style={styles.arrow}>
          ›
        </Text>

      </TouchableOpacity>


      {/* Add Plant Button */}
      <TouchableOpacity
        style={styles.addButton}
        activeOpacity={0.8}
        onPress={handleAddPlant}
      >
        <Text style={styles.addButtonText}>
          + Add New Plant Record
        </Text>
      </TouchableOpacity>


      {/* Section Title */}
      <Text style={styles.sectionTitle}>
        My Plant Records
      </Text>


      {/* Plant List */}
      <FlatList
        data={myPlants}
        keyExtractor={(item, index) =>
          String(
            item.id ||
            item.slug ||
            index
          )
        }
        showsVerticalScrollIndicator={false}

        renderItem={({ item }) => {

          const isPending =
            item.status === "pending" ||
            item.status === "Pending Approval" ||
            item.status === "pending_approval" ||
            item.syncStatus === "Pending Sync" ||
            item.syncStatus === "pending";

          const isApproved =
            item.status === "approved" ||
            item.status === "Approved";

          const isRejected =
            item.status === "rejected" ||
            item.status === "Rejected";

          return (
            <TouchableOpacity
              style={styles.plantCard}
              activeOpacity={0.75}
              onPress={() =>
                handlePlantPress(item)
              }
            >

              <View style={styles.plantInfo}>

                <Text style={styles.plantName}>
                  {item.scientificName ||
                    item.name ||
                    "Unnamed Plant"}
                </Text>

                <Text style={styles.commonName}>
                  {item.name ||
                    item.commonName ||
                    "No common name"}
                </Text>

                <Text style={styles.recordId}>
                  ID: {item.id || "No ID"}
                </Text>

                {/* QR Code */}
                {item.qrCode && (
                  <Text style={styles.qrCodeText}>
                    QR: {item.qrCode}
                  </Text>
                )}

              </View>


              <View style={styles.badgeContainer}>

                {/* Pending */}
                {isPending && (
                  <View
                    style={[
                      styles.statusBadge,
                      styles.pendingBadge,
                    ]}
                  >
                    <Text style={styles.pendingText}>
                      ⏳ Pending Approval
                    </Text>
                  </View>
                )}


                {/* Approved */}
                {isApproved && (
                  <View
                    style={[
                      styles.statusBadge,
                      styles.approvedBadge,
                    ]}
                  >
                    <Text style={styles.approvedText}>
                      ✓ Approved
                    </Text>
                  </View>
                )}


                {/* Rejected */}
                {isRejected && (
                  <View
                    style={[
                      styles.statusBadge,
                      styles.rejectedBadge,
                    ]}
                  >
                    <Text style={styles.rejectedText}>
                      ✕ Rejected
                    </Text>
                  </View>
                )}


                {/* QR Status */}
                {item.qrStatus && (
                  <View style={styles.qrStatusBadge}>
                    <Text style={styles.qrStatusText}>
                      QR: {item.qrStatus}
                    </Text>
                  </View>
                )}

              </View>

            </TouchableOpacity>
          );
        }}


        ListEmptyComponent={
          <View style={styles.empty}>

            <Text style={styles.emptyIcon}>
              🌱
            </Text>

            <Text style={styles.emptyTitle}>
              No plant records yet
            </Text>

            <Text style={styles.emptyText}>
              Generate QR codes first, then add
              plant records during your field survey.
            </Text>

          </View>
        }
      />

    </View>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F3F8F4",
    paddingHorizontal: 20,
    padding: 50,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 25,
    marginBottom: 20,
  },

  headerText: {
    flex: 1,
  },

  greeting: {
    fontSize: 25,
    fontWeight: "700",
    color: "#468585",
  },

  subtitle: {
    fontSize: 14,
    color: "#6B7D73",
    marginTop: 4,
  },

  logoutButton: {
    backgroundColor: "#E8F3EC",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },

  logoutText: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "600",
  },


  /* Statistics */

  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },

  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 6,
    alignItems: "center",

    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#DEF9C4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 7,
  },

  statNumber: {
    fontSize: 21,
    fontWeight: "700",
    color: "#468585",
  },

  statLabel: {
    fontSize: 11,
    color: "#6B7D73",
    marginTop: 3,
    textAlign: "center",
  },


  /* QR Management */

  qrButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,

    flexDirection: "row",
    alignItems: "center",

    borderWidth: 1,
    borderColor: "#D9EBDD",

    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },

  qrButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: "#DEF9C4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  qrIconText: {
    fontSize: 27,
    fontWeight: "700",
    color: "#468585",
  },

  qrButtonInfo: {
    flex: 1,
  },

  qrButtonTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
  },

  qrButtonSubtitle: {
    fontSize: 12,
    color: "#718078",
    marginTop: 4,
    lineHeight: 17,
  },

  arrow: {
    fontSize: 28,
    color: "#50B498",
    marginLeft: 5,
  },


  /* Add Plant */

  addButton: {
    backgroundColor: "#50B498",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 20,
  },

  addButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },


  /* Plant Records */

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 12,
  },

  plantCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,

    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",

    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },

  plantInfo: {
    flex: 1,
    paddingRight: 10,
  },

  plantName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
  },

  commonName: {
    fontSize: 14,
    color: "#5F6F65",
    marginTop: 4,
  },

  recordId: {
    fontSize: 11,
    color: "#9AA79F",
    marginTop: 6,
  },

  qrCodeText: {
    fontSize: 11,
    color: "#50B498",
    fontWeight: "600",
    marginTop: 4,
  },


  /* Status */

  badgeContainer: {
    alignItems: "flex-end",
    gap: 5,
  },

  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
  },

  pendingBadge: {
    backgroundColor: "#FFF3D6",
  },

  approvedBadge: {
    backgroundColor: "#DEF9C4",
  },

  rejectedBadge: {
    backgroundColor: "#FFE3E3",
  },

  pendingText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9A7215",
  },

  approvedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#35652F",
  },

  rejectedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#B44A4A",
  },

  qrStatusBadge: {
    backgroundColor: "#E8F3EC",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
  },

  qrStatusText: {
    fontSize: 9,
    fontWeight: "600",
    color: "#468585",
  },


  /* Empty */

  empty: {
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 30,
  },

  emptyIcon: {
    fontSize: 45,
    marginBottom: 12,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 8,
  },

  emptyText: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    color: "#718078",
  },

}); 