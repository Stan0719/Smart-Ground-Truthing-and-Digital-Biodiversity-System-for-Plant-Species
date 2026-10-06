import React from "react";

import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { plants } from "../data/mockData";


export default function ScanHistoryScreen({
  navigation,
}) {

  // Temporary frontend data
  // Later this will come from the logged-in visitor's scan history.
  const scanHistory = [
    {
      id: 1,
      plantId: "NIAH-PLANT-0001",
      scannedAt: "6 Oct 2026, 10:30 AM",
    },
    {
      id: 2,
      plantId: "NIAH-PLANT-0003",
      scannedAt: "5 Oct 2026, 2:15 PM",
    },
    {
      id: 3,
      plantId: "NIAH-PLANT-0002",
      scannedAt: "4 Oct 2026, 11:45 AM",
    },
  ];

  const history = scanHistory
    .map((scan) => {
      const plant = plants.find(
        (plant) => plant.id === scan.plantId
      );

      return {
        ...scan,
        plant,
      };
    })
    .filter((scan) => scan.plant);


  return (
    <SafeAreaView style={styles.container}>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* Header */}
        <View style={styles.header}>

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color="#468585"
            />
          </TouchableOpacity>

          <Text style={styles.title}>
            Scan History
          </Text>

        </View>


        {/* Scan History */}
        {history.length === 0 ? (

          <View style={styles.emptyContainer}>

            <Ionicons
              name="scan-outline"
              size={60}
              color="#9CDBA6"
            />

            <Text style={styles.emptyTitle}>
              No Scan History
            </Text>

            <Text style={styles.emptyText}>
              Plants you scan will appear here.
            </Text>

          </View>

        ) : (

          <View>

            {history.map((scan) => (

              <TouchableOpacity
                key={scan.id}
                style={styles.historyCard}
                activeOpacity={0.75}
                onPress={() =>
                  navigation.navigate("PlantDetails", {
                    plant: scan.plant,
                  })
                }
              >

                {/* Scan Icon */}
                <View style={styles.iconContainer}>

                  <Ionicons
                    name="scan"
                    size={28}
                    color="#468585"
                  />

                </View>


                {/* Plant Information */}
                <View style={styles.historyInfo}>

                  <Text style={styles.plantName}>
                    {scan.plant.name}
                  </Text>

                  <Text style={styles.scientificName}>
                    {scan.plant.scientificName}
                  </Text>

                  <View style={styles.dateRow}>

                    <Ionicons
                      name="time-outline"
                      size={14}
                      color="#7A918C"
                    />

                    <Text style={styles.dateText}>
                      {scan.scannedAt}
                    </Text>

                  </View>

                </View>


                {/* Arrow */}
                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color="#9BBDB4"
                />

              </TouchableOpacity>

            ))}

          </View>

        )}

      </ScrollView>

    </SafeAreaView>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F8FFF5",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,

    backgroundColor: "#DEF9C4",

    justifyContent: "center",
    alignItems: "center",

    marginRight: 12,
  },

  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#468585",
  },

  historyCard: {
    flexDirection: "row",
    alignItems: "center",

    backgroundColor: "#FFFFFF",

    borderRadius: 16,

    padding: 15,

    marginBottom: 12,

    elevation: 2,

    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,

    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  iconContainer: {
    width: 58,
    height: 58,

    borderRadius: 14,

    backgroundColor: "#DEF9C4",

    justifyContent: "center",
    alignItems: "center",

    marginRight: 14,
  },

  historyInfo: {
    flex: 1,
  },

  plantName: {
    fontSize: 16,
    fontWeight: "700",

    color: "#315E59",

    marginBottom: 4,
  },

  scientificName: {
    fontSize: 13,
    fontStyle: "italic",

    color: "#7A918C",

    marginBottom: 7,
  },

  dateRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  dateText: {
    marginLeft: 5,

    fontSize: 12,

    color: "#7A918C",
  },

  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",

    paddingTop: 100,

    paddingHorizontal: 30,
  },

  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",

    color: "#468585",

    marginTop: 16,
    marginBottom: 8,
  },

  emptyText: {
    fontSize: 14,

    color: "#7A918C",

    textAlign: "center",
  },

});