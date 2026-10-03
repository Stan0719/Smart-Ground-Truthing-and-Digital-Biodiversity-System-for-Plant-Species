import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ImageBackground,
} from "react-native";

import { plants } from "../data/mockData";

const categories = ["All", "Trees", "Flowers", "Ferns", "Climbers"];

export default function PlantScreen({ navigation }) {
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPlants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return plants.filter((plant) => {
      const matchesCategory =
        activeCategory === "All" ||
        plant.category === activeCategory;

      const matchesSearch =
        !query ||
        plant.name.toLowerCase().includes(query) ||
        plant.scientificName.toLowerCase().includes(query) ||
        plant.category.toLowerCase().includes(query) ||
        plant.description.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* ================= HERO ================= */}
      <ImageBackground
        source={require("../assets/park.jpg")}
        style={styles.hero}
        imageStyle={styles.heroImage}
      >
        <View style={styles.heroOverlay} />

        <View style={styles.heroContent}>
          <Text style={styles.eyebrow}>
            NIAH NATIONAL PARK
          </Text>

          <Text style={styles.heroTitle}>
            Plants of Niah
          </Text>

          <Text style={styles.heroLead}>
            Explore the rich flora of Niah National Park.
          </Text>

          <Text style={styles.heroDescription}>
            From towering rainforest trees to delicate orchids,
            discover the remarkable plant life that makes Niah
            a place of extraordinary beauty and ecological
            significance.
          </Text>
        </View>
      </ImageBackground>

      {/* ================= PLANT LIBRARY ================= */}
      <View style={styles.library}>
        <Text style={styles.sectionLabel}>
          EXPLORE THE COLLECTION
        </Text>

        <View style={styles.headingRow}>
          <Text style={styles.libraryTitle}>
            Discover Niah's flora
          </Text>

          <Text style={styles.plantCount}>
            {filteredPlants.length}{" "}
            {filteredPlants.length === 1 ? "plant" : "plants"} found
          </Text>
        </View>

        {/* ================= SEARCH ================= */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>

          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search plants..."
            placeholderTextColor="#8A968F"
            style={styles.searchInput}
          />
        </View>

        {/* ================= CATEGORY FILTER ================= */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryContainer}
        >
          {categories.map((category) => (
            <TouchableOpacity
              key={category}
              style={[
                styles.categoryButton,
                activeCategory === category &&
                  styles.categoryButtonActive,
              ]}
              onPress={() => setActiveCategory(category)}
            >
              <Text
                style={[
                  styles.categoryButtonText,
                  activeCategory === category &&
                    styles.categoryButtonTextActive,
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ================= PLANT CARDS ================= */}
        {filteredPlants.length > 0 ? (
          filteredPlants.map((plant) => (
            <View
              key={plant.slug}
              style={styles.plantCard}
            >
              {/* Plant image placeholder */}
              <View style={styles.plantImage}>
                <Text style={styles.leafIcon}>🌿</Text>

                <Text style={styles.imageComingSoon}>
                  IMAGE COMING SOON
                </Text>

                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {plant.category}
                  </Text>
                </View>
              </View>

              {/* Card content */}
              <View style={styles.cardContent}>
                <Text style={styles.plantName}>
                  {plant.name}
                </Text>

                <Text style={styles.scientificName}>
                  {plant.scientificName}
                </Text>

                <Text style={styles.description}>
                  {plant.description}
                </Text>

                <TouchableOpacity
                  style={styles.learnMoreButton}
                  onPress={() =>
                    navigation.navigate(
                      "PlantDetails",
                      {
                        slug: plant.slug,
                      }
                    )
                  }
                >
                  <View style={styles.arrowCircle}>
                    <Text style={styles.arrow}>
                      →
                    </Text>
                  </View>

                  <Text style={styles.learnMoreText}>
                    LEARN MORE
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        ) : (
          /* ================= EMPTY STATE ================= */
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>
              🌿
            </Text>

            <Text style={styles.emptyTitle}>
              No plants found
            </Text>

            <Text style={styles.emptyText}>
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
                Clear filters
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ================= QUOTE ================= */}
      <View style={styles.quoteSection}>
        <Text style={styles.quote}>
          "Extraordinary plants.{"\n"}
          A timeless rainforest."
        </Text>

        <Text style={styles.quoteLabel}>
          NIAH NATIONAL PARK
        </Text>
      </View>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },

  /* ================= HERO ================= */

  hero: {
    height: 450,
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  heroImage: {
    resizeMode: "cover",
  },

  heroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,

    backgroundColor: 'rgba(30, 45, 40, 0.58)',
  },

  heroContent: {
    paddingHorizontal: 25,
    paddingBottom: 48,
  },

  eyebrow: {
    color: "#9CDBA6",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginBottom: 12,
  },

  heroTitle: {
    color: "#FFFAF0",
    fontSize: 52,
    fontWeight: "600",
    lineHeight: 56,
  },

  heroLead: {
    color: "#FFFFFF",
    fontSize: 21,
    lineHeight: 29,
    marginTop: 14,
    marginBottom: 8,
  },

  heroDescription: {
    maxWidth: 650,
    color: "#E9EEE4",
    fontSize: 14,
    lineHeight: 23,
  },

  /* ================= LIBRARY ================= */

  library: {
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 65,
  },

  sectionLabel: {
    color: "#50A078",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.2,
    marginBottom: 8,
  },

  headingRow: {
    marginBottom: 24,
  },

  libraryTitle: {
    color: "#254B42",
    fontSize: 34,
    fontWeight: "600",
    lineHeight: 40,
  },

  plantCount: {
    color: "#6A7B73",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
  },

  /* ================= SEARCH ================= */

  searchBox: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 15,

    shadowColor: "#233F31",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,

    elevation: 2,
  },

  searchIcon: {
    color: "#254B42",
    fontSize: 27,
    marginRight: 8,
  },

  searchInput: {
    flex: 1,
    color: "#254B42",
    fontSize: 14,
  },

  /* ================= CATEGORIES ================= */

  categoryScroll: {
    marginBottom: 25,
  },

  categoryContainer: {
    paddingRight: 10,
  },

  categoryButton: {
    paddingVertical: 11,
    paddingHorizontal: 17,
    borderRadius: 999,
    backgroundColor: "#EEECE3",
    marginRight: 8,
  },

  categoryButtonActive: {
    backgroundColor: "#35652F",
  },

  categoryButtonText: {
    color: "#44564E",
    fontSize: 13,
    fontWeight: "600",
  },

  categoryButtonTextActive: {
    color: "#FFFFFF",
  },

  /* ================= PLANT CARD ================= */

  plantCard: {
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    marginBottom: 24,

    borderWidth: 1,
    borderColor: "rgba(49, 91, 70, 0.1)",

    shadowColor: "#21392C",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.08,
    shadowRadius: 15,

    elevation: 3,
  },

  plantImage: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCE8D6",
    position: "relative",
  },

  leafIcon: {
    fontSize: 55,
    marginBottom: 10,
  },

  imageComingSoon: {
    color: "#577265",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },

  badge: {
    position: "absolute",
    top: 14,
    right: 14,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: "rgba(20, 54, 37, 0.84)",
  },

  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  cardContent: {
    padding: 22,
  },

  plantName: {
    color: "#203F35",
    fontSize: 23,
    fontWeight: "700",
  },

  scientificName: {
    color: "#7C6C5B",
    fontSize: 15,
    fontStyle: "italic",
    marginTop: 5,
    marginBottom: 14,
  },

  description: {
    color: "#617068",
    fontSize: 13,
    lineHeight: 21,
    marginBottom: 20,
  },

  /* ================= LEARN MORE ================= */

  learnMoreButton: {
    height: 44,
    width: 170,
    borderRadius: 999,
    backgroundColor: "#F3F0E7",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
  },

  arrowCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#8A5727",
    alignItems: "center",
    justifyContent: "center",
  },

  arrow: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "600",
  },

  learnMoreText: {
    flex: 1,
    color: "#805020",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.5,
    marginRight: 10,
  },

  /* ================= EMPTY ================= */

  emptyState: {
    paddingVertical: 65,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BDC8BD",
    borderRadius: 18,
  },

  emptyIcon: {
    fontSize: 42,
  },

  emptyTitle: {
    color: "#254B42",
    fontSize: 25,
    fontWeight: "700",
    marginTop: 12,
  },

  emptyText: {
    color: "#63736A",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 7,
    marginBottom: 20,
  },

  clearButton: {
    backgroundColor: "#35652F",
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 999,
  },

  clearButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },

  /* ================= QUOTE ================= */

  quoteSection: {
    minHeight: 210,
    paddingHorizontal: 25,
    paddingVertical: 45,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#214638",
  },

  quote: {
    color: "#FFFFFF",
    fontSize: 27,
    lineHeight: 37,
    fontStyle: "italic",
    textAlign: "center",
  },

  quoteLabel: {
    color: "#D6E3CF",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 4,
    marginTop: 18,
  },

  bottomSpace: {
    height: 20,
  },
});