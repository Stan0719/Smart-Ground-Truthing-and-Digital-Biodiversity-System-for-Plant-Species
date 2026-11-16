import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker } from "react-native-maps";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { t, translateLabel, useAppTranslation } from "../translations/i18n";

const NIAH_REGION = { latitude: 3.82, longitude: 113.78, latitudeDelta: 0.12, longitudeDelta: 0.12 };

export default function PlantExplorerMap({ plants, onViewDetails }) {
  useAppTranslation();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const coordinates = useMemo(() => plants.map((plant) => ({
    latitude: plant.mapLocation.latitude,
    longitude: plant.mapLocation.longitude,
  })), [plants]);
  const selected = plants.find((plant) => plant.plantId === selectedId);

  useEffect(() => {
    if (!mapReady || !coordinates.length) return;
    if (coordinates.length === 1) {
      mapRef.current?.animateToRegion({ ...coordinates[0], latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
    } else {
      mapRef.current?.fitToCoordinates(coordinates, { edgePadding: { top: 45, right: 45, bottom: 95, left: 45 }, animated: true });
    }
  }, [mapReady, coordinates]);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={styles.map} initialRegion={NIAH_REGION}
        onMapReady={() => setMapReady(true)}
        zoomEnabled zoomControlEnabled scrollEnabled rotateEnabled={false} pitchEnabled={false}
        accessibilityLabel={t("map.biodiversityMap")}>
        {plants.map((plant) => (
          <Marker key={plant.plantId} coordinate={{
            latitude: plant.mapLocation.latitude,
            longitude: plant.mapLocation.longitude,
          }} onPress={() => setSelectedId(plant.plantId)}
            accessibilityLabel={plant.plantScientificName || t("plant.notRecorded")}>
            <View style={styles.marker}><Ionicons name="leaf" size={17} color="#FFFFFF" /></View>
          </Marker>
        ))}
      </MapView>
      {selected && (
        <View style={styles.selectedCard}>
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
  marker: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "#278051", borderWidth: 2, borderColor: "#FFFFFF", elevation: 3 },
  selectedCard: { position: "absolute", bottom: 10, left: 10, right: 10, flexDirection: "row",
    alignItems: "center", gap: 9, padding: 11, borderRadius: 13, backgroundColor: "#FFFFFF",
    shadowColor: "#123D27", shadowOpacity: 0.15, shadowRadius: 7, elevation: 4 },
  selectedText: { flex: 1 },
  name: { fontSize: 13, fontWeight: "700", fontStyle: "italic", color: "#214C37" },
  meta: { marginTop: 3, fontSize: 10, color: "#5E7668" },
  detailsButton: { backgroundColor: "#267348", paddingVertical: 9, paddingHorizontal: 10, borderRadius: 9 },
  detailsText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
