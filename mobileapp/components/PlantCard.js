import { t, translateLabel, dateLocale, useAppTranslation, translateFieldValue } from "../translations/i18n";
import React, { useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  Dimensions,
  Platform,
} from "react-native";

import { getPlantDisplayObservation } from "../utils/plantApi";
import { getPlantCardZoneLabel } from "../utils/plantCardDisplay";

const CARD_CONTENT_PADDING = 13;


export default function PlantCard({
  plant,
  navigation,
  user,
  speciesDetailCard = false,
}) {
  useAppTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const screenSize = Dimensions.get("screen");
  const isTabletDevice = Platform.isPad || (
    Platform.OS === "android" && Math.min(screenSize.width, screenSize.height) >= 600
  );
  const isTabletLayout = speciesDetailCard && isTabletDevice;
  const tabletImageWidth = Math.min(Math.round(windowWidth * 0.3), 280);
  const [measuredCardHeight, setMeasuredCardHeight] = useState(0);
  const [failedImageUri, setFailedImageUri] = useState(null);
  const imageSource = plant.plantImage || null;
  const imageUri = typeof imageSource === "number" ? `local:${imageSource}` : imageSource?.uri || null;
  const imageFailed = imageUri === failedImageUri;
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const isPublicViewer = !user || ["visitor", "guest"].includes(user?.role?.toLowerCase());
  const observation = getPlantDisplayObservation(plant);
  const lastVerified = formatDate(plant.latestApproved?.date);
  const zoneBadge = getPlantCardZoneLabel(plant, user?.role, {
    restricted: t("map.locationRestricted"),
    missing: t("plant.notRecorded"),
  });
  const handleContentLayout = (event) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height + CARD_CONTENT_PADDING * 2);
    setMeasuredCardHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
  };

  return (
    <TouchableOpacity
      style={[styles.card, speciesDetailCard && styles.speciesDetailCard]}
      onPress={() =>
        navigation.navigate("PlantDetails", {
          plantId: plant.plantId,
        })
      }
    >

      {/* IMAGE */}
      <View style={[
        styles.imageContainer,
        !speciesDetailCard && styles.phoneImageContainer,
        speciesDetailCard && {
          width: isTabletLayout ? tabletImageWidth : 110,
          height: measuredCardHeight || undefined,
          alignSelf: "stretch",
          overflow: "hidden",
        },
      ]}>

        {imageSource && !imageFailed ? (
          <Image
            source={imageSource}
            style={speciesDetailCard ? [styles.speciesDetailImage, measuredCardHeight > 0 && { height: measuredCardHeight }] : styles.image}
            onError={() => setFailedImageUri(imageUri)}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>
              🌿
            </Text>
          </View>
        )}

        {!speciesDetailCard && !isPublicViewer && <View pointerEvents="none" style={styles.imageBadges}>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.statusBadge, statusStyle(plant.currentStatus)]}>
            {translateLabel(plant.currentStatus || t("plant.notRecorded"))}
          </Text>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.zoneBadge]}>
            {zoneBadge}
          </Text>
        </View>}

      </View>


      {/* CONTENT */}
      <View style={styles.content}>
        <View onLayout={speciesDetailCard ? handleContentLayout : undefined}>

        {speciesDetailCard && !isPublicViewer && <View style={styles.speciesDetailBadges}>
          <Text style={[styles.speciesDetailBadge, isTabletLayout && styles.tabletBadge, styles.statusBadge, statusStyle(plant.currentStatus)]}>
            {translateLabel(plant.currentStatus || t("plant.notRecorded"))}
          </Text>
          <Text style={[styles.speciesDetailBadge, isTabletLayout && styles.tabletBadge, styles.zoneBadge]}>{zoneBadge}</Text>
        </View>}

        <Text style={styles.plantName}>
          {plant.plantScientificName || t("plant.unnamedPlant")}
        </Text>
        <Text style={styles.plantId}>{t("plantDetail.plantId")}: {plant.plantId}</Text>
        {!!plant.plantCommonName && <Text style={styles.plantCommonName}>{plant.plantCommonName}</Text>}

        {isBotanist ? (
          <>
            <View style={styles.infoGrid}>
              <PublicFact label={t("plant.height")} value={observation?.heightCm != null ? `${observation.heightCm} cm` : t("plant.notRecorded")} />
              <PublicFact label={t("plant.lifeStage2")} value={observation?.lifeStage || t("plant.notRecorded")} />
              <PublicFact label={t("plant.health")} value={observation?.healthStatus || t("plant.notRecorded")} />
              <PublicFact label={t("plant.morphology")} value={observation?.morphology || t("plant.notRecorded")} />
              <PublicFact label={t("plant.locationZone")} value={zoneBadge} />
              <PublicFact label={t("plant.qrStatus2")} value={plant.qr?.status || t("plant.notRecorded")} />
            </View>
          </>
        ) : (
          <View style={styles.infoGrid}>
            <PublicFact
              label={t("plant.height")}
              value={observation?.heightCm != null ? `${observation.heightCm} cm` : t("plant.notRecorded")}
            />
            <PublicFact
              label={t("plant.lifeStage")}
              value={observation?.lifeStage || t("plant.notRecorded")}
            />
            <PublicFact
              label={t("plant.health")}
              value={observation?.healthStatus || t("plant.notRecorded")}
            />
            <PublicFact
              label={t("plant.morphology")}
              value={observation?.morphology || t("plant.notRecorded")}
            />
            {!(speciesDetailCard && isPublicViewer) && <PublicFact label={t("plant.locationZone")} value={zoneBadge} />}
            <PublicFact
              label={t("plant.lastVerified")}
              value={lastVerified}
            />
          </View>
        )}

        {isBotanist && plant.latestSubmission?.status ? (
          <Text style={styles.observationStatus}>{t("botanistRecords.observationStatus")}{translateLabel(plant.latestSubmission.status)}</Text>
        ) : null}
        {isBotanist && plant.currentStatus === "Pending Review" ? (
          <Text style={styles.pendingApprovalHint}>{t("plant.awaitingOfficerApproval")}</Text>
        ) : null}

        <Text style={styles.plantView}>{t("plantCard.viewRecord")}</Text>

        </View>
      </View>

    </TouchableOpacity>
  );
}

function statusStyle(status) {
  switch (String(status || "").toLowerCase()) {
    case "approved": return styles.statusApproved;
    case "pending review": return styles.statusPending;
    case "rejected": return styles.statusRejected;
    case "correction required": return styles.statusCorrection;
    default: return styles.statusOther;
  }
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
  speciesDetailCard: { alignItems: "stretch" },

  imageContainer: {
    width: 110,
    backgroundColor: "#DCE8D6",
  },
  phoneImageContainer: { height: 130 },
  speciesDetailImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  imageBadges: { position: "absolute", top: 5, left: 5, right: 5, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 3 },
  speciesDetailBadges: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 5, marginBottom: 8 },
  speciesDetailBadge: { flexShrink: 1, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 8, color: "#FFFFFF", fontSize: 8, lineHeight: 11, fontWeight: "700" },
  tabletBadge: { paddingHorizontal: 9, paddingVertical: 6, fontSize: 11, lineHeight: 15 },
  imageBadge: { maxWidth: "48%", overflow: "hidden", paddingHorizontal: 4, paddingVertical: 4, borderRadius: 8, color: "#FFFFFF", fontSize: 8, lineHeight: 10, fontWeight: "700", textAlign: "center" },
  statusBadge: { backgroundColor: "#315B49" },
  statusApproved: { backgroundColor: "#23734D" },
  statusPending: { backgroundColor: "#A76512" },
  statusRejected: { backgroundColor: "#A53A35" },
  statusCorrection: { backgroundColor: "#8C5D20" },
  statusOther: { backgroundColor: "#52645A" },
  zoneBadge: { backgroundColor: "#143625DD" },

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
    padding: CARD_CONTENT_PADDING,
  },

  plantId: {
    marginTop: 3,
    color: "#7C8982",
    fontSize: 10,
    fontWeight: "600",
  },

  plantName: {
    color: "#234A3C",
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  plantCommonName: {
    marginTop: 2,
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
  observationStatus: {
    marginTop: 5,
    color: "#75867E",
    fontSize: 9,
    fontWeight: "600",
  },
  pendingApprovalHint: { marginTop: 5, color: "#805B16", fontSize: 11, lineHeight: 15, fontWeight: "600" },
});
