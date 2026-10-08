// screens/SpeciesDetail.js

import React from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from "react-native";

import {
  getSpeciesBySlug,
  getPlantsBySpecies,
} from "../data/mockData";

import PlantCard from "../components/PlantCard";

export default function SpeciesDetail({
  route,
  navigation,
}) {

  const { slug } = route.params || {};

  const selectedSpecies =
    getSpeciesBySlug(slug);

  if (!selectedSpecies) {
    return (
      <View style={styles.notFound}>

        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>
          Species not found
        </Text>

        <Text style={styles.notFoundText}>
          The species you are looking for is not
          in the collection.
        </Text>

        <TouchableOpacity
          style={styles.notFoundButton}
          onPress={() =>
            navigation.navigate("Plants")
          }
        >
          <Text style={styles.notFoundButtonText}>
            Return to Species
          </Text>
        </TouchableOpacity>

      </View>
    );
  }


  const speciesPlants =
    getPlantsBySpecies(
      selectedSpecies.slug
    );


  return (
    <ScrollView
      style={styles.page}
      showsVerticalScrollIndicator={false}
    >

      {/* HERO */}

      <View style={styles.hero}>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() =>
            navigation.goBack()
          }
        >
          <Text style={styles.backText}>
            ← Back to Species
          </Text>
        </TouchableOpacity>


        <View style={styles.heroImage}>

          {selectedSpecies.image ? (
            <Image
              source={{
                uri: selectedSpecies.image,
              }}
              style={styles.image}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>
                🌿
              </Text>

              <Text style={styles.placeholderText}>
                Plant image coming soon
              </Text>
            </View>
          )}

        </View>


        <View style={styles.heroContent}>

          <View style={styles.badges}>

            <Text style={styles.category}>
              {selectedSpecies.category}
            </Text>

            {selectedSpecies.conservationStatus && (
              <Text style={styles.conservation}>
                {selectedSpecies.conservationStatus}
              </Text>
            )}

          </View>


          <Text style={styles.title}>
            {selectedSpecies.name}
          </Text>

          <Text style={styles.scientificName}>
            {selectedSpecies.scientificName}
          </Text>

          <Text style={styles.summary}>
            {selectedSpecies.description}
          </Text>

        </View>

      </View>


      {/* ABOUT */}

      <View style={styles.section}>

        <Text style={styles.sectionLabel}>
          ABOUT THIS SPECIES
        </Text>

        <Text style={styles.sectionTitle}>
          About {selectedSpecies.name}
        </Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.overview}
        </Text>


        <Text style={styles.subTitle}>
          Natural habitat
        </Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.habitat}
        </Text>


        {selectedSpecies.distribution && (
          <>
            <Text style={styles.subTitle}>
              Distribution
            </Text>

            <Text style={styles.paragraph}>
              {selectedSpecies.distribution}
            </Text>
          </>
        )}


        <Text style={styles.subTitle}>
          Ecological importance
        </Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.ecologicalRole}
        </Text>


        {selectedSpecies.culturalSignificance && (
          <>
            <Text style={styles.subTitle}>
              Traditional and cultural importance
            </Text>

            <Text style={styles.paragraph}>
              {selectedSpecies.culturalSignificance}
            </Text>
          </>
        )}

      </View>


      {/* QUICK FACTS */}

      <View style={styles.quickFacts}>

        <Text style={styles.sectionLabel}>
          TAXONOMY & QUICK FACTS
        </Text>

        <Text style={styles.quickTitle}>
          Species reference
        </Text>


        <Text style={styles.characteristicTitle}>
          Key characteristics
        </Text>


        {selectedSpecies.characteristics.map(
          (characteristic) => (
            <View
              key={characteristic}
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


        <View style={styles.factDivider} />


        <Fact
          label="Common name"
          value={selectedSpecies.name}
        />

        <Fact
          label="Scientific name"
          value={selectedSpecies.scientificName}
        />

        <Fact
          label="Family"
          value={selectedSpecies.family}
        />

        <Fact
          label="Genus"
          value={selectedSpecies.genus}
        />

        <Fact
          label="Plant group"
          value={selectedSpecies.category}
        />

        <Fact
          label="Local name"
          value={selectedSpecies.localName}
        />

        <Fact
          label="Conservation status"
          value={selectedSpecies.conservationStatus}
        />

        <Fact
          label="Sensitivity level"
          value={selectedSpecies.sensitivityLevel}
        />

        {selectedSpecies.niahDistribution && (
          <Fact
            label="Distribution in Niah"
            value={`Zones ${selectedSpecies.niahDistribution.zones.join(
              ", "
            )}`}
          />
        )}

      </View>


      {/* INDIVIDUAL PLANTS */}

      <View style={styles.individualSection}>

        <Text style={styles.sectionLabel}>
          INDIVIDUAL PLANTS OF THIS SPECIES
        </Text>

        <Text style={styles.sectionTitle}>
          Verified plants in Niah
        </Text>

        <Text style={styles.sectionDescription}>
          {speciesPlants.length} tagged plant records
          are linked to this species in the prototype.
        </Text>


        {speciesPlants.length === 0 ? (
          <View style={styles.noRecords}>
            <Text>
              No verified individual plant records
              are linked yet.
            </Text>
          </View>
        ) : (
          <>
            {speciesPlants
              .slice(0, 3)
              .map((plant) => (
                <PlantCard
                  key={plant.plantId}
                  plant={plant}
                  navigation={navigation}
                />
              ))}


            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() =>
                navigation.navigate(
                  "Species",
                  {
                    slug: selectedSpecies.slug,
                  }
                )
              }
            >
              <Text style={styles.viewAllText}>
                View All Plants →
              </Text>
            </TouchableOpacity>
          </>
        )}

      </View>


      {/* GALLERY */}

      <View style={styles.gallerySection}>

        <Text style={styles.sectionLabel}>
          BOTANICAL PHOTOGRAPHS
        </Text>

        <Text style={styles.sectionTitle}>
          Identification from different views
        </Text>

        <Text style={styles.sectionDescription}>
          Photographs support species identification
          by showing important botanical features
          and growth form.
        </Text>


        <View style={styles.galleryGrid}>

          {selectedSpecies.images?.map(
            (image, index) => (
              <View
                key={`${image.caption}-${index}`}
                style={styles.galleryCard}
              >

                {image.path ? (
                  <Image
                    source={{ uri: image.path }}
                    style={styles.galleryImage}
                  />
                ) : (
                  <View
                    style={styles.galleryPlaceholder}
                  >
                    <Text style={styles.placeholderIcon}>
                      🌿
                    </Text>

                    <Text style={styles.placeholderText}>
                      Photograph coming soon
                    </Text>
                  </View>
                )}

                <Text style={styles.caption}>
                  {image.caption}
                </Text>

              </View>
            )
          )}

        </View>

      </View>


      {/* DISTRIBUTION */}

      {selectedSpecies.niahDistribution && (
        <View style={styles.distribution}>

          <Text style={styles.sectionLabel}>
            DISTRIBUTION IN NIAH NATIONAL PARK
          </Text>

          <Text style={styles.sectionTitle}>
            Known species occurrence
          </Text>

          <Text style={styles.paragraph}>
            This staff prototype summary represents
            approved species occurrence records at
            zone level. Authorized coordinates are
            available on each individual plant record.
          </Text>


          <View style={styles.statsRow}>

            <View style={styles.statCard}>
              <Text style={styles.statNumber}>
                {
                  selectedSpecies
                    .niahDistribution
                    .knownOccurrences
                }
              </Text>

              <Text style={styles.statLabel}>
                Known verified occurrences
              </Text>
            </View>


            <View style={styles.statCard}>
              <Text style={styles.statNumber}>
                {
                  selectedSpecies
                    .niahDistribution
                    .zones
                    .join(", ")
                }
              </Text>

              <Text style={styles.statLabel}>
                Monitoring zones
              </Text>
            </View>

          </View>


          <View style={styles.mapPlaceholder}>

            {["A", "B", "C"].map((zone, index) => {

            const recorded =
                selectedSpecies.niahDistribution.zones.includes(zone);

            return (
                <View
                key={zone}
                style={[
                    styles.zone,
                    index === 0 && styles.zoneA,
                    index === 1 && styles.zoneB,
                    index === 2 && styles.zoneC,
                    recorded && styles.zoneRecorded,
                ]}
                >
                <Text
                    style={[
                    styles.zoneText,
                    recorded && styles.zoneTextRecorded,
                    ]}
                >
                    Zone {zone}
                </Text>
                </View>
            );
            })}

            <Text style={styles.mapLabel}>
              Prototype zone-level distribution
            </Text>

          </View>

        </View>
      )}


      {/* FOOTER */}

      <View style={styles.exploreMore}>

        <Text style={styles.exploreText}>
          Continue discovering the remarkable flora
          of Niah.
        </Text>

        <TouchableOpacity
          onPress={() =>
            navigation.navigate("Plants")
          }
        >
          <Text style={styles.exploreLink}>
            Explore more species →
          </Text>
        </TouchableOpacity>

      </View>

    </ScrollView>
  );
}


// =====================================================
// FACT COMPONENT
// =====================================================

function Fact({ label, value }) {
  if (!value) return null;

  return (
    <View style={styles.fact}>

      <Text style={styles.factLabel}>
        {label}
      </Text>

      <Text style={styles.factValue}>
        {value}
      </Text>

    </View>
  );
}

// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  page: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },

  hero: {
    padding: 20,
    backgroundColor: "#E1EADB",
  },

  backButton: {
    alignSelf: "flex-start",
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#FFFFFFAA",
  },

  backText: {
    color: "#315B49",
    fontSize: 12,
    fontWeight: "700",
  },

  heroImage: {
    width: "100%",
    height: 280,
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#DCE8D6",
  },

  image: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  placeholderIcon: {
    fontSize: 48,
  },

  placeholderText: {
    marginTop: 10,
    color: "#577265",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  heroContent: {
    paddingTop: 25,
  },

  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 10,
  },

  category: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#D4E4CF",
    color: "#35652F",
    fontSize: 9,
    fontWeight: "700",
  },

  conservation: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFF0D9",
    color: "#8A651F",
    fontSize: 9,
    fontWeight: "700",
  },

  title: {
    color: "#234A3C",
    fontSize: 36,
    fontWeight: "600",
  },

  scientificName: {
    marginTop: 7,
    color: "#7C6955",
    fontSize: 17,
    fontStyle: "italic",
  },

  summary: {
    marginTop: 15,
    color: "#50675D",
    fontSize: 13,
    lineHeight: 21,
  },

  section: {
    padding: 24,
  },

  sectionLabel: {
    marginBottom: 8,
    color: "#50A078",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },

  sectionTitle: {
    color: "#234A3C",
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 18,
  },

  paragraph: {
    color: "#50675D",
    fontSize: 13,
    lineHeight: 22,
  },

  subTitle: {
    marginTop: 25,
    marginBottom: 8,
    color: "#315F4E",
    fontSize: 20,
    fontWeight: "600",
  },

  quickFacts: {
    margin: 20,
    padding: 20,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  quickTitle: {
    marginBottom: 18,
    color: "#234A3C",
    fontSize: 25,
    fontWeight: "600",
  },

  characteristicTitle: {
    marginBottom: 12,
    color: "#315F4E",
    fontSize: 14,
    fontWeight: "700",
  },

  characteristicRow: {
    flexDirection: "row",
    marginBottom: 10,
  },

  check: {
    width: 25,
    color: "#50A078",
    fontWeight: "800",
  },

  characteristicText: {
    flex: 1,
    color: "#405F56",
    fontSize: 12,
    lineHeight: 18,
  },

  factDivider: {
    height: 1,
    marginVertical: 20,
    backgroundColor: "#E7E8E1",
  },

  fact: {
    marginBottom: 15,
  },

  factLabel: {
    marginBottom: 3,
    color: "#7C8982",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },

  factValue: {
    color: "#315447",
    fontSize: 13,
    fontWeight: "600",
  },

  individualSection: {
    padding: 24,
    backgroundColor: "#E8EFE3",
  },

  sectionDescription: {
    marginBottom: 18,
    color: "#63776D",
    fontSize: 12,
    lineHeight: 19,
  },

  plantCard: {
    flexDirection: "row",
    marginBottom: 12,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },

  plantCardImage: {
    width: 100,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCE8D6",
  },

  plantIcon: {
    fontSize: 35,
  },

  plantCardContent: {
    flex: 1,
    padding: 13,
  },

  plantId: {
    color: "#234A3C",
    fontSize: 14,
    fontWeight: "700",
  },

  plantZone: {
    marginTop: 3,
    color: "#75867E",
    fontSize: 10,
  },

  plantHealth: {
    marginTop: 5,
    color: "#34785D",
    fontSize: 10,
    fontWeight: "700",
  },

  plantView: {
    marginTop: 7,
    color: "#315B49",
    fontSize: 10,
    fontWeight: "700",
  },

  viewAllButton: {
    alignSelf: "center",
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  viewAllText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  noRecords: {
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#AEBFAD",
    borderRadius: 15,
  },

  gallerySection: {
    padding: 24,
    backgroundColor: "#E8EFE3",
  },

  galleryGrid: {
    gap: 14,
  },

  galleryCard: {
    overflow: "hidden",
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },

  galleryImage: {
    width: "100%",
    height: 220,
    resizeMode: "cover",
  },

  galleryPlaceholder: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DCE8D6",
  },

  caption: {
    padding: 12,
    color: "#405F56",
    fontSize: 11,
    fontWeight: "700",
  },

  distribution: {
    padding: 24,
    backgroundColor: "#F8F6EE",
  },

  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginVertical: 18,
  },

  statCard: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },

  statNumber: {
    color: "#2F7056",
    fontSize: 23,
    fontWeight: "700",
  },

  statLabel: {
    marginTop: 4,
    color: "#75867E",
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  mapPlaceholder: {
    height: 280,
    position: "relative",
    borderRadius: 20,
    backgroundColor: "#DFE9DC",
  },

  zone: {
    position: "absolute",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#FFFFFFCC",
  },

  zoneA: {
    top: 40,
    left: 30,
    },

    zoneB: {
    top: 110,
    left: 130,
    },

    zoneC: {
    top: 180,
    right: 30,
    },

  zoneText: {
    color: "#7B8982",
    fontSize: 9,
    fontWeight: "800",
  },

  zoneRecorded: {
    backgroundColor: "#34785D",
  },

  zoneTextRecorded: {
    color: "#FFFFFF",
  },

  mapLabel: {
    position: "absolute",
    bottom: 12,
    right: 12,
    color: "#6F8078",
    fontSize: 8,
    fontWeight: "700",
  },

  exploreMore: {
    padding: 35,
    alignItems: "center",
    backgroundColor: "#214638",
  },

  exploreText: {
    marginBottom: 15,
    color: "#FFFFFF",
    fontSize: 18,
    textAlign: "center",
  },

  exploreLink: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#FFF4D8",
    color: "#315B49",
    fontSize: 12,
    fontWeight: "700",
  },

  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
    backgroundColor: "#F4F3E9",
  },

  notFoundIcon: {
    fontSize: 50,
  },

  notFoundTitle: {
    marginTop: 15,
    color: "#234A3C",
    fontSize: 25,
    fontWeight: "600",
  },

  notFoundText: {
    marginTop: 8,
    color: "#50675D",
    fontSize: 13,
    textAlign: "center",
  },

  notFoundButton: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  notFoundButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

});