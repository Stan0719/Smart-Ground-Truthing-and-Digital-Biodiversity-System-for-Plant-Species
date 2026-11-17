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
  ScrollView,
  Image,
  Dimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getSpeciesImageSource } from "../data/speciesImages";
import { useSpeciesCatalog } from "../utils/useSpeciesCatalog";
import RefreshButton from "../components/RefreshButton";
import FavouriteHeart from "../components/FavouriteHeart";
import useVisitorFavourites from "../hooks/useVisitorFavourites";
import { combineBotanistSpecies, filterAndSortSpecies, getSpeciesFamilyOptions, resetMissingSpeciesFamily } from "../utils/speciesFilters";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const GRID_HORIZONTAL_PADDING = SCREEN_WIDTH < 500 ? 12 : 13;
const GRID_GAP = SCREEN_WIDTH < 500 ? 8 : 10;
const SPECIES_CARD_WIDTH =
  (SCREEN_WIDTH - GRID_HORIZONTAL_PADDING * 2 - GRID_GAP) / 2;

function SpeciesCardImage({ species }) {
  useAppTranslation();
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
  const isPublicViewer = !user || isVisitor;

  const { species: plants, ownedRequests, counts: plantCounts, loading, error: errorMessage, refresh } = useSpeciesCatalog(user?.id, { publicOnly: isPublicViewer, includeOwnedRequests: isBotanist });
  const favourites = useVisitorFavourites(user);
  const refreshFavourites = favourites.refresh;
  const refreshAll = useCallback(() => Promise.all([refresh(), refreshFavourites(true)]), [refresh, refreshFavourites]);

  const [activeFamily, setActiveFamily] = useState(null);

  const familyOptions = useMemo(() => getSpeciesFamilyOptions(plants), [plants]);
  const selectedFamily = resetMissingSpeciesFamily(activeFamily, familyOptions);

  const [searchQuery, setSearchQuery] = useState("");

  const [sortOption, setSortOption] = useState("default");

  const [sortOpen, setSortOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closeSortMenu = () => { setSortOpen(false); setFiltersOpen(false); };


  // =====================================================
  // FILTER AND SORT
  // =====================================================

  const availableSpecies = useMemo(() => isBotanist ? combineBotanistSpecies(plants, ownedRequests) : plants,
    [isBotanist, plants, ownedRequests]);
  const filteredSpecies = useMemo(() => filterAndSortSpecies(availableSpecies.filter((item) =>
    isPublicViewer ? !item.privateRequest && item.approvalStatus === "Approved"
      : !isBotanist || statusFilter === "all" || item.approvalStatus === statusFilter), {
    family: isBotanist || isPublicViewer ? null : selectedFamily,
    query: searchQuery,
    sortOption,
  }), [availableSpecies, isBotanist, isPublicViewer, selectedFamily, searchQuery, sortOption, statusFilter]);

  // =====================================================
  // SPECIES CARD
  // =====================================================

  const renderSpeciesCard = ({ item }) => {
    const plantCount = item.privateRequest ? 0 : plantCounts?.[item.id] || 0;
    const pendingRequest = isBotanist && item.privateRequest && item.approvalStatus === "Pending Review";
    const openDetails = () => pendingRequest
      ? navigation.navigate("SpeciesDetail", { requestId: item.requestId, speciesId: item.proposedSpeciesId, slug: item.slug })
      : item.privateRequest
      ? navigation.navigate("BotanistSpeciesRequestDetail", { requestId: item.requestId, botanist: user })
      : navigation.navigate("SpeciesDetail", { slug: item.slug, speciesId: item.id });


    return (
      <View style={styles.card}>
        <View style={styles.imageWrapper}>
          <SpeciesCardImage species={item} />

          {!isPublicViewer && <View style={styles.badgeContainer}>
            <Text style={[styles.statusBadge, speciesApprovalBadgeStyle(item.approvalStatus)]}>
              {translateLabel(item.approvalStatus)}
            </Text>
          </View>}
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle} numberOfLines={2}>{item.scientificName}</Text>
              <Text style={styles.scientificName} numberOfLines={2}>{item.name}</Text>
            </View>
            {isVisitor && <FavouriteHeart
              active={favourites.isFavourite("species", item.id)}
              pending={favourites.isPending("species", item.id)}
              disabled={favourites.loading}
              onPress={() => void favourites.toggle("species", item.id)}
              style={styles.cardHeart}
            />}
          </View>

          {!!item.genus && <Text style={styles.family} numberOfLines={1}>{t("plant.genus")}: {item.genus}</Text>}
          {!!item.family && <Text style={styles.family} numberOfLines={1}>{t("species.family")}{item.family}</Text>}
          {!item.privateRequest && plantCounts !== null && <Text style={styles.recordCount}>
            {plantCount}{t("species.verified")}{" "}
            {plantCount === 1 ? t("plant.plant") : t("plant.plants")}
          </Text>}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={openDetails}
            >
              <Text style={styles.secondaryText}>{t(item.privateRequest && !pendingRequest ? "species.viewRequest" : "species.viewSpecies")}</Text>
            </TouchableOpacity>

            {(!item.privateRequest || pendingRequest) && <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                if (pendingRequest && !item.proposedSpeciesId) {
                  Alert.alert(t("species.viewPlants"), t("plant.speciesDetailsUnavailable"));
                  return;
                }
                navigation.navigate("Species", {
                  slug: item.slug,
                  speciesId: pendingRequest ? item.proposedSpeciesId : item.id,
                  species: pendingRequest ? { ...item, id: item.proposedSpeciesId } : item,
                });
              }}
            >
              <Text style={styles.primaryText}>{t("species.viewPlants")}</Text>
            </TouchableOpacity>}
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
      <View style={styles.fixedHeader}>
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
                {errorMessage === "species.requestsRefreshFailed" ? t(errorMessage) : translateUIMessage(errorMessage)}
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

              {isBotanist && <TouchableOpacity
                style={[styles.filterToggle, filtersOpen && styles.filterToggleActive]}
                onPress={() => setFiltersOpen(!filtersOpen)}
                accessibilityRole="button"
                accessibilityState={{ expanded: filtersOpen }}
              >
                <Text style={[styles.filterText, filtersOpen && styles.filterTextActive]}>{t("plant.filters")}</Text>
              </TouchableOpacity>}

              {!isBotanist && <TouchableOpacity
                style={styles.sortButton}
                onPress={() => setSortOpen(!sortOpen)}
              >
                <Text style={styles.sortButtonText}>{t("species.sort")}</Text>
              </TouchableOpacity>}
            </View>

            {isBotanist && <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statusFilters} accessibilityLabel={t("species.approvalStatusFilter")}>
              {[["all", t("plant.allVisible")], ["Approved", t("plant.approvedOnly")],
                ["Pending Review", t("plant.myPending")], ["Rejected", t("species.myRejected")]].map(([value, label]) => {
                const selected = statusFilter === value;
                return <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected }}
                  onPress={() => setStatusFilter(value)}
                  style={[styles.statusFilterChip, selected && styles.statusFilterChipSelected]}>
                  <Text style={[styles.statusFilterText, selected && styles.statusFilterTextSelected]}>{label}</Text>
                </TouchableOpacity>;
              })}
            </ScrollView>}

            {(isBotanist ? filtersOpen : sortOpen) && (
              <View style={styles.sortMenu}>
                {isBotanist && <Text style={styles.sortMenuLabel}>{t("species.sort")}</Text>}
                <SortOption
                  label={t("species.defaultOrder")}
                  selected={sortOption === "default"}
                  onPress={() => {
                    setSortOption("default");
                    closeSortMenu();
                  }}
                />

                <SortOption
                  label={t("species.nameAZ")}
                  selected={sortOption === "name-asc"}
                  onPress={() => {
                    setSortOption("name-asc");
                    closeSortMenu();
                  }}
                />

                <SortOption
                  label={t("species.nameZA")}
                  selected={sortOption === "name-desc"}
                  onPress={() => {
                    setSortOption("name-desc");
                    closeSortMenu();
                  }}
                />

                <SortOption
                  label={t("species.scientificNameAZ")}
                  selected={sortOption === "scientific-asc"}
                  onPress={() => {
                    setSortOption("scientific-asc");
                    closeSortMenu();
                  }}
                />
              </View>
            )}

            {!isBotanist && !isPublicViewer && <FlatList
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
            />}

      </View>
      <FlatList
        style={styles.resultsList}
        data={filteredSpecies}
        refreshing={loading || favourites.refreshing}
        onRefresh={refreshAll}
        keyExtractor={(item) => item.slug}
        renderItem={renderSpeciesCard}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loading && !errorMessage ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🌿</Text>

              <Text style={styles.emptyTitle}>{t("species.noMatchingSpecies")}</Text>

              <Text style={styles.emptyDescription}>{t(isBotanist ? "species.tryAnotherSearchTerm" : "species.tryAnotherSearchTermOrSelectADifferentCategory")}</Text>

              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  setSearchQuery("");
                  setActiveFamily(null);
                  setStatusFilter("all");
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

function speciesApprovalBadgeStyle(status) {
  switch (String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")) {
    case "approved": return styles.approvalApproved;
    case "pending review": return styles.approvalPending;
    case "rejected": return styles.approvalRejected;
    default: return styles.approvalOther;
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F7FBF4",
  },
  fixedHeader: { flexShrink: 0 },
  resultsList: { flex: 1 },

  listContent: {
    paddingBottom: 24,
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
  filterToggle: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14,
    paddingVertical: 10, borderWidth: 1, borderColor: "#468585", borderRadius: 12, backgroundColor: "#FFFFFF" },
  filterToggleActive: { backgroundColor: "#468585" },
  filterText: { color: "#468585", fontSize: 11, fontWeight: "700" },
  filterTextActive: { color: "#FFFFFF" },
  statusFilters: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  statusFilterChip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: "#D6E9D9", backgroundColor: "#FFFFFF" },
  statusFilterChipSelected: { borderColor: "#2F6B4F", backgroundColor: "#D6E9D9" },
  statusFilterText: { color: "#52665C", fontSize: 12, fontWeight: "600" },
  statusFilterTextSelected: { color: "#2F6B4F", fontWeight: "700" },

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
  sortMenuLabel: { color: "#234B3A", fontSize: 12, fontWeight: "700", paddingHorizontal: 12, paddingVertical: 6 },

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
    right: SCREEN_WIDTH < 500 ? 8 : 10,
    alignItems: "flex-end",
  },

  statusBadge: {
    paddingHorizontal: SCREEN_WIDTH < 500 ? 6 : 8,
    paddingVertical: SCREEN_WIDTH < 500 ? 4 : 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#E7EBE6",
    color: "#52645A",
    fontSize: SCREEN_WIDTH < 500 ? 7 : 8,
    fontWeight: "600",
  },
  approvalApproved: { backgroundColor: "#E3F4E9", color: "#247344" },
  approvalPending: { backgroundColor: "#FFF0D8", color: "#965C12" },
  approvalRejected: { backgroundColor: "#FDE7E7", color: "#B42318" },
  approvalOther: { backgroundColor: "#E7EBE6", color: "#52645A" },

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
