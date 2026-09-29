import React from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
} from "react-native";

export default function PlantDetailsScreen({ route }) {
  const { plant } = route.params;

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={plant.image}
        style={styles.image}
      />

      <View style={styles.content}>
        <Text style={styles.scientificName}>
          {plant.scientificName}
        </Text>

        <Text style={styles.commonName}>
          {plant.commonName}
        </Text>

        <View style={styles.statusBadge}>
          <Text style={styles.statusBadgeText}>
            {plant.conservationStatus}
          </Text>
        </View>

        <Section
          title="Taxonomy"
          text={`Family: ${plant.family}
Genus: ${plant.genus}
Species: ${plant.species}`}
        />

        <Section
          title="Description"
          text={plant.description}
        />

        <Section
          title="Morphological Characteristics"
          text={plant.morphology}
        />

        <Section
          title="Plant Height"
          text={plant.height}
        />

        <Section
          title="Conservation Status"
          text={plant.conservationStatus}
        />

        <Section
          title="Cultural Significance"
          text={plant.culturalSignificance}
        />

        <View style={styles.locationCard}>
          <Text style={styles.locationTitle}>
            📍 GPS Location
          </Text>

          <Text style={styles.locationText}>
            Latitude: {plant.latitude}
          </Text>

          <Text style={styles.locationText}>
            Longitude: {plant.longitude}
          </Text>
        </View>

        <View style={styles.recordCard}>
          <Text style={styles.recordTitle}>
            Plant Record
          </Text>

          <Text style={styles.recordText}>
            Record ID: {plant.id}
          </Text>

          <Text style={styles.recordText}>
            Recorded by: {plant.botanist}
          </Text>

          <Text style={styles.recordText}>
            Sync Status: {plant.syncStatus}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Section({ title, text }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {title}
      </Text>

      <Text style={styles.sectionText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#DEF9C4",
  },

  image: {
    width: "100%",
    height: 290,
  },

  content: {
    padding: 20,
  },

  scientificName: {
    fontSize: 26,
    fontWeight: "800",
    fontStyle: "italic",
    color: "#468585",
  },

  commonName: {
    fontSize: 16,
    color: "#687568",
    marginTop: 5,
  },

  statusBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#50B498",
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    marginTop: 12,
  },

  statusBadgeText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  section: {
    marginTop: 22,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 7,
  },

  sectionText: {
    fontSize: 15,
    lineHeight: 23,
    color: "#56645A",
  },

  locationCard: {
    backgroundColor: "#9CDBA6",
    borderRadius: 15,
    padding: 16,
    marginTop: 22,
  },

  locationTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 8,
  },

  locationText: {
    fontSize: 14,
    color: "#468585",
    marginTop: 3,
  },

  recordCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 16,
    marginTop: 15,
    marginBottom: 30,
  },

  recordTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 8,
  },

  recordText: {
    color: "#687568",
    marginTop: 5,
    fontSize: 13,
  },
});