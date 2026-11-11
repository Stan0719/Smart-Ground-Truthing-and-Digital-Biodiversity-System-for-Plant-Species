import { t, translateLabel, translateUIMessage, useAppTranslation } from "../translations/i18n";
// screens/Plant.js
import LanguageSelector from "../components/LanguageSelector";

import React, { useCallback, useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSpeciesImageSource } from "../data/speciesImages";
import { useSpeciesCatalog } from "../utils/useSpeciesCatalog";
import RefreshButton from "../components/RefreshButton";
import FavouriteHeart from "../components/FavouriteHeart";
import useVisitorFavourites from "../hooks/useVisitorFavourites";
import { filterAndSortSpecies, getSpeciesFamilyOptions, resetMissingSpeciesFamily } from "../utils/speciesFilters";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const GRID_HORIZONTAL_PADDING = SCREEN_WIDTH < 500 ? 12 : 13;
const GRID_GAP = SCREEN_WIDTH < 500 ? 8 : 10;
const SPECIES_CARD_WIDTH =
  (SCREEN_WIDTH - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;

function SpeciesCardImage({ species }) {
  const [failedImageKey, setFailedImageKey] = useState(null);
  const source = getSpeciesImageSource(species);
  const key = typeof source === "number" ? `local:${source}` : source?.uri || null;
  if (!source || key === failedImageKey) {
    return (
      <View style={styles.imagePlaceholder}>
        <Text style={styles.placeholderIcon}>🌿</Text>
        <Text style={styles.placeholderText}>{t("species.imageComingSoon")}</Text>
      </View>
    );
  }
  return <Image source={source} style={styles.cardImage} resizeMode="cover" onError={() => setFailedImageKey(key)} />;
}

export default function Species({ navigation, user }) {
  useAppTranslation();
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const isVisitor = user?.role?.toLowerCase() === "visitor";

  const { species: plants, counts: plantCounts, loading, error: errorMessage, refresh } = useSpeciesCatalog(user?.id, { publicOnly: !user || isVisitor });
  const favourites = useVisitorFavourites(user);
  const refreshFavourites = favourites.refresh;
  const refreshAll = useCallback(() => Promise.all([refresh(), refreshFavourites(true)]), [refresh, refreshFavourites]);

  const [activeFamily, setActiveFamily] = useState(null);

  const familyOptions = useMemo(() => getSpeciesFamilyOptions(plants), [plants]);
  const selectedFamily = resetMissingSpeciesFamily(activeFamily, familyOptions);

  const [searchQuery, setSearchQuery] = useState("");

  const [sortOption, setSortOption] = useState("default");

  const [sortOpen, setSortOpen] = useState(false);


  // =====================================================
  // FILTER AND SORT
  // =====================================================

  const filteredSpecies = useMemo(() => filterAndSortSpecies(plants, {
    family: selectedFamily,
    query: searchQuery,
    sortOption,
  }), [plants, selectedFamily, searchQuery, sortOption]);

  // =====================================================
  // SPECIES CARD
  // =====================================================

  const renderSpeciesCard = ({ item }) => {
    const plantCount = plantCounts?.[item.id] || 0;


    return (
      <View style={styles.card}>
        <View style={styles.imageWrapper}>
          <SpeciesCardImage species={item} />

          <View style={styles.badgeContainer}>
            {!!item.family?.trim() && <Text style={styles.categoryBadge}>
              {translateLabel(item.family)}
            </Text>}

            {isBotanist && item.conservationStatus && (
              <Text style={styles.statusBadge}>
                {translateLabel(item.conservationStatus)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.scientificName}>{item.scientificName}</Text>
            </View>
            {isVisitor && <FavouriteHeart
              active={favourites.isFavourite("species", item.id)}
              pending={favourites.isPending("species", item.id)}
              disabled={favourites.loading}
              onPress={() => void favourites.toggle("species", item.id)}
              style={styles.cardHeart}
            />}
          </View>

          {item.family && (
            <Text style={styles.family}>{t("species.family")}{item.family}
            </Text>
          )}

          <Text style={styles.description} numberOfLines={3}>
            {item.description}
          </Text>

          {plantCounts !== null && <Text style={styles.recordCount}>
            {plantCount}{t("species.verified")}{" "}
            {plantCount === 1 ? t("plant.plant") : t("plant.plants")}
          </Text>}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                navigation.navigate("SpeciesDetail", {
                  slug: item.slug,
                  speciesId: item.id,
                })
              }
            >
              <Text style={styles.secondaryText}>{t("species.viewSpecies")}</Text>
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
              <Text style={styles.primaryText}>{t("species.viewPlants")}</Text>
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
        refreshing={loading || favourites.refreshing}
        onRefresh={refreshAll}
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
              <View style={styles.libraryHeaderRow}>
                <View style={styles.libraryHeading}>
                  <Text style={styles.sectionLabel}>{t("species.exploreTheCollection")}</Text>
                  <Text style={styles.sectionTitle}>{t("species.discoverNiahSFlora")}</Text>
                </View>
                <LanguageSelector />
              </View>

              <Text style={styles.speciesCount}>
                {filteredSpecies.length}{t("species.speciesFound")}</Text>
            </View>

            {/* LOADING AND ERROR MESSAGES */}

            {loading && (
              <Text style={styles.messageText}>{t("plant.loadingSpecies")}</Text>
            )}

            {!!favourites.mutationError && <Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(favourites.mutationError)}</Text>}
            {!!favourites.error && !favourites.loading && <Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(favourites.error)}</Text>}

            {!loading && errorMessage !== "" && (
              <Text style={styles.errorText}>
                {translateUIMessage(errorMessage)}
              </Text>
            )}

            {!loading &&
              !errorMessage &&
              filteredSpecies.length === 0 && (
                <Text style={styles.messageText}>{t("species.noSpeciesFound")}</Text>
              )}

            {/* SEARCH AND SORT */}

            <View style={styles.filterControls}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                maxLength={100}
                placeholder={t("species.searchByName")}
                placeholderTextColor="#8A968F"
                style={styles.searchInput}
              />

              <RefreshButton
                onPress={refreshAll}
                loading={loading || favourites.refreshing}
                label={t("species.refreshSpecies")}
                testID="catalogue-species-refresh"
              />

              <TouchableOpacity
                style={styles.sortButton}
                onPress={() => setSortOpen(!sortOpen)}
              >
                <Text style={styles.sortButtonText}>{t("species.sort")}</Text>
              </TouchableOpacity>
            </View>

            {sortOpen && (
              <View style={styles.sortMenu}>
                <SortOption
                  label={t("species.defaultOrder")}
                  selected={sortOption === "default"}
                  onPress={() => {
                    setSortOption("default");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label={t("species.nameAZ")}
                  selected={sortOption === "name-asc"}
                  onPress={() => {
                    setSortOption("name-asc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label={t("species.nameZA")}
                  selected={sortOption === "name-desc"}
                  onPress={() => {
                    setSortOption("name-desc");
                    setSortOpen(false);
                  }}
                />

                <SortOption
                  label={t("species.scientificNameAZ")}
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
              data={[null, ...familyOptions]}
              keyExtractor={(item) => item ?? "all-families"}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.categoryButton,
                    selectedFamily === item &&
                      styles.categoryButtonActive,
                  ]}
                  onPress={() => setActiveFamily(item)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      selectedFamily === item &&
                        styles.categoryTextActive,
                    ]}
                  >
                    {item === null ? t("common.all") : translateLabel(item)}
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

              <Text style={styles.emptyTitle}>{t("species.noMatchingSpecies")}</Text>

              <Text style={styles.emptyDescription}>{t("species.tryAnotherSearchTermOrSelectADifferentCategory")}</Text>

              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setSearchQuery("");
                  setActiveFamily(null);
                }}
              >
                <Text style={styles.clearButtonText}>{t("map.clearFilters")}</Text>
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
  useAppTranslation();
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
        {translateLabel(label)}
      </Text>
    </TouchableOpacity>
  );
}

// STYLES

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F7FBF4",
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

  libraryHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  libraryHeading: { flex: 1, minWidth: 0 },

  sectionLabel: {
    color: "#468585",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 7,
  },

  sectionTitle: {
    flexShrink: 1,
    color: "#234B3A",
    fontSize: SCREEN_WIDTH < 500 ? 26 : 28,
    lineHeight: SCREEN_WIDTH < 500 ? 32 : 34,
    fontWeight: "700",
  },

  speciesCount: {
    marginTop: 6,
    color: "#6D7F75",
    fontSize: 11,
  },

  messageText: {
    marginHorizontal: 20,
    marginBottom: 12,
    color: "#468585",
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
    borderColor: "#E2EDE0",
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    color: "#234B3A",
    fontSize: 14,
  },

  sortButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2EDE0",
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
  },

  sortButtonText: {
    color: "#44564E",
    fontSize: 13,
    fontWeight: "700",
  },

  sortMenu: {
    marginHorizontal: SCREEN_WIDTH < 500 ? 18 : 20,
    marginBottom: 10,
    padding: 6,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2EDE0",
    elevation: 2,
    shadowColor: "#234B3A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },

  sortOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },

  sortOptionSelected: {
    backgroundColor: "#E1F0EA",
  },

  sortOptionText: {
    color: "#44564E",
    fontSize: 12,
  },

  sortOptionTextSelected: {
    color: "#234B3A",
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
    backgroundColor: "#E7F2E2",
  },

  categoryButtonActive: {
    backgroundColor: "#468585",
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
    borderWidth: 1,
    borderColor: "#E2EDE0",
    elevation: 1,
    shadowColor: "#234B3A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
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

  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitleCopy: { flex: 1, minWidth: 0 },
  cardHeart: { backgroundColor: "#F1F6EF" },

  cardTitle: {
    color: "#234B3A",
    fontSize:
      SCREEN_WIDTH < 360 ? 15 : SCREEN_WIDTH < 500 ? 16 : 20,
    lineHeight:
      SCREEN_WIDTH < 360 ? 19 : SCREEN_WIDTH < 500 ? 20 : 24,
    fontWeight: "600",
  },

  scientificName: {
    marginTop: 3,
    color: "#6D7F75",
    fontSize: SCREEN_WIDTH < 500 ? 10 : 12,
    lineHeight: SCREEN_WIDTH < 500 ? 14 : 16,
    fontStyle: "italic",
  },

  family: {
    marginTop: SCREEN_WIDTH < 500 ? 5 : 7,
    color: "#6D7F75",
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
    minHeight: SCREEN_WIDTH < 500 ? 42 : 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2EDE0",
    borderRadius: 12,
    backgroundColor: "#E7F2E2",
  },

  secondaryText: {
    color: "#468585",
    fontSize: SCREEN_WIDTH < 360 ? 8.5 : SCREEN_WIDTH < 500 ? 9.5 : 12,
    fontWeight: "700",
  },

  primaryButton: {
    flex: 1,
    minHeight: SCREEN_WIDTH < 500 ? 42 : 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#468585",
  },

  primaryText: {
    color: "#FFFFFF",
    fontSize: SCREEN_WIDTH < 360 ? 8.5 : SCREEN_WIDTH < 500 ? 9.5 : 12,
    fontWeight: "700",
  },

  emptyState: {
    margin: SCREEN_WIDTH < 500 ? 18 : 20,
    padding: SCREEN_WIDTH < 500 ? 28 : 40,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#E2EDE0",
    borderRadius: 16,
  },

  emptyIcon: {
    fontSize: SCREEN_WIDTH < 500 ? 30 : 34,
  },

  emptyTitle: {
    marginTop: 10,
    color: "#234B3A",
    fontSize: SCREEN_WIDTH < 500 ? 18 : 20,
    fontWeight: "600",
  },

  emptyDescription: {
    marginTop: 6,
    color: "#6D7F75",
    fontSize: SCREEN_WIDTH < 500 ? 11 : 12,
    lineHeight: SCREEN_WIDTH < 500 ? 17 : 18,
    textAlign: "center",
  },

  clearButton: {
    minHeight: 44,
    marginTop: 15,
    paddingHorizontal: 17,
    paddingVertical: 9,
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#468585",
  },

  clearButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
