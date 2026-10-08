import React, { useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  FlatList,
} from "react-native";

import MapView, {
  Marker,
  PROVIDER_GOOGLE,
} from "react-native-maps";

import {
  plants,
  plantRecords,
} from "../data/mockData";

export default function MapScreen({ navigation }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState("All");

  // =====================================================
  // CATEGORIES
  // =====================================================

  const categories = [
    "All",
    ...new Set(
      plants
        .map((plant) => plant.category)
        .filter(Boolean)
    ),
  ];

  // =====================================================
  // COMBINE SPECIES + PLANT RECORDS
  // =====================================================

  const documentedPlants = useMemo(() => {
    return plantRecords.map((record) => {
      const species = plants.find(
        (plant) =>
          plant.slug === record.speciesSlug
      );

      return {
        ...record,

        // Species information
        speciesName:
          species?.name ||
          "Unknown Plant",

        scientificName:
          species?.scientificName ||
          "Unknown species",

        category:
          species?.category ||
          "Unknown",

        family:
          species?.family ||
          "",

        description:
          species?.description ||
          "",

        speciesImage:
          species?.image ||
          null,

        // Common name
        name:
          species?.name ||
          "Unknown Plant",

        // Record ID
        id:
          record.plantId,
      };
    });
  }, []);

  // =====================================================
  // CHECK GPS
  // =====================================================

  // function hasLocation(plant) {
  //   return (
  //     plant.latitude !== null &&
  //     plant.latitude !== undefined &&
  //     plant.longitude !== null &&
  //     plant.longitude !== undefined &&
  //     !Number.isNaN(
  //       Number(plant.latitude)
  //     ) &&
  //     !Number.isNaN(
  //       Number(plant.longitude)
  //     )
  //   );
  // }

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
          plant.category
            ?.toLowerCase()
            .includes(searchText) ||
          plant.plantId
            ?.toLowerCase()
            .includes(searchText);

        const matchesCategory =
          selectedCategory === "All" ||
          plant.category ===
            selectedCategory;

        return (
          matchesSearch &&
          matchesCategory
        );
      }
    );
  }, [
    documentedPlants,
    search,
    selectedCategory,
  ]);

  // =====================================================
  // GPS RECORDS
  // =====================================================

  // const plantsWithLocation =
  //   filteredPlants.filter(
  //     hasLocation
  //   );

  // const totalPlantsWithLocation =
  //   documentedPlants.filter(
  //     hasLocation
  //   ).length;

  // =====================================================
  // FORMAT COORDINATE
  // =====================================================

  // function formatCoordinate(value) {
  //   if (
  //     value === undefined ||
  //     value === null ||
  //     value === ""
  //   ) {
  //     return "Not available";
  //   }

  //   return Number(value).toFixed(6);
  // }

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
    setSelectedCategory("All");
  }

  // =====================================================
  // RENDER CARD
  // =====================================================

  function renderPlantCard({
    item,
  }) {
    const photos =
      item.images ||
      item.photos ||
      [];

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
          {item.scientificName}
        </Text>

        {/* COMMON NAME */}

        <Text
          style={styles.commonName}
          numberOfLines={1}
        >
          {item.name}
        </Text>

        {/* CATEGORY */}

        {item.category && (
          <View
            style={
              styles.categoryBadge
            }
          >
            <Text
              style={
                styles.categoryText
              }
            >
              {item.category}
            </Text>
          </View>
        )}

        {/* RECORD ID */}

        <Text
          style={styles.recordId}
          numberOfLines={1}
        >
          {item.plantId}
        </Text>

        {/* STATUS */}

        <View
          style={styles.statusRow}
        >
          <View
            style={[
              styles.statusBadge,
              item.status ===
                "approved"
                ? styles.statusApproved
                : styles.statusPending,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                item.status ===
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
                : "Unknown"}
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
        contentContainerStyle={
          styles.content
        }
      >
        {/* =====================================================
            HEADER
        ===================================================== */}

        <View style={styles.header}>
          <Text style={styles.title}>
            Plant Map
          </Text>

          <Text style={styles.subtitle}>
            Explore documented plant
            locations in Niah National
            Park
          </Text>
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
            placeholder="Search plants..."
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

        {/* =====================================================
            CATEGORY FILTER
        ===================================================== */}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={
            false
          }
          contentContainerStyle={
            styles.categoryList
          }
        >
          {categories.map(
            (category) => {
              const selected =
                selectedCategory ===
                category;

              return (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.filterButton,
                    selected &&
                      styles.filterButtonSelected,
                  ]}
                  onPress={() =>
                    setSelectedCategory(
                      category
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.filterText,
                      selected &&
                        styles.filterTextSelected,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              );
            }
          )}
        </ScrollView>

        
        {/* =====================================================
            SUMMARY
        ===================================================== */}

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
            >
              Total Records
            </Text>
          </View>

          <View
            style={
              styles.summaryDivider
            }
          />
          
          <View
            style={
              styles.summaryDivider
            }
          />

          <View style={styles.summaryItem}>
            <Text
              style={
                styles.summaryNumber
              }
            >
              {Math.max(
                categories.length - 1,
                0
              )}
            </Text>

            <Text
              style={styles.summaryLabel}
            >
              Categories
            </Text>
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
            >
              Documented Plants
            </Text>

            <Text
              style={
                styles.sectionSubtitle
              }
            >
              Tap a record to view its
              details
            </Text>
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
            >
              No records found
            </Text>

            <Text
              style={styles.emptyText}
            >
              Try searching for another
              plant or selecting a
              different category.
            </Text>

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
              >
                Clear Filters
              </Text>
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
    paddingTop: 10,
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
  // CATEGORY
  // =====================================================

  categoryList: {
    paddingBottom: 4,
  },

  filterButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    marginRight: 8,
  },

  filterButtonSelected: {
    backgroundColor: "#468585",
    borderColor: "#468585",
  },

  filterText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#687568",
  },

  filterTextSelected: {
    color: "#FFFFFF",
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

  summaryDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#E5ECE2",
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

  categoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#DEF9C4",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },

  categoryText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#468585",
  },

  recordId: {
    fontSize: 9,
    color: "#999",
    marginTop: 7,
    fontWeight: "600",
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