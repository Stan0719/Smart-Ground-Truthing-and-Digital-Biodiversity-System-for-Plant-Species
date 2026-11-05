import LanguageSelector from "../components/LanguageSelector";
import { useAppTranslation, t } from "../translations/i18n";
import React from "react";

import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

export default function AccountScreen({
  navigation,
  user,
  onLogout,
}) {
  useAppTranslation();
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
        <View style={styles.header}>
          <Text style={styles.title}>{t("account.account")}</Text>
          <LanguageSelector />
        </View>

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
              {user?.name || t("account.visitor")}
            </Text>

            <Text style={styles.email}>
              {user?.email || t("account.noEmail")}
            </Text>
          </View>
        </View>

        {/* Account Options */}
        <View style={styles.section}>
          {user?.role === "conservation-officer" && <TouchableOpacity style={styles.option} onPress={() => navigation.navigate("RecordChangeReview")}>
            <View style={styles.iconContainer}><Ionicons name="document-text-outline" size={22} color="#468585" /></View>
            <View style={styles.optionText}><Text style={styles.optionTitle}>{t("recordEdits.reviewTitle")}</Text>
              <Text style={styles.optionSubtitle}>{t("recordEdits.reviewSubtitle")}</Text></View>
            <Ionicons name="chevron-forward" size={22} color="#9BBDB4" />
          </TouchableOpacity>}
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
              <Text style={styles.optionTitle}>{t("navigation.favouritePlants")}</Text>

              <Text style={styles.optionSubtitle}>{t("account.viewYourFavouritePlants")}</Text>
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
              <Text style={styles.optionTitle}>{t("account.scanHistory")}</Text>

              <Text style={styles.optionSubtitle}>{t("account.viewYourPreviousPlantScans")}</Text>
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
            color="#468585"
          />

          <Text style={styles.logoutText}>{t("account.logOut")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7FBF4",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  title: {
    flex: 1,
    fontSize: 28,
    fontWeight: "700",
    color: "#234B3A",
  },

  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 24 },

  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E7F2E2",
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
    color: "#234B3A",
    marginBottom: 5,
  },

  email: {
    fontSize: 14,
    color: "#5F7772",
  },

  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2EDE0",
    overflow: "hidden",
    marginBottom: 24,
  },

  option: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#E2EDE0",
  },

  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E7F2E2",
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
    color: "#234B3A",
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
    minHeight: 44,
    backgroundColor: "#E7F2E2",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  logoutText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#468585",
    marginLeft: 8,
  },
});
