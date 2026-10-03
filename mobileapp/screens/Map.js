import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from "react-native";

import { plants } from "../data/mockData";

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        Plant Locations
      </Text>

      <Text style={styles.subtitle}>
        GPS locations of documented plants
      </Text>

      <View style={styles.mapPlaceholder}>
        <Text style={styles.mapIcon}>🗺️</Text>

        <Text style={styles.mapTitle}>
          Biodiversity Map
        </Text>

        <Text style={styles.mapText}>
          Map integration will display plant GPS
          locations here.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>
        Documented Plants
      </Text>

      <ScrollView showsVerticalScrollIndicator={false}>
        {plants.map((plant) => (
          <View
            style={styles.locationCard}
            key={plant.slug}
          >
            <Text style={styles.plantName}>
              {plant.scientificName}
            </Text>

            <Text style={styles.commonName}>
              {plant.name}
            </Text>

            <Text style={styles.category}>
              {plant.category}
            </Text>

            <Text style={styles.location}>
              📍 GPS location not available
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7FAF5",
    padding: 20,
  },

  title: {
    fontSize: 27,
    fontWeight: "700",
    color: "#234D20",
    marginTop: 10,
  },

  subtitle: {
    color: "#687568",
    marginTop: 5,
  },

  mapPlaceholder: {
    height: 270,
    backgroundColor: "#DCE8D7",
    borderRadius: 20,
    marginTop: 20,
    justifyContent: "center",
    alignItems: "center",
  },

  mapIcon: {
    fontSize: 55,
  },

  mapTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#356859",
    marginTop: 10,
  },

  mapText: {
    color: "#687568",
    textAlign: "center",
    paddingHorizontal: 30,
    marginTop: 5,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#234D20",
    marginTop: 20,
    marginBottom: 10,
  },

  locationCard: {
    backgroundColor: "#FFFFFF",
    padding: 15,
    borderRadius: 14,
    marginBottom: 10,
  },

  plantName: {
    fontWeight: "700",
    fontStyle: "italic",
    color: "#356859",
  },

  commonName: {
    color: "#666",
    marginTop: 3,
  },

  category: {
    color: "#50B498",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 5,
  },

  location: {
    color: "#777",
    fontSize: 13,
    marginTop: 7,
  },
});
