import React from "react";

import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

export default function AccountScreen({
  navigation,
  user,
  onLogout,
}) {
  function handleLogout() {
    if (onLogout) {
      onLogout();
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>Account</Text>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons
              name="person"
              size={38}
              color="#468585"
            />
          </View>

          <View style={styles.profileInfo}>
            <Text style={styles.name}>
              {user?.name || "Visitor"}
            </Text>

            <Text style={styles.email}>
              {user?.email || "No email"}
            </Text>
          </View>
        </View>

        {/* Account Options */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => navigation.navigate("FavouritePlants")}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name="star"
                size={22}
                color="#468585"
              />
            </View>

            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>
                Favourite Plants
              </Text>

              <Text style={styles.optionSubtitle}>
                View your favourite plants
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#9BBDB4"
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.option}
            onPress={() => navigation.navigate("ScanHistory")}
          >
            <View style={styles.iconContainer}>
              <Ionicons
                name="scan"
                size={22}
                color="#468585"
              />
            </View>

            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>
                Scan History
              </Text>

              <Text style={styles.optionSubtitle}>
                View your previous plant scans
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={22}
              color="#9BBDB4"
            />
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Ionicons
            name="log-out-outline"
            size={22}
            color="#D9534F"
          />

          <Text style={styles.logoutText}>
            Log Out
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FFF5",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 24,
  },

  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DEF9C4",
    borderRadius: 18,
    padding: 20,
    marginBottom: 28,
  },

  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },

  profileInfo: {
    flex: 1,
  },

  name: {
    fontSize: 20,
    fontWeight: "700",
    color: "#315E59",
    marginBottom: 5,
  },

  email: {
    fontSize: 14,
    color: "#5F7772",
  },

  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: 24,
  },

  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E8F1E8",
  },

  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#DEF9C4",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  optionText: {
    flex: 1,
  },

  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#315E59",
    marginBottom: 4,
  },

  optionSubtitle: {
    fontSize: 13,
    color: "#7A918C",
  },

  logoutButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: "#F0D5D5",
  },

  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#D9534F",
    marginLeft: 8,
  },
});