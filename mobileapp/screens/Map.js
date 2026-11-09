import { useAppTranslation, t } from "../translations/i18n";
import React, { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { fetchPlantRecords, getPlantDisplayObservation } from "../utils/plantApi";
import { getPlantLocationDisplay } from "../utils/plantLocationDisplay";

import {
  ActivityIndicator,
  RefreshControl,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  FlatList,
} from "react-native";

export default function MapScreen({ navigation, user }) {
  useAppTranslation();
  const [search, setSearch] = useState("");
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
      if (isCurrent()) setPlants([...recordsById.values()].filter((record) => record.plantId && record.plantId !== "Unknown ID"));
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
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    let current = true;
    void loadPlants(false, () => current);
    return () => { current = false; };
  }, [loadPlants]));

  // =====================================================
  // MAP BACKEND RECORDS
  // =====================================================

  const documentedPlants = useMemo(() => plants.map((record) => {
    return {
      ...record,
      name: record.plantCommonName || "",
      scientificName: record.plantScientificName || "",
      family: record.family ?? "",
      id: record.plantId,
      status: record.currentStatus ?? record.status,
    };
  }), [plants]);

  // =====================================================
  // FILTER RECORDS
  // =====================================================

  const filteredPlants = useMemo(() => {
    const searchText =
      search.toLowerCase().trim();

    return documentedPlants.filter(
      (plant) => {
        const matchesSearch =
          !searchText ||
          plant.name
            ?.toLowerCase()
            .includes(searchText) ||
          plant.scientificName
            ?.toLowerCase()
            .includes(searchText) ||
          plant.family
            ?.toLowerCase()
            .includes(searchText) ||
          plant.plantId
            ?.toLowerCase()
            .includes(searchText);
        return matchesSearch;
      }
    );
  }, [documentedPlants, search]);

  // =====================================================
  // RECORD PRESS
  // =====================================================

  function handlePlantPress(record) {
    navigation?.navigate(
      "PlantDetails",
      {
        plantId: record.plantId || record.id,
      }
    );
  }

  // =====================================================
  // CLEAR FILTERS
  // =====================================================

  function clearFilters() {
    setSearch("");
  }

  // =====================================================
  // RENDER CARD
  // =====================================================

  function renderPlantCard({
    item,
  }) {
    const observation = getPlantDisplayObservation(item);
    const photos =
      item.images ||
      item.photos ||
      [];
    const location = getPlantLocationDisplay(item.location, user?.role);
    const locationText = location.status === "available"
      ? [
          `${t("map.latitude")}: ${location.latitude.toFixed(6)}`,
          `${t("map.longitude")}: ${location.longitude.toFixed(6)}`,
          `${t("plantDetail.gpsAccuracy")}: ${location.accuracyM != null ? `± ${location.accuracyM} m` : t("plant.notRecorded")}`,
          `${t("plantDetail.altitude")}: ${location.altitudeM != null ? `${location.altitudeM} m` : t("plant.notRecorded")}`,
          `${t("plantDetail.locationZone")}: ${location.zone || t("plant.notRecorded")}`,
        ].join("\n")
      : location.status === "restricted"
        ? t("map.locationRestricted")
        : t("map.locationNotRecorded");

    return (
      <TouchableOpacity
        style={styles.locationCard}
        onPress={() =>
          handlePlantPress(item)
        }
        activeOpacity={0.85}
      >
        {/* ICON */}

        <View
          style={
            styles.plantIconContainer
          }
        >
          <Text style={styles.plantIcon}>
            🌿
          </Text>
        </View>

        {/* SCIENTIFIC NAME */}

        <Text
          style={styles.plantName}
          numberOfLines={2}
        >
          {item.scientificName || t("plant.notRecorded")}
        </Text>

        {/* COMMON NAME */}

        <Text
          style={styles.commonName}
          numberOfLines={1}
        >
          {item.name || t("plant.notRecorded")}
        </Text>

        {/* RECORD ID */}

        <Text
          style={styles.recordId}
          numberOfLines={1}
        >
          {item.plantId}
        </Text>

        <Text style={styles.locationText} numberOfLines={2}>
          {t("plant.height")}: {observation?.heightCm != null ? `${observation.heightCm} cm` : t("plant.notRecorded")}
          {" · "}{t("plant.lifeStage2")}: {observation?.lifeStage || t("plant.notRecorded")}
          {" · "}{t("plant.health")}: {observation?.healthStatus || t("plant.notRecorded")}
        </Text>

        <Text style={styles.locationText} numberOfLines={5}>
          {t("map.location")}: {locationText}
        </Text>

        {/* STATUS */}

        <View
          style={styles.statusRow}
        >
          <View
            style={[
              styles.statusBadge,
              String(item.status || "").toLowerCase() ===
                "approved"
                ? styles.statusApproved
                : styles.statusPending,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                String(item.status || "").toLowerCase() ===
                  "approved"
                  ? styles.statusApprovedText
                  : styles.statusPendingText,
              ]}
            >
              {item.status
                ? item.status
                    .charAt(0)
                    .toUpperCase() +
                  item.status.slice(1)
                : t("map.unknown")}
            </Text>
          </View>

          {photos.length > 0 && (
            <Text
              style={styles.photoCount}
            >
              📷 {photos.length}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // =====================================================
  // MAIN SCREEN
  // =====================================================

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadPlants(true)} tintColor="#468585" colors={["#468585"]} />}
        contentContainerStyle={
          styles.content
        }
      >
        {/* =====================================================
            HEADER
        ===================================================== */}

        <View style={styles.header}>
          <Text style={styles.title}>{t("map.plantMap")}</Text>

          <Text style={styles.subtitle}>{t("map.exploreDocumentedPlantLocationsInNiahNationalPark")}</Text>
        </View>

        {/* =====================================================
            SEARCH
        ===================================================== */}

        <View
          style={
            styles.searchContainer
          }
        >
          <Text style={styles.searchIcon}>
            🔍
          </Text>

          <TextInput
            style={styles.searchInput}
            placeholder={t("map.searchPlants")}
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
          />

          {search.length > 0 && (
            <TouchableOpacity
              onPress={() =>
                setSearch("")
              }
              activeOpacity={0.7}
            >
              <Text
                style={
                  styles.clearButton
                }
              >
                ×
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.emptyContainer}>
            <ActivityIndicator size="small" color="#468585" />
            <Text style={styles.emptyText}>{t("plant.loadingPlantRecords")}</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>{t("common.error")}</Text>
            <Text style={styles.emptyText}>{error}</Text>
            <TouchableOpacity style={styles.clearFiltersButton} onPress={() => void loadPlants(true)} activeOpacity={0.8}>
              <Text style={styles.clearFiltersText}>{t("common.refresh")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        
        {/* =====================================================
            SUMMARY
        ===================================================== */}

        {!loading && !error && <>
        <View
          style={
            styles.summaryContainer
          }
        >
          <View style={styles.summaryItem}>
            <Text
              style={
                styles.summaryNumber
              }
            >
              {documentedPlants.length}
            </Text>

            <Text
              style={styles.summaryLabel}
            >{t("map.totalRecords")}</Text>
          </View>

        </View>

        {/* =====================================================
            DOCUMENTED PLANTS
        ===================================================== */}

        <View
          style={styles.sectionHeader}
        >
          <View
            style={
              styles.sectionHeaderText
            }
          >
            <Text
              style={
                styles.sectionTitle
              }
            >{t("map.documentedPlants")}</Text>

            <Text
              style={
                styles.sectionSubtitle
              }
            >{t("map.tapARecordToViewItsDetails")}</Text>
          </View>

          <View
            style={
              styles.resultCountContainer
            }
          >
            <Text
              style={
                styles.resultCount
              }
            >
              {filteredPlants.length}
            </Text>
          </View>
        </View>

        {/* =====================================================
            PLANT GRID
        ===================================================== */}

        {filteredPlants.length === 0 ? (
          <View
            style={
              styles.emptyContainer
            }
          >
            <Text
              style={styles.emptyIcon}
            >
              🌱
            </Text>

            <Text
              style={styles.emptyTitle}
            >{t("map.noRecordsFound")}</Text>

            <Text
              style={styles.emptyText}
            >{t("map.tryAnotherSearchOrClearYourSearch")}</Text>

            <TouchableOpacity
              style={
                styles.clearFiltersButton
              }
              onPress={clearFilters}
              activeOpacity={0.8}
            >
              <Text
                style={
                  styles.clearFiltersText
                }
              >{t("map.clearSearch")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredPlants}
            keyExtractor={(item) =>
              item.plantId
            }
            numColumns={2}
            scrollEnabled={false}
            columnWrapperStyle={
              styles.plantGrid
            }
            renderItem={
              renderPlantCard
            }
          />
        )}
        </>}
      </ScrollView>
    </View>
  );
}

// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7FAF5",
  },

  content: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 35,
  },

  // =====================================================
  // HEADER
  // =====================================================

  header: {
    marginTop: 10,
    marginBottom: 18,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#468585",
  },

  subtitle: {
    fontSize: 14,
    color: "#687568",
    marginTop: 5,
    lineHeight: 20,
  },

  // =====================================================
  // SEARCH
  // =====================================================

  searchContainer: {
    height: 48,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#E2EBDD",
    marginBottom: 14,
  },

  searchIcon: {
    fontSize: 17,
    marginRight: 9,
  },

  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#333",
  },

  clearButton: {
    fontSize: 24,
    color: "#888",
    lineHeight: 24,
  },

  // =====================================================
  // MAP
  // =====================================================

  mapContainer: {
    height: 320,
    marginTop: 18,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#DCE8D7",
    position: "relative",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  map: {
    flex: 1,
  },

  markerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#468585",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  markerIcon: {
    fontSize: 17,
  },

  // =====================================================
  // MAP HINT
  // =====================================================

  mapHint: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
    paddingHorizontal: 5,
  },

  mapHintIcon: {
    fontSize: 13,
    marginRight: 5,
  },

  mapHintText: {
    fontSize: 10,
    color: "#7A8278",
  },

  // =====================================================
  // SUMMARY
  // =====================================================

  summaryContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    marginTop: 14,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  summaryItem: {
    flex: 1,
    alignItems: "center",
  },

  summaryNumber: {
    fontSize: 19,
    fontWeight: "700",
    color: "#468585",
  },

  summaryLabel: {
    fontSize: 10,
    color: "#777",
    marginTop: 3,
  },

  // =====================================================
  // SECTION
  // =====================================================

  sectionHeader: {
    marginTop: 23,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionHeaderText: {
    flex: 1,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#234D20",
  },

  sectionSubtitle: {
    fontSize: 12,
    color: "#7A8278",
    marginTop: 3,
  },

  resultCountContainer: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#DEF9C4",
    alignItems: "center",
    justifyContent: "center",
  },

  resultCount: {
    fontSize: 12,
    fontWeight: "700",
    color: "#468585",
  },

  // =====================================================
  // PLANT GRID
  // =====================================================

  plantGrid: {
    justifyContent: "space-between",
  },

  locationCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EDF1EA",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  plantIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: "#EAF6E4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  plantIcon: {
    fontSize: 23,
  },

  plantName: {
    fontSize: 14,
    fontWeight: "700",
    fontStyle: "italic",
    color: "#356859",
    lineHeight: 19,
  },

  commonName: {
    fontSize: 12,
    color: "#777",
    marginTop: 3,
  },

  recordId: {
    fontSize: 9,
    color: "#999",
    marginTop: 7,
    fontWeight: "600",
  },

  locationText: {
    marginTop: 5,
    color: "#687568",
    fontSize: 9,
    lineHeight: 13,
  },

  // =====================================================
  // STATUS
  // =====================================================

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },

  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 7,
  },

  statusApproved: {
    backgroundColor: "#E3F4E0",
  },

  statusPending: {
    backgroundColor: "#FFF1D6",
  },

  statusText: {
    fontSize: 8,
    fontWeight: "700",
  },

  statusApprovedText: {
    color: "#43804A",
  },

  statusPendingText: {
    color: "#A66A13",
  },

  photoCount: {
    fontSize: 9,
    color: "#777",
    marginLeft: "auto",
  },

  
  // =====================================================
  // EMPTY
  // =====================================================

  emptyContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 30,
    alignItems: "center",
    marginBottom: 20,
  },

  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },

  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
  },

  emptyText: {
    fontSize: 13,
    color: "#777",
    textAlign: "center",
    lineHeight: 19,
    marginTop: 5,
  },

  clearFiltersButton: {
    marginTop: 15,
    backgroundColor: "#468585",
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 10,
  },

  clearFiltersText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});
