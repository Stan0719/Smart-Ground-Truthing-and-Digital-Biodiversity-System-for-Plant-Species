import React, { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import PlantExplorerMap from "../components/PlantExplorerMap";
import { t, translateLabel, useAppTranslation } from "../translations/i18n";
import { fetchPlantRecords, filterMapPlantsByStatus, isMapPlantVisible } from "../utils/plantApi";
import { getPlantLocationDisplay } from "../utils/plantLocationDisplay";
import LanguageSelector from "../components/LanguageSelector";

const statusColors = {
  approved: ["#E2F4E6", "#257344"],
  "pending review": ["#FFF1D8", "#9A6210"],
  "correction required": ["#FFF0D9", "#98601B"],
  rejected: ["#FCE8E8", "#B42F35"],
  withdrawn: ["#ECEFF1", "#52616A"],
};

function PlantCard({ plant, onPress, onMapPress }) {
  useAppTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const status = plant.currentStatus || plant.status || "";
  const [badgeBackground, badgeText] = statusColors[status.toLowerCase()] || ["#E9EFEA", "#466354"];
  const zone = plant.mapLocation.zone || t("plant.notRecorded");
  const canMap = plant.mapLocation.status === "available";
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardMain} onPress={onPress} activeOpacity={0.82} accessibilityRole="button"
        accessibilityLabel={`${plant.plantScientificName || t("plant.notRecorded")}, ${t("plantDetail.plantId")} ${plant.plantId}`}>
        <View style={styles.imageWrap}>
          {plant.plantImage && !imageFailed ? (
            <Image source={plant.plantImage} style={styles.image} resizeMode="cover" onError={() => setImageFailed(true)} />
          ) : (
            <View style={styles.imagePlaceholder}><Ionicons name="leaf-outline" size={34} color="#5C9B70" /></View>
          )}
        <View pointerEvents="none" style={[styles.imageStatusBadge, { backgroundColor: badgeBackground }]}>
          <Text style={[styles.imageStatusBadgeText, { color: badgeText }]} numberOfLines={1}>
            {status ? translateLabel(status) : t("map.unknown")}
          </Text>
        </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.plantName} numberOfLines={2}>{plant.plantScientificName || t("plant.notRecorded")}</Text>
          <Text style={styles.recordId} numberOfLines={1}>{t("plantDetail.plantId")}: {plant.plantId}</Text>
          <View style={styles.zoneRow}>
            <Ionicons name="location-outline" size={13} color="#668271" />
            <Text style={styles.zoneText} numberOfLines={1}>{zone}</Text>
          </View>
        </View>
      </TouchableOpacity>
      <View style={styles.cardActions}>
        <TouchableOpacity testID={`plant-map-${plant.plantId}`} style={[styles.cardAction, styles.mapAction, !canMap && styles.disabledMapAction]}
          onPress={() => onMapPress(plant)} disabled={!canMap} activeOpacity={0.8} accessibilityRole="button"
          accessibilityLabel={canMap ? t("navigation.map") : `${t("navigation.map")}, ${plant.mapLocation.status === "restricted" ? t("map.locationRestricted") : t("map.locationNotRecorded")}`}
          accessibilityState={{ disabled: !canMap }}>
          <Ionicons name="location" size={15} color="#FFFFFF" /><Text style={styles.mapActionText}>{t("navigation.map")}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID={`plant-details-${plant.plantId}`} style={[styles.cardAction, styles.detailsAction]}
          onPress={() => onPress(plant)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t("map.details")}>
          <Ionicons name="eye-outline" size={15} color="#267348" /><Text style={styles.detailsActionText}>{t("map.details")}</Text>
        </TouchableOpacity>
      </View>
      {!canMap && <Text style={styles.mapUnavailableText}>{plant.mapLocation.status === "restricted" ? t("map.locationRestricted") : t("map.locationNotRecorded")}</Text>}
    </View>
  );
}

function matchesPlantSearch(plant, value) {
  const query = String(value || "").toLowerCase().trim();
  return !query || [plant.plantCommonName, plant.plantScientificName, plant.family, plant.plantId]
    .some((field) => String(field || "").toLowerCase().includes(query));
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
  const [mapFocusRequest, setMapFocusRequest] = useState(null);
  const [selectedMapPlantId, setSelectedMapPlantId] = useState(null);
  const scrollRef = useRef(null);
  const mapOffset = useRef(0);
  const focusSequence = useRef(0);

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
  const effectiveStatusFilter = statusFilter === "myRejected" ? "allVisible" : statusFilter;
  const filteredPlants = useMemo(() => {
    return filterMapPlantsByStatus(documentedPlants, user?.role, user?.id, effectiveStatusFilter)
      .filter((plant) => matchesPlantSearch(plant, search));
  }, [documentedPlants, search, effectiveStatusFilter, user?.role, user?.id]);
  const mappedPlants = useMemo(() => filteredPlants.filter((plant) => plant.mapLocation.status === "available"), [filteredPlants]);
  const selectedMapPlantVisible = selectedMapPlantId != null && mappedPlants.some(
    (plant) => String(plant.plantId) === String(selectedMapPlantId),
  );
  const updateSearch = (value) => {
    setSearch(value);
    if (selectedMapPlantId != null && !filterMapPlantsByStatus(documentedPlants, user?.role, user?.id, effectiveStatusFilter)
      .some((plant) => String(plant.plantId) === String(selectedMapPlantId) && matchesPlantSearch(plant, value) && plant.mapLocation.status === "available")) {
      setSelectedMapPlantId(null);
    }
  };
  const updateStatusFilter = (value) => {
    setStatusFilter(value);
    if (selectedMapPlantId != null && !filterMapPlantsByStatus(documentedPlants, user?.role, user?.id, value)
      .some((plant) => String(plant.plantId) === String(selectedMapPlantId) && matchesPlantSearch(plant, search) && plant.mapLocation.status === "available")) {
      setSelectedMapPlantId(null);
    }
  };
  const openPlant = (plant) => navigation?.navigate("PlantDetails", { plantId: plant.plantId });
  const focusPlantOnMap = (plant) => {
    if (plant.mapLocation.status !== "available") return;
    setSelectedMapPlantId(plant.plantId);
    setMapFocusRequest({ plantId: plant.plantId, sequence: ++focusSequence.current });
    scrollRef.current?.scrollTo({ y: Math.max(0, mapOffset.current - 16), animated: true });
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPlants(true)} tintColor="#267348" colors={["#267348"]} />}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>{t("map.plantExplorer")}</Text>
            <LanguageSelector />
          </View>
          <Text style={styles.subtitle}>{t("map.discoverDocumentedPlantsInNiahNationalPark")}</Text>
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
            <View onLayout={(event) => { mapOffset.current = event.nativeEvent.layout.y; }}>
              <PlantExplorerMap key={isBotanist ? effectiveStatusFilter : "default"}
                plants={mappedPlants} onViewDetails={openPlant} focusRequest={mapFocusRequest}
                selectedPlantId={selectedMapPlantVisible ? selectedMapPlantId : null} onSelectPlant={setSelectedMapPlantId} />
            </View>
            {!mappedPlants.length && <Text style={styles.mapEmpty}>{t("map.noMappedPlants")}</Text>}
            <View style={styles.listHeading}>
              <View>
                <Text style={styles.sectionTitle}>{t("map.documentedPlants")}</Text>
                <Text style={styles.sectionSubtitle}>{t("map.tapARecordToViewItsDetails")}</Text>
              </View>
              <View style={styles.count}><Text style={styles.countText}>{filteredPlants.length}</Text></View>
            </View>
            <View style={styles.searchContainer}>
              <Ionicons name="search-outline" size={20} color="#668271" />
              <TextInput style={styles.searchInput} placeholder={t("map.searchByPlantName")}
                placeholderTextColor="#87998B" value={search} onChangeText={updateSearch} returnKeyType="search" />
              {!!search && <TouchableOpacity onPress={() => updateSearch("")} accessibilityRole="button"
                accessibilityLabel={t("map.clearSearch")}><Ionicons name="close-circle" size={20} color="#789181" /></TouchableOpacity>}
            </View>
            {isBotanist && <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statusFilters} accessibilityLabel={t("plant.recordVisibilityFilters")}>
              {[["allVisible", t("plant.allVisible")], ["approved", t("plant.approvedOnly")],
                ["myPending", t("plant.myPending")]].map(([value, label]) => {
                const selected = effectiveStatusFilter === value;
                return <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => updateStatusFilter(value)}
                  style={[styles.statusFilterChip, selected && styles.statusFilterChipSelected]}>
                  <Text style={[styles.statusFilterText, selected && styles.statusFilterTextSelected]}>{label}</Text>
                </TouchableOpacity>;
              })}
            </ScrollView>}
            {filteredPlants.length ? (
              <FlatList data={filteredPlants} keyExtractor={(item) => item.plantId} numColumns={2}
                scrollEnabled={false} columnWrapperStyle={styles.plantGrid}
                renderItem={({ item }) => <PlantCard plant={item} onPress={() => openPlant(item)} onMapPress={focusPlantOnMap} />} />
            ) : (
              <View style={styles.message}>
                <Ionicons name="leaf-outline" size={34} color="#6A9E76" />
                <Text style={styles.messageTitle}>{t("map.noRecordsFound")}</Text>
                <Text style={styles.messageText}>{t("map.tryAnotherSearchOrClearYourSearch")}</Text>
                <TouchableOpacity onPress={() => updateSearch("")} style={styles.retryButton}>
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
  content: { width: "100%", maxWidth: 860, alignSelf: "center", paddingHorizontal: 18, paddingTop: 100, paddingBottom: 40 },
  header: { marginBottom: 20 },
  headerTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 29, fontWeight: "800", color: "#214C37" },
  subtitle: { marginTop: 5, fontSize: 14, lineHeight: 20, color: "#62796A" },
  searchContainer: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14,
    marginBottom: 15, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1ECE1" },
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
  cardMain: { width: "100%", flexGrow: 1 },
  imageWrap: { height: 116, position: "relative", backgroundColor: "#E7F1E5" },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  imageStatusBadge: { position: "absolute", top: 8, right: 8, maxWidth: "88%", borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(35, 77, 56, 0.16)" },
  imageStatusBadgeText: { fontSize: 10, lineHeight: 13, fontWeight: "700" },
  cardBody: { padding: 11 },
  plantName: { minHeight: 37, fontSize: 14, lineHeight: 18, fontWeight: "700", fontStyle: "italic", color: "#234D38" },
  recordId: { marginTop: 5, fontSize: 11, color: "#62796A" },
  zoneRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  zoneText: { flex: 1, fontSize: 11, color: "#607667" },
  cardActions: { flexDirection: "row", gap: 7, paddingHorizontal: 9, paddingBottom: 10 },
  cardAction: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 1, paddingHorizontal: 2, borderRadius: 12, borderWidth: 1 },
  mapAction: { backgroundColor: "#267348", borderColor: "#267348" },
  disabledMapAction: { backgroundColor: "#AAB8AE", borderColor: "#AAB8AE" },
  mapActionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  detailsAction: { backgroundColor: "#F2F8F1", borderColor: "#5A8C69" },
  detailsActionText: { color: "#267348", fontSize: 11, fontWeight: "700" },
  mapUnavailableText: { marginHorizontal: 9, marginTop: -4, marginBottom: 8, textAlign: "center", color: "#748278", fontSize: 10 },
  message: { minHeight: 160, alignItems: "center", justifyContent: "center", marginTop: 22, padding: 24,
    borderRadius: 17, backgroundColor: "#FFFFFF" },
  messageTitle: { marginTop: 8, fontSize: 16, fontWeight: "700", color: "#244C38" },
  messageText: { marginTop: 6, textAlign: "center", fontSize: 13, color: "#68806F" },
  retryButton: { marginTop: 14, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: "#267348" },
  retryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
