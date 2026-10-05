import React, { useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from "react-native";

import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";

import { plants } from "../data/mockData";

export default function MapScreen({ navigation }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  const categories = [
    "All",
    ...new Set(
      plants
        .map((plant) => plant.category)
        .filter(Boolean)
    ),
  ];

  function hasLocation(plant) {
    return (
      plant.latitude !== null &&
      plant.latitude !== undefined &&
      plant.longitude !== null &&
      plant.longitude !== undefined &&
      !Number.isNaN(Number(plant.latitude)) &&
      !Number.isNaN(Number(plant.longitude))
    );
  }

  const filteredPlants = useMemo(() => {
    return plants.filter((plant) => {
      const searchText = search.toLowerCase().trim();

      const matchesSearch =
        plant.name?.toLowerCase().includes(searchText) ||
        plant.scientificName
          ?.toLowerCase()
          .includes(searchText) ||
        plant.commonName
          ?.toLowerCase()
          .includes(searchText) ||
        plant.family
          ?.toLowerCase()
          .includes(searchText) ||
        plant.botanist
          ?.toLowerCase()
          .includes(searchText);

      const matchesCategory =
        selectedCategory === "All" ||
        plant.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [search, selectedCategory]);

  const plantsWithLocation =
    filteredPlants.filter(hasLocation);

  const totalPlantsWithLocation =
    plants.filter(hasLocation).length;

  function formatCoordinate(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "Not available";
    }

    return Number(value).toFixed(6);
  }

  function handlePlantPress(plant) {
    navigation?.navigate("PlantDetails", {
      plant,
      id: plant.id,
      slug: plant.slug,
    });
  }

  function clearFilters() {
    setSearch("");
    setSelectedCategory("All");
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>
            Plant Map
          </Text>

          <Text style={styles.subtitle}>
            Explore documented plant locations
            in Niah National Park
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
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
              onPress={() => setSearch("")}
              activeOpacity={0.7}
            >
              <Text style={styles.clearButton}>
                ×
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Category Filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={
            styles.categoryList
          }
        >
          {categories.map((category) => {
            const selected =
              selectedCategory === category;

            return (
              <TouchableOpacity
                key={category}
                style={[
                  styles.filterButton,
                  selected &&
                    styles.filterButtonSelected,
                ]}
                onPress={() =>
                  setSelectedCategory(category)
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
          })}
        </ScrollView>

        {/* REAL NIAH NATIONAL PARK MAP */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: 3.815,
              longitude: 113.813,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
            mapType="standard"
            showsCompass={true}
            showsScale={true}
            showsPointsOfInterest={true}
            zoomEnabled={true}
            scrollEnabled={true}
            rotateEnabled={true}
            pitchEnabled={true}
          >
            {plantsWithLocation.map((plant) => (
              <Marker
                key={plant.id}
                coordinate={{
                  latitude: Number(plant.latitude),
                  longitude: Number(plant.longitude),
                }}
                title={plant.scientificName || plant.name || "Plant"}
                description={plant.name || "Documented plant"}
                onCalloutPress={() => handlePlantPress(plant)}
              >
                <View style={styles.markerCircle}>
                  <Text style={styles.markerIcon}>🌿</Text>
                </View>
              </Marker>
            ))}
          </MapView>

          {/* Map Information Overlay */}
          <View style={styles.mapOverlay}>
            <Text style={styles.mapOverlayIcon}>
              📍
            </Text>

            <View
              style={styles.mapOverlayInfo}
            >
              <Text
                style={styles.mapOverlayTitle}
              >
                Niah National Park
              </Text>

              <Text
                style={styles.mapOverlayText}
              >
                {plantsWithLocation.length}{" "}
                documented{" "}
                {plantsWithLocation.length === 1
                  ? "plant"
                  : "plants"}{" "}
                with GPS
              </Text>
            </View>
          </View>

          {/* No GPS */}
          {plantsWithLocation.length === 0 && (
            <View
              style={
                styles.noGpsMapContainer
              }
            >
              <Text
                style={styles.noGpsMapIcon}
              >
                📍
              </Text>

              <Text
                style={styles.noGpsMapTitle}
              >
                No GPS locations
              </Text>

              <Text
                style={styles.noGpsMapText}
              >
                Plant locations will appear
                here after GPS coordinates
                are recorded.
              </Text>
            </View>
          )}
        </View>

        {/* Map Hint */}
        <View style={styles.mapHint}>
          <Text style={styles.mapHintIcon}>
            👆
          </Text>

          <Text style={styles.mapHintText}>
            Pinch to zoom and drag the map to
            explore Niah National Park
          </Text>
        </View>

        {/* Summary */}
        <View style={styles.summaryContainer}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>
              {plants.length}
            </Text>

            <Text style={styles.summaryLabel}>
              Total Plants
            </Text>
          </View>

          <View
            style={styles.summaryDivider}
          />

          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>
              {totalPlantsWithLocation}
            </Text>

            <Text style={styles.summaryLabel}>
              GPS Recorded
            </Text>
          </View>

          <View
            style={styles.summaryDivider}
          />

          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>
              {Math.max(
                categories.length - 1,
                0
              )}
            </Text>

            <Text style={styles.summaryLabel}>
              Categories
            </Text>
          </View>
        </View>

        {/* Plant List */}
        <View style={styles.sectionHeader}>
          <View
            style={styles.sectionHeaderText}
          >
            <Text
              style={styles.sectionTitle}
            >
              Documented Plants
            </Text>

            <Text
              style={styles.sectionSubtitle}
            >
              Tap a plant to view its details
            </Text>
          </View>

          <View
            style={styles.resultCountContainer}
          >
            <Text style={styles.resultCount}>
              {filteredPlants.length}
            </Text>
          </View>
        </View>

        {filteredPlants.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>
              🌱
            </Text>

            <Text style={styles.emptyTitle}>
              No plants found
            </Text>

            <Text style={styles.emptyText}>
              Try searching for another plant
              or selecting a different
              category.
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
          filteredPlants.map(
            (plant, index) => {
              const locationAvailable =
                hasLocation(plant);

              const photos =
                plant.photos ||
                (plant.photo
                  ? [plant.photo]
                  : []);

              return (
                <TouchableOpacity
                  key={
                    plant.id ||
                    plant.slug ||
                    index
                  }
                  style={styles.locationCard}
                  onPress={() =>
                    handlePlantPress(plant)
                  }
                  activeOpacity={0.85}
                >
                  {/* Card Top */}
                  <View style={styles.cardTop}>
                    <View
                      style={
                        styles.plantIconContainer
                      }
                    >
                      <Text
                        style={
                          styles.plantIcon
                        }
                      >
                        🌿
                      </Text>
                    </View>

                    <View
                      style={styles.plantInfo}
                    >
                      <Text
                        style={
                          styles.plantName
                        }
                        numberOfLines={1}
                      >
                        {plant.scientificName ||
                          plant.name}
                      </Text>

                      <Text
                        style={
                          styles.commonName
                        }
                        numberOfLines={1}
                      >
                        {plant.name}
                      </Text>
                    </View>

                    {plant.category && (
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
                          {plant.category}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Botanist */}
                  <View style={styles.infoRow}>
                    <Text
                      style={styles.infoIcon}
                    >
                      👤
                    </Text>

                    <Text
                      style={styles.infoText}
                    >
                      Documented by{" "}
                      <Text
                        style={
                          styles.infoTextBold
                        }
                      >
                        {plant.botanist ||
                          "Unknown"}
                      </Text>
                    </Text>
                  </View>

                  {/* Status */}
                  <View
                    style={styles.statusRow}
                  >
                    <View
                      style={[
                        styles.statusBadge,
                        plant.status ===
                          "approved"
                          ? styles.statusApproved
                          : styles.statusPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          plant.status ===
                            "approved"
                            ? styles.statusApprovedText
                            : styles.statusPendingText,
                        ]}
                      >
                        {plant.status
                          ? plant.status
                              .charAt(0)
                              .toUpperCase() +
                            plant.status.slice(
                              1
                            )
                          : "Unknown"}
                      </Text>
                    </View>

                    {plant.syncStatus && (
                      <Text
                        style={
                          styles.syncStatus
                        }
                      >
                        {plant.syncStatus}
                      </Text>
                    )}

                    {photos.length > 0 && (
                      <Text
                        style={
                          styles.photoCount
                        }
                      >
                        📷 {photos.length}
                      </Text>
                    )}
                  </View>

                  {/* Location */}
                  <View
                    style={
                      styles.locationContainer
                    }
                  >
                    <View
                      style={
                        styles.locationIconContainer
                      }
                    >
                      <Text
                        style={
                          styles.locationIcon
                        }
                      >
                        📍
                      </Text>
                    </View>

                    <View
                      style={styles.coordinates}
                    >
                      <Text
                        style={
                          styles.locationTitle
                        }
                      >
                        GPS Location
                      </Text>

                      {locationAvailable ? (
                        <Text
                          style={
                            styles.locationValue
                          }
                        >
                          {formatCoordinate(
                            plant.latitude
                          )}
                          {"  •  "}
                          {formatCoordinate(
                            plant.longitude
                          )}
                        </Text>
                      ) : (
                        <Text
                          style={
                            styles.noLocation
                          }
                        >
                          GPS location not
                          available
                        </Text>
                      )}
                    </View>

                    <Text
                      style={styles.arrow}
                    >
                      ›
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }
          )
        )}
      </ScrollView>
    </View>
  );
}

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
  },

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

  mapOverlay: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    backgroundColor:
      "rgba(255,255,255,0.95)",
    borderRadius: 12,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
  },

  mapOverlayIcon: {
    fontSize: 22,
    marginRight: 9,
  },

  mapOverlayInfo: {
    flex: 1,
  },

  mapOverlayTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#356859",
  },

  mapOverlayText: {
    fontSize: 11,
    color: "#777",
    marginTop: 2,
  },

  noGpsMapContainer: {
    position: "absolute",
    left: 35,
    right: 35,
    top: 95,
    alignItems: "center",
    backgroundColor:
      "rgba(255,255,255,0.92)",
    borderRadius: 15,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },

  noGpsMapIcon: {
    fontSize: 28,
    marginBottom: 5,
  },

  noGpsMapTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#468585",
  },

  noGpsMapText: {
    fontSize: 11,
    color: "#777",
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
  },

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

  locationCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 15,
    marginBottom: 10,
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

  cardTop: {
    flexDirection: "row",
    alignItems: "center",
  },

  plantIconContainer: {
    width: 43,
    height: 43,
    borderRadius: 12,
    backgroundColor: "#EAF6E4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },

  plantIcon: {
    fontSize: 21,
  },

  plantInfo: {
    flex: 1,
    paddingRight: 8,
  },

  plantName: {
    fontSize: 15,
    fontWeight: "700",
    fontStyle: "italic",
    color: "#356859",
  },

  commonName: {
    fontSize: 13,
    color: "#777",
    marginTop: 3,
  },

  categoryBadge: {
    backgroundColor: "#DEF9C4",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },

  categoryText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#468585",
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },

  infoIcon: {
    fontSize: 13,
    marginRight: 6,
  },

  infoText: {
    fontSize: 11,
    color: "#888",
  },

  infoTextBold: {
    fontWeight: "600",
    color: "#468585",
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 9,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },

  statusApproved: {
    backgroundColor: "#E3F4E0",
  },

  statusPending: {
    backgroundColor: "#FFF1D6",
  },

  statusText: {
    fontSize: 9,
    fontWeight: "700",
  },

  statusApprovedText: {
    color: "#43804A",
  },

  statusPendingText: {
    color: "#A66A13",
  },

  syncStatus: {
    fontSize: 10,
    color: "#777",
    marginLeft: 8,
  },

  photoCount: {
    fontSize: 10,
    color: "#777",
    marginLeft: "auto",
  },

  locationContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#EEF2EC",
  },

  locationIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#F0F7ED",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },

  locationIcon: {
    fontSize: 16,
  },

  coordinates: {
    flex: 1,
  },

  locationTitle: {
    fontSize: 11,
    color: "#888",
    marginBottom: 3,
  },

  locationValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#468585",
  },

  noLocation: {
    fontSize: 12,
    color: "#999",
  },

  arrow: {
    fontSize: 27,
    color: "#AAB5A7",
    marginLeft: 5,
  },

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