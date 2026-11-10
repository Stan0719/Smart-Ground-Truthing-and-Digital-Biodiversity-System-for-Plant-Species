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
  ActivityIndicator,
} from "react-native";

import {
  getSpeciesBySlug,
} from "../data/mockData";
import { useFocusEffect } from "@react-navigation/native";
import BackButton from "../components/BackButton";
import { fetchPlantRecords, fetchSpeciesCatalog, filterUniqueSpeciesPlantRecords, filterPlantRecordsForRole, getPlantDisplayObservation, isOwnedPendingPlant, mergeOwnedPendingPlantZones } from "../utils/plantApi";
import { getPlantCardZoneLabel, getPlantCardZoneValue } from "../utils/plantCardDisplay";
import RefreshButton from "../components/RefreshButton";
import FavouriteHeart from "../components/FavouriteHeart";
import useVisitorFavourites from "../hooks/useVisitorFavourites";


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

function useSpeciesScopedState(scope, initialValue) {
  const [entry, setEntry] = useState({ scope, value: initialValue });
  const value = entry.scope === scope ? entry.value : initialValue;
  const update = useCallback((nextValue) => {
    setEntry((current) => ({
      scope,
      value: typeof nextValue === "function"
        ? nextValue(current.scope === scope ? current.value : initialValue)
        : nextValue,
    }));
  }, [scope, initialValue]);
  return [value, update];
}

export function getPlantListViewState({ loading, errorMessage, sourceCount, visibleCount, hasActiveFilters }) {
  if (loading) return "loading";
  if (errorMessage) return "error";
  if (visibleCount > 0) return "results";
  if (sourceCount === 0) return "empty";
  return hasActiveFilters ? "filtered-empty" : "empty";
}

export default function Species({
  route,
  navigation,
  user,
}) {
  useAppTranslation();

  const { slug } = route.params || {};
  const accountId = user?.id;
  const role = user?.role;
  const isBotanist = role?.toLowerCase() === "botanist";
  const isVisitor = role?.toLowerCase() === "visitor";
  const publicOnly = !user || isVisitor;
  const favourites = useVisitorFavourites(user);

  const [selectedSpecies, setSelectedSpecies] = useState(
    route.params?.species || getSpeciesBySlug(slug) || null
  );
  const [speciesPlants, setSpeciesPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const requestRef = useRef({ key: null, id: 0, promise: null });
  const routeParams = route.params || {};
  const currentSpeciesId = routeParams.speciesId;
  const currentSlug = routeParams.slug;
  const requestKey = `${String(accountId ?? "")}:${String(role ?? "")}:${String(currentSpeciesId ?? "")}:${String(currentSlug ?? "")}`;
  const loadSpeciesPlants = useCallback((isRefresh = false) => {
    const activeRequest = requestRef.current;
    if (activeRequest?.key === requestKey && activeRequest.promise) {
      return activeRequest.promise;
    }
    const requestId = (activeRequest?.id || 0) + 1;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");
    setSpeciesPlants([]);
    const request = (async () => {
      try {
        const catalog = await fetchSpeciesCatalog({ accountId, publicOnly });
        let records = await fetchPlantRecords(catalog, { accountId, publicOnly });
        if (isBotanist && records.some((record) => isOwnedPendingPlant(record, accountId))) {
          const ownerRecords = await fetchPlantRecords(catalog, { accountId, scopeMine: true });
          records = mergeOwnedPendingPlantZones(records, ownerRecords, accountId);
        }
        const matchedSpecies = catalog.find((item) =>
          currentSpeciesId != null
            ? String(item.id) === String(currentSpeciesId)
            : item.slug === currentSlug
        ) || routeParams.species || getSpeciesBySlug(currentSlug) || null;
        const matchedId = matchedSpecies?.id ?? currentSpeciesId;
        const recordsForSpecies = filterUniqueSpeciesPlantRecords(records, matchedId, currentSlug);
        const visibleRecords = filterPlantRecordsForRole(recordsForSpecies, role, accountId, { publicOnly });

        if (requestRef.current?.id === requestId) {
          setSelectedSpecies(matchedSpecies);
          setSpeciesPlants(visibleRecords);
        }
      } catch (error) {
        if (requestRef.current?.id === requestId) {
          setErrorMessage(error.message || "Unable to load plant records.");
        }
      } finally {
        if (requestRef.current?.id === requestId) {
          requestRef.current = { key: requestKey, id: requestId, promise: null };
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    requestRef.current = { key: requestKey, id: requestId, promise: request };
    return request;
  }, [requestKey, currentSpeciesId, currentSlug, routeParams.species, accountId, role, isBotanist, publicOnly]);

  useFocusEffect(useCallback(() => {
    void loadSpeciesPlants(false);
  }, [loadSpeciesPlants]));


  const [searchQuery, setSearchQuery] = useSpeciesScopedState(requestKey, "");

  const [plantStatusFilter, setPlantStatusFilter] = useSpeciesScopedState(requestKey, "allVisible");

  const [healthFilter, setHealthFilter] = useSpeciesScopedState(requestKey, "All");

  const [lifeStageFilter, setLifeStageFilter] = useSpeciesScopedState(requestKey, "All");

  const [qrFilter, setQrFilter] = useSpeciesScopedState(requestKey, "All");

  const [zoneFilter, setZoneFilter] = useSpeciesScopedState(requestKey, "All");

  const [sortOption, setSortOption] = useSpeciesScopedState(requestKey, "default");

  const [filtersOpen, setFiltersOpen] = useSpeciesScopedState(requestKey, false);


  // =====================================================
  // FILTER
  // =====================================================

  const filteredPlants = useMemo(() => {

    const query =
      searchQuery.trim().toLowerCase();


    const filtered = speciesPlants.filter(
      (plant) => {
        const observation = getPlantDisplayObservation(plant);

        const matchesSearch =
          !query ||
          plant.plantId
            ?.toLowerCase()
            .includes(query);

        const matchesStatus = !isBotanist || plantStatusFilter === "allVisible" ||
          (plantStatusFilter === "approved" && plant.currentStatus === "Approved") ||
          (plantStatusFilter === "myPending" && isOwnedPendingPlant(plant, user?.id));


        const matchesHealth =
          !isBotanist ||
          healthFilter === "All" ||
          (observation?.healthStatus || "Not recorded") ===
            healthFilter;


        const matchesLifeStage =
          lifeStageFilter === "All" ||
          (observation?.lifeStage || "Not recorded") ===
            lifeStageFilter;


        const matchesQr =
          !isBotanist ||
          qrFilter === "All" ||
          plant.qr?.status === qrFilter;


        const zoneValue = getPlantCardZoneValue(plant, user?.role, {
          allowOwnedPending: isBotanist && isOwnedPendingPlant(plant, user?.id),
        });
        const matchesZone =
            !isBotanist ||
            zoneFilter === "All" ||
            (zoneFilter === "Not recorded"
              ? zoneValue === null && plant.location?.restricted !== true
              : zoneValue === `Zone ${zoneFilter}`);


        return (
          matchesSearch &&
          matchesStatus &&
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
    plantStatusFilter,
    user?.id,
    user?.role,
  ]);


  const activeFilterCount =
    [
      isBotanist && healthFilter !== "All",
      lifeStageFilter !== "All",
      isBotanist && qrFilter !== "All",
      isBotanist && zoneFilter !== "All",
      sortOption !== "default",
      isBotanist && plantStatusFilter !== "allVisible",
    ].filter(Boolean).length;

  const hasActiveResultFilters = Boolean(searchQuery.trim()) ||
    (isBotanist && plantStatusFilter !== "allVisible") ||
    (isBotanist && healthFilter !== "All") ||
    lifeStageFilter !== "All" ||
    (isBotanist && qrFilter !== "All") ||
    (isBotanist && zoneFilter !== "All");
  const listViewState = getPlantListViewState({
    loading: loading || refreshing,
    errorMessage,
    sourceCount: speciesPlants.length,
    visibleCount: filteredPlants.length,
    hasActiveFilters: hasActiveResultFilters,
  });


  const clearFilters = () => {
    setSearchQuery("");
    setPlantStatusFilter("allVisible");
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
        {loading || refreshing ? <View style={styles.loadingState}>
          <ActivityIndicator size="small" color="#2F6B4F" />
          <Text style={styles.loadingText}>{t("plant.loadingSpecies")}</Text>
        </View> : errorMessage ? <View style={styles.loadError}>
          <Text accessibilityRole="alert" style={styles.loadErrorText}>{translateUIMessage(errorMessage)}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => { void loadSpeciesPlants(true); }} accessibilityRole="button">
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View> : <>
          <Text style={styles.icon}>??</Text>
          <Text style={styles.title}>{t("plant.speciesNotFound")}</Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate("Plants")}>
            <Text style={styles.buttonText}>{t("plant.returnToSpecies")}</Text>
          </TouchableOpacity>
        </>}
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
          onRefresh={() => { void loadSpeciesPlants(true); void favourites.refresh(true); }}
          tintColor="#468585"
          colors={["#468585"]}
        />
      }
    >

      {/* HEADER */}

      <View style={styles.header}>

        <View style={styles.headerToolbar}>
        <BackButton label={t("plant.back")} variant="glass" onPress={() => navigation.goBack()} />
        <LanguageSelector />
        </View>


        <Text style={styles.label}>{t("plant.plantRecords")}</Text>

        <View style={styles.headingRow}>
          <Text style={styles.heading}>{isBotanist ? t("plant.allVisiblePlants") : t("plant.allVerifiedPlants")}</Text>
          <RefreshButton
            onPress={() => { void loadSpeciesPlants(true); void favourites.refresh(true); }}
            loading={loading || refreshing || favourites.refreshing}
            label={t("common.refresh")}
            testID="plant-list-refresh"
          />
        </View>

        <Text style={styles.speciesName}>
          {selectedSpecies.name}
        </Text>

        {!loading && !refreshing && !errorMessage && <Text style={styles.count}>
          {filteredPlants.length}{" "}
          {filteredPlants.length === 1
            ? t("plant.plant")
            : t("plant.plants")}{" "}{t("plant.found")}</Text>}

        {!!favourites.mutationError && <Text accessibilityRole="alert" style={{ marginTop: 8, color: "#A52A3A" }}>{translateUIMessage(favourites.mutationError)}</Text>}
        {!!favourites.error && !favourites.loading && <Text accessibilityRole="alert" style={{ marginTop: 8, color: "#A52A3A" }}>{translateUIMessage(favourites.error)}</Text>}

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

      {isBotanist && <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statusFilters}
        accessibilityLabel={t("plant.recordVisibilityFilters")}
      >
        {[
          ["allVisible", t("plant.allVisible")],
          ["approved", t("plant.approvedOnly")],
          ["myPending", t("plant.myPending")],
        ].map(([value, label]) => {
          const selected = plantStatusFilter === value;
          return <TouchableOpacity
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setPlantStatusFilter(value)}
            style={[styles.statusFilterChip, selected && styles.statusFilterChipSelected]}
          >
            <Text style={[styles.statusFilterText, selected && styles.statusFilterTextSelected]}>{label}</Text>
          </TouchableOpacity>;
        })}
      </ScrollView>}


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


          {!loading && !refreshing && !errorMessage && speciesPlants.length > 0 && listViewState !== "filtered-empty" && activeFilterCount > 0 && (
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

        {listViewState === "loading" ? <View style={styles.loadingState} testID="plant-list-loading">
          <ActivityIndicator size="small" color="#2F6B4F" />
          <Text style={styles.loadingText}>{t("plant.loadingPlantRecords")}</Text>
        </View> : listViewState === "error" ? <View style={styles.loadError} testID="plant-list-error">
          <Text accessibilityRole="alert" style={styles.loadErrorText}>{translateUIMessage(errorMessage)}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={() => { void loadSpeciesPlants(true); }}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View> : listViewState === "results" ? (

          filteredPlants.map((plant) => (
            <PlantCard
              key={plant.plantId}
              plant={plant}
              navigation={navigation}
              user={user}
              isVisitor={isVisitor}
              favourites={favourites}
            />
          ))

        ) : (

          <View style={styles.empty}>

            <Text style={styles.emptyIcon}>
              🌿
            </Text>

            <Text style={styles.emptyTitle}>
              {listViewState === "filtered-empty"
                ? t("plant.noPlantsMatchYourCurrentSearchOrFilters")
                : t("plant.noPlantRecordsForThisSpeciesYet")}
            </Text>

            {listViewState === "filtered-empty" && hasActiveResultFilters && (
              <TouchableOpacity
                testID="plant-list-clear-filters"
                style={[styles.clearButton, styles.emptyClearButton]}
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
  isVisitor,
  favourites,
}) {
  useAppTranslation();
  const [failedImageKey, setFailedImageKey] = useState(null);

  const sourceKey = (source) => typeof source === "number" ? `local:${source}` : source?.uri || null;
  const imageSource = plant.plantImage && sourceKey(plant.plantImage) !== failedImageKey ? plant.plantImage : null;
  const observation = getPlantDisplayObservation(plant);
  const isBotanist = user?.role?.toLowerCase() === "botanist";
  const displayStatus = plant.currentStatus;
  const zoneLabel = getPlantCardZoneLabel(plant, user?.role, {
    restricted: t("map.locationRestricted"),
    missing: t("plant.notRecorded"),
    allowOwnedPending: isBotanist && isOwnedPendingPlant(plant, user?.id),
  });

  return (
    <View style={styles.card}>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => navigation.navigate("PlantDetails", { plantId: plant.plantId })}
      >

      {/* IMAGE */}
      <View style={styles.cardImage}>

        {imageSource ? (
          <Image
            source={imageSource}
            style={styles.plantImage}
            resizeMode="cover"
            onError={() => setFailedImageKey(sourceKey(imageSource))}
          />
        ) : (
          <Text style={styles.plantIcon}>
            🌿
          </Text>
        )}

        {!isVisitor && <View pointerEvents="none" style={styles.imageBadges}>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.statusBadge, plantStatusStyle(plant.currentStatus)]}>
            {translateLabel(plant.currentStatus || t("plant.notRecorded"))}
          </Text>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.zoneBadge]}>{zoneLabel}</Text>
        </View>}

      </View>


      {/* CONTENT */}
      <View style={styles.cardContent}>

        {isVisitor && <View style={styles.visitorBadges}>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.visitorBadge, styles.statusBadge, plantStatusStyle(displayStatus)]}>
            {translateLabel(displayStatus || t("plant.notRecorded"))}
          </Text>
          <Text numberOfLines={2} style={[styles.imageBadge, styles.visitorBadge, styles.zoneBadge]}>{zoneLabel}</Text>
        </View>}

        <Text style={styles.species}>
          {plant.plantScientificName || t("plant.unnamedPlant")}
        </Text>
        <Text style={styles.plantId}>{t("plantDetail.plantId")}: {plant.plantId}</Text>
        {!!plant.plantCommonName && <Text style={styles.infoValue}>{plant.plantCommonName}</Text>}


        <View style={styles.infoGrid}>

          {isBotanist ? (
            <>
              <Info
                label={t("plant.health")}
                value={observation?.healthStatus || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.lifeStage2")}
                value={observation?.lifeStage || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.qrStatus2")}
                value={plant.qr?.status || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.height")}
                value={observation?.heightCm != null ? `${observation.heightCm} cm` : t("plant.notRecorded")}
              />
              <Info label={t("plant.morphology")} value={observation?.morphology || t("plant.notRecorded")} />
              <Info label={t("plant.locationZone")} value={zoneLabel} />
            </>
          ) : (
            <>
              <Info
                label={t("plant.height")}
                value={observation?.heightCm != null ? `${observation.heightCm} cm` : t("plant.notRecorded")}
              />

              <Info
                label={t("plant.lifeStage2")}
                value={observation?.lifeStage || t("plant.notRecorded")}
              />

              <Info
                label={t("plant.lastVerified")}
                value={formatDate(plant.latestApproved?.date)}
              />
              <Info label={t("plant.health")} value={observation?.healthStatus || t("plant.notRecorded")} />
              <Info label={t("plant.morphology")} value={observation?.morphology || t("plant.notRecorded")} />
              <Info label={t("plant.locationZone")} value={zoneLabel} />
            </>
          )}

        </View>

        {isBotanist && plant.latestSubmission?.status ? (
          <Text style={styles.infoValue}>{t("botanistRecords.observationStatus")}{translateLabel(plant.latestSubmission.status)}</Text>
        ) : null}
        {isBotanist && plant.currentStatus === "Pending Review" ? (
          <Text accessibilityRole="text" style={styles.pendingApprovalHint}>{t("plant.awaitingOfficerApproval")}</Text>
        ) : null}

        <View style={styles.viewRecord}>

          <Text style={styles.viewRecordText}>{t("plant.viewPlantRecord")}</Text>

        </View>

      </View>

      </TouchableOpacity>
      {isVisitor && <FavouriteHeart
        active={favourites.isFavourite("plant", plant.plantId)}
        pending={favourites.isPending("plant", plant.plantId)}
        disabled={favourites.loading}
        onPress={() => void favourites.toggle("plant", plant.plantId)}
        style={styles.plantHeart}
      />}
    </View>
  );
}

function plantStatusStyle(status) {
  switch (String(status || "").toLowerCase()) {
    case "approved": return styles.statusApproved;
    case "pending review": return styles.statusPending;
    case "rejected": return styles.statusRejected;
    case "correction required": return styles.statusCorrection;
    default: return styles.statusOther;
  }
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
    backgroundColor: "#F7FBF4",
  },

  header: {
    padding: 22,
    paddingTop: 50,
    backgroundColor: "#E7F2E2",
  },

  headerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  unavailableLanguageHeader: { position: "absolute", top: 50, right: 22 },

  plantImage: {
    width: "100%",
    height: "100%",
    },

  label: {
    color: "#468585",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.8,
  },

  heading: {
    flexShrink: 1,
    marginTop: 7,
    color: "#234B3A",
    fontSize: 30,
    fontWeight: "600",
  },

  speciesName: {
    marginTop: 7,
    color: "#6D7F75",
    fontSize: 15,
    fontStyle: "italic",
  },

  count: {
    marginTop: 10,
    color: "#6D7F75",
    fontSize: 11,
  },

controls: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingHorizontal: 20,
  paddingVertical: 20,
},

statusFilters: {
  paddingHorizontal: 20,
  paddingBottom: 12,
  gap: 8,
},

statusFilterChip: {
  minHeight: 40,
  justifyContent: "center",
  paddingHorizontal: 14,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: "#D6E9D9",
  backgroundColor: "#FFFFFF",
},

statusFilterChipSelected: {
  borderColor: "#2F6B4F",
  backgroundColor: "#D6E9D9",
},

statusFilterText: {
  color: "#52665C",
  fontSize: 12,
  fontWeight: "600",
},

statusFilterTextSelected: {
  color: "#2F6B4F",
  fontWeight: "700",
},

pendingApprovalHint: {
  marginTop: 10,
  color: "#805B16",
  fontSize: 12,
  lineHeight: 17,
  fontWeight: "600",
},

search: {
  flex: 1,
  minWidth: 0,
  minHeight: 44,
  paddingHorizontal: 12,
  paddingVertical: 11,
  borderWidth: 1,
  borderColor: "#E2EDE0",
  borderRadius: 12,
  backgroundColor: "#FFFFFF",
  color: "#234B3A",
  fontSize: 14,
},

filterToggle: {
  minHeight: 44,
  alignItems: "center",
  justifyContent: "center",
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderWidth: 1,
  borderColor: "#468585",
  borderRadius: 12,
  backgroundColor: "#FFFFFF",
},

  filterToggleActive: {
    backgroundColor: "#468585",
  },

  filterText: {
    color: "#468585",
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
    borderWidth: 1,
    borderColor: "#E2EDE0",
  },

  filterGroup: {
    marginBottom: 12,
  },

  filterLabel: {
    marginBottom: 5,
    color: "#6D7F75",
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
    borderColor: "#E2EDE0",
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
    backgroundColor: "#E1F0EA",
  },

  optionText: {
    color: "#44564E",
    fontSize: 11,
  },

  optionTextSelected: {
    color: "#234B3A",
    fontWeight: "700",
  },

  clearButton: {
    alignSelf: "flex-start",
    marginTop: 5,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#468585",
  },

  emptyClearButton: {
    alignSelf: "center",
    minHeight: 42,
    justifyContent: "center",
    marginTop: 14,
    paddingHorizontal: 18,
  },

  loadingState: {
    minHeight: 92,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2EDE0",
    borderRadius: 15,
  },
  loadingText: { color: "#52665C", fontSize: 14 },
  loadError: { padding: 20, alignItems: "center", borderWidth: 1, borderColor: "#F0D7D4", borderRadius: 15, backgroundColor: "#FFF9F8" },
  loadErrorText: { color: "#A52A3A", textAlign: "center", lineHeight: 21 },

  clearText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },

  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#2F6B4F",
  },

  retryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  list: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },

  card: {
    position: "relative",
    marginBottom: 14,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2EDE0",
    elevation: 1,
    shadowColor: "#234B3A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },

  plantHeart: { position: "absolute", top: 8, right: 8, backgroundColor: "#FFFFFFE8", zIndex: 2 },

  cardImage: {
    height: 135,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    backgroundColor: "#DCE8D6",
    },

  imageBadges: { position: "absolute", top: 9, left: 10, right: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 6 },
  imageBadge: { maxWidth: "48%", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, color: "#FFFFFF", fontSize: 9, lineHeight: 12, fontWeight: "700", textAlign: "center" },
  visitorBadges: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 6, marginBottom: 9 },
  visitorBadge: { maxWidth: "100%", flexShrink: 1 },
  statusBadge: { backgroundColor: "#315B49" },
  statusApproved: { backgroundColor: "#23734D" },
  statusPending: { backgroundColor: "#A76512" },
  statusRejected: { backgroundColor: "#A53A35" },
  statusCorrection: { backgroundColor: "#8C5D20" },
  statusOther: { backgroundColor: "#52645A" },

    plantIcon: {
    fontSize: 45,
    },

  zoneBadge: { backgroundColor: "#143625DD" },

  cardContent: {
    padding: 14,
  },

  plantId: {
    marginTop: 4,
    color: "#7C8982",
    fontSize: 11,
    fontWeight: "600",
  },

  species: {
    color: "#234B3A",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "700",
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
    color: "#234B3A",
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
    color: "#468585",
    fontSize: 11,
    fontWeight: "700",
  },

  empty: {
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#E2EDE0",
    borderRadius: 15,
  },

  emptyIcon: {
    fontSize: 35,
  },

  emptyTitle: {
    marginTop: 10,
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },

  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7FBF4",
  },

  icon: {
    fontSize: 45,
  },

  title: {
    marginTop: 12,
    color: "#234B3A",
    fontSize: 24,
    fontWeight: "600",
  },

  button: {
    minHeight: 44,
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

});
