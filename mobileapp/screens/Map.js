import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import PlantExplorerMap from "../components/PlantExplorerMap";
import { t, translateLabel, useAppTranslation } from "../translations/i18n";
import { fetchPlantRecords, filterMapPlantsByStatus, isMapPlantVisible } from "../utils/plantApi";
import { getPlantLocationDisplay } from "../utils/plantLocationDisplay";

const statusColors = {
  approved: ["#E2F4E6", "#257344"],
  "pending review": ["#FFF1D8", "#9A6210"],
  "correction required": ["#FFF0D9", "#98601B"],
  rejected: ["#FCE8E8", "#B42F35"],
  withdrawn: ["#ECEFF1", "#52616A"],
};

function PlantCard({ plant, onPress }) {
  useAppTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const status = plant.currentStatus || plant.status || "";
  const [badgeBackground, badgeText] = statusColors[status.toLowerCase()] || ["#E9EFEA", "#466354"];
  const zone = plant.mapLocation.zone || t("plant.notRecorded");
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.82} accessibilityRole="button"
      accessibilityLabel={`${plant.plantScientificName || t("plant.notRecorded")}, ${t("plantDetail.plantId")} ${plant.plantId}`}>
      <View style={styles.imageWrap}>
        {plant.plantImage && !imageFailed ? (
          <Image source={plant.plantImage} style={styles.image} resizeMode="cover" onError={() => setImageFailed(true)} />
        ) : (
          <View style={styles.imagePlaceholder}><Ionicons name="leaf-outline" size={34} color="#5C9B70" /></View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.plantName} numberOfLines={2}>{plant.plantScientificName || t("plant.notRecorded")}</Text>
        <Text style={styles.recordId} numberOfLines={1}>{t("plantDetail.plantId")}: {plant.plantId}</Text>
        <View style={[styles.badge, { backgroundColor: badgeBackground }]}>
          <Text style={[styles.badgeText, { color: badgeText }]} numberOfLines={1}>{status ? translateLabel(status) : t("map.unknown")}</Text>
        </View>
        <View style={styles.zoneRow}>
          <Ionicons name="location-outline" size={13} color="#668271" />
          <Text style={styles.zoneText} numberOfLines={1}>{zone}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MapScreen({ navigation, user }) {
  useAppTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("allVisible");
  const isBotanist = String(user?.role || "").toLowerCase() === "botanist";
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadPlants = useCallback(async (pullToRefresh = false, isCurrent = () => true) => {
    if (!user?.id) {
      if (isCurrent()) {
        setPlants([]);
        setError(t("botanistRecords.sessionRequired"));
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    if (pullToRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [catalogRecords, ownedRecords] = await Promise.all([
        fetchPlantRecords([], { accountId: user.id }),
        fetchPlantRecords([], { accountId: user.id, scopeMine: true }),
      ]);
      const recordsById = new Map(catalogRecords.map((record) => [record.plantId, record]));
      for (const record of ownedRecords) recordsById.set(record.plantId, record);
      if (isCurrent()) setPlants([...recordsById.values()].filter((record) =>
        record.plantId && record.plantId !== "Unknown ID" &&
        isMapPlantVisible(record, user.role, user.id)
      ));
    } catch (loadError) {
      if (isCurrent()) {
        setPlants([]);
        setError(loadError?.message || t("common.error"));
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    let current = true;
    void loadPlants(false, () => current);
    return () => { current = false; };
  }, [loadPlants]));

  const documentedPlants = useMemo(() => plants.map((record) => ({
    ...record,
    mapLocation: getPlantLocationDisplay(record.location, user?.role),
  })), [plants, user?.role]);
  const filteredPlants = useMemo(() => {
    const query = search.toLowerCase().trim();
    return filterMapPlantsByStatus(documentedPlants, user?.role, user?.id, statusFilter).filter((plant) => !query || [
      plant.plantCommonName, plant.plantScientificName, plant.family, plant.plantId,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [documentedPlants, search, statusFilter, user?.role, user?.id]);
  const mappedPlants = useMemo(() => filteredPlants.filter((plant) => plant.mapLocation.status === "available"), [filteredPlants]);
  const openPlant = (plant) => navigation?.navigate("PlantDetails", { plantId: plant.plantId });

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPlants(true)} tintColor="#267348" colors={["#267348"]} />}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("map.plantExplorer")}</Text>
          <Text style={styles.subtitle}>{t("map.discoverDocumentedPlantsInNiahNationalPark")}</Text>
        </View>
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#668271" />
          <TextInput style={styles.searchInput} placeholder={t("map.searchByPlantName")}
            placeholderTextColor="#87998B" value={search} onChangeText={setSearch} returnKeyType="search" />
          {!!search && <TouchableOpacity onPress={() => setSearch("")} accessibilityRole="button"
            accessibilityLabel={t("map.clearSearch")}><Ionicons name="close-circle" size={20} color="#789181" /></TouchableOpacity>}
        </View>
        {loading || error ? (
          <View style={styles.message}>
            {loading ? <ActivityIndicator color="#267348" /> : <Text style={styles.messageTitle}>{t("common.error")}</Text>}
            <Text style={styles.messageText}>{loading ? t("plant.loadingPlantRecords") : error}</Text>
            {!!error && <TouchableOpacity onPress={() => void loadPlants(true)} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.refresh")}</Text>
            </TouchableOpacity>}
          </View>
        ) : (
          <>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{t("map.biodiversityMap")}</Text>
              <Text style={styles.sectionSubtitle}>{t("map.tapAMarkerForDetails")}</Text>
            </View>
            <PlantExplorerMap key={isBotanist ? `${statusFilter}:${search}` : "default"}
              plants={mappedPlants} onViewDetails={openPlant} />
            {!mappedPlants.length && <Text style={styles.mapEmpty}>{t("map.noMappedPlants")}</Text>}
            <View style={styles.listHeading}>
              <View>
                <Text style={styles.sectionTitle}>{t("map.documentedPlants")}</Text>
                <Text style={styles.sectionSubtitle}>{t("map.tapARecordToViewItsDetails")}</Text>
              </View>
              <View style={styles.count}><Text style={styles.countText}>{filteredPlants.length}</Text></View>
            </View>
            {isBotanist && <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statusFilters} accessibilityLabel={t("plant.recordVisibilityFilters")}>
              {[["allVisible", t("plant.allVisible")], ["approved", t("plant.approvedOnly")],
                ["myPending", t("plant.myPending")], ["myRejected", t("plant.myRejected")]].map(([value, label]) => {
                const selected = statusFilter === value;
                return <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => setStatusFilter(value)}
                  style={[styles.statusFilterChip, selected && styles.statusFilterChipSelected]}>
                  <Text style={[styles.statusFilterText, selected && styles.statusFilterTextSelected]}>{label}</Text>
                </TouchableOpacity>;
              })}
            </ScrollView>}
            {filteredPlants.length ? (
              <FlatList data={filteredPlants} keyExtractor={(item) => item.plantId} numColumns={2}
                scrollEnabled={false} columnWrapperStyle={styles.plantGrid}
                renderItem={({ item }) => <PlantCard plant={item} onPress={() => openPlant(item)} />} />
            ) : (
              <View style={styles.message}>
                <Ionicons name="leaf-outline" size={34} color="#6A9E76" />
                <Text style={styles.messageTitle}>{t("map.noRecordsFound")}</Text>
                <Text style={styles.messageText}>{t("map.tryAnotherSearchOrClearYourSearch")}</Text>
                <TouchableOpacity onPress={() => { setSearch(""); setStatusFilter("allVisible"); }} style={styles.retryButton}>
                  <Text style={styles.retryText}>{t("map.clearSearch")}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F9F4" },
  content: { width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 18, paddingTop: 38, paddingBottom: 40 },
  header: { marginBottom: 20 },
  title: { fontSize: 29, fontWeight: "800", color: "#214C37" },
  subtitle: { marginTop: 5, fontSize: 14, lineHeight: 20, color: "#62796A" },
  searchContainer: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14,
    borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1ECE1" },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, color: "#244C38" },
  sectionHeading: { marginTop: 24, marginBottom: 11 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#214C37" },
  sectionSubtitle: { marginTop: 3, fontSize: 12, color: "#718575" },
  mapEmpty: { marginTop: 8, fontSize: 12, color: "#687E6D" },
  listHeading: { marginTop: 28, marginBottom: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusFilters: { paddingBottom: 12, gap: 8 },
  statusFilterChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: "#D6E9D9", backgroundColor: "#FFFFFF" },
  statusFilterChipSelected: { borderColor: "#2F6B4F", backgroundColor: "#D6E9D9" },
  statusFilterText: { color: "#52665C", fontSize: 12, fontWeight: "600" },
  statusFilterTextSelected: { color: "#2F6B4F", fontWeight: "700" },
  count: { minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#DDEFD9" },
  countText: { fontSize: 13, fontWeight: "700", color: "#286C42" },
  plantGrid: { justifyContent: "space-between" },
  card: { width: "48%", marginBottom: 14, overflow: "hidden", borderRadius: 17, backgroundColor: "#FFFFFF",
    borderWidth: 1, borderColor: "#E3EDE2", elevation: 2, shadowColor: "#173B27", shadowOpacity: 0.06,
    shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  imageWrap: { height: 116, backgroundColor: "#E7F1E5" },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardBody: { padding: 11 },
  plantName: { minHeight: 37, fontSize: 14, lineHeight: 18, fontWeight: "700", fontStyle: "italic", color: "#234D38" },
  recordId: { marginTop: 5, fontSize: 11, color: "#62796A" },
  badge: { alignSelf: "flex-start", maxWidth: "100%", marginTop: 10, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  zoneRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  zoneText: { flex: 1, fontSize: 11, color: "#607667" },
  message: { minHeight: 160, alignItems: "center", justifyContent: "center", marginTop: 22, padding: 24,
    borderRadius: 17, backgroundColor: "#FFFFFF" },
  messageTitle: { marginTop: 8, fontSize: 16, fontWeight: "700", color: "#244C38" },
  messageText: { marginTop: 6, textAlign: "center", fontSize: 13, color: "#68806F" },
  retryButton: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: "#267348" },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
