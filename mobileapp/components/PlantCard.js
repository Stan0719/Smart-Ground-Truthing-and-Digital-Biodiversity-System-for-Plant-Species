import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

export default function PlantCard({ plant, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Image source={plant.image} style={styles.image} />

      <View style={styles.info}>
        <Text style={styles.scientificName}>
          {plant.scientificName}
        </Text>

        <Text style={styles.commonName}>
          {plant.commonName}
        </Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusLabel}>
            Conservation Status
          </Text>

          <Text style={styles.status}>
            {plant.conservationStatus}
          </Text>
        </View>

        <Text style={styles.location}>
          📍 {plant.latitude.toFixed(4)},{" "}
          {plant.longitude.toFixed(4)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    marginBottom: 16,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#468585",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.12,
    shadowRadius: 5,
  },

  image: {
    width: "100%",
    height: 190,
  },

  info: {
    padding: 16,
  },

  scientificName: {
    fontSize: 19,
    fontWeight: "700",
    fontStyle: "italic",
    color: "#468585",
  },

  commonName: {
    fontSize: 15,
    color: "#687568",
    marginTop: 5,
  },

  statusBox: {
    backgroundColor: "#DEF9C4",
    borderRadius: 10,
    padding: 9,
    marginTop: 12,
  },

  statusLabel: {
    fontSize: 11,
    color: "#468585",
    fontWeight: "600",
  },

  status: {
    fontSize: 13,
    color: "#468585",
    fontWeight: "700",
    marginTop: 2,
  },

  location: {
    fontSize: 12,
    color: "#777",
    marginTop: 9,
  },
});