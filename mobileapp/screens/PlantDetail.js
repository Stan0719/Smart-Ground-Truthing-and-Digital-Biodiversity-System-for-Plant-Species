import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

import { plants } from "../data/mockData";

export default function PlantDetailScreen({
  route,
  navigation,
}) {
  // Get the plant slug passed from Plant.js
  const { slug } = route.params || {};

  // Find the matching plant from mockData.js
  const plant = plants.find(
    (item) => item.slug === slug
  );

  // =====================================================
  // PLANT NOT FOUND
  // =====================================================

  if (!plant) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>
          Plant not found
        </Text>

        <Text style={styles.notFoundText}>
          The plant you are looking for is not in
          the collection.
        </Text>

        <TouchableOpacity
          style={styles.returnButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.returnButtonText}>
            Return to Plants
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // =====================================================
  // PLANT DETAIL PAGE
  // =====================================================

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* =================================================
          HERO SECTION
      ================================================= */}

      <View style={styles.heroSection}>

        {/* Plant Image Placeholder */}

        <View style={styles.plantPlaceholder}>
          <Text style={styles.placeholderIcon}>
            🌿
          </Text>

          <Text style={styles.placeholderText}>
            PLANT IMAGE COMING SOON
          </Text>
        </View>

        {/* Hero Content */}

        <View style={styles.heroContent}>

          {/* Back Button */}

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>
              ← Back to all plants
            </Text>
          </TouchableOpacity>

          {/* Category */}

          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>
              {plant.category}
            </Text>
          </View>

          {/* Plant Name */}

          <Text style={styles.plantName}>
            {plant.name}
          </Text>

          {/* Scientific Name */}

          <Text style={styles.scientificName}>
            {plant.scientificName}
          </Text>

          {/* Description */}

          <Text style={styles.summary}>
            {plant.description}
          </Text>
        </View>
      </View>

      {/* =================================================
          PLANT INFORMATION
      ================================================= */}

      <View style={styles.informationSection}>

        {/* ABOUT THIS PLANT */}

        <View style={styles.mainDescription}>

          <Text style={styles.sectionLabel}>
            ABOUT THIS PLANT
          </Text>

          <Text style={styles.sectionTitle}>
            A remarkable rainforest species
          </Text>

          <Text style={styles.bodyText}>
            {plant.overview}
          </Text>

          {/* Natural Habitat */}

          <Text style={styles.subHeading}>
            Natural habitat
          </Text>

          <Text style={styles.bodyText}>
            {plant.habitat}
          </Text>

          {/* Ecological Importance */}

          <Text style={styles.subHeading}>
            Ecological and cultural importance
          </Text>

          <Text style={styles.bodyText}>
            {plant.significance}
          </Text>

        </View>

        {/* =================================================
            QUICK FACTS
        ================================================= */}

        <View style={styles.quickFacts}>

          <Text style={styles.sectionLabel}>
            QUICK IDENTIFICATION
          </Text>

          <Text style={styles.quickFactsTitle}>
            Key characteristics
          </Text>

          {/* Characteristics */}

          {plant.characteristics.map(
            (characteristic, index) => (
              <View
                key={index}
                style={styles.characteristicRow}
              >
                <Text style={styles.check}>
                  ✓
                </Text>

                <Text style={styles.characteristicText}>
                  {characteristic}
                </Text>
              </View>
            )
          )}

          {/* Divider */}

          <View style={styles.divider} />

          {/* Scientific Name */}

          <View style={styles.factItem}>
            <Text style={styles.factLabel}>
              SCIENTIFIC NAME
            </Text>

            <Text style={styles.factValueItalic}>
              {plant.scientificName}
            </Text>
          </View>

          {/* Plant Group */}

          <View style={styles.factItem}>
            <Text style={styles.factLabel}>
              PLANT GROUP
            </Text>

            <Text style={styles.factValue}>
              {plant.category}
            </Text>
          </View>

          {/* Location */}

          <View style={styles.factItem}>
            <Text style={styles.factLabel}>
              LOCATION
            </Text>

            <Text style={styles.factValue}>
              Niah National Park, Sarawak
            </Text>
          </View>

        </View>
      </View>

      {/* =================================================
          EXPLORE MORE
      ================================================= */}

      <View style={styles.exploreMore}>

        <Text style={styles.exploreText}>
          Continue discovering the remarkable
          {"\n"}
          flora of Niah.
        </Text>

        <TouchableOpacity
          style={styles.exploreButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.exploreButtonText}>
            Explore more plants →
          </Text>
        </TouchableOpacity>

      </View>

      <View style={styles.bottomSpace} />

    </ScrollView>
  );
}


// =======================================================
// STYLES
// =======================================================

const styles = StyleSheet.create({

  // =====================================================
  // MAIN CONTAINER
  // =====================================================

  container: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },


  // =====================================================
  // HERO SECTION
  // =====================================================

  heroSection: {
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 55,
    backgroundColor: "#E1EADB",
  },


  // =====================================================
  // PLANT IMAGE PLACEHOLDER
  // =====================================================

  plantPlaceholder: {
    height: 320,
    borderRadius: 28,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "#D0DFCA",

    borderWidth: 1,
    borderColor: "rgba(63, 104, 77, 0.15)",

    shadowColor: "#254B3A",
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.12,
    shadowRadius: 20,

    elevation: 4,
  },


  placeholderIcon: {
    fontSize: 75,
    marginBottom: 15,
  },


  placeholderText: {
    color: "#4E7060",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },


  // =====================================================
  // HERO CONTENT
  // =====================================================

  heroContent: {
    marginTop: 30,
  },


  // =====================================================
  // BACK BUTTON
  // =====================================================

  backButton: {
    alignSelf: "flex-start",
    marginBottom: 25,
  },


  backButtonText: {
    color: "#477462",
    fontSize: 14,
    fontWeight: "600",
  },


  // =====================================================
  // CATEGORY
  // =====================================================

  categoryBadge: {
    alignSelf: "flex-start",

    paddingVertical: 7,
    paddingHorizontal: 13,

    borderRadius: 999,

    backgroundColor: "#D4E4CF",

    marginBottom: 14,
  },


  categoryText: {
    color: "#35652F",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },


  // =====================================================
  // PLANT NAME
  // =====================================================

  plantName: {
    color: "#234A3C",
    fontSize: 43,
    fontWeight: "600",
    lineHeight: 48,
  },


  // =====================================================
  // SCIENTIFIC NAME
  // =====================================================

  scientificName: {
    color: "#7C6955",
    fontSize: 21,
    fontStyle: "italic",

    marginTop: 12,
    marginBottom: 22,
  },


  // =====================================================
  // DESCRIPTION
  // =====================================================

  summary: {
    color: "#50675D",
    fontSize: 16,
    lineHeight: 27,
  },


  // =====================================================
  // INFORMATION SECTION
  // =====================================================

  informationSection: {
    paddingHorizontal: 20,
    paddingVertical: 55,
  },


  // =====================================================
  // MAIN DESCRIPTION
  // =====================================================

  mainDescription: {
    marginBottom: 45,
  },


  sectionLabel: {
    color: "#50A078",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.3,

    marginBottom: 10,
  },


  sectionTitle: {
    color: "#234A3C",
    fontSize: 31,
    fontWeight: "600",
    lineHeight: 39,

    marginBottom: 22,
  },


  bodyText: {
    color: "#405F56",
    fontSize: 15,
    lineHeight: 28,
  },


  // =====================================================
  // SUB HEADINGS
  // =====================================================

  subHeading: {
    color: "#315F4E",
    fontSize: 23,
    fontWeight: "600",

    marginTop: 35,
    marginBottom: 10,
  },


  // =====================================================
  // QUICK FACTS CARD
  // =====================================================

  quickFacts: {
    padding: 25,

    borderRadius: 22,

    backgroundColor: "#FFFFFF",

    borderWidth: 1,
    borderColor: "rgba(58, 96, 70, 0.12)",

    shadowColor: "#254B3A",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.08,
    shadowRadius: 20,

    elevation: 3,
  },


  quickFactsTitle: {
    color: "#234A3C",
    fontSize: 27,
    fontWeight: "600",

    marginBottom: 22,
  },


  // =====================================================
  // CHARACTERISTICS
  // =====================================================

  characteristicRow: {
    flexDirection: "row",
    alignItems: "flex-start",

    marginBottom: 13,
  },


  check: {
    width: 25,

    color: "#50A078",
    fontSize: 17,
    fontWeight: "800",
  },


  characteristicText: {
    flex: 1,

    color: "#405F56",
    fontSize: 14,
    lineHeight: 21,
  },


  // =====================================================
  // DIVIDER
  // =====================================================

  divider: {
    height: 1,

    backgroundColor: "#E7E8E1",

    marginVertical: 24,
  },


  // =====================================================
  // FACT ITEMS
  // =====================================================

  factItem: {
    marginBottom: 18,
  },


  factLabel: {
    color: "#7C8982",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,

    marginBottom: 5,
  },


  factValue: {
    color: "#315447",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },


  factValueItalic: {
    color: "#315447",
    fontSize: 14,
    fontWeight: "600",
    fontStyle: "italic",
  },


  // =====================================================
  // EXPLORE MORE SECTION
  // =====================================================

  exploreMore: {
    paddingHorizontal: 25,
    paddingVertical: 45,

    backgroundColor: "#214638",

    alignItems: "center",
  },


  exploreText: {
    color: "#FFFFFF",
    fontSize: 21,
    lineHeight: 29,

    textAlign: "center",

    marginBottom: 22,
  },


  exploreButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,

    borderRadius: 999,

    backgroundColor: "#FFF4D8",
  },


  exploreButtonText: {
    color: "#315B49",
    fontSize: 14,
    fontWeight: "700",
  },


  // =====================================================
  // BOTTOM SPACE
  // =====================================================

  bottomSpace: {
    height: 20,
  },


  // =====================================================
  // NOT FOUND
  // =====================================================

  notFound: {
    flex: 1,

    paddingHorizontal: 25,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "#F4F3E9",
  },


  notFoundIcon: {
    fontSize: 50,
  },


  notFoundTitle: {
    color: "#234A3C",
    fontSize: 30,
    fontWeight: "700",

    marginTop: 16,
  },


  notFoundText: {
    color: "#50675D",
    fontSize: 15,
    lineHeight: 23,

    textAlign: "center",

    marginTop: 8,
    marginBottom: 24,
  },


  returnButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,

    borderRadius: 999,

    backgroundColor: "#35652F",
  },


  returnButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

});