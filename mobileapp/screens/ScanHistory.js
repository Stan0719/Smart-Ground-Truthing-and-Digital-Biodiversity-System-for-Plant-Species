import React, { useCallback, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { t, dateLocale, translateUIMessage, useAppTranslation } from "../translations/i18n";
import { fetchVisitorScanHistory } from "../utils/visitorFeatures";
import RefreshButton from "../components/RefreshButton";

export default function ScanHistoryScreen({ navigation, user }) {
  useAppTranslation();
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = await fetchVisitorScanHistory(user?.id);
      setScans(result);
    } catch (cause) {
      setError(cause?.message || "Unable to load scan history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { void load(false); }, [load]));
  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("scanHistory.dateUnavailable");
    return date.toLocaleString(dateLocale(), { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#468585" colors={["#468585"]} />}
      >
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("common.goBack")} style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#468585" />
          </TouchableOpacity>
          <Text style={styles.title}>{t("account.scanHistory")}</Text>
          <RefreshButton onPress={() => void load(true)} loading={loading || refreshing} label={t("common.refresh")} />
        </View>

        {!!error && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(error)}</Text>}
        {loading ? (
          <View style={styles.state}><Ionicons name="scan-outline" size={38} color="#77A68A" /><Text style={styles.stateText}>{t("scanHistory.loading")}</Text></View>
        ) : !error && scans.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="scan-outline" size={54} color="#91BFA0" />
            <Text style={styles.emptyTitle}>{t("scanHistory.noScanHistory")}</Text>
            <Text style={styles.stateText}>{t("scanHistory.plantsYouScanWillAppearHere")}</Text>
          </View>
        ) : scans.map((scan) => (
          <TouchableOpacity
            key={String(scan.scan_id)}
            accessibilityRole="button"
            disabled={!scan.plant?.plantId}
            activeOpacity={0.8}
            style={[styles.card, !scan.plant?.plantId && styles.disabledCard]}
            onPress={() => navigation.navigate("PlantDetails", { plantId: scan.plant.plantId })}
          >
            <View style={styles.imageFrame}>
              {scan.plant?.image ? <Image source={scan.plant.image} style={styles.image} resizeMode="cover" /> : <Ionicons name="leaf" size={27} color="#4F8065" />}
            </View>
            <View style={styles.copy}>
              <Text style={styles.commonName} numberOfLines={2}>{scan.plant?.commonName || scan.plant?.scientificName || t("favourites.unnamedRecord")}</Text>
              {!!scan.plant?.scientificName && <Text style={styles.scientificName} numberOfLines={1}>{scan.plant.scientificName}</Text>}
              <View style={styles.detailRow}><Ionicons name="qr-code-outline" size={14} color="#6D7F75" /><Text style={styles.detailText}>{scan.qrIdentifier}</Text></View>
              <View style={styles.detailRow}><Ionicons name="time-outline" size={14} color="#6D7F75" /><Text style={styles.detailText}>{formatDate(scan.scannedAt)}</Text></View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#91A89A" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 18, paddingBottom: 34 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#E7F2E2", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: "#234B3A", fontSize: 23, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2EDE0", padding: 14, marginBottom: 12, elevation: 1, shadowColor: "#234B3A", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  disabledCard: { opacity: 0.7 },
  imageFrame: { width: 76, height: 76, borderRadius: 13, backgroundColor: "#E5F0E1", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  copy: { flex: 1, minWidth: 0 },
  commonName: { color: "#234B3A", fontSize: 15, fontWeight: "700" },
  scientificName: { marginTop: 3, marginBottom: 4, color: "#6D7F75", fontSize: 12, fontStyle: "italic" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  detailText: { color: "#6D7F75", fontSize: 11, flexShrink: 1 },
  state: { minHeight: 230, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyTitle: { color: "#468585", fontSize: 18, fontWeight: "700", textAlign: "center" },
  stateText: { color: "#6D7F75", fontSize: 14, textAlign: "center" },
  error: { color: "#A52A3A", fontSize: 13, marginBottom: 12 },
});
