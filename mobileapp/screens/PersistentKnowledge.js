import { can } from "../utils/rbac";
import React, { useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import {
  mobileApiUrl,
  createConnectivityGuard,
} from "../utils/apiConfiguration.js";
const imageConnectivity = createConnectivityGuard("plant", () =>
  mobileApiUrl("plant"),
);
export default function PersistentKnowledge({ route, navigation, user }) {
  const [species, setSpecies] = useState([]),
    [plants, setPlants] = useState([]),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null),
    [images, setImages] = useState([]);
  const map = route.name === "Map";
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
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
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
              (p) =>
                Number.isFinite(Number(p.latitude)) &&
                Number.isFinite(Number(p.longitude)) &&
                p.latitude != null &&
                p.longitude != null,
            )
            .map((p) => (
              <Marker
                key={p.plant_id}
                coordinate={{
                  latitude: Number(p.latitude),
                  longitude: Number(p.longitude),
                }}
                title={`Plant ${p.plant_id}`}
              />
            ))}
        </MapView>
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
        {selected ? selected.scientific_name : "Plant knowledge"}
      </Text>
      <TouchableOpacity onPress={load}>
        <Text style={{ padding: 12 }}>Refresh</Text>
      </TouchableOpacity>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
          {error}
        </Text>
      )}
      {selected ? (
        <>
          <Text>{selected.common_name}</Text>
          <Text>
            {selected.genus_name} · {selected.family_name}
          </Text>
          <Text>{selected.description}</Text>
          <Text>{selected.habitat}</Text>
          <Text>{selected.culturalSignificance}</Text>
          {!!selected.conservation_status && (
            <Text>Conservation: {selected.conservation_status}</Text>
          )}
          {images.map((a) => (
            <AuthenticatedImage key={a.id} id={a.id} userId={user?.id} />
          ))}
          {plants
            .filter((p) => String(p.species_id) === selected.species_id)
            .map((p) => (
              <View key={p.plant_id}>
                <Text>Plant {p.plant_id}</Text>
                {p.latitude !== undefined && (
                  <Text>
                    GPS: {p.latitude}, {p.longitude}
                  </Text>
                )}
              </View>
            ))}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search plants"
            placeholder="Search plant names"
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
                <Text>{s.common_name}</Text>
              </TouchableOpacity>
            ))}
        </>
      )}
    </ScrollView>
  );
}
function AuthenticatedImage({ id, userId }) {
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
  if (error) return <Text accessibilityRole="alert">{error}</Text>;
  return source ? (
    <Image
      source={source}
      onError={() => {
        setSource(null);
        setError("Photo could not be loaded. Check connectivity and access.");
      }}
      style={{ width: "100%", height: 240, marginVertical: 10 }}
    />
  ) : null;
}
