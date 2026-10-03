import React from "react";

import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";

import { plants } from "../data/mockData";


export default function BotanistDashboardScreen({
  route,
  navigation,
  onLogout,
}) {
  const botanist = route.params?.botanist;

  const myPlants = plants.filter(
    (plant) =>
      plant.botanist === botanist?.name
  );

  const pending = myPlants.filter(
    (plant) =>
      plant.syncStatus === "Pending Sync"
  );


  function handleLogout() {

  if (onLogout) {
    onLogout();
    return;
  }

  navigation.goBack();
}


  return (
    <View style={styles.container}>

      {/* ================= HEADER ================= */}

      <View style={styles.header}>

        <View>
          <Text style={styles.greeting}>
            Hello, {botanist?.name} 👋
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


      {/* ================= STATS ================= */}

      <View style={styles.statsRow}>

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


        <View style={styles.statCard}>

          <View style={styles.statIcon}>
            <Text>🔄</Text>
          </View>

          <Text style={styles.statNumber}>
            {pending.length}
          </Text>

          <Text style={styles.statLabel}>
            Pending Sync
          </Text>

        </View>

      </View>


      {/* ================= ADD PLANT ================= */}

      <TouchableOpacity
        style={styles.addButton}
        onPress={() =>
          navigation.navigate(
            "AddPlant",
            {
              botanist,
            }
          )
        }
      >
        <Text style={styles.addButtonText}>
          + Add New Plant
        </Text>
      </TouchableOpacity>


      {/* ================= RECORDS ================= */}

      <Text style={styles.sectionTitle}>
        My Plant Records
      </Text>


      <FlatList
        data={myPlants}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}

        renderItem={({ item }) => (

          <TouchableOpacity
            style={styles.plantCard}
            onPress={() =>
              navigation.navigate(
                "EditPlant",
                {
                  plant: item,
                  botanist,
                }
              )
            }
          >

            <View style={styles.plantInfo}>

              <Text style={styles.plantName}>
                {item.scientificName}
              </Text>

              <Text style={styles.commonName}>
                {item.commonName}
              </Text>

              <Text style={styles.recordId}>
                ID: {item.id}
              </Text>

            </View>


            <View
              style={[
                styles.syncBadge,

                item.syncStatus === "Pending Sync"
                  ? styles.pendingBadge
                  : styles.syncedBadge,
              ]}
            >

              <Text style={styles.syncText}>
                {item.syncStatus === "Synced"
                  ? "✓ Synced"
                  : "⟳ Pending"}
              </Text>

            </View>

          </TouchableOpacity>

        )}

        ListEmptyComponent={

          <View style={styles.empty}>

            <Text style={styles.emptyIcon}>
              🌱
            </Text>

            <Text style={styles.emptyText}>
              No plant records yet.
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
  },


  /* ================= HEADER ================= */

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 25,
  },


  greeting: {
    fontSize: 25,
    fontWeight: "800",
    color: "#468585",
  },


  subtitle: {
    color: "#687568",
    marginTop: 4,
  },


  /* ================= LOGOUT ================= */

  logoutButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#468585",
    backgroundColor: "#FFFFFF",
  },


  logoutText: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "700",
  },


  /* ================= STATS ================= */

  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },


  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },


  statIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#9CDBA6",
    justifyContent: "center",
    alignItems: "center",
  },


  statNumber: {
    fontSize: 27,
    fontWeight: "800",
    color: "#468585",
    marginTop: 8,
  },


  statLabel: {
    color: "#687568",
    marginTop: 2,
    fontSize: 13,
  },


  /* ================= ADD BUTTON ================= */

  addButton: {
    backgroundColor: "#50B498",
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 15,
  },


  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },


  /* ================= RECORDS ================= */

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#468585",
    marginTop: 25,
    marginBottom: 10,
  },


  plantCard: {
    backgroundColor: "#FFFFFF",
    padding: 15,
    borderRadius: 15,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },


  plantInfo: {
    flex: 1,
  },


  plantName: {
    fontWeight: "700",
    fontStyle: "italic",
    color: "#468585",
    fontSize: 15,
  },


  commonName: {
    color: "#687568",
    marginTop: 3,
  },


  recordId: {
    color: "#999",
    fontSize: 11,
    marginTop: 5,
  },


  /* ================= SYNC ================= */

  syncBadge: {
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },


  syncedBadge: {
    backgroundColor: "#DEF9C4",
  },


  pendingBadge: {
    backgroundColor: "#9CDBA6",
  },


  syncText: {
    color: "#468585",
    fontSize: 11,
    fontWeight: "700",
  },


  /* ================= EMPTY ================= */

  empty: {
    alignItems: "center",
    marginTop: 50,
  },


  emptyIcon: {
    fontSize: 45,
  },


  emptyText: {
    color: "#687568",
    marginTop: 10,
  },

});