import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { t, translateLabel, useAppTranslation } from "../translations/i18n";

// The Botanist map uses native markers on iOS and Android. Keep the Expo web
// preview functional without loading react-native-maps in a browser bundle.
export default function PlantExplorerMap({ plants, onViewDetails }) {
  useAppTranslation();
  const [selectedId, setSelectedId] = useState(null);
  const selected = plants.find((plant) => plant.plantId === selectedId) || plants[0];
  const mapUrl = useMemo(() => {
    const latitude = selected?.mapLocation.latitude ?? 3.82;
    const longitude = selected?.mapLocation.longitude ?? 113.78;
    const bounds = [longitude - 0.015, latitude - 0.015, longitude + 0.015, latitude + 0.015];
    const marker = selected ? `&marker=${latitude}%2C${longitude}` : "";
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bounds.join("%2C")}&layer=mapnik${marker}`;
  }, [selected]);
  return (
    <View style={styles.container}>
      <iframe title={t("map.biodiversityMap")} src={mapUrl} style={{ width: "100%", height: 290, border: 0 }} />
      {!!plants.length && (
        <View style={styles.row}>
          <View style={styles.markerList}>
            {plants.map((plant) => (
              <TouchableOpacity key={plant.plantId} onPress={() => setSelectedId(plant.plantId)}
                style={[styles.markerChoice, selected?.plantId === plant.plantId && styles.activeChoice]}>
                <Text style={styles.choiceText} numberOfLines={1}>{plant.plantScientificName || plant.plantId}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.details}>
            <Text style={styles.name}>{selected?.plantScientificName || t("plant.notRecorded")}</Text>
            <Text style={styles.meta}>{t("plantDetail.plantId")}: {selected?.plantId} · {translateLabel(selected?.currentStatus || selected?.status || t("map.unknown"))}</Text>
            <Text style={styles.meta}>{t("plantDetail.locationZone")}: {selected?.mapLocation.zone || t("plant.notRecorded")}</Text>
            <TouchableOpacity onPress={() => onViewDetails(selected)} style={styles.button}>
              <Text style={styles.buttonText}>{t("map.viewDetails")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden", borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7E7D8" },
  row: { padding: 10, gap: 8 },
  markerList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  markerChoice: { maxWidth: 150, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "#EEF5EB" },
  activeChoice: { backgroundColor: "#D6ECD7" },
  choiceText: { fontSize: 11, color: "#275740" },
  details: { padding: 5 },
  name: { fontSize: 14, fontWeight: "700", fontStyle: "italic", color: "#214C37" },
  meta: { marginTop: 3, fontSize: 11, color: "#5E7668" },
  button: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#267348" },
  buttonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
