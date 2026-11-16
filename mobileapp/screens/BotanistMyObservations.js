import { useAppTranslation, t, translateLabel, translateUIMessage, formatDateTime } from "../translations/i18n";
import React, { useCallback, useRef, useState } from "react";
import { FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CardListSkeleton } from "../components/BotanicalSkeleton";
import { fetchMyObservations, observationHistoryRoute, observationMatchesFilter, observationStatusMatchesFilter, observationStatusSummary, withObservationPhotoSources } from "../utils/myObservations";
import { plantApi, plantAssetSources } from "../utils/plantApi";

const observationFilters = ["all", "pending", "approved", "rejected"];

function StatusBadge({ status, style }) {
  useAppTranslation();
  const tone = status === "Approved" ? styles.approvedBadge : ["Rejected", "Withdrawn"].includes(status) ? styles.rejectedBadge : styles.pendingBadge;
  return <View style={[styles.badge, tone, style]}>
    <Text style={[styles.badgeText, status === "Approved" && styles.approvedText, ["Rejected", "Withdrawn"].includes(status) && styles.rejectedText]}>{translateLabel(status)}</Text>
  </View>;
}

function ObservationThumbnail({ sources }) {
  useAppTranslation();
  const [photoIndex, setPhotoIndex] = useState(0);
  const source = sources?.[photoIndex];
  return source ? <Image source={source} style={styles.thumbnail} resizeMode="cover"
    accessibilityLabel={t("submissions.photo")} onError={() => setPhotoIndex((index) => index + 1)} />
    : <View style={styles.thumbnailPlaceholder}><Ionicons name="leaf-outline" size={25} color="#2F6B4F" /></View>;
}

export default function BotanistMyObservations({ navigation, user }) {
  useAppTranslation();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const accountId = user?.role?.toLowerCase() === "botanist" ? user.id : null;
  const [items, setItems] = useState([]);
  const [versionHistoryError, setVersionHistoryError] = useState(false);
  const [loading, setLoading] = useState(Boolean(accountId));
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const requestId = useRef(0);

  const load = useCallback(async (refresh = false) => {
    const currentRequest = ++requestId.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    if (!accountId) {
      setItems([]);
      setError(t("myObservations.botanistAccountRequired"));
      setLoading(false);
      setRefreshing(false);
      setLoaded(true);
      return;
    }
    try {
      const result = await fetchMyObservations(accountId, user?.name || user?.displayName, plantApi);
      if (currentRequest !== requestId.current) return;
      const observations = await withObservationPhotoSources(result.observations, accountId, plantAssetSources);
      if (currentRequest !== requestId.current) return;
      setItems(observations);
      setVersionHistoryError(result.versionHistoryError);
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : t("myObservations.loadFailed"));
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
        setLoaded(true);
      }
    }
  }, [accountId, user]);

  useFocusEffect(useCallback(() => {
    void load(false);
    return () => { requestId.current += 1; };
  }, [load]));

  const visibleItems = items.filter((item) => observationMatchesFilter(item, filter));
  const renderItem = ({ item }) => {
    const expanded = expandedId === item.id;
    const summary = observationStatusSummary(item);
    const summaryDetail = ["pendingEditOne", "pendingEditMany", "rejectedEditOne", "rejectedEditMany"].includes(summary.detailKey)
      ? t(`submissions.${summary.detailKey}`, { count: summary.count })
      : summary.detailKey === "currentEditSummary"
        ? t("submissions.currentEditSummary", { edit: t("recordEdits.editNumber", { number: summary.editNumber }) }) : "";
    const recordLabel = `${t("myObservations.observationId")} ${item.displayId || item.id}`;
    return <View testID={`observation-group-${item.id}`} style={styles.groupCard}>
      <TouchableOpacity testID={`observation-group-toggle-${item.id}`} style={styles.groupHeader} activeOpacity={0.78}
        accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={`${recordLabel}, ${t("submissions.plantId")} ${item.plantId}, ${item.plantName || t("myObservations.plantRecord")}, ${t(item.historyRows.length === 1 ? "submissions.oneVersion" : "submissions.versionCount", { count: item.historyRows.length })}`}
        accessibilityHint={t("submissions.viewVersions")} onPress={() => setExpandedId(expanded ? null : item.id)}>
        <View style={styles.groupTop}>
          <ObservationThumbnail key={item.thumbnailSources?.map((source) => source.uri).join("|") || "none"} sources={item.thumbnailSources} />
          <View style={styles.recordInfo}>
            <Text style={styles.recordType}>{recordLabel}</Text>
            <Text style={styles.scientificName} numberOfLines={2}>{item.scientificName || item.plantName || t("myObservations.plantRecord")}</Text>
            {!!item.plantName && item.plantName !== item.scientificName && <Text style={styles.commonName} numberOfLines={2}>{item.plantName}</Text>}
            <Text style={styles.versionCount}>{t(item.historyRows.length === 1 ? "submissions.oneVersion" : "submissions.versionCount", { count: item.historyRows.length })} · {t("submissions.plantId")} {item.plantId}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={21} color="#2F6B4F" />
        </View>
        <View style={styles.groupSummary}>
          {!!summary.status && <StatusBadge status={summary.status} />}
          {!!summaryDetail && <Text style={styles.groupSummaryDetail} numberOfLines={1}>{summaryDetail}</Text>}
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.versionList}>
        {item.historyRows.map((row) => {
          const title = row.original ? t("recordEdits.originalLabel") : t("recordEdits.editNumber", { number: row.editNumber ?? row.versionNumber });
          return <TouchableOpacity key={row.key} testID={`observation-version-${item.id}-${row.key}`} style={[styles.versionRow, observationStatusMatchesFilter(row.status, filter) && filter !== "all" && styles.matchingVersionRow]}
            activeOpacity={0.78} accessibilityRole="button"
            accessibilityLabel={`${title}, ${translateLabel(row.status)}, ${formatDateTime(row.createdAt)}`}
            onPress={() => navigation.navigate(...observationHistoryRoute(item, row))}>
            <View style={styles.versionRowMain}>
              <Text style={styles.versionRowTitle}>{title}</Text>
              {!!row.createdAt && <Text style={styles.versionRowDate}>{t("submissions.submitted")}: {formatDateTime(row.createdAt)}</Text>}
            </View>
            <View style={styles.versionRowBadges}>
              {!!row.status && <StatusBadge status={row.status} />}
              {row.current && <View style={[styles.versionBadge, styles.currentVersionBadge]}><Text style={styles.currentVersionText}>{t("recordEdits.currentVersionLabel")}</Text></View>}
              {row.superseded && <View style={[styles.versionBadge, styles.supersededVersionBadge]}><Text style={styles.supersededVersionText}>{t("recordEdits.supersededLabel")}</Text></View>}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#718078" />
          </TouchableOpacity>;
        })}
      </View>}
    </View>;
  };

  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}><FlatList
    style={styles.screen}
    contentContainerStyle={[styles.content, tablet && styles.tabletContent, !visibleItems.length && styles.emptyContent]}
    data={visibleItems}
    keyExtractor={(item) => item.id}
    renderItem={renderItem}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void load(true); }} tintColor="#2F6B4F" colors={["#2F6B4F"]} />}
    ListHeaderComponent={<View style={styles.pageHeaderContent}>
      <View style={styles.pageHeading}><Text style={styles.pageTitle}>{t("myObservations.title")}</Text></View>
      <View style={styles.filters} accessibilityRole="tablist">{observationFilters.map((value) => <TouchableOpacity key={value}
        testID={`observations-filter-${value}`} accessibilityRole="button" accessibilityState={{ selected: filter === value }}
        onPress={() => setFilter(value)} style={[styles.filterChip, filter === value && styles.selectedFilter]}>
        <Text style={[styles.filterLabel, filter === value && styles.selectedFilterLabel]}>{t(`submissions.${value}`)}</Text>
      </TouchableOpacity>)}</View>
      {versionHistoryError && <Text style={styles.inlineNotice}>{t("myObservations.historyUnavailable")}</Text>}
      {!!error && items.length > 0 && <View style={styles.inlineError}><Text style={styles.errorText}>{translateUIMessage(error)}</Text><TouchableOpacity onPress={() => { void load(true); }} accessibilityRole="button"><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    </View>}
    ListEmptyComponent={loading ? <CardListSkeleton label={t("myObservations.loading")} count={3} />
      : error ? <View style={styles.state}><Ionicons name="cloud-offline-outline" size={30} color="#B84F43" /><Text style={styles.errorText}>{translateUIMessage(error)}</Text><TouchableOpacity style={styles.retry} onPress={() => { void load(true); }} accessibilityRole="button"><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>
        : loaded ? <View style={styles.state}><Ionicons name="leaf-outline" size={32} color="#86A88E" /><Text style={styles.emptyTitle}>{items.length ? t("submissions.noMatchingRecords") : t("myObservations.noObservations")}</Text><Text style={styles.muted}>{items.length ? t("submissions.emptyHint") : t("myObservations.noObservationsHint")}</Text></View> : null}
    showsVerticalScrollIndicator={false}
  /></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FAFBF7" },
  content: { paddingHorizontal: 14, paddingBottom: 28, width: "100%", alignSelf: "center" },
  tabletContent: { maxWidth: 1000, paddingHorizontal: 24 },
  emptyContent: { flexGrow: 1 },
  pageHeaderContent: { width: "100%", maxWidth: 952, alignSelf: "center", paddingTop: 8 },
  pageHeading: { marginBottom: 18 },
  pageTitle: { color: "#2F6B4F", fontSize: 24, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  filterChip: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE8D6", minHeight: 40 },
  selectedFilter: { backgroundColor: "#DCEBDD", borderColor: "#2F6B4F" },
  filterLabel: { color: "#718078", fontSize: 12 },
  selectedFilterLabel: { color: "#2F6B4F", fontWeight: "700" },
  inlineNotice: { marginBottom: 10, color: "#86652E", fontSize: 12, lineHeight: 18 },
  inlineError: { marginTop: 10, marginBottom: 10, padding: 11, borderRadius: 12, backgroundColor: "#FCEEEB", gap: 8 },
  groupCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: "#DCEBDD", shadowColor: "#2F6B4F", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  groupHeader: { gap: 10 },
  groupTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  thumbnail: { width: 58, height: 68, borderRadius: 12 },
  thumbnailPlaceholder: { width: 58, height: 68, borderRadius: 12, backgroundColor: "#D5EEDC", alignItems: "center", justifyContent: "center" },
  recordInfo: { flex: 1, minWidth: 0, paddingRight: 8 },
  recordType: { color: "#2F6B4F", fontSize: 11, fontWeight: "700", marginBottom: 5 },
  scientificName: { fontSize: 15, fontWeight: "700", fontStyle: "italic", color: "#2F6B4F", flexShrink: 1 },
  commonName: { marginTop: 3, fontSize: 13, color: "#6D7F75", flexShrink: 1 },
  versionCount: { marginTop: 5, color: "#718078", fontSize: 11, fontWeight: "600" },
  groupSummary: { minHeight: 28, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: "#EFF3ED" },
  groupSummaryDetail: { flexShrink: 1, color: "#52665A", fontSize: 12, fontWeight: "600" },
  badge: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 },
  pendingBadge: { backgroundColor: "#F5EBD6" },
  badgeText: { color: "#77501D", fontSize: 10, fontWeight: "700" },
  approvedBadge: { backgroundColor: "#D5EEDC" },
  approvedText: { color: "#2F6B4F" },
  rejectedBadge: { backgroundColor: "#FCE2E2" },
  rejectedText: { color: "#B84444" },
  versionList: { marginTop: 10, gap: 7 },
  versionRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, backgroundColor: "#F7FAF5", borderWidth: 1, borderColor: "#E7EEE3" },
  matchingVersionRow: { backgroundColor: "#E8F2E8", borderColor: "#88AC8D" },
  versionRowMain: { flex: 1, minWidth: 85 },
  versionRowTitle: { color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
  versionRowDate: { color: "#718078", fontSize: 10, marginTop: 4 },
  versionRowBadges: { maxWidth: "55%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  versionBadge: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 },
  currentVersionBadge: { backgroundColor: "#2F6B4F" },
  currentVersionText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  supersededVersionBadge: { backgroundColor: "#ECEFED" },
  supersededVersionText: { color: "#66736A", fontSize: 10, fontWeight: "700" },
  state: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: 10, padding: 22 },
  emptyTitle: { color: "#2F6B4F", fontSize: 17, fontWeight: "700", textAlign: "center" },
  muted: { color: "#718078", fontSize: 13, lineHeight: 19, textAlign: "center" },
  errorText: { color: "#A34740", fontSize: 14, textAlign: "center", lineHeight: 21 },
  retry: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: "#E2F0E4", justifyContent: "center" },
  retryText: { color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
});
