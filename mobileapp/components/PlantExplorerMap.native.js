import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker } from "react-native-maps";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { t, translateLabel, useAppTranslation } from "../translations/i18n";
import { initialMapCluster, SARAWAK_REGION, validMapPoint } from "../utils/mapCamera";

export default function PlantExplorerMap({ plants, onViewDetails, focusRequest, selectedPlantId, onSelectPlant }) {
  useAppTranslation();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const validPlants = useMemo(() => (plants || []).filter(validMapPoint), [plants]);
  const initialGroup = useMemo(() => initialMapCluster(validPlants), [validPlants]);
  const coordinates = useMemo(() => initialGroup.map((item) => item.coordinate), [initialGroup]);
  const localIds = new Set(initialGroup.map((item) => item.plant.plantId));
  const distantPlants = validPlants.filter((plant) => !localIds.has(plant.plantId));
  const selected = validPlants.find((plant) => plant.plantId === selectedPlantId);

  const focusPlant = (plant) => {
    const coordinate = validMapPoint(plant);
    if (!coordinate) return;
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
  };

  useEffect(() => {
    if (!mapReady) return;
    if (!coordinates.length) {
      mapRef.current?.animateToRegion(SARAWAK_REGION, 350);
      return;
    }
    if (coordinates.length === 1) {
      mapRef.current?.animateToRegion({ ...coordinates[0], latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
    } else {
      const longitudeSpread = Math.max(...coordinates.map((point) => point.longitude)) - Math.min(...coordinates.map((point) => point.longitude));
      if (longitudeSpread > 5) mapRef.current?.animateToRegion({ ...coordinates[0], latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
      else mapRef.current?.fitToCoordinates(coordinates, { edgePadding: { top: 45, right: 45, bottom: 95, left: 45 }, animated: true });
    }
  }, [mapReady, coordinates]);

  useEffect(() => {
    const requestedPlantId = focusRequest?.plantId;
    if (!mapReady || !requestedPlantId) return;
    const plant = validPlants.find((item) => item.plantId === requestedPlantId);
    const coordinate = plant && validMapPoint(plant);
    if (coordinate) mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
  }, [mapReady, focusRequest?.sequence, focusRequest?.plantId, validPlants]);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={styles.map} initialRegion={SARAWAK_REGION}
        onMapReady={() => setMapReady(true)}
        zoomEnabled zoomControlEnabled scrollEnabled rotateEnabled={false} pitchEnabled={false}
        accessibilityLabel={t("map.biodiversityMap")}>
        {validPlants.map((plant) => (
          <Marker key={plant.plantId} coordinate={validMapPoint(plant)} onPress={() => onSelectPlant(plant.plantId)}
            accessibilityLabel={plant.plantScientificName || t("plant.notRecorded")}>
            <View style={[styles.marker, selectedPlantId === plant.plantId && styles.selectedMarker]}><Ionicons name="leaf" size={17} color="#FFFFFF" /></View>
          </Marker>
        ))}
      </MapView>
      {!!distantPlants.length && <View style={styles.distantBar}>
        <Text style={styles.distantLabel}>{t("map.otherMappedLocations")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.distantChoices}
          contentContainerStyle={styles.distantChoiceContent}>
          {distantPlants.map((plant) => <TouchableOpacity key={plant.plantId} onPress={() => { onSelectPlant(plant.plantId); focusPlant(plant); }}
            accessibilityRole="button" accessibilityLabel={`${t("map.showPlantOnMap")} ${plant.plantId}`} style={styles.distantChoice}>
            <Text style={styles.distantChoiceText} numberOfLines={1}>{plant.plantId}</Text>
          </TouchableOpacity>)}
        </ScrollView>
      </View>}
      {selected && (
        <View style={[styles.selectedCard, distantPlants.length ? styles.selectedCardAboveChoices : null]}>
          <View style={styles.selectedText}>
            <Text style={styles.name} numberOfLines={1}>{selected.plantScientificName || t("plant.notRecorded")}</Text>
            <Text style={styles.meta} numberOfLines={1}>{t("plantDetail.plantId")}: {selected.plantId} · {translateLabel(selected.currentStatus || selected.status || t("map.unknown"))}</Text>
            <Text style={styles.meta} numberOfLines={1}>{t("plantDetail.locationZone")}: {selected.mapLocation.zone || t("plant.notRecorded")}</Text>
          </View>
          <TouchableOpacity style={styles.detailsButton} onPress={() => onViewDetails(selected)}
            accessibilityRole="button" accessibilityLabel={t("map.viewDetails")}>
            <Text style={styles.detailsText}>{t("map.viewDetails")}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 330, borderRadius: 19, overflow: "hidden", backgroundColor: "#DCEBDD",
    borderWidth: 1, borderColor: "#D7E7D8", elevation: 2, shadowColor: "#173B27", shadowOpacity: 0.08,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  map: { flex: 1 },
  distantBar: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, backgroundColor: "#FFFFFF" },
  distantLabel: { color: "#466354", fontSize: 10, fontWeight: "700" },
  distantChoices: { flex: 1 },
  distantChoiceContent: { flexDirection: "row", gap: 6, alignItems: "center" },
  distantChoice: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 6,
    borderRadius: 8, backgroundColor: "#E3F4E9" },
  distantChoiceText: { maxWidth: 52, color: "#247344", fontSize: 11, fontWeight: "700" },
  marker: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "#278051", borderWidth: 2, borderColor: "#FFFFFF", elevation: 3 },
  selectedMarker: { backgroundColor: "#174D30", borderColor: "#C8F2A8", borderWidth: 3, transform: [{ scale: 1.18 }] },
  selectedCard: { position: "absolute", bottom: 10, left: 10, right: 10, flexDirection: "row",
    alignItems: "center", gap: 9, padding: 11, borderRadius: 13, backgroundColor: "#FFFFFF",
    shadowColor: "#123D27", shadowOpacity: 0.15, shadowRadius: 7, elevation: 4 },
  selectedCardAboveChoices: { bottom: 58 },
  selectedText: { flex: 1 },
  name: { fontSize: 13, fontWeight: "700", fontStyle: "italic", color: "#214C37" },
  meta: { marginTop: 3, fontSize: 10, color: "#5E7668" },
  detailsButton: { backgroundColor: "#267348", paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9 },
  detailsText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
