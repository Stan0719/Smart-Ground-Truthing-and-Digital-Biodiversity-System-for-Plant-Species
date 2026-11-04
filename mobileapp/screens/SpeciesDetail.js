import { t, translateLabel, translateUIMessage, useAppTranslation, translateFieldValue } from "../translations/i18n";
// screens/SpeciesDetail.js

import React, { useCallback, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
} from "react-native";

import {
  getSpeciesBySlug,
} from "../data/mockData";
import { useFocusEffect } from "@react-navigation/native";
import { getSpeciesImageSource } from "../data/speciesImages";
import { fetchPlantRecords, fetchSpeciesDetail } from "../utils/plantApi";

import PlantCard from "../components/PlantCard";
import RefreshButton from "../components/RefreshButton";
import FavouriteHeart from "../components/FavouriteHeart";
import useVisitorFavourites from "../hooks/useVisitorFavourites";

export default function SpeciesDetail({
  route,
  navigation,
  user,
}) {
  useAppTranslation();

  const { slug, speciesId } = route.params || {};
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const isVisitor = user?.role?.toLowerCase() === "visitor";
  const favourites = useVisitorFavourites(user);

  const [selectedSpecies, setSelectedSpecies] = useState(
    route.params?.species || getSpeciesBySlug(slug) || null
  );
  const [speciesPlants, setSpeciesPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(null);

  const loadSpeciesDetails = useCallback((isRefresh = false) => {
    if (requestRef.current) return requestRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");
    const request = (async () => {
      try {
        const [backendSpecies, records] = await Promise.all([
          fetchSpeciesDetail(speciesId, slug, { accountId: user?.id }),
          fetchPlantRecords([], { accountId: user?.id }),
        ]);
        const resolvedSpecies = backendSpecies || route.params?.species || getSpeciesBySlug(slug) || null;
        const resolvedId = resolvedSpecies?.id ?? speciesId;
        const recordsForSpecies = resolvedId != null
          ? records.filter((record) => String(record.speciesId) === String(resolvedId))
          : records.filter((record) => record.speciesSlug === slug);

        setSelectedSpecies(resolvedSpecies);
        setSpeciesPlants(recordsForSpecies);
      } catch (error) {
        setErrorMessage(error.message || "Unable to load species details.");
      } finally {
        if (requestRef.current === request) requestRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    })();
    requestRef.current = request;
    return request;
  }, [slug, speciesId, route.params?.species, user?.id]);

  useFocusEffect(useCallback(() => {
    void loadSpeciesDetails(false);
  }, [loadSpeciesDetails]));

  const primaryImageSource = getSpeciesImageSource(selectedSpecies);

  if (!selectedSpecies) {
    return (
      <View style={styles.notFound}>

        <Text style={styles.notFoundIcon}>
          🌿
        </Text>

        <Text style={styles.notFoundTitle}>
          {loading ? t("plant.loadingSpecies") : t("plant.speciesNotFound")}
        </Text>

        <Text style={styles.notFoundText}>
          {errorMessage || t("speciesDetail.theSpeciesYouAreLookingForIsNotInThe")}
        </Text>

        <TouchableOpacity
          style={styles.notFoundButton}
          onPress={() =>
            navigation.navigate("Plants")
          }
        >
          <Text style={styles.notFoundButtonText}>{t("plant.returnToSpecies")}</Text>
        </TouchableOpacity>

      </View>
    );
  }


  return (
    <ScrollView
      style={styles.page}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing || favourites.refreshing}
          onRefresh={() => { void loadSpeciesDetails(true); void favourites.refresh(true); }}
          tintColor="#468585"
          colors={["#468585"]}
        />
      }
    >

      {/* HERO */}

      <View style={styles.hero}>

        <View style={styles.heroToolbar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() =>
            navigation.goBack()
          }
        >
          <Text style={styles.backText}>{t("plant.back")}</Text>
        </TouchableOpacity>
        <RefreshButton
          onPress={() => { void loadSpeciesDetails(true); void favourites.refresh(true); }}
          loading={loading || refreshing || favourites.refreshing}
          label={t("common.refresh")}
          testID="species-detail-refresh"
        />
        {isVisitor && <FavouriteHeart
          active={favourites.isFavourite("species", selectedSpecies.id ?? speciesId)}
          pending={favourites.isPending("species", selectedSpecies.id ?? speciesId)}
          disabled={favourites.loading}
          onPress={() => void favourites.toggle("species", selectedSpecies.id ?? speciesId)}
        />}
        </View>
        {!!favourites.mutationError && <Text accessibilityRole="alert" style={styles.refreshError}>{translateUIMessage(favourites.mutationError)}</Text>}


        <View style={styles.heroImage}>

          {primaryImageSource ? (
            <Image
              source={primaryImageSource}
              style={styles.image}
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>
                🌿
              </Text>

              <Text style={styles.placeholderText}>{t("speciesDetail.plantImageComingSoon")}</Text>
            </View>
          )}

        </View>


        <View style={styles.heroContent}>

          <View style={styles.badges}>

            <Text style={styles.category}>
              {translateLabel(selectedSpecies.category)}
            </Text>

            {isBotanist && selectedSpecies.conservationStatus && (
              <Text style={styles.conservation}>
                {translateLabel(selectedSpecies.conservationStatus)}
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
          {selectedSpecies.description || t("speciesDetail.noDescriptionHasBeenRecorded")}
          </Text>

        </View>

      </View>


      {/* ABOUT */}

      <View style={styles.section}>

        <Text style={styles.sectionLabel}>{t("speciesDetail.aboutThisSpecies")}</Text>

        <Text style={styles.sectionTitle}>{t("speciesDetail.about")}{selectedSpecies.name}
        </Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.overview || selectedSpecies.description || t("speciesDetail.noOverviewHasBeenRecorded")}
        </Text>


        <Text style={styles.subTitle}>{t("speciesDetail.naturalHabitat")}</Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.habitat || t("speciesDetail.habitatInformationHasNotBeenRecorded")}
        </Text>


        {selectedSpecies.distribution && (
          <>
            <Text style={styles.subTitle}>{t("speciesDetail.distribution")}</Text>

            <Text style={styles.paragraph}>
              {selectedSpecies.distribution}
            </Text>
          </>
        )}


        <Text style={styles.subTitle}>{t("speciesDetail.ecologicalImportance")}</Text>

        <Text style={styles.paragraph}>
          {selectedSpecies.ecologicalRole || t("speciesDetail.ecologicalInformationHasNotBeenRecorded")}
        </Text>


        {selectedSpecies.culturalSignificance && (
          <>
            <Text style={styles.subTitle}>{t("speciesDetail.traditionalAndCulturalImportance")}</Text>

            <Text style={styles.paragraph}>
              {selectedSpecies.culturalSignificance}
            </Text>
          </>
        )}

      </View>


      {/* QUICK FACTS */}

      <View style={styles.quickFacts}>

        <Text style={styles.sectionLabel}>{t("speciesDetail.taxonomyQuickFacts")}</Text>

        <Text style={styles.quickTitle}>{t("fieldCollection.speciesReference")}</Text>


        <Text style={styles.characteristicTitle}>{t("speciesDetail.keyCharacteristics")}</Text>


        {(selectedSpecies.characteristics || []).map(
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

        {(!selectedSpecies.characteristics || selectedSpecies.characteristics.length === 0) && (
          <Text style={styles.characteristicText}>{t("speciesDetail.noCharacteristicsHaveBeenRecorded")}</Text>
        )}


        <View style={styles.factDivider} />


        <Fact
          label={t("speciesDetail.commonName")}
          value={selectedSpecies.name}
        />

        <Fact
          label={t("plantDetail.scientificName")}
          value={selectedSpecies.scientificName}
        />

        <Fact
          label={t("speciesDetail.family")}
          value={selectedSpecies.family}
        />

        <Fact
          label={t("plant.genus")}
          value={selectedSpecies.genus}
        />

        <Fact
          label={t("speciesDetail.plantGroup")}
          value={selectedSpecies.category}
        />

        <Fact
          label={t("speciesDetail.localName")}
          value={selectedSpecies.localName}
        />

        {isBotanist && (
          <>
            <Fact
              label={t("speciesDetail.conservationStatus")}
              value={selectedSpecies.conservationStatus}
            />

            <Fact
              label={t("speciesDetail.sensitivityLevel")}
              value={selectedSpecies.sensitivityLevel}
            />
          </>
        )}

      </View>


      {/* INDIVIDUAL PLANTS */}

      <View style={styles.individualSection}>

        <Text style={styles.sectionLabel}>{t("speciesDetail.individualPlantsOfThisSpecies")}</Text>

        <Text style={styles.sectionTitle}>{t("speciesDetail.registeredPlantsInNiah")}</Text>

        <Text style={styles.sectionDescription}>
          {speciesPlants.length}{t("speciesDetail.registeredPlant")}{speciesPlants.length === 1 ? t("speciesDetail.recordIs") : t("speciesDetail.recordsAre")}
          {" "}{t("speciesDetail.linkedToThisSpecies")}</Text>

        {loading && <Text style={styles.sectionDescription}>{t("speciesDetail.loadingSpeciesRecords")}</Text>}
        {!!errorMessage && <Text style={{ color: "#B42318", marginBottom: 12 }}>{translateUIMessage(errorMessage)}</Text>}


        {speciesPlants.length === 0 ? (
          <View style={styles.noRecords}>
            <Text>
              {loading ? t("plant.loadingPlantRecords") : t("speciesDetail.noPlantRecordsAreLinkedToThisSpeciesYet")}
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
                user={user}
                />
              ))}


            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() =>
                navigation.navigate(
                  "Species",
                  {
                    slug: selectedSpecies.slug,
                    speciesId: selectedSpecies.id,
                    species: selectedSpecies,
                  }
                )
              }
            >
              <Text style={styles.viewAllText}>{t("speciesDetail.viewAllPlants")}</Text>
            </TouchableOpacity>
          </>
        )}

      </View>


      {/* GALLERY */}

      <View style={styles.gallerySection}>

        <Text style={styles.sectionLabel}>{t("speciesDetail.botanicalPhotographs")}</Text>

        <Text style={styles.sectionTitle}>{t("speciesDetail.identificationFromDifferentViews")}</Text>

        <Text style={styles.sectionDescription}>{t("speciesDetail.photographsSupportSpeciesIdentificationByShowingImportantBotanicalFeaturesAnd")}</Text>


        <View style={styles.galleryGrid}>

          {selectedSpecies.images?.map(
            (image, index) => (
              <View
                key={`${image.caption}-${index}`}
                style={styles.galleryCard}
              >

                {getSpeciesImageSource(selectedSpecies, image.path) ? (
                  <Image
                    source={getSpeciesImageSource(selectedSpecies, image.path)}
                    style={styles.galleryImage}
                  />
                ) : (
                  <View
                    style={styles.galleryPlaceholder}
                  >
                    <Text style={styles.placeholderIcon}>
                      🌿
                    </Text>

                    <Text style={styles.placeholderText}>{t("speciesDetail.photographComingSoon")}</Text>
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




    </ScrollView>
  );
}


// =====================================================
// FACT COMPONENT
// =====================================================

function Fact({ label, value }) {
  useAppTranslation();
  if (!value) return null;

  return (
    <View style={styles.fact}>

      <Text style={styles.factLabel}>
        {translateLabel(label)}
      </Text>

      <Text style={styles.factValue}>
        {translateFieldValue(label, value)}
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
    backgroundColor: "#F7FBF4",
  },

  hero: {
    padding: 20,
    paddingTop: 50,
    backgroundColor: "#E7F2E2",
  },

  refreshError: { color: "#A52A3A", fontSize: 12, marginBottom: 10 },

  heroToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },

  backButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#FFFFFFAA",
  },

  backText: {
    color: "#468585",
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
    backgroundColor: "#E1F0EA",
    color: "#468585",
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
    color: "#234B3A",
    fontSize: 36,
    fontWeight: "600",
  },

  scientificName: {
    marginTop: 7,
    color: "#6D7F75",
    fontSize: 17,
    fontStyle: "italic",
  },

  summary: {
    marginTop: 15,
    color: "#6D7F75",
    fontSize: 13,
    lineHeight: 21,
  },

  section: {
    padding: 24,
  },

  sectionLabel: {
    marginBottom: 8,
    color: "#468585",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },

  sectionTitle: {
    color: "#234B3A",
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 18,
  },

  paragraph: {
    color: "#6D7F75",
    fontSize: 13,
    lineHeight: 22,
  },

  subTitle: {
    marginTop: 25,
    marginBottom: 8,
    color: "#234B3A",
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
    color: "#234B3A",
    fontSize: 25,
    fontWeight: "600",
  },

  characteristicTitle: {
    marginBottom: 12,
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
  },

  characteristicRow: {
    flexDirection: "row",
    marginBottom: 10,
  },

  check: {
    width: 25,
    color: "#468585",
    fontWeight: "800",
  },

  characteristicText: {
    flex: 1,
    color: "#6D7F75",
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
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "600",
  },

  individualSection: {
    padding: 24,
    backgroundColor: "#E7F2E2",
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
    color: "#234B3A",
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
    color: "#468585",
    fontSize: 10,
    fontWeight: "700",
  },

  viewAllButton: {
    alignSelf: "center",
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#468585",
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
    backgroundColor: "#E7F2E2",
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
    color: "#6D7F75",
    fontSize: 11,
    fontWeight: "700",
  },

  distribution: {
    padding: 24,
    backgroundColor: "#F7FBF4",
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
    color: "#468585",
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
    color: "#234B3A",
    fontSize: 25,
    fontWeight: "600",
  },

  notFoundText: {
    marginTop: 8,
    color: "#6D7F75",
    fontSize: 13,
    textAlign: "center",
  },

  notFoundButton: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "#468585",
  },

  notFoundButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

});
