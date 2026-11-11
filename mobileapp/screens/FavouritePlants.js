import React, { useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import useVisitorFavourites from "../hooks/useVisitorFavourites";
import FavouriteHeart from "../components/FavouriteHeart";
import RefreshButton from "../components/RefreshButton";
import BackButton from "../components/BackButton";

export default function FavouritePlantsScreen({ navigation, user }) {
  useAppTranslation();
  const [tab, setTab] = useState("plants");
  const [failedPlantImageUris, setFailedPlantImageUris] = useState(() => new Set());
  const favourites = useVisitorFavourites(user);
  const items = favourites.data[tab];
  const isSpecies = tab === "species";

  function openItem(item) {
    if (isSpecies) navigation.navigate("SpeciesDetail", { speciesId: item.id, slug: item.slug });
    else navigation.navigate("PlantDetails", { plantId: item.plantId });
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={favourites.refreshing} onRefresh={() => void favourites.refresh(true)} tintColor="#468585" colors={["#468585"]} />}
      >
        <View style={styles.header}>
          <BackButton accessibilityLabel={t("common.goBack")} onPress={() => navigation.goBack()} />
          <Text style={styles.title}>{t("navigation.favouritePlants")}</Text>
          <RefreshButton onPress={() => void favourites.refresh(true)} loading={favourites.loading || favourites.refreshing} label={t("common.refresh")} />
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {[["plants", t("favourites.plantsTab")], ["species", t("favourites.speciesTab")]].map(([key, label]) => (
            <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={[styles.tab, tab === key && styles.activeTab]} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!!favourites.mutationError && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(favourites.mutationError)}</Text>}
        {!favourites.loading && !!favourites.error && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(favourites.error)}</Text>}
        {favourites.loading ? (
          <View style={styles.state}><Ionicons name="leaf-outline" size={34} color="#77A68A" /><Text style={styles.stateText}>{t("favourites.loading")}</Text></View>
        ) : !favourites.error && items.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="heart-outline" size={54} color="#91BFA0" />
            <Text style={styles.emptyTitle}>{isSpecies ? t("favourites.noFavouriteSpecies") : t("favouritePlants.noFavouritePlants")}</Text>
            <Text style={styles.stateText}>{isSpecies ? t("favourites.noFavouriteSpeciesHint") : t("favouritePlants.plantsYouFavouriteWillAppearHere")}</Text>
          </View>
        ) : (
          items.map((item) => {
            const id = isSpecies ? item.id : item.plantId;
            const commonName = isSpecies ? item.commonName : item.commonName;
            const scientificName = isSpecies ? item.scientificName : item.scientificName;
            return (
              <View key={`${tab}:${id}`} style={styles.card}>
                <TouchableOpacity accessibilityRole="button" style={styles.cardMain} activeOpacity={0.8} onPress={() => openItem(item)}>
                  <View style={styles.imageFrame}>
                    {item.image && (isSpecies || !failedPlantImageUris.has(item.image.uri))
                      ? <Image
                        source={item.image}
                        style={styles.image}
                        resizeMode="cover"
                        onError={isSpecies ? undefined : () => setFailedPlantImageUris((current) => new Set(current).add(item.image.uri))}
                      />
                      : <Ionicons name="leaf" size={28} color="#4F8065" />}
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.commonName} numberOfLines={2}>{commonName || scientificName || t("favourites.unnamedRecord")}</Text>
                    {!!scientificName && <Text style={styles.scientificName} numberOfLines={2}>{scientificName}</Text>}
                    {!isSpecies && <Text style={styles.recordId}>{t("favourites.plantId")}{item.plantId}</Text>}
                  </View>
                </TouchableOpacity>
                <FavouriteHeart active pending={favourites.isPending(isSpecies ? "species" : "plant", id)} onPress={() => void favourites.toggle(isSpecies ? "species" : "plant", id)} style={styles.heart} />
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 18, paddingBottom: 34 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  title: { flex: 1, color: "#234B3A", fontSize: 23, fontWeight: "700" },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 14, backgroundColor: "#E7F2E2", marginBottom: 16 },
  tab: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  activeTab: { backgroundColor: "#468585" },
  tabText: { color: "#446457", fontSize: 14, fontWeight: "600" },
  activeTabText: { color: "#FFFFFF" },
  card: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2EDE0", padding: 14, marginBottom: 12, elevation: 1, shadowColor: "#234B3A", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  cardMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  imageFrame: { width: 76, height: 76, borderRadius: 13, backgroundColor: "#E5F0E1", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  copy: { flex: 1, minWidth: 0 },
  commonName: { color: "#234B3A", fontSize: 15, fontWeight: "700" },
  scientificName: { marginTop: 4, color: "#6D7F75", fontSize: 13, fontStyle: "italic" },
  recordId: { marginTop: 5, color: "#829289", fontSize: 11 },
  heart: { backgroundColor: "#F6F9F5" },
  state: { minHeight: 230, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyTitle: { color: "#468585", fontSize: 18, fontWeight: "700", textAlign: "center" },
  stateText: { color: "#6D7F75", fontSize: 14, textAlign: "center" },
  error: { color: "#A52A3A", fontSize: 13, marginBottom: 12 },
});
