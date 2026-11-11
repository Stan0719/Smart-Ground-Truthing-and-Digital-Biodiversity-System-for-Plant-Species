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
  const isVisitor = user?.role?.toLowerCase() === "visitor";
  function handleLogout() {
    if (onLogout) {
      onLogout();
    }
  }

  if (!isVisitor) return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.legacyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.legacyHeader}>
          <Text style={styles.legacyTitle}>{t("account.account")}</Text>
          <LanguageSelector />
        </View>
        <View style={styles.legacyProfileCard}>
          <View style={styles.legacyAvatar}><Ionicons name="person" size={38} color="#468585" /></View>
          <View style={styles.legacyProfileInfo}>
            <Text style={styles.legacyName}>{user?.name || t("account.visitor")}</Text>
            <Text style={styles.legacyEmail}>{user?.email || t("account.noEmail")}</Text>
          </View>
        </View>
        <View style={styles.legacySection}>
          {user?.role === "conservation-officer" && <TouchableOpacity style={styles.legacyOption} onPress={() => navigation.navigate("RecordChangeReview")}>
            <View style={styles.legacyIconContainer}><Ionicons name="document-text-outline" size={22} color="#468585" /></View>
            <View style={styles.legacyOptionText}><Text style={styles.legacyOptionTitle}>{t("recordEdits.reviewTitle")}</Text><Text style={styles.legacyOptionSubtitle}>{t("recordEdits.reviewSubtitle")}</Text></View>
            <Ionicons name="chevron-forward" size={22} color="#9BBDB4" />
          </TouchableOpacity>}
          <TouchableOpacity style={styles.legacyOption} onPress={() => navigation.navigate("FavouritePlants")}>
            <View style={styles.legacyIconContainer}><Ionicons name="star" size={22} color="#468585" /></View>
            <View style={styles.legacyOptionText}><Text style={styles.legacyOptionTitle}>{t("navigation.favouritePlants")}</Text><Text style={styles.legacyOptionSubtitle}>{t("account.viewYourFavouritePlants")}</Text></View>
            <Ionicons name="chevron-forward" size={22} color="#9BBDB4" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.legacyOption} onPress={() => navigation.navigate("ScanHistory")}>
            <View style={styles.legacyIconContainer}><Ionicons name="scan" size={22} color="#468585" /></View>
            <View style={styles.legacyOptionText}><Text style={styles.legacyOptionTitle}>{t("account.scanHistory")}</Text><Text style={styles.legacyOptionSubtitle}>{t("account.viewYourPreviousPlantScans")}</Text></View>
            <Ionicons name="chevron-forward" size={22} color="#9BBDB4" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.legacyLogoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={22} color="#468585" />
          <Text style={styles.legacyLogoutText}>{t("account.logOut")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>{t("account.account")}</Text>
            </View>
            <LanguageSelector />
          </View>

          {/* Profile Card */}
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={27} color="#2F6B4F" />
            </View>
            <View style={styles.profileInfo}>
              <View style={styles.profileTopRow}>
                <View style={styles.profileCopy}>
                  <Text style={styles.name} numberOfLines={2} ellipsizeMode="tail">
                    {t("botanistDashboard.hello")} {user?.name || t("account.visitor")}
                  </Text>
                  <Text style={styles.profileLabel}>{t("account.visitor")}</Text>
                  <Text style={styles.email} numberOfLines={2} ellipsizeMode="middle">{user?.email || t("account.noEmail")}</Text>
                </View>
                <TouchableOpacity
                  style={styles.logoutButton}
                  onPress={handleLogout}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={t("account.logOut")}
                >
                  <Ionicons name="log-out-outline" size={21} color="#2F6B4F" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Collection shortcuts */}
          <View style={styles.collections}>
            <Text style={styles.collectionHeading}>{t("account.myCollection")}</Text>
            <TouchableOpacity
              style={styles.collectionCard}
              onPress={() => navigation.navigate("FavouritePlants")}
              activeOpacity={0.82}
              accessibilityRole="button"
            >
              <View style={styles.collectionIcon}><Ionicons name="heart-outline" size={21} color="#2F6B4F" /></View>
              <View style={styles.collectionText}>
                <Text style={styles.collectionTitle} numberOfLines={2}>{t("navigation.favouritePlants")}</Text>
                <Text style={styles.collectionDescription} numberOfLines={2}>{t("account.viewYourFavouritePlants")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#6D8978" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.collectionCard}
              onPress={() => navigation.navigate("ScanHistory")}
              activeOpacity={0.82}
              accessibilityRole="button"
            >
              <View style={styles.collectionIcon}><Ionicons name="scan-outline" size={21} color="#2F6B4F" /></View>
              <View style={styles.collectionText}>
                <Text style={styles.collectionTitle} numberOfLines={2}>{t("account.scanHistory")}</Text>
                <Text style={styles.collectionDescription} numberOfLines={2}>{t("account.viewYourPreviousPlantScans")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#6D8978" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAFBF7" },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, alignItems: "center" },
  page: { width: "100%", maxWidth: 620, gap: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 2 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 29, lineHeight: 35, fontWeight: "700", color: "#234B3A" },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#DCEBDD", borderRadius: 18, borderWidth: 1, borderColor: "#C9DEC9", padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#FAFBF7", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#C9DEC9" },
  profileInfo: { flex: 1, minWidth: 0 },
  profileTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  profileCopy: { flex: 1, minWidth: 0 },
  profileLabel: { color: "#52715D", fontSize: 12, lineHeight: 17, fontWeight: "600", marginBottom: 1 },
  name: { fontSize: 20, lineHeight: 25, fontWeight: "800", color: "#234B3A", marginBottom: 1 },
  email: { fontSize: 13, lineHeight: 18, color: "#52665A" },
  collections: { gap: 10 },
  collectionHeading: { color: "#52715D", fontSize: 14, lineHeight: 19, fontWeight: "700", marginBottom: 1 },
  collectionCard: { minHeight: 76, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EDE0", flexDirection: "row", alignItems: "center", gap: 12 },
  collectionText: { flex: 1, minWidth: 0 },
  collectionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#E8EDDA", alignItems: "center", justifyContent: "center" },
  collectionTitle: { color: "#234B3A", fontSize: 15, lineHeight: 20, fontWeight: "700", marginBottom: 2 },
  collectionDescription: { color: "#6B7F73", fontSize: 12, lineHeight: 16 },
  logoutButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#FAFBF7", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#C9DEC9", flexShrink: 0 },
  legacyContent: { padding: 20, paddingBottom: 40 },
  legacyTitle: { flex: 1, fontSize: 28, fontWeight: "700", color: "#234B3A" },
  legacyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 24 },
  legacyProfileCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#E7F2E2", borderRadius: 18, padding: 20, marginBottom: 28 },
  legacyAvatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center", marginRight: 16 },
  legacyProfileInfo: { flex: 1 },
  legacyName: { fontSize: 20, fontWeight: "700", color: "#234B3A", marginBottom: 5 },
  legacyEmail: { fontSize: 14, color: "#5F7772" },
  legacySection: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2EDE0", overflow: "hidden", marginBottom: 24 },
  legacyOption: { flexDirection: "row", alignItems: "center", padding: 18, borderBottomWidth: 1, borderBottomColor: "#E2EDE0" },
  legacyIconContainer: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#E7F2E2", justifyContent: "center", alignItems: "center", marginRight: 14 },
  legacyOptionText: { flex: 1 },
  legacyOptionTitle: { fontSize: 16, fontWeight: "600", color: "#234B3A", marginBottom: 4 },
  legacyOptionSubtitle: { fontSize: 13, color: "#7A918C" },
  legacyLogoutButton: { flexDirection: "row", justifyContent: "center", alignItems: "center", minHeight: 44, backgroundColor: "#E7F2E2", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  legacyLogoutText: { fontSize: 13, fontWeight: "600", color: "#468585", marginLeft: 8 },
});
