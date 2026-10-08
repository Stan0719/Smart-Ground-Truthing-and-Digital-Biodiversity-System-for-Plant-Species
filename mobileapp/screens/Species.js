// screens/Species.js

import React, { useMemo, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
} from "react-native";

import {
  getSpeciesBySlug,
  getPlantsBySpecies,
} from "../data/mockData";


const healthOptions = [
  "All",
  "Healthy",
  "Good",
  "Fair",
  "Poor",
];


const lifeStageOptions = [
  "All",
  "Seedling",
  "Young",
  "Mature",
  "Flowering",
  "Fruiting",
];


const qrOptions = [
  "All",
  "Active",
  "Inactive",
];


const zoneOptions = [
  "All",
  "A",
  "B",
  "C",
];


export default function Species({
  route,
  navigation,
}) {

  const { slug } = route.params || {};

  const selectedSpecies =
    getSpeciesBySlug(slug);

  const speciesPlants =
    getPlantsBySpecies(slug);


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
            .toLowerCase()
            .includes(query);


        const matchesHealth =
          healthFilter === "All" ||
          plant.latestApproved.healthStatus ===
            healthFilter;


        const matchesLifeStage =
          lifeStageFilter === "All" ||
          plant.latestApproved.lifeStage ===
            lifeStageFilter;


        const matchesQr =
          qrFilter === "All" ||
          plant.qr.status === qrFilter;


        const matchesZone =
            zoneFilter === "All" ||
            plant.location.zone === `Zone ${zoneFilter}`;


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
        new Date(b.latestApproved.date).getTime() -
        new Date(a.latestApproved.date).getTime()
    );
    }

    if (sortOption === "verified-oldest") {
    sorted.sort(
        (a, b) =>
        new Date(a.latestApproved.date).getTime() -
        new Date(b.latestApproved.date).getTime()
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
  ]);


  const activeFilterCount =
    [
      healthFilter !== "All",
      lifeStageFilter !== "All",
      qrFilter !== "All",
      zoneFilter !== "All",
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

        <Text style={styles.icon}>
          🌿
        </Text>

        <Text style={styles.title}>
          Species not found
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={() =>
            navigation.navigate("Plants")
          }
        >
          <Text style={styles.buttonText}>
            Return to Species
          </Text>
        </TouchableOpacity>

      </View>
    );
  }


  return (
    <ScrollView
      style={styles.page}
      showsVerticalScrollIndicator={false}
    >

      {/* HEADER */}

      <View style={styles.header}>

        <TouchableOpacity
          onPress={() =>
            navigation.goBack()
          }
        >
          <Text style={styles.back}>
            ← Back
          </Text>
        </TouchableOpacity>


        <Text style={styles.label}>
          PLANT RECORDS
        </Text>

        <Text style={styles.heading}>
          All verified plants
        </Text>

        <Text style={styles.speciesName}>
          {selectedSpecies.name}
        </Text>

        <Text style={styles.count}>
          {filteredPlants.length}{" "}
          {filteredPlants.length === 1
            ? "plant"
            : "plants"}{" "}
          found
        </Text>

      </View>


      {/* SEARCH */}

      <View style={styles.controls}>

        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by Plant ID..."
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
          >
            Filters
            {activeFilterCount > 0
              ? ` (${activeFilterCount})`
              : ""}
          </Text>
        </TouchableOpacity>

      </View>


      {/* FILTERS */}

      {filtersOpen && (
        <View style={styles.filters}>

          <FilterSelector
            label="Health"
            options={healthOptions}
            value={healthFilter}
            setValue={setHealthFilter}
          />

          <FilterSelector
            label="Life stage"
            options={lifeStageOptions}
            value={lifeStageFilter}
            setValue={setLifeStageFilter}
          />

          <FilterSelector
            label="QR status"
            options={qrOptions}
            value={qrFilter}
            setValue={setQrFilter}
          />

          <FilterSelector
            label="Zone"
            options={zoneOptions}
            value={zoneFilter}
            setValue={setZoneFilter}
          />

          <FilterSelector
            label="Sort"
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
              <Text style={styles.clearText}>
                Clear Filters
              </Text>
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
            />
          ))

        ) : (

          <View style={styles.empty}>

            <Text style={styles.emptyIcon}>
              🌿
            </Text>

            <Text style={styles.emptyTitle}>
              No plants match your current
              search or filters.
            </Text>

            {activeFilterCount > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearFilters}
              >
                <Text style={styles.clearText}>
                  Clear Filters
                </Text>
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

  const [open, setOpen] =
    useState(false);


  return (
    <View style={styles.filterGroup}>

      <Text style={styles.filterLabel}>
        {label}
      </Text>


      <TouchableOpacity
        style={styles.selector}
        onPress={() =>
          setOpen(!open)
        }
      >
        <Text style={styles.selectorText}>
          {value}
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
                {option}
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
}) {

  const species = getSpeciesBySlug(
    plant.speciesSlug
  );

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

        {species?.image ? (
          <Image
            source={{
              uri: species.image,
            }}
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

        <Text style={styles.zoneBadge}>
          {plant.location.zone}
        </Text>

      </View>


      {/* CONTENT */}
      <View style={styles.cardContent}>

        <Text style={styles.plantId}>
          {plant.plantId}
        </Text>

        <Text style={styles.species}>
          {species?.name || "Plant record"}
        </Text>


        <View style={styles.infoGrid}>

          <Info
            label="Health"
            value={
              plant.latestApproved.healthStatus
            }
          />

          <Info
            label="Life Stage"
            value={
              plant.latestApproved.lifeStage
            }
          />

          <Info
            label="QR Status"
            value={plant.qr.status}
          />

          <Info
            label="Height"
            value={`${plant.latestApproved.heightCm} cm`}
          />

        </View>


        <View style={styles.viewRecord}>

          <Text style={styles.viewRecordText}>
            View Plant Record →
          </Text>

        </View>

      </View>

    </TouchableOpacity>
  );
}


// =====================================================
// INFO
// =====================================================

function Info({ label, value }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>
        {label}
      </Text>

      <Text style={styles.infoValue}>
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

  header: {
    padding: 22,
    backgroundColor: "#E8EFE3",
  },

  back: {
    marginBottom: 25,
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
    padding: 20,
  },

  search: {
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "#D9D9CF",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    color: "#254B42",
    fontSize: 13,
  },

  filterToggle: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#315B49",
    borderRadius: 999,
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