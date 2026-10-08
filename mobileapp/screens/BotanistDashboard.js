import React, {
  useCallback,
  useState,
} from "react";

import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";

import {
  useFocusEffect,
} from "@react-navigation/native";

import {
  botanistPlantRecords,
} from "../data/mockData";


export default function BotanistDashboardScreen({
  route,
  navigation,
  onLogout,
}) {

  const botanist =
    route.params?.botanist;

  const [
    myPlants,
    setMyPlants,
  ] = useState([]);


  // =====================================================
  // REFRESH PLANT RECORDS
  // =====================================================

  useFocusEffect(
    useCallback(() => {

      const updatedPlants =
        botanistPlantRecords.filter(
          (plant) =>
            plant.botanist ===
            botanist?.name
        );

      setMyPlants(
        updatedPlants
      );

    }, [botanist?.name])
  );


  // =====================================================
  // PENDING APPROVAL
  // =====================================================

  const pendingApproval =
    myPlants.filter(
      (plant) =>
        plant.status === "pending" ||
        plant.status ===
          "Pending Approval" ||
        plant.status ===
          "pending_approval" ||
        plant.syncStatus ===
          "Pending Sync" ||
        plant.syncStatus ===
          "pending"
    );


  // =====================================================
  // APPROVED
  // =====================================================

  const approvedPlants =
    myPlants.filter(
      (plant) =>
        plant.status ===
          "approved" ||
        plant.status ===
          "Approved"
    );


  // =====================================================
  // LOGOUT
  // =====================================================

  function handleLogout() {

    if (onLogout) {
      onLogout();
      return;
    }

    navigation.goBack();
  }


  // =====================================================
  // PLANT PRESS
  // =====================================================

  function handlePlantPress(
    plant
  ) {

    /*
      For now, we do not navigate to PlantDetails.

      The new botanist plant record has a different
      data structure from the existing public plantRecords.

      We can create BotanistPlantDetail later.
    */

    console.log(
      "Selected botanist plant:",
      plant
    );
  }


  // =====================================================
  // ADD PLANT
  // =====================================================

  function handleAddPlant() {

    navigation.navigate(
      "AddPlant",
      {
        botanist,
      }
    );
  }


  // =====================================================
  // QR CODE MANAGEMENT
  // =====================================================

  function handleQRCodeManagement() {

    navigation.navigate(
      "PlantQRCode",
      {
        botanist,
      }
    );
  }


  // =====================================================
  // RENDER PLANT
  // =====================================================

  function renderPlant({
    item,
  }) {

    return (
      <TouchableOpacity
        style={
          styles.plantCard
        }
        activeOpacity={0.8}
        onPress={() =>
          handlePlantPress(
            item
          )
        }
      >

        {/* LEFT */}

        <View
          style={
            styles.plantInfo
          }
        >

          <Text
            style={
              styles.scientificName
            }
            numberOfLines={1}
          >
            {item.scientificName ||
              item.name ||
              "Unknown Species"}
          </Text>


          <Text
            style={
              styles.commonName
            }
            numberOfLines={1}
          >
            {item.name ||
              "No common name"}
          </Text>


          <Text
            style={
              styles.plantId
            }
          >
            ID: {item.id}
          </Text>


          {/* QR CODE */}

          {item.qrCode && (
            <Text
              style={
                styles.qrText
              }
            >
              QR: {item.qrCode}
            </Text>
          )}

        </View>


        {/* RIGHT */}

        <View
          style={
            styles.badges
          }
        >

          {/* STATUS */}

          {item.status ===
            "pending" && (
            <View
              style={[
                styles.badge,
                styles.pendingBadge,
              ]}
            >

              <Text
                style={
                  styles.pendingText
                }
              >
                Pending
              </Text>

            </View>
          )}


          {(
            item.status ===
              "approved" ||
            item.status ===
              "Approved"
          ) && (
            <View
              style={[
                styles.badge,
                styles.approvedBadge,
              ]}
            >

              <Text
                style={
                  styles.approvedText
                }
              >
                Approved
              </Text>

            </View>
          )}


          {item.status ===
            "rejected" && (
            <View
              style={[
                styles.badge,
                styles.rejectedBadge,
              ]}
            >

              <Text
                style={
                  styles.rejectedText
                }
              >
                Rejected
              </Text>

            </View>
          )}


          {/* QR STATUS */}

          {item.qrStatus && (
            <View
              style={[
                styles.badge,
                styles.qrBadge,
              ]}
            >

              <Text
                style={
                  styles.qrStatusText
                }
              >
                QR Ready
              </Text>

            </View>
          )}

        </View>

      </TouchableOpacity>
    );
  }


  // =====================================================
  // EMPTY LIST
  // =====================================================

  function renderEmpty() {

    return (
      <View
        style={
          styles.emptyContainer
        }
      >

        <Text
          style={
            styles.emptyIcon
          }
        >
          🌿
        </Text>


        <Text
          style={
            styles.emptyTitle
          }
        >
          No Plant Records
        </Text>


        <Text
          style={
            styles.emptyText
          }
        >
          Generate a QR code first,
          then add a plant record
          during your field survey.
        </Text>


        <TouchableOpacity
          style={
            styles.emptyButton
          }
          onPress={
            handleAddPlant
          }
        >

          <Text
            style={
              styles.emptyButtonText
            }
          >
            + Add Plant Record
          </Text>

        </TouchableOpacity>

      </View>
    );
  }


  // =====================================================
  // UI
  // =====================================================

  return (
    <View
      style={styles.container}
    >

      {/* HEADER */}

      <View
        style={styles.header}
      >

        <View
          style={styles.headerInfo}
        >

          <Text
            style={styles.greeting}
          >
            Hello,{" "}
            {botanist?.name ||
              "Botanist"} 👋
          </Text>


          <Text
            style={styles.subtitle}
          >
            Manage your plant records
          </Text>

        </View>


        <TouchableOpacity
          style={
            styles.logoutButton
          }
          activeOpacity={0.8}
          onPress={
            handleLogout
          }
        >

          <Text
            style={
              styles.logoutText
            }
          >
            Logout
          </Text>

        </TouchableOpacity>

      </View>


      {/* STATISTICS */}

      <View
        style={styles.statsRow}
      >

        {/* MY PLANTS */}

        <View
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            🌿
          </Text>


          <Text
            style={styles.statNumber}
          >
            {myPlants.length}
          </Text>


          <Text
            style={styles.statLabel}
          >
            My Plants
          </Text>

        </View>


        {/* PENDING */}

        <View
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            ⏳
          </Text>


          <Text
            style={styles.statNumber}
          >
            {pendingApproval.length}
          </Text>


          <Text
            style={styles.statLabel}
          >
            Pending Approval
          </Text>

        </View>


        {/* APPROVED */}

        <View
          style={styles.statCard}
        >

          <Text
            style={styles.statIcon}
          >
            ✓
          </Text>


          <Text
            style={styles.statNumber}
          >
            {approvedPlants.length}
          </Text>


          <Text
            style={styles.statLabel}
          >
            Approved
          </Text>

        </View>

      </View>


      {/* QR MANAGEMENT */}

      <TouchableOpacity
        style={
          styles.qrManagementButton
        }
        activeOpacity={0.8}
        onPress={
          handleQRCodeManagement
        }
      >

        <View
          style={
            styles.qrManagementIcon
          }
        >

          <Text
            style={
              styles.qrManagementIconText
            }
          >
            ▦
          </Text>

        </View>


        <View
          style={
            styles.qrManagementInfo
          }
        >

          <Text
            style={
              styles.qrManagementTitle
            }
          >
            QR Code Management
          </Text>


          <Text
            style={
              styles.qrManagementSubtitle
            }
          >
            Generate and manage QR codes
          </Text>

        </View>


        <Text
          style={styles.arrow}
        >
          ›
        </Text>

      </TouchableOpacity>


      {/* ADD PLANT */}

      <TouchableOpacity
        style={styles.addButton}
        activeOpacity={0.8}
        onPress={
          handleAddPlant
        }
      >

        <Text
          style={
            styles.addButtonText
          }
        >
          + Add New Plant Record
        </Text>

      </TouchableOpacity>


      {/* TITLE */}

      <Text
        style={
          styles.sectionTitle
        }
      >
        My Plant Records
      </Text>


      {/* LIST */}

      <FlatList
        data={myPlants}
        keyExtractor={(item) =>
          item.id
        }
        renderItem={
          renderPlant
        }
        ListEmptyComponent={
          renderEmpty
        }
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          myPlants.length === 0
            ? styles.emptyList
            : styles.list
        }
      />

    </View>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles =
  StyleSheet.create({

    container: {
      flex: 1,
      backgroundColor: "#F7FBF4",
      paddingHorizontal: 20,
      paddingTop: 50,
    },


    // -------------------------------------------------
    // HEADER
    // -------------------------------------------------

    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 20,
    },


    headerInfo: {
      flex: 1,
    },


    greeting: {
      fontSize: 24,
      fontWeight: "700",
      color: "#234B3A",
    },


    subtitle: {
      marginTop: 4,
      fontSize: 14,
      color: "#6D7F75",
    },


    logoutButton: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: "#E7F2E2",
    },


    logoutText: {
      fontSize: 13,
      fontWeight: "600",
      color: "#468585",
    },


    // -------------------------------------------------
    // STATISTICS
    // -------------------------------------------------

    statsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 18,
    },


    statCard: {
      flex: 1,
      minHeight: 105,
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      padding: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#E2EDE0",
    },


    statIcon: {
      fontSize: 22,
      marginBottom: 4,
    },


    statNumber: {
      fontSize: 22,
      fontWeight: "700",
      color: "#468585",
    },


    statLabel: {
      marginTop: 3,
      textAlign: "center",
      fontSize: 11,
      color: "#6D7F75",
    },


    // -------------------------------------------------
    // QR MANAGEMENT
    // -------------------------------------------------

    qrManagementButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#E9F7E4",
      borderRadius: 16,
      padding: 15,
      marginBottom: 12,
    },


    qrManagementIcon: {
      width: 46,
      height: 46,
      borderRadius: 12,
      backgroundColor: "#9CDBA6",
      alignItems: "center",
      justifyContent: "center",
    },


    qrManagementIconText: {
      fontSize: 26,
      color: "#234B3A",
      fontWeight: "700",
    },


    qrManagementInfo: {
      flex: 1,
      marginLeft: 12,
    },


    qrManagementTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: "#234B3A",
    },


    qrManagementSubtitle: {
      marginTop: 3,
      fontSize: 12,
      color: "#6D7F75",
    },


    arrow: {
      fontSize: 28,
      color: "#468585",
      marginLeft: 8,
    },


    // -------------------------------------------------
    // ADD BUTTON
    // -------------------------------------------------

    addButton: {
      backgroundColor: "#468585",
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: "center",
      marginBottom: 20,
    },


    addButtonText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700",
    },


    // -------------------------------------------------
    // SECTION
    // -------------------------------------------------

    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#234B3A",
      marginBottom: 10,
    },


    list: {
      paddingBottom: 30,
    },


    // -------------------------------------------------
    // PLANT CARD
    // -------------------------------------------------

    plantCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "#FFFFFF",
      borderRadius: 16,
      padding: 15,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: "#E2EDE0",
    },


    plantInfo: {
      flex: 1,
      paddingRight: 10,
    },


    scientificName: {
      fontSize: 15,
      fontWeight: "700",
      fontStyle: "italic",
      color: "#234B3A",
    },


    commonName: {
      marginTop: 3,
      fontSize: 13,
      color: "#6D7F75",
    },


    plantId: {
      marginTop: 7,
      fontSize: 11,
      color: "#8A9991",
    },


    qrText: {
      marginTop: 3,
      fontSize: 11,
      color: "#8A9991",
    },


    badges: {
      alignItems: "flex-end",
      gap: 5,
    },


    badge: {
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: 8,
    },


    pendingBadge: {
      backgroundColor: "#FFF1D6",
    },


    pendingText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#B97900",
    },


    approvedBadge: {
      backgroundColor: "#E1F4E3",
    },


    approvedText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#398344",
    },


    rejectedBadge: {
      backgroundColor: "#FCE2E2",
    },


    rejectedText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#B84444",
    },


    qrBadge: {
      backgroundColor: "#E2F1F0",
    },


    qrStatusText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#468585",
    },


    // -------------------------------------------------
    // EMPTY
    // -------------------------------------------------

    emptyList: {
      flexGrow: 1,
    },


    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 25,
      paddingVertical: 50,
    },


    emptyIcon: {
      fontSize: 45,
      marginBottom: 12,
    },


    emptyTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#234B3A",
    },


    emptyText: {
      marginTop: 8,
      textAlign: "center",
      lineHeight: 20,
      fontSize: 13,
      color: "#718078",
    },


    emptyButton: {
      marginTop: 18,
      backgroundColor: "#468585",
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 12,
    },


    emptyButtonText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "700",
    },

  });