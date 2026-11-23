import PreviewableImage from "../components/PreviewableImage";
import { t, translateLabel, translateUIMessage, useAppTranslation } from "../translations/i18n";
import { can } from "../utils/rbac";
import React, { useEffect, useState } from "react";
import {
  ScrollView, TouchableOpacity, View} from "react-native";
import Text, { ScaledTextInput as TextInput } from "../components/ScaledText";
import PersistentKnowledgeMap from "./PersistentKnowledgeMap";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import useDatabaseTranslations from "../hooks/useDatabaseTranslations";
import {
  mobileApiUrl,
  createConnectivityGuard,
} from "../utils/apiConfiguration.js";
const imageConnectivity = createConnectivityGuard("plant", () =>
  mobileApiUrl("plant"),
);
export default function PersistentKnowledge({ route, navigation, user }) {
  useAppTranslation();
  const [species, setSpecies] = useState([]),
    [plants, setPlants] = useState([]),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null),
    [images, setImages] = useState([]);
  const speciesTranslationFields = [
    ...species
      .filter((item) => item?.species_id != null && typeof item.common_name === "string" && item.common_name.trim())
      .map((item) => ({ recordType: "species", recordId: String(item.species_id), fieldName: "commonName", sourceText: item.common_name })),
    ...(selected?.species_id != null
      ? ["description", "habitat", "culturalSignificance"]
        .filter((fieldName) => typeof selected[fieldName] === "string" && selected[fieldName].trim())
        .map((fieldName) => ({ recordType: "species", recordId: String(selected.species_id), fieldName, sourceText: selected[fieldName] }))
      : []),
  ];
  const translatedSpeciesText = useDatabaseTranslations(speciesTranslationFields, {
    accountId: user?.id ?? null,
    publicOnly: !can(user, "plants.scientific.read"),
  });
  const speciesText = (fieldName) => {
    const field = speciesTranslationFields.find((entry) => entry.fieldName === fieldName &&
      (fieldName !== "commonName" || entry.recordId === String(selected?.species_id)));
    return field ? translatedSpeciesText(field) : (fieldName === "commonName" ? selected?.common_name : selected?.[fieldName]) || "";
  };
  const speciesCommonName = (item) => {
    const field = speciesTranslationFields.find((entry) => entry.recordId === String(item.species_id) && entry.fieldName === "commonName");
    return field ? translatedSpeciesText(field) : item.common_name || "";
  };
  const map = route.name === "KnowledgeMap";
  async function load() {
    setError("");
    setSpecies([]);
    setPlants([]);
    setSelected(null);
    setImages([]);
    try {
      const authenticated = faceSession.hasSession();
      const options = { guest: !authenticated };
      const scientific = can(user, "plants.scientific.read");
      const [catalog, records] = await Promise.all([
        plantApi(
          `/species?scope=${scientific ? "scientific" : "public"}`,
          options,
        ),
        plantApi("/plants", options),
      ]);
      setSpecies(catalog.species);
      setPlants(records.plants);
      const speciesId = String(
        route.params?.speciesId ||
          route.params?.slug ||
          route.params?.plant?.species_id ||
          "",
      );
      const plantId = String(
        route.params?.plantId || route.params?.plant?.plant_id || "",
      );
      const record = records.plants.find((p) => String(p.plant_id) === plantId);
      const item = catalog.species.find(
        (s) => s.species_id === (speciesId || String(record?.species_id || "")),
      );
      if (item) {
        setSelected(item);
        const media = await plantApi(
          `/assets?species_id=${item.species_id}`,
          options,
        );
        setImages(
          media.assets.filter((a) => a.content_type.startsWith("image/")),
        );
      }
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [route.name, route.params?.speciesId, route.params?.plantId, user?.id]);
  if (map)
    return (
      <View style={{ flex: 1 }}>
        {!!error && <Text accessibilityRole="alert">{translateUIMessage(error)}</Text>}
        <PersistentKnowledgeMap plants={plants} />
      </View>
    );
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        backgroundColor: "#f2f8ef",
        flexGrow: 1,
      }}
    >
      <Text style={{ fontSize: 26, color: "#234b3a" }}>
        {selected ? selected.scientific_name : t("persistentKnowledge.plantKnowledge")}
      </Text>
      <TouchableOpacity onPress={load}>
        <Text style={{ padding: 12 }}>{t("common.refresh")}</Text>
      </TouchableOpacity>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
          {translateUIMessage(error)}
        </Text>
      )}
      {selected ? (
        <>
          <Text>{speciesText("commonName")}</Text>
          <Text>
            {selected.genus_name} · {selected.family_name}
          </Text>
          <Text>{speciesText("description")}</Text>
          <Text>{speciesText("habitat")}</Text>
          <Text>{speciesText("culturalSignificance")}</Text>
          {!!selected.conservation_status && (
            <Text>{t("persistentKnowledge.conservation")}{translateLabel(selected.conservation_status)}</Text>
          )}
          {images.map((a) => (
            <AuthenticatedImage key={a.id} id={a.id} userId={user?.id} />
          ))}
          {plants
            .filter((p) => String(p.species_id) === selected.species_id)
            .map((p) => (
              <View key={p.plant_id}>
                <Text>{t("fieldCollection.plant")}{p.plant_id}</Text>
                {p.latitude !== undefined && (
                  <Text>{t("editPlant.gps")}{p.latitude}, {p.longitude}
                  </Text>
                )}
              </View>
            ))}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel={t("persistentKnowledge.searchPlants")}
            placeholder={t("persistentKnowledge.searchPlantNames")}
            value={search}
            onChangeText={setSearch}
            style={{ borderWidth: 1, padding: 12, marginVertical: 12 }}
          />
          {species
            .filter((s) =>
              `${s.scientific_name} ${s.common_name}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((s) => (
              <TouchableOpacity
                key={s.species_id}
                style={{
                  padding: 18,
                  marginVertical: 6,
                  backgroundColor: "white",
                  borderRadius: 10,
                }}
                onPress={() =>
                  navigation.navigate("SpeciesDetail", {
                    speciesId: s.species_id,
                  })
                }
              >
                <Text>{s.scientific_name}</Text>
                <Text>{speciesCommonName(s)}</Text>
              </TouchableOpacity>
            ))}
        </>
      )}
    </ScrollView>
  );
}
function AuthenticatedImage({ id, userId }) {
  useAppTranslation();
  const [source, setSource] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSource(null);
    setError("");
    const load = async () => {
      await imageConnectivity();
      const origin = mobileApiUrl("plant");
      if (faceSession.hasSession())
        await faceSession.withToken(async (token) => {
          if (active)
            setSource({
              uri: `${origin}/api/assets/${id}`,
              headers: { Authorization: `Bearer ${token}` },
            });
        }, userId);
      else if (active) setSource({ uri: `${origin}/api/assets/${id}` });
    };
    load().catch(() => {
      if (active)
        setError("Photo unavailable. Check connectivity and sign in again.");
    });
    return () => {
      active = false;
    };
  }, [id, userId]);
  if (error) return <Text accessibilityRole="alert">{translateUIMessage(error)}</Text>;
  return source ? (
    <PreviewableImage
      source={source}
      onError={() => {
        setSource(null);
        setError("Photo could not be loaded. Check connectivity and access.");
      }}
      style={{ width: "100%", height: 240, marginVertical: 10 }}
    />
  ) : null;
}
