import React from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";

import { getSpeciesBySlug } from "../data/mockData";


export default function PlantCard({
  plant,
  navigation,
}) {
  const species = getSpeciesBySlug(
    plant.speciesSlug
  );

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate("PlantDetails", {
          plantId: plant.plantId,
        })
      }
    >

      {/* IMAGE */}
      <View style={styles.imageContainer}>

        {species?.image ? (
          <Image
            source={{
              uri: species.image,
            }}
            style={styles.image}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>
              🌿
            </Text>
          </View>
        )}

      </View>


      {/* CONTENT */}
      <View style={styles.content}>

        <Text style={styles.plantId}>
          {plant.plantId}
        </Text>

        <Text style={styles.plantName}>
          {plant.commonName}
        </Text>

        <Text style={styles.plantZone}>
          {plant.location.zone}
        </Text>

        <Text style={styles.plantHealth}>
          {plant.latestApproved.healthStatus}
        </Text>

        <Text style={styles.plantView}>
          View Record →
        </Text>

      </View>

    </TouchableOpacity>
  );
}


const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    marginBottom: 12,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },

  imageContainer: {
    width: 110,
    height: 130,
    backgroundColor: "#DCE8D6",
  },

  image: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCE8D6",
  },

  placeholderIcon: {
    fontSize: 35,
  },

  content: {
    flex: 1,
    padding: 13,
  },

  plantId: {
    color: "#234A3C",
    fontSize: 14,
    fontWeight: "700",
  },

  plantName: {
    marginTop: 3,
    color: "#50675D",
    fontSize: 11,
  },

  plantZone: {
    marginTop: 7,
    color: "#75867E",
    fontSize: 10,
  },

  plantHealth: {
    marginTop: 5,
    color: "#34785D",
    fontSize: 10,
    fontWeight: "700",
  },

  plantView: {
    marginTop: 9,
    color: "#315B49",
    fontSize: 10,
    fontWeight: "700",
  },
});