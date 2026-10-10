// screens/Plant.js

import React, { useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  SafeAreaView,
} from "react-native";

import {
  plants,
  plantRecords,
} from "../data/mockData";

const categories = [
  "All",
  "Trees",
  "Flowers",
  "Ferns",
  "Climbers",
];


export default function Plant({ navigation }) {
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
  activeCategory,
  searchQuery,
  sortOption,
]);

  // =====================================================
  // SPECIES CARD
  // =====================================================

  const renderSpeciesCard = ({ item }) => {
    const plantCount = plantRecords.filter(
      (plant) => plant.speciesSlug === item.slug
    ).length;


    return (
      <View style={styles.card}>

        {/* IMAGE */}

        <View style={styles.imageWrapper}>

          {item.image ? (
            <Image
              source={{ uri: item.image }}
              style={styles.cardImage}
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderIcon}>
                🌿
              </Text>

              <Text style={styles.placeholderText}>
                Image coming soon
              </Text>
            </View>
          )}


          {/* BADGES */}

          <View style={styles.badgeContainer}>

            <Text style={styles.categoryBadge}>
              {item.category}
            </Text>

            {item.conservationStatus && (
              <Text style={styles.statusBadge}>
                {item.conservationStatus}
              </Text>
            )}

          </View>

        </View>


        {/* CONTENT */}

        <View style={styles.cardContent}>

          <Text style={styles.cardTitle}>
            {item.name}
          </Text>


          <Text style={styles.scientificName}>
            {item.scientificName}
          </Text>


          {item.family && (
            <Text style={styles.family}>
              Family: {item.family}
            </Text>
          )}


          <Text
            style={styles.description}
            numberOfLines={3}
          >
            {item.description}
          </Text>


          <Text style={styles.recordCount}>
            {plantCount} verified{" "}
            {plantCount === 1 ? "plant" : "plants"}
          </Text>


          {/* ACTIONS */}

          <View style={styles.actions}>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                navigation.navigate(
                  "SpeciesDetail",
                  {
                    slug: item.slug,
                  }
                )
              }
            >
              <Text style={styles.secondaryText}>
                View Species
              </Text>
            </TouchableOpacity>


            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() =>
                navigation.navigate(
                  "Species",
                  {
                    slug: item.slug,
                  }
                )
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
           
            {/* LIBRARY */}

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


            {/* SEARCH */}

            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by name, scientific name or keyword..."
              placeholderTextColor="#8A968F"
              style={styles.searchInput}
            />


            {/* SORT */}

            <TouchableOpacity
              style={styles.sortButton}
              onPress={() =>
                setSortOpen(!sortOpen)
              }
            >
              <Text style={styles.sortButtonText}>
                ☷ Sort
              </Text>
            </TouchableOpacity>


            {sortOpen && (
              <View style={styles.sortMenu}>

                <SortOption
                  label="Default order"
                  selected={
                    sortOption === "default"
                  }
                  onPress={() => {
                    setSortOption("default");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Name: A-Z"
                  selected={
                    sortOption === "name-asc"
                  }
                  onPress={() => {
                    setSortOption("name-asc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Name: Z-A"
                  selected={
                    sortOption === "name-desc"
                  }
                  onPress={() => {
                    setSortOption("name-desc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label="Scientific name: A-Z"
                  selected={
                    sortOption ===
                    "scientific-asc"
                  }
                  onPress={() => {
                    setSortOption(
                      "scientific-asc"
                    );

                    setSortOpen(false);
                  }}
                />

              </View>
            )}


            {/* CATEGORY */}

            <FlatList
              horizontal
              data={categories}
              keyExtractor={(item) => item}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={
                styles.categoryList
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.categoryButton,
                    activeCategory === item &&
                      styles.categoryButtonActive,
                  ]}
                  onPress={() =>
                    setActiveCategory(item)
                  }
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
          <View style={styles.emptyState}>

            <Text style={styles.emptyIcon}>
              🌿
            </Text>

            <Text style={styles.emptyTitle}>
              No species found
            </Text>

            <Text style={styles.emptyDescription}>
              Try another search term or select
              a different category.
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
        }
      />

    </SafeAreaView>
  );
}


// =====================================================
// SORT OPTION
// =====================================================

function SortOption({
  label,
  selected,
  onPress,
}) {
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
          selected &&
            styles.sortOptionTextSelected,
        ]}
      >
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </TouchableOpacity>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },

  listContent: {
    paddingButtom: 0,
  },

  columnWrapper: {
    paddingHorizontal: 13,
    gap: 3,
  },

  hero: {
    paddingHorizontal: 22,
    paddingTop: 45,
    paddingBottom: 40,
    backgroundColor: "#214638",
  },

  eyebrow: {
    color: "#9CDBA6",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 10,
  },

  heroTitle: {
    color: "#FFFAF0",
    fontSize: 42,
    fontWeight: "600",
    marginBottom: 10,
  },

  heroLead: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 26,
    marginBottom: 8,
  },

  heroDescription: {
    color: "#DCE8DF",
    fontSize: 13,
    lineHeight: 21,
  },

  libraryHeader: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 18,
  },

  sectionLabel: {
    color: "#50A078",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
    marginBottom: 7,
  },

  sectionTitle: {
    color: "#254B42",
    fontSize: 28,
    fontWeight: "600",
  },

  speciesCount: {
    marginTop: 8,
    color: "#6A7B73",
    fontSize: 11,
  },

  searchInput: {
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    color: "#254B42",
    fontSize: 13,
  },

  sortButton: {
    alignSelf: "flex-end",
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
  },

  sortButtonText: {
    color: "#44564E",
    fontSize: 12,
    fontWeight: "600",
  },

  sortMenu: {
    marginHorizontal: 20,
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
    paddingVertical: 11,
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
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 7,
  },

  categoryButton: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#EEECE3",
  },

  categoryButtonActive: {
    backgroundColor: "#35652F",
  },

  categoryText: {
    color: "#44564E",
    fontSize: 11,
    fontWeight: "600",
  },

  categoryTextActive: {
    color: "#FFFFFF",
  },

  card: {
    flex: 1,
    height: 430,
    marginBottom: 15,
    marginHorizontal: 5,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#21392C",
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  imageWrapper: {
    height: 190,
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
    fontSize: 45,
    marginBottom: 8,
  },

  placeholderText: {
    color: "#577265",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },

  badgeContainer: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  categoryBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#143625D9",
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#FFF6DC",
    color: "#6F532E",
    fontSize: 8,
    fontWeight: "700",
  },

  cardContent: {
    flex: 1,
    padding: 14,
  },

  cardTitle: {
    color: "#203F35",
    fontSize: 20,
    fontWeight: "600",
  },

  scientificName: {
    marginTop: 3,
    color: "#7C6C5B",
    fontSize: 12,
    fontStyle: "italic",
  },

  family: {
    marginTop: 7,
    color: "#66786F",
    fontSize: 9,
  },

  description: {
    marginTop: 10,
    color: "#617068",
    fontSize: 11,
    lineHeight: 17,
  },

  recordCount: {
    marginTop: 8,
    color: "#508A6A",
    fontSize: 10,
    fontWeight: "700",
  },

  actions: {
    flexDirection: "row",
    gap: 4,
    marginTop: "auto",
    paddingTop: 13,
  },

  secondaryButton: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#B7C7BD",
    borderRadius: 999,
    backgroundColor: "#F7F6EF",
  },

  secondaryText: {
    color: "#315B49",
    fontSize: 9,
    fontWeight: "700",
  },

  primaryButton: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  primaryText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },

  emptyState: {
    margin: 20,
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BDC8BD",
    borderRadius: 16,
  },

  emptyIcon: {
    fontSize: 34,
  },

  emptyTitle: {
    marginTop: 10,
    color: "#254B42",
    fontSize: 20,
    fontWeight: "600",
  },

  emptyDescription: {
    marginTop: 6,
    color: "#63736A",
    fontSize: 12,
    textAlign: "center",
  },

  clearButton: {
    marginTop: 15,
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#35652F",
  },

  clearButtonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  quoteSection: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: "center",
    backgroundColor: "#214638",
  },

  quote: {
    color: "#FFFFFF",
    fontSize: 23,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 32,
  },

  quoteLabel: {
    marginTop: 15,
    color: "#D6E3CF",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 3,
  },

});