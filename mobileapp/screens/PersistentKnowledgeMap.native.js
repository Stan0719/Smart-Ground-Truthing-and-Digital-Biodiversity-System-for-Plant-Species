import React from "react";
import MapView, { Marker } from "react-native-maps";
import { t } from "../translations/i18n";

export default function PersistentKnowledgeMap({ plants }) {
  return (
    <MapView
      style={{ flex: 1 }}
      initialRegion={{
        latitude: 3.8,
        longitude: 113.8,
        latitudeDelta: 0.2,
        longitudeDelta: 0.2,
      }}
    >
      {plants
        .filter(
          (plant) =>
            Number.isFinite(Number(plant.latitude)) &&
            Number.isFinite(Number(plant.longitude)) &&
            plant.latitude != null &&
            plant.longitude != null,
        )
        .map((plant) => (
          <Marker
            key={plant.plant_id}
            coordinate={{
              latitude: Number(plant.latitude),
              longitude: Number(plant.longitude),
            }}
            title={t("persistentKnowledge.plant", { plant_id: plant.plant_id })}
          />
        ))}
    </MapView>
  );
}
