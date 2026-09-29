import React from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

export default function HomeScreen({ navigation }) {
  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Image
        source={require("../assets/logo.png")}
        style={styles.logo}
      />

      <Text style={styles.welcome}>
        Welcome to
      </Text>

      <Text style={styles.title}>
        Niah Biodiversity
      </Text>

      <Text style={styles.subtitle}>
        Discover, document and protect the plant biodiversity of
        Niah National Park.
      </Text>

      <Image
        source={require("../assets/park.jpg")}
        style={styles.heroImage}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          About Niah National Park
        </Text>

        <Text style={styles.description}>
          Niah National Park is an important natural and cultural
          heritage area in Sarawak. The park contains diverse plant
          species and forest ecosystems that support research,
          conservation and sustainable ecotourism.
        </Text>
      </View>

      <View style={styles.featureCard}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>🌿</Text>
        </View>

        <View style={styles.featureText}>
          <Text style={styles.cardTitle}>
            Explore Plants
          </Text>

          <Text style={styles.cardText}>
            Browse plant species documented in Niah National Park.
          </Text>
        </View>
      </View>

      <View style={styles.featureCard}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📷</Text>
        </View>

        <View style={styles.featureText}>
          <Text style={styles.cardTitle}>
            Scan Plant QR
          </Text>

          <Text style={styles.cardText}>
            Scan QR codes attached to plants to quickly access
            their information.
          </Text>
        </View>
      </View>

      <View style={styles.featureCard}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>📍</Text>
        </View>

        <View style={styles.featureText}>
          <Text style={styles.cardTitle}>
            Explore Locations
          </Text>

          <Text style={styles.cardText}>
            View GPS locations of documented plants in the park.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.exploreButton}
        onPress={() => navigation.navigate("PlantsTab")}
      >
        <Text style={styles.exploreButtonText}>
          Explore Plant Species
        </Text>
      </TouchableOpacity>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#DEF9C4",
    paddingHorizontal: 20,
  },

  logo: {
    width: 90,
    height: 90,
    resizeMode: "contain",
    alignSelf: "center",
    marginTop: 25,
  },

  welcome: {
    fontSize: 15,
    color: "#468585",
    marginTop: 5,
  },

  title: {
    fontSize: 31,
    fontWeight: "800",
    color: "#468585",
    marginTop: 3,
  },

  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#687568",
    marginTop: 8,
  },

  heroImage: {
    width: "100%",
    height: 220,
    borderRadius: 20,
    marginTop: 20,
  },

  section: {
    marginTop: 25,
  },

  sectionTitle: {
    fontSize: 21,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 8,
  },

  description: {
    fontSize: 15,
    lineHeight: 24,
    color: "#56645A",
  },

  featureCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 17,
    padding: 16,
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
  },

  iconCircle: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: "#9CDBA6",
    justifyContent: "center",
    alignItems: "center",
  },

  icon: {
    fontSize: 27,
  },

  featureText: {
    flex: 1,
    marginLeft: 14,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
  },

  cardText: {
    fontSize: 13,
    color: "#687568",
    lineHeight: 19,
    marginTop: 4,
  },

  exploreButton: {
    backgroundColor: "#50B498",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },

  exploreButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  bottomSpace: {
    height: 30,
  },
});