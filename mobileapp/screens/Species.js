// screens/Plant.js

import React, { useEffect, useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  SafeAreaView,
  Dimensions,
} from "react-native";

import { getSpeciesImageSource } from "../data/speciesImages";
import { fetchPlantRecords, fetchSpeciesCatalog } from "../utils/plantApi";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const GRID_HORIZONTAL_PADDING = SCREEN_WIDTH < 500 ? 12 : 13;
const GRID_GAP = SCREEN_WIDTH < 500 ? 8 : 10;
const SPECIES_CARD_WIDTH =
  (SCREEN_WIDTH - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;

const categories = [
  "All",
  "Trees",
  "Flowers",
  "Ferns",
  "Climbers",
];


export default function Plant({ navigation, user }) {
  const isBotanist = user?.role?.toLowerCase() === "botanist";

  const [plants, setPlants] = useState([]);
  const [plantCounts, setPlantCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadBackendData = async () => {
      try {
        setLoading(true);
        setErrorMessage("");
        const speciesCatalog = await fetchSpeciesCatalog();
        const records = await fetchPlantRecords(speciesCatalog);
        const counts = records.reduce((result, record) => {
          result[record.speciesId] = (result[record.speciesId] || 0) + 1;
          return result;
        }, {});

        if (isMounted) {
          setPlants(speciesCatalog);
          setPlantCounts(counts);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error.message || "Unable to load species."
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBackendData();

    return () => {
      isMounted = false;
    };
  }, []);

  const [activeCategory, setActiveCategory] = useState("All");

  const [searchQuery, setSearchQuery] = useState("");

  const [sortOption, setSortOption] = useState("default");

  const [sortOpen, setSortOpen] = useState(false);


  // =====================================================
  // FILTER AND SORT
  // =====================================================

  const filteredSpecies = useMemo(() => {
  const query = searchQuery.trim().toLowerCase();

  const filtered = plants.filter((item) => {
    const matchesCategory =
      activeCategory === "All" ||
      item.category === activeCategory;

    const matchesSearch =
      !query ||
      item.name?.toLowerCase().includes(query) ||
      item.scientificName?.toLowerCase().includes(query) ||
      item.genus?.toLowerCase().includes(query) ||
      item.category?.toLowerCase().includes(query) ||
      item.family?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query);

    return matchesCategory && matchesSearch;
  });

  const sorted = [...filtered];

  if (sortOption === "name-asc") {
    sorted.sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  if (sortOption === "name-desc") {
    sorted.sort((a, b) =>
      b.name.localeCompare(a.name)
    );
  }

  if (sortOption === "scientific-asc") {
    sorted.sort((a, b) =>
      a.scientificName.localeCompare(
        b.scientificName
      )
    );
  }

  return sorted;
}, [
  plants,
  activeCategory,
  searchQuery,
  sortOption,
]);

  // =====================================================
  // SPECIES CARD
  // =====================================================

  const renderSpeciesCard = ({ item }) => {
    const plantCount = plantCounts[item.id] || 0;
    const imageSource = getSpeciesImageSource(item);


    return (
      <View style={styles.card}>
        <View style={styles.imageWrapper}>
          {imageSource ? (
            <Image
              source={imageSource}
              style={styles.cardImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderIcon}>🌿</Text>
              <Text style={styles.placeholderText}>
                Image coming soon
              </Text>
            </View>
          )}

          <View style={styles.badgeContainer}>
            <Text style={styles.categoryBadge}>
              {item.category}
            </Text>

            {isBotanist && item.conservationStatus && (
              <Text style={styles.statusBadge}>
                {item.conservationStatus}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.name}</Text>

          <Text style={styles.scientificName}>
            {item.scientificName}
          </Text>

          {item.family && (
            <Text style={styles.family}>
              Family: {item.family}
            </Text>
          )}

          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>

          <Text style={styles.recordCount}>
            {plantCount} verified{" "}
            {plantCount === 1 ? "plant" : "plants"}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                navigation.navigate("SpeciesDetail", {
                  slug: item.slug,
                })
              }
            >
              <Text style={styles.secondaryText}>
                View Species
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() =>
                navigation.navigate("Species", {
                  slug: item.slug,
                  speciesId: item.id,
                  species: item,
                })
              }
            >
              <Text style={styles.primaryText}>
                View Plants →
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };


  // =====================================================
  // MAIN SCREEN
  // =====================================================
  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={filteredSpecies}
        keyExtractor={(item) => item.slug}
        renderItem={renderSpeciesCard}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* LIBRARY HEADER */}

            <View style={styles.libraryHeader}>
              <View>
                <Text style={styles.sectionLabel}>
                  EXPLORE THE COLLECTION
                </Text>

                <Text style={styles.sectionTitle}>
                  Discover Niah's flora
                </Text>
              </View>

              <Text style={styles.speciesCount}>
                {filteredSpecies.length} species found
              </Text>
            </View>

            {/* LOADING AND ERROR MESSAGES */}

            {loading && (
              <Text style={styles.messageText}>
                Loading species...
              </Text>
            )}

            {!loading && errorMessage !== "" && (
              <Text style={styles.errorText}>
                {errorMessage}
              </Text>
            )}

            {!loading &&
              !errorMessage &&
              plants.length === 0 && (
                <Text style={styles.messageText}>
                  No species found.
                </Text>
              )}

            {/* SEARCH AND SORT */}

            <View style={styles.filterControls}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search by name..."
                placeholderTextColor="#8A968F"
                style={styles.searchInput}
              />

              <TouchableOpacity
                style={styles.sortButton}
                onPress={() => setSortOpen(!sortOpen)}
              >
                <Text style={styles.sortButtonText}>
                  ☷ Sort
                </Text>
              </TouchableOpacity>
            </View>

            {sortOpen && (
              <View style={styles.sortMenu}>
                <SortOption
                  label="Default order"
                  selected={sortOption === "default"}
                  onPress={() => {
                    setSortOption("default");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Name: A-Z"
                  selected={sortOption === "name-asc"}
                  onPress={() => {
                    setSortOption("name-asc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Name: Z-A"
                  selected={sortOption === "name-desc"}
                  onPress={() => {
                    setSortOption("name-desc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Scientific name: A-Z"
                  selected={sortOption === "scientific-asc"}
                  onPress={() => {
                    setSortOption("scientific-asc");
                    setSortOpen(false);
                  }}
                />
              </View>
            )}

            {/* CATEGORY FILTER */}

            <FlatList
              horizontal
              data={categories}
              keyExtractor={(item) => item}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.categoryButton,
                    activeCategory === item &&
                      styles.categoryButtonActive,
                  ]}
                  onPress={() => setActiveCategory(item)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      activeCategory === item &&
                        styles.categoryTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </>
        }
        ListEmptyComponent={
          !loading && !errorMessage ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🌿</Text>

              <Text style={styles.emptyTitle}>
                No matching species
              </Text>

              <Text style={styles.emptyDescription}>
                Try another search term or select a
                different category.
              </Text>

              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setSearchQuery("");
                  setActiveCategory("All");
                }}
              >
                <Text style={styles.clearButtonText}>
                  Clear Filters
                </Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}


// =====================================================
// SORT OPTION
// =====================================================

// SORT OPTION

function SortOption({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      style={[
        styles.sortOption,
        selected && styles.sortOptionSelected,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.sortOptionText,
          selected && styles.sortOptionTextSelected,
        ]}
      >
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// STYLES

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },

  listContent: {
    paddingBottom: 0,
  },

  columnWrapper: {
    paddingHorizontal: GRID_HORIZONTAL_PADDING,
    gap: GRID_GAP,
  },

  libraryHeader: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 18 : 20,
    paddingTop: SCREEN_WIDTH < 500 ? 26 : 32,
    paddingBottom: SCREEN_WIDTH < 500 ? 14 : 18,
  },

  sectionLabel: {
    color: "#50A078",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 7,
  },

  sectionTitle: {
    color: "#254B42",
    fontSize: SCREEN_WIDTH < 500 ? 26 : 28,
    lineHeight: SCREEN_WIDTH < 500 ? 32 : 34,
    fontWeight: "600",
  },

  speciesCount: {
    marginTop: 6,
    color: "#6A7B73",
    fontSize: 11,
  },

  messageText: {
    marginHorizontal: 20,
    marginBottom: 12,
    color: "#315B49",
    fontSize: 13,
  },

  errorText: {
    marginHorizontal: 20,
    marginBottom: 12,
    color: "#B42318",
    fontSize: 13,
  },

  filterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: SCREEN_WIDTH < 500 ? 18 : 20,
    marginBottom: 10,
  },

  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: SCREEN_WIDTH < 500 ? 10 : 13,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    color: "#254B42",
    fontSize: 13,
  },

  sortButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
  },

  sortButtonText: {
    color: "#44564E",
    fontSize: 12,
    fontWeight: "600",
  },

  sortMenu: {
    marginHorizontal: SCREEN_WIDTH < 500 ? 18 : 20,
    marginBottom: 10,
    padding: 6,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    elevation: 4,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },

  sortOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },

  sortOptionSelected: {
    backgroundColor: "#DFE8DA",
  },

  sortOptionText: {
    color: "#44564E",
    fontSize: 12,
  },

  sortOptionTextSelected: {
    color: "#254B42",
    fontWeight: "700",
  },

  categoryList: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 18 : 20,
    paddingBottom: 14,
    gap: 6,
  },

  categoryButton: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 12 : 15,
    paddingVertical: SCREEN_WIDTH < 500 ? 7 : 9,
    borderRadius: 999,
    backgroundColor: "#EEECE3",
  },

  categoryButtonActive: {
    backgroundColor: "#35652F",
  },

  categoryText: {
    color: "#44564E",
    fontSize: SCREEN_WIDTH < 500 ? 10 : 11,
    fontWeight: "600",
  },

  categoryTextActive: {
    color: "#FFFFFF",
  },

  card: {
    width: SPECIES_CARD_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 0,
    marginBottom: SCREEN_WIDTH < 500 ? 11 : 15,
    overflow: "hidden",
    borderRadius: SCREEN_WIDTH < 500 ? 13 : 16,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  imageWrapper: {
    width: "100%",
    aspectRatio: 4 / 3,
    position: "relative",
  },

  cardImage: {
    width: "100%",
    height: "100%",
  },

  imagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCE8D6",
  },

  placeholderIcon: {
    fontSize: SCREEN_WIDTH < 500 ? 30 : 45,
    marginBottom: 8,
  },

  placeholderText: {
    color: "#577265",
    fontSize: SCREEN_WIDTH < 500 ? 8 : 10,
    fontWeight: "700",
    letterSpacing: 1,
  },

  badgeContainer: {
    position: "absolute",
    top: SCREEN_WIDTH < 500 ? 8 : 10,
    left: SCREEN_WIDTH < 500 ? 8 : 10,
    right: SCREEN_WIDTH < 500 ? 8 : 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  categoryBadge: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 7 : 9,
    paddingVertical: SCREEN_WIDTH < 500 ? 4 : 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#143625D9",
    color: "#FFFFFF",
    fontSize: SCREEN_WIDTH < 500 ? 8 : 9,
    fontWeight: "700",
  },

  statusBadge: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 6 : 8,
    paddingVertical: SCREEN_WIDTH < 500 ? 4 : 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#FFF6DC",
    color: "#6F532E",
    fontSize: SCREEN_WIDTH < 500 ? 7 : 8,
    fontWeight: "700",
  },

  cardContent: {
    flex: 1,
    padding: SCREEN_WIDTH < 500 ? 10 : 14,
  },

  cardTitle: {
    color: "#203F35",
    fontSize:
      SCREEN_WIDTH < 360 ? 15 : SCREEN_WIDTH < 500 ? 16 : 20,
    lineHeight:
      SCREEN_WIDTH < 360 ? 19 : SCREEN_WIDTH < 500 ? 20 : 24,
    fontWeight: "600",
  },

  scientificName: {
    marginTop: 3,
    color: "#7C6C5B",
    fontSize: SCREEN_WIDTH < 500 ? 10 : 12,
    lineHeight: SCREEN_WIDTH < 500 ? 14 : 16,
    fontStyle: "italic",
  },

  family: {
    marginTop: SCREEN_WIDTH < 500 ? 5 : 7,
    color: "#66786F",
    fontSize: SCREEN_WIDTH < 500 ? 8 : 9,
  },

  description: {
    marginTop: SCREEN_WIDTH < 500 ? 7 : 10,
    color: "#617068",
    fontSize: SCREEN_WIDTH < 500 ? 9 : 11,
    lineHeight: SCREEN_WIDTH < 500 ? 14 : 17,
  },

  recordCount: {
    marginTop: SCREEN_WIDTH < 500 ? 6 : 8,
    color: "#508A6A",
    fontSize: SCREEN_WIDTH < 500 ? 9 : 10,
    fontWeight: "700",
  },

  actions: {
    flexDirection: "row",
    gap: SCREEN_WIDTH < 500 ? 4 : 6,
    marginTop: "auto",
    paddingTop: SCREEN_WIDTH < 500 ? 10 : 13,
  },

  secondaryButton: {
    flex: 1,
    minHeight: SCREEN_WIDTH < 500 ? 36 : 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#B7C7BD",
    borderRadius: 999,
    backgroundColor: "#F7F6EF",
  },

  secondaryText: {
    color: "#315B49",
    fontSize: SCREEN_WIDTH < 360 ? 7.5 : SCREEN_WIDTH < 500 ? 8.5 : 9,
    fontWeight: "700",
  },

  primaryButton: {
    flex: 1,
    minHeight: SCREEN_WIDTH < 500 ? 36 : 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  primaryText: {
    color: "#FFFFFF",
    fontSize: SCREEN_WIDTH < 360 ? 7.5 : SCREEN_WIDTH < 500 ? 8.5 : 9,
    fontWeight: "700",
  },

  emptyState: {
    margin: SCREEN_WIDTH < 500 ? 18 : 20,
    padding: SCREEN_WIDTH < 500 ? 28 : 40,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BDC8BD",
    borderRadius: 16,
  },

  emptyIcon: {
    fontSize: SCREEN_WIDTH < 500 ? 30 : 34,
  },

  emptyTitle: {
    marginTop: 10,
    color: "#254B42",
    fontSize: SCREEN_WIDTH < 500 ? 18 : 20,
    fontWeight: "600",
  },

  emptyDescription: {
    marginTop: 6,
    color: "#63736A",
    fontSize: SCREEN_WIDTH < 500 ? 11 : 12,
    lineHeight: SCREEN_WIDTH < 500 ? 17 : 18,
    textAlign: "center",
  },

  clearButton: {
    minHeight: 42,
    marginTop: 15,
    paddingHorizontal: 17,
    paddingVertical: 9,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#35652F",
  },

  clearButtonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
