import { t, translateLabel, translateUIMessage, dateLocale, useAppTranslation, translateFieldValue } from "../translations/i18n";
// screens/Species.js
import LanguageSelector from "../components/LanguageSelector";

import React, { useCallback, useMemo, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  RefreshControl,
} from "react-native";

import {
  getSpeciesBySlug,
} from "../data/mockData";
import { useFocusEffect } from "@react-navigation/native";
import { getSpeciesImageSource } from "../data/speciesImages";
import { fetchPlantRecords, fetchSpeciesCatalog } from "../utils/plantApi";
import RefreshButton from "../components/RefreshButton";


const healthOptions = [
  "All",
  "Not recorded",
  "Healthy",
  "Good",
  "Fair",
  "Poor",
];


const lifeStageOptions = [
  "All",
  "Not recorded",
  "Seedling",
  "Young",
  "Mature",
  "Flowering",
  "Fruiting",
];


const qrOptions = [
  "All",
  "Not recorded",
  "Active",
  "Inactive",
];


const zoneOptions = [
  "All",
  "Not recorded",
  "A",
  "B",
  "C",
];


export default function Species({
  route,
  navigation,
  user,
}) {
  useAppTranslation();

  const { slug, speciesId } = route.params || {};
  const isBotanist = user?.role?.toLowerCase() === "botanist";

  const [selectedSpecies, setSelectedSpecies] = useState(
    route.params?.species || getSpeciesBySlug(slug) || null
  );
  const [speciesPlants, setSpeciesPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef(null);

  const loadSpeciesPlants = useCallback((isRefresh = false) => {
    if (requestRef.current) return requestRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");
    const request = (async () => {
      try {
        const catalog = await fetchSpeciesCatalog({ accountId: user?.id });
        const records = await fetchPlantRecords(catalog, { accountId: user?.id });
        const matchedSpecies = catalog.find((item) =>
          speciesId != null
            ? String(item.id) === String(speciesId)
            : item.slug === slug
        ) || route.params?.species || getSpeciesBySlug(slug) || null;
        const matchedId = matchedSpecies?.id ?? speciesId;
        const recordsForSpecies = matchedId != null
          ? records.filter((record) => String(record.speciesId) === String(matchedId))
          : records.filter((record) => record.speciesSlug === slug);

        setSelectedSpecies(matchedSpecies);
        setSpeciesPlants(recordsForSpecies);
      } catch (error) {
        setErrorMessage(error.message || "Unable to load plant records.");
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
    void loadSpeciesPlants(false);
  }, [loadSpeciesPlants]));


  const [searchQuery, setSearchQuery] =
    useState("");

  const [healthFilter, setHealthFilter] =
    useState("All");

  const [lifeStageFilter, setLifeStageFilter] =
    useState("All");

  const [qrFilter, setQrFilter] =
    useState("All");

  const [zoneFilter, setZoneFilter] =
    useState("All");

  const [sortOption, setSortOption] =
    useState("default");

  const [filtersOpen, setFiltersOpen] =
    useState(false);


  // =====================================================
  // FILTER
  // =====================================================

  const filteredPlants = useMemo(() => {

    const query =
      searchQuery.trim().toLowerCase();


    const filtered = speciesPlants.filter(
      (plant) => {

        const matchesSearch =
          !query ||
          plant.plantId
            ?.toLowerCase()
            .includes(query);


        const matchesHealth =
          !isBotanist ||
          healthFilter === "All" ||
          plant.latestApproved?.healthStatus ===
            healthFilter;


        const matchesLifeStage =
          lifeStageFilter === "All" ||
          plant.latestApproved?.lifeStage ===
            lifeStageFilter;


        const matchesQr =
          !isBotanist ||
          qrFilter === "All" ||
          plant.qr?.status === qrFilter;


        const matchesZone =
            !isBotanist ||
            zoneFilter === "All" ||
            (zoneFilter === "Not recorded"
              ? plant.location?.zone === "Not recorded"
              : plant.location?.zone === `Zone ${zoneFilter}`);


        return (
          matchesSearch &&
          matchesHealth &&
          matchesLifeStage &&
          matchesQr &&
          matchesZone
        );
      }
    );


    const sorted = [...filtered];


    if (sortOption === "id-asc") {
      sorted.sort((a, b) =>
        a.plantId.localeCompare(b.plantId)
      );
    }


    if (sortOption === "verified-newest") {
    sorted.sort(
        (a, b) =>
        new Date(b.latestApproved?.date || 0).getTime() -
        new Date(a.latestApproved?.date || 0).getTime()
    );
    }

    if (sortOption === "verified-oldest") {
    sorted.sort(
        (a, b) =>
        new Date(a.latestApproved?.date || 0).getTime() -
        new Date(b.latestApproved?.date || 0).getTime()
    );
    }


    return sorted;

  }, [
    speciesPlants,
    searchQuery,
    healthFilter,
    lifeStageFilter,
    qrFilter,
    zoneFilter,
    sortOption,
    isBotanist,
  ]);


  const activeFilterCount =
    [
      isBotanist && healthFilter !== "All",
      lifeStageFilter !== "All",
      isBotanist && qrFilter !== "All",
      isBotanist && zoneFilter !== "All",
      sortOption !== "default",
    ].filter(Boolean).length;


  const clearFilters = () => {
    setSearchQuery("");
    setHealthFilter("All");
    setLifeStageFilter("All");
    setQrFilter("All");
    setZoneFilter("All");
    setSortOption("default");
  };


  if (!selectedSpecies) {
    return (
      <View style={styles.notFound}>

        <View style={styles.unavailableLanguageHeader}><LanguageSelector /></View>

        <Text style={styles.icon}>
          🌿
        </Text>

        <Text style={styles.title}>
          {loading ? t("plant.loadingSpecies") : t("plant.speciesNotFound")}
        </Text>

        {!!errorMessage && (
          <Text style={{ color: "#B42318", marginTop: 8, textAlign: "center" }}>
            {translateUIMessage(errorMessage)}
          </Text>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={() =>
            navigation.navigate("Plants")
          }
        >
          <Text style={styles.buttonText}>{t("plant.returnToSpecies")}</Text>
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
          refreshing={refreshing}
          onRefresh={() => void loadSpeciesPlants(true)}
          tintColor="#315B49"
          colors={["#315B49"]}
        />
      }
    >

      {/* HEADER */}

      <View style={styles.header}>

        <View style={styles.headerToolbar}>
        <TouchableOpacity
          style={styles.heroBackButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
        >
          <Text style={styles.heroBackText}>{t("plant.back")}</Text>
        </TouchableOpacity>
        <LanguageSelector />
        </View>


        <Text style={styles.label}>{t("plant.plantRecords")}</Text>

        <View style={styles.headingRow}>
          <Text style={styles.heading}>{t("plant.allVerifiedPlants")}</Text>
          <RefreshButton
            onPress={() => void loadSpeciesPlants(true)}
            loading={loading || refreshing}
            label={t("common.refresh")}
            testID="plant-list-refresh"
          />
        </View>

        <Text style={styles.speciesName}>
          {selectedSpecies.name}
        </Text>

        <Text style={styles.count}>
          {filteredPlants.length}{" "}
          {filteredPlants.length === 1
            ? t("plant.plant")
            : t("plant.plants")}{" "}{t("plant.found")}</Text>

        {loading && <Text style={{ marginTop: 8, color: "#52665C" }}>{t("plant.loadingPlantRecords")}</Text>}
        {!!errorMessage && <Text style={{ marginTop: 8, color: "#B42318" }}>{translateUIMessage(errorMessage)}</Text>}

      </View>


      {/* SEARCH */}

      <View style={styles.controls}>

        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
                maxLength={100}
          placeholder={t("plant.searchByPlantId")}
          placeholderTextColor="#8A968F"
          style={styles.search}
        />


        <TouchableOpacity
          style={[
            styles.filterToggle,
            filtersOpen &&
              styles.filterToggleActive,
          ]}
          onPress={() =>
            setFiltersOpen(!filtersOpen)
          }
        >
          <Text
            style={[
              styles.filterText,
              filtersOpen &&
                styles.filterTextActive,
            ]}
          >{t("plant.filters")}{activeFilterCount > 0
              ? t("plant.label", { activeFilterCount: activeFilterCount })
              : ""}
          </Text>
        </TouchableOpacity>

      </View>


      {/* FILTERS */}

      {filtersOpen && (
        <View style={styles.filters}>

          {isBotanist && (
            <FilterSelector
              label={t("plant.health")}
              options={healthOptions}
              value={healthFilter}
              setValue={setHealthFilter}
            />
          )}

          <FilterSelector
            label={t("plant.lifeStage")}
            options={lifeStageOptions}
            value={lifeStageFilter}
            setValue={setLifeStageFilter}
          />

          {isBotanist && (
            <>
              <FilterSelector
                label={t("plant.qrStatus")}
                options={qrOptions}
                value={qrFilter}
                setValue={setQrFilter}
              />

              <FilterSelector
                label={t("plant.zone")}
                options={zoneOptions}
                value={zoneFilter}
                setValue={setZoneFilter}
              />
            </>
          )}

          <FilterSelector
            label={t("plant.sort")}
            options={[
              "Default",
              "Plant ID: A-Z",
              "Latest Verified: Newest",
              "Latest Verified: Oldest",
            ]}
            value={
              sortOption === "default"
                ? "Default"
                : sortOption === "id-asc"
                ? "Plant ID: A-Z"
                : sortOption ===
                  "verified-newest"
                ? "Latest Verified: Newest"
                : "Latest Verified: Oldest"
            }
            setValue={(value) => {

              if (value === "Default")
                setSortOption("default");

              if (value === "Plant ID: A-Z")
                setSortOption("id-asc");

              if (
                value ===
                "Latest Verified: Newest"
              )
                setSortOption(
                  "verified-newest"
                );

              if (
                value ===
                "Latest Verified: Oldest"
              )
                setSortOption(
                  "verified-oldest"
                );
            }}
          />


          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearFilters}
            >
              <Text style={styles.clearText}>{t("map.clearFilters")}</Text>
            </TouchableOpacity>
          )}

        </View>
      )}


      {/* PLANT LIST */}

      <View style={styles.list}>

        {filteredPlants.length > 0 ? (

          filteredPlants.map((plant) => (
            <PlantCard
              key={plant.plantId}
              plant={plant}
              navigation={navigation}
              user={user}
            />
          ))

        ) : (

          <View style={styles.empty}>

            <Text style={styles.emptyIcon}>
              🌿
            </Text>

            <Text style={styles.emptyTitle}>
              {loading
                ? t("plant.loadingPlantRecords")
                : speciesPlants.length === 0
                  ? t("plant.noPlantRecordsForThisSpeciesYet")
                  : t("plant.noPlantsMatchYourCurrentSearchOrFilters")}
            </Text>

            {activeFilterCount > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearFilters}
              >
                <Text style={styles.clearText}>{t("map.clearFilters")}</Text>
              </TouchableOpacity>
            )}

          </View>
        )}

      </View>

    </ScrollView>
  );
}


// =====================================================
// FILTER SELECTOR
// =====================================================

function FilterSelector({
  label,
  options,
  value,
  setValue,
}) {
  useAppTranslation();

  const [open, setOpen] =
    useState(false);


  return (
    <View style={styles.filterGroup}>

      <Text style={styles.filterLabel}>
        {translateLabel(label)}
      </Text>


      <TouchableOpacity
        style={styles.selector}
        onPress={() =>
          setOpen(!open)
        }
      >
        <Text style={styles.selectorText}>
          {translateFieldValue(label, value)}
        </Text>

        <Text>
          {open ? "▲" : "▼"}
        </Text>
      </TouchableOpacity>


      {open && (
        <View style={styles.options}>

          {options.map((option) => (
            <TouchableOpacity
              key={option}
              style={[
                styles.option,
                value === option &&
                  styles.optionSelected,
              ]}
              onPress={() => {
                setValue(option);
                setOpen(false);
              }}
            >

              <Text
                style={[
                  styles.optionText,
                  value === option &&
                    styles.optionTextSelected,
                ]}
              >
                {translateLabel(option)}
              </Text>

            </TouchableOpacity>
          ))}

        </View>
      )}

    </View>
  );
}


// =====================================================
// PLANT CARD
// =====================================================

function PlantCard({
  plant,
  navigation,
  user,
}) {
  useAppTranslation();

  const species = plant.species || getSpeciesBySlug(plant.speciesSlug) || {
    name: plant.commonName,
    genus: plant.genus,
  };
  const imageSource = getSpeciesImageSource(species);
  const isBotanist = user?.role?.toLowerCase() === "botanist";

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate(
          "PlantDetails",
          {
            plantId: plant.plantId,
          }
        )
      }
    >

      {/* IMAGE */}
      <View style={styles.cardImage}>

        {imageSource ? (
          <Image
            source={imageSource}
            style={styles.plantImage}
            resizeMode="cover"
            onError={(error) => {
              console.log(
                "Plant image error:",
                error.nativeEvent
              );
            }}
          />
        ) : (
          <Text style={styles.plantIcon}>
            🌿
          </Text>
        )}

        {isBotanist && (
          <Text style={styles.zoneBadge}>
            {plant.location?.zone || t("plant.notRecorded")}
          </Text>
        )}

      </View>


      {/* CONTENT */}
      <View style={styles.cardContent}>

        <Text style={styles.plantId}>
          {plant.plantId}
        </Text>

        <Text style={styles.species}>
          {species?.name || t("plant.plantRecord")}
        </Text>


        <View style={styles.infoGrid}>

          {isBotanist ? (
            <>
              <Info
                label={t("plant.health")}
                value={plant.latestApproved?.healthStatus || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.lifeStage2")}
                value={plant.latestApproved?.lifeStage || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.qrStatus2")}
                value={plant.qr?.status || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.height")}
                value={plant.latestApproved?.heightCm != null ? `${plant.latestApproved.heightCm} cm` : t("plant.notRecorded")}
              />
            </>
          ) : (
            <>
              <Info
                label={t("plant.height")}
                value={plant.latestApproved?.heightCm != null ? `${plant.latestApproved.heightCm} cm` : t("plant.notRecorded")}
              />

              <Info
                label={t("plant.lifeStage2")}
                value={plant.latestApproved?.lifeStage || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.genus")}
                value={species?.genus || "-"}
              />

              <Info
                label={t("plant.lastVerified")}
                value={formatDate(plant.latestApproved?.date)}
              />
            </>
          )}

        </View>


        <View style={styles.viewRecord}>

          <Text style={styles.viewRecordText}>{t("plant.viewPlantRecord")}</Text>

        </View>

      </View>

    </TouchableOpacity>
  );
}


// =====================================================
// INFO
// =====================================================

function Info({ label, value }) {
  useAppTranslation();
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>
        {translateLabel(label)}
      </Text>

      <Text style={styles.infoValue}>
        {translateFieldValue(label, value)}
      </Text>
    </View>
  );
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  page: {
    flex: 1,
    backgroundColor: "#F8F6EE",
  },

  header: {
    padding: 22,
    paddingTop: 50,
    backgroundColor: "#E8EFE3",
  },

  headerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  unavailableLanguageHeader: { position: "absolute", top: 50, right: 22 },

  heroBackButton: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#FFFFFFAA",
  },

  heroBackText: {
    color: "#315B49",
    fontSize: 12,
    fontWeight: "700",
  },

  plantImage: {
    width: "100%",
    height: "100%",
    },

  label: {
    color: "#50A078",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
  },

  heading: {
    flexShrink: 1,
    marginTop: 7,
    color: "#234A3C",
    fontSize: 30,
    fontWeight: "600",
  },

  speciesName: {
    marginTop: 7,
    color: "#7C6955",
    fontSize: 15,
    fontStyle: "italic",
  },

  count: {
    marginTop: 10,
    color: "#6A7B73",
    fontSize: 11,
  },

controls: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingHorizontal: 20,
  paddingVertical: 20,
},

search: {
  flex: 1,
  minWidth: 0,
  minHeight: 44,
  paddingHorizontal: 12,
  paddingVertical: 11,
  borderWidth: 1,
  borderColor: "#D9D9CF",
  borderRadius: 11,
  backgroundColor: "#FFFFFF",
  color: "#254B42",
  fontSize: 13,
},

filterToggle: {
  minHeight: 44,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: "#315B49",
  borderRadius: 11,
  backgroundColor: "#FFFFFF",
},

  filterToggleActive: {
    backgroundColor: "#315B49",
  },

  filterText: {
    color: "#315B49",
    fontSize: 11,
    fontWeight: "700",
  },

  filterTextActive: {
    color: "#FFFFFF",
  },

  filters: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 15,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },

  filterGroup: {
    marginBottom: 12,
  },

  filterLabel: {
    marginBottom: 5,
    color: "#63736A",
    fontSize: 10,
    fontWeight: "700",
  },

  selector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 9,
  },

  selectorText: {
    color: "#44564E",
    fontSize: 11,
  },

  options: {
    marginTop: 4,
    borderRadius: 9,
    backgroundColor: "#F4F5EF",
  },

  option: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  optionSelected: {
    backgroundColor: "#DFE8DA",
  },

  optionText: {
    color: "#44564E",
    fontSize: 11,
  },

  optionTextSelected: {
    color: "#254B42",
    fontWeight: "700",
  },

  clearButton: {
    alignSelf: "flex-start",
    marginTop: 5,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#35652F",
  },

  clearText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },

  list: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },

  card: {
    marginBottom: 14,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },

  cardImage: {
    height: 135,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    backgroundColor: "#DCE8D6",
    },

    plantIcon: {
    fontSize: 45,
    },

  zoneBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#143625DD",
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },

  cardContent: {
    padding: 14,
  },

  plantId: {
    color: "#234A3C",
    fontSize: 16,
    fontWeight: "700",
  },

  species: {
    marginTop: 3,
    color: "#7C8982",
    fontSize: 10,
  },

  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 13,
    gap: 8,
  },

  info: {
    width: "47%",
  },

  infoLabel: {
    color: "#7C8982",
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  infoValue: {
    marginTop: 2,
    color: "#315447",
    fontSize: 10,
    fontWeight: "600",
  },

  viewRecord: {
    marginTop: 13,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E7E8E1",
  },

  viewRecordText: {
    color: "#315B49",
    fontSize: 11,
    fontWeight: "700",
  },

  empty: {
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#BDC8BD",
    borderRadius: 15,
  },

  emptyIcon: {
    fontSize: 35,
  },

  emptyTitle: {
    marginTop: 10,
    color: "#254B42",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F6EE",
  },

  icon: {
    fontSize: 45,
  },

  title: {
    marginTop: 12,
    color: "#234A3C",
    fontSize: 24,
    fontWeight: "600",
  },

  button: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#315B49",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

});
