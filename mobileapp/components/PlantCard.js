import { t, translateLabel, dateLocale, useAppTranslation, translateFieldValue } from "../translations/i18n";
import React from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from "react-native";

import { getSpeciesBySlug } from "../data/mockData";
import { getSpeciesImageSource } from "../data/speciesImages";


export default function PlantCard({
  plant,
  navigation,
  user,
}) {
  useAppTranslation();
  const species = getSpeciesBySlug(plant.speciesSlug) || {
    name: plant.commonName,
    genus: plant.genus,
  };
  const imageSource = getSpeciesImageSource(species);
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const lastVerified = formatDate(plant.latestApproved?.date);

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

        {imageSource ? (
          <Image
            source={imageSource}
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

        {isBotanist ? (
          <>
            <Text style={styles.plantZone}>
              {plant.location?.zone || t("plant.notRecorded")}
            </Text>

            <Text style={styles.plantHealth}>
              {translateLabel(plant.latestApproved?.healthStatus || t("plant.notRecorded"))}
            </Text>
          </>
        ) : (
          <View style={styles.infoGrid}>
            <PublicFact
              label={t("plant.height")}
              value={plant.latestApproved?.heightCm != null ? `${plant.latestApproved.heightCm} cm` : t("plant.notRecorded")}
            />
            <PublicFact
              label={t("plant.lifeStage")}
              value={plant.latestApproved?.lifeStage || t("plant.notRecorded")}
            />
            <PublicFact
              label={t("plant.genus")}
              value={species?.genus}
            />
            <PublicFact
              label={t("plantCard.registered")}
              value={lastVerified}
            />
          </View>
        )}

        <Text style={styles.plantView}>{t("plantCard.viewRecord")}</Text>

      </View>

    </TouchableOpacity>
  );
}

function PublicFact({ label, value }) {
  useAppTranslation();
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{translateLabel(label)}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {translateFieldValue(label, value || "-")}
      </Text>
    </View>
  );
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    rowGap: 7,
  },

  infoItem: {
    width: "50%",
    paddingRight: 5,
  },

  infoLabel: {
    color: "#89958F",
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  infoValue: {
    marginTop: 2,
    color: "#405F56",
    fontSize: 9,
    fontWeight: "600",
  },

  plantView: {
    marginTop: 9,
    color: "#315B49",
    fontSize: 10,
    fontWeight: "700",
  },
});
