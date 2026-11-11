import React from "react";
import { ScrollView, Text, View } from "react-native";
import { t, useAppTranslation } from "../translations/i18n";

export default function PersistentKnowledgeMap({ plants }) {
  useAppTranslation();
  const mappedPlants = plants.filter(
    (plant) =>
      Number.isFinite(Number(plant.latitude)) &&
      Number.isFinite(Number(plant.longitude)) &&
      plant.latitude != null &&
      plant.longitude != null,
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 10, backgroundColor: "#f2f8ef", flexGrow: 1 }}>
      {mappedPlants.length ? mappedPlants.map((plant) => (
        <View key={plant.plant_id} style={{ padding: 16, borderRadius: 10, backgroundColor: "white" }}>
          <Text style={{ color: "#234b3a", fontWeight: "700" }}>
            {t("persistentKnowledge.plant", { plant_id: plant.plant_id })}
          </Text>
          <Text style={{ color: "#52665a", marginTop: 4 }}>
            {plant.latitude}, {plant.longitude}
          </Text>
        </View>
      )) : <Text style={{ color: "#52665a" }}>{t("persistentKnowledge.noMappedPlants")}</Text>}
    </ScrollView>
  );
}
