import React, { useCallback, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { t, dateLocale, translateUIMessage, useAppTranslation } from "../translations/i18n";
import { fetchVisitorFavouritePlantIds, fetchVisitorScanHistory } from "../utils/visitorFeatures";
import { calendarWeeks, filterAndSortScanHistory, formatDateKey, isCalendarDateSelected, localDateKey, shiftCalendarMonth } from "../utils/scanHistoryFilters";
import RefreshButton from "../components/RefreshButton";
import BackButton from "../components/BackButton";

const defaultDateFilter = () => ({ type: "all", value: null });
const weekdayKeys = (locale) => Array.from({ length: 7 }, (_, index) =>
  new Date(2026, 0, 5 + index).toLocaleDateString(locale, { weekday: "short" }));

function formatScanDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("scanHistory.dateUnavailable");
  const datePart = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart}, ${timePart}`;
}

export default function ScanHistoryScreen({ navigation, user }) {
  useAppTranslation();
  const accountId = user?.id;
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [failedImageUris, setFailedImageUris] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [dateFilter, setDateFilter] = useState(defaultDateFilter);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const favouritesOnlyRef = useRef(false);
  const [favouritePlantIds, setFavouritePlantIds] = useState(() => new Set());
  const [favouriteFilterLoading, setFavouriteFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [uniquePlantsOnly, setUniquePlantsOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState("newest");

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const result = await fetchVisitorScanHistory(accountId);
      setScans(result);
      if (favouritesOnlyRef.current) {
        try {
          setFavouritePlantIds(await fetchVisitorFavouritePlantIds(accountId));
          setFilterError("");
        } catch (cause) {
          setFilterError(cause?.message || "Unable to refresh favourite plants.");
        }
      }
    } catch (cause) {
      setError(cause?.message || "Unable to load scan history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId]);

  useFocusEffect(useCallback(() => { void load(false); }, [load]));
  const matchingScans = useMemo(() => filterAndSortScanHistory(scans, {
    search,
    dateFilter,
    favouritesOnly,
    favouritePlantIds,
    uniquePlantsOnly,
    sortOrder,
  }), [scans, search, dateFilter, favouritesOnly, favouritePlantIds, uniquePlantsOnly, sortOrder]);
  const activeFilterCount = Number(dateFilter.type !== "all") + Number(favouritesOnly) + Number(uniquePlantsOnly) + Number(sortOrder === "oldest");
  const dateLabel = dateFilter.type === "specific" ? formatDateKey(dateFilter.value) : dateFilter.type === "today" ? t("scanHistory.today")
    : dateFilter.type === "last7" ? t("scanHistory.last7Days") : dateFilter.type === "last30" ? t("scanHistory.last30Days") : t("scanHistory.allDates");
  const activeFilterSummary = [
    dateFilter.type !== "all" ? dateLabel : null,
    favouritesOnly ? t("scanHistory.favouritesOnly") : null,
    uniquePlantsOnly ? t("scanHistory.uniquePlantsOnly") : null,
    sortOrder === "oldest" ? t("scanHistory.oldestFirst") : null,
  ].filter(Boolean).join(" · ");
  const calendar = calendarWeeks(calendarMonth);
  const monthLabel = calendarMonth.toLocaleDateString(dateLocale(), { month: "long", year: "numeric" });
  const resetFilters = () => {
    setSearch("");
    setDateFilter(defaultDateFilter());
    setShowCalendar(false);
    setFavouritesOnly(false);
    favouritesOnlyRef.current = false;
    setUniquePlantsOnly(false);
    setSortOrder("newest");
    setFilterError("");
  };
  const toggleFavouritesOnly = async (enabled) => {
    setFilterError("");
    if (!enabled) {
      favouritesOnlyRef.current = false;
      setFavouritesOnly(false);
      return;
    }
    setFavouriteFilterLoading(true);
    try {
      const ids = await fetchVisitorFavouritePlantIds(accountId);
      setFavouritePlantIds(ids);
      favouritesOnlyRef.current = true;
      setFavouritesOnly(true);
    } catch (cause) {
      setFilterError(cause?.message || "Unable to load favourite plants.");
    } finally {
      setFavouriteFilterLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#468585" colors={["#468585"]} />}
      >
        <View style={styles.header}>
          <BackButton accessibilityLabel={t("common.goBack")} onPress={() => navigation.goBack()} />
          <Text style={styles.title}>{t("account.scanHistory")}</Text>
          <RefreshButton onPress={() => void load(true)} loading={loading || refreshing} label={t("common.refresh")} />
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={19} color="#648273" />
            <TextInput
              accessibilityLabel={t("scanHistory.searchScans")}
              placeholder={t("scanHistory.searchPlaceholder")}
              placeholderTextColor="#84968B"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {!!search && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("scanHistory.clearSearch")} style={styles.clearSearch} onPress={() => setSearch("")}><Ionicons name="close-circle" size={19} color="#81958A" /></TouchableOpacity>}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("scanHistory.filterScans")}
            accessibilityState={{ selected: activeFilterCount > 0 }}
            style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
            onPress={() => setFiltersOpen(true)}
          >
            <Ionicons name="options-outline" size={20} color={activeFilterCount > 0 ? "#FFFFFF" : "#3D735E"} />
            {activeFilterCount > 0 && <View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilterCount}</Text></View>}
          </TouchableOpacity>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.resultCount}>{t("scanHistory.matchingScans", { count: loading ? "—" : matchingScans.length })}</Text>
          {activeFilterCount > 0 && <Text style={styles.activeFilters} numberOfLines={1}>{activeFilterSummary}</Text>}
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
        ) : matchingScans.length === 0 ? (
          <View style={styles.state}>
            <Ionicons name="search-outline" size={48} color="#91BFA0" />
            <Text style={styles.emptyTitle}>{t("scanHistory.noMatchingScans")}</Text>
            <Text style={styles.stateText}>{t("scanHistory.adjustSearchOrFilters")}</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.resetEmptyButton} onPress={resetFilters}>
              <Text style={styles.resetEmptyText}>{t("scanHistory.resetFilters")}</Text>
            </TouchableOpacity>
          </View>
        ) : matchingScans.map((scan) => (
          <TouchableOpacity
            key={String(scan.scan_id)}
            accessibilityRole="button"
            disabled={!scan.plant?.plantId}
            activeOpacity={0.8}
            style={[styles.card, !scan.plant?.plantId && styles.disabledCard]}
            onPress={() => navigation.navigate("PlantDetails", { plantId: scan.plant.plantId })}
          >
            <View style={styles.imageFrame}>
              {scan.plant?.image?.uri && !failedImageUris.has(scan.plant.image.uri) ? (
                <Image
                  source={scan.plant.image}
                  style={styles.image}
                  resizeMode="cover"
                  onError={() => setFailedImageUris((current) => new Set(current).add(scan.plant.image.uri))}
                />
              ) : <Ionicons name="leaf" size={27} color="#4F8065" />}
            </View>
            <View style={styles.copy}>
              <Text style={styles.commonName} numberOfLines={2}>{scan.plant?.commonName || scan.plant?.scientificName || t("favourites.unnamedRecord")}</Text>
              {!!scan.plant?.scientificName && <Text style={styles.scientificName} numberOfLines={1}>{scan.plant.scientificName}</Text>}
              <View style={styles.detailRow}><Ionicons name="qr-code-outline" size={14} color="#6D7F75" /><Text style={styles.detailText}>{scan.qrIdentifier}</Text></View>
              <View style={styles.detailRow}><Ionicons name="time-outline" size={14} color="#6D7F75" /><Text style={styles.detailText}>{formatScanDate(scan.scannedAt)}</Text></View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#91A89A" />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("scanHistory.closeFilters")} style={styles.modalDismiss} onPress={() => setFiltersOpen(false)} />
          <SafeAreaView edges={["bottom"]} style={styles.filterSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t("scanHistory.filters")}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("scanHistory.closeFilters")} style={styles.closeButton} onPress={() => setFiltersOpen(false)}><Ionicons name="close" size={21} color="#456B58" /></TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>{t("scanHistory.date")}</Text>
              <View style={styles.dateChoices}>
                {[
                  ["all", t("scanHistory.allDates")], ["today", t("scanHistory.today")],
                  ["last7", t("scanHistory.last7Days")], ["last30", t("scanHistory.last30Days")],
                ].map(([type, label]) => (
                  <TouchableOpacity key={type} accessibilityRole="button" accessibilityState={{ selected: dateFilter.type === type }} style={[styles.dateChoice, dateFilter.type === type && styles.dateChoiceSelected]} onPress={() => { setDateFilter({ type, value: null }); setShowCalendar(false); }}>
                    <Text style={[styles.dateChoiceText, dateFilter.type === type && styles.dateChoiceTextSelected]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.datePickerRow}>
                <TouchableOpacity accessibilityRole="button" style={styles.selectDateButton} onPress={() => setShowCalendar((value) => !value)}>
                  <Ionicons name="calendar-outline" size={17} color="#3D735E" />
                  <Text style={styles.selectDateText}>{dateFilter.type === "specific" ? formatDateKey(dateFilter.value) : t("scanHistory.selectDate")}</Text>
                  <Ionicons name="chevron-down" size={15} color="#789184" />
                </TouchableOpacity>
                {dateFilter.type !== "all" && <TouchableOpacity accessibilityRole="button" style={styles.clearDateButton} onPress={() => { setDateFilter(defaultDateFilter()); setShowCalendar(false); }}><Text style={styles.clearDateText}>{t("scanHistory.clearDate")}</Text></TouchableOpacity>}
              </View>
              {showCalendar && (
                <View style={styles.calendar}>
                  <View style={styles.calendarHeader}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("scanHistory.previousMonth")} style={styles.calendarArrow} onPress={() => setCalendarMonth((month) => shiftCalendarMonth(month, -1))}><Ionicons name="chevron-back" size={18} color="#3D735E" /></TouchableOpacity>
                    <Text style={styles.monthLabel}>{monthLabel}</Text>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("scanHistory.nextMonth")} style={styles.calendarArrow} onPress={() => setCalendarMonth((month) => shiftCalendarMonth(month, 1))}><Ionicons name="chevron-forward" size={18} color="#3D735E" /></TouchableOpacity>
                  </View>
                  <View style={styles.calendarGrid}>
                    <View style={styles.calendarWeek}>
                      {weekdayKeys(dateLocale()).map((weekday, index) => <Text key={`weekday-${index}`} style={styles.weekday}>{weekday}</Text>)}
                    </View>
                    {calendar.map((week, weekIndex) => (
                      <View key={`week-${weekIndex}`} style={styles.calendarWeek}>
                        {week.map((dateKey, dayIndex) => {
                          if (!dateKey) return <View key={`blank-${weekIndex}-${dayIndex}`} style={styles.calendarDayCell} />;
                          const day = Number(dateKey.slice(-2));
                          const selected = isCalendarDateSelected(dateKey, dateFilter);
                          const today = dateKey === localDateKey(new Date());
                          return <TouchableOpacity key={dateKey} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={formatDateKey(dateKey)} style={[styles.calendarDayCell, selected && styles.calendarDaySelected, !selected && today && styles.calendarDayToday]} onPress={() => { setDateFilter({ type: "specific", value: dateKey }); setShowCalendar(false); }}><Text style={[styles.calendarDayText, selected && styles.calendarDaySelectedText]}>{day}</Text></TouchableOpacity>;
                        })}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.separator} />
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{t("scanHistory.favouritesOnly")}</Text><Text style={styles.toggleHint}>{t("favourites.plantsTab")}</Text></View>
                <Switch accessibilityLabel={t("scanHistory.favouritesOnly")} value={favouritesOnly} onValueChange={(value) => void toggleFavouritesOnly(value)} disabled={favouriteFilterLoading} trackColor={{ false: "#D7E2DA", true: "#93BE9D" }} thumbColor={favouritesOnly ? "#468585" : "#FFFFFF"} />
              </View>
              {favouriteFilterLoading && <Text style={styles.inlineHint}>{t("favourites.loading")}</Text>}
              {!!filterError && <Text accessibilityRole="alert" style={styles.filterError}>{translateUIMessage(filterError)}</Text>}
              <View style={styles.toggleRow}>
                <View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{t("scanHistory.uniquePlantsOnly")}</Text></View>
                <Switch accessibilityLabel={t("scanHistory.uniquePlantsOnly")} value={uniquePlantsOnly} onValueChange={setUniquePlantsOnly} trackColor={{ false: "#D7E2DA", true: "#93BE9D" }} thumbColor={uniquePlantsOnly ? "#468585" : "#FFFFFF"} />
              </View>
              <View style={styles.separator} />
              <Text style={styles.sectionLabel}>{t("scanHistory.sortOrder")}</Text>
              <View style={styles.sortChoices}>
                {[["newest", t("scanHistory.newestFirst")], ["oldest", t("scanHistory.oldestFirst")]].map(([value, label]) => (
                  <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{ selected: sortOrder === value }} style={[styles.sortChoice, sortOrder === value && styles.sortChoiceSelected]} onPress={() => setSortOrder(value)}><Text style={[styles.sortChoiceText, sortOrder === value && styles.sortChoiceTextSelected]}>{label}</Text></TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={styles.sheetFooter}>
              <TouchableOpacity accessibilityRole="button" style={styles.resetButton} onPress={resetFilters}><Text style={styles.resetButtonText}>{t("scanHistory.resetFilters")}</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.doneButton} onPress={() => setFiltersOpen(false)}><Text style={styles.doneButtonText}>{t("scanHistory.done")}</Text></TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 18, paddingBottom: 34 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  title: { flex: 1, color: "#234B3A", fontSize: 23, fontWeight: "700" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: -6, marginBottom: 5 },
  searchBox: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 14, borderWidth: 1, borderColor: "#DDE9DC", backgroundColor: "#FFFFFF" },
  searchInput: { flex: 1, minWidth: 0, color: "#234B3A", fontSize: 14, paddingVertical: 0 },
  clearSearch: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  filterButton: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: "#DDE9DC", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  filterButtonActive: { backgroundColor: "#468585", borderColor: "#468585" },
  filterCount: { position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#234B3A", alignItems: "center", justifyContent: "center" },
  filterCountText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  resultRow: { minHeight: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11 },
  resultCount: { color: "#688073", fontSize: 12, fontWeight: "600" },
  activeFilters: { flex: 1, color: "#468585", fontSize: 11, textAlign: "right" },
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
  resetEmptyButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, marginTop: 4, borderRadius: 12, backgroundColor: "#E7F2E2" },
  resetEmptyText: { color: "#3D735E", fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(23, 42, 32, 0.28)" },
  modalDismiss: { ...StyleSheet.absoluteFillObject },
  filterSheet: { maxHeight: "88%", backgroundColor: "#F8FBF6", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 16 },
  sheetHeader: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: "#E2EDE0" },
  sheetTitle: { color: "#234B3A", fontSize: 18, fontWeight: "700" },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  sectionLabel: { color: "#456B58", fontSize: 13, fontWeight: "700", marginBottom: 9 },
  dateChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateChoice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: "#DDE9DC", borderRadius: 12, backgroundColor: "#FFFFFF" },
  dateChoiceSelected: { backgroundColor: "#E4F0E4", borderColor: "#80A98B" },
  dateChoiceText: { color: "#61786B", fontSize: 12, fontWeight: "600" },
  dateChoiceTextSelected: { color: "#35674F" },
  datePickerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 11 },
  selectDateButton: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "#DDE9DC", backgroundColor: "#FFFFFF" },
  selectDateText: { flex: 1, color: "#3D735E", fontSize: 13, fontWeight: "600" },
  clearDateButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  clearDateText: { color: "#6D7F75", fontSize: 12, fontWeight: "600" },
  calendar: { width: "100%", maxWidth: 400, alignSelf: "center", marginTop: 12, padding: 11, borderRadius: 15, borderWidth: 1, borderColor: "#E2EDE0", backgroundColor: "#FFFFFF" },
  calendarHeader: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarArrow: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  monthLabel: { color: "#234B3A", fontSize: 14, fontWeight: "700" },
  calendarGrid: { width: "100%" },
  calendarWeek: { width: "100%", flexDirection: "row" },
  weekday: { flex: 1, minWidth: 0, height: 29, textAlign: "center", textAlignVertical: "center", color: "#87968D", fontSize: 10, fontWeight: "600" },
  calendarDayCell: { flex: 1, minWidth: 0, height: 44, marginVertical: 1, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  calendarDayToday: { borderWidth: 1, borderColor: "#9ABCA0" },
  calendarDaySelected: { backgroundColor: "#468585" },
  calendarDayText: { color: "#40594B", fontSize: 13 },
  calendarDaySelectedText: { color: "#FFFFFF", fontWeight: "700" },
  separator: { height: 1, backgroundColor: "#E2EDE0", marginVertical: 12 },
  toggleRow: { minHeight: 55, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  toggleCopy: { flex: 1 },
  toggleTitle: { color: "#355844", fontSize: 14, fontWeight: "600" },
  toggleHint: { marginTop: 2, color: "#829289", fontSize: 11 },
  inlineHint: { color: "#718679", fontSize: 11, marginBottom: 4 },
  filterError: { color: "#A52A3A", fontSize: 12, marginBottom: 5 },
  sortChoices: { flexDirection: "row", gap: 9 },
  sortChoice: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderWidth: 1, borderColor: "#DDE9DC", borderRadius: 12, backgroundColor: "#FFFFFF" },
  sortChoiceSelected: { backgroundColor: "#E4F0E4", borderColor: "#80A98B" },
  sortChoiceText: { color: "#61786B", fontSize: 12, fontWeight: "600", textAlign: "center" },
  sortChoiceTextSelected: { color: "#35674F" },
  sheetFooter: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#E2EDE0" },
  resetButton: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 13, borderWidth: 1, borderColor: "#D5E3D5", backgroundColor: "#FFFFFF" },
  resetButtonText: { color: "#46715C", fontSize: 13, fontWeight: "700" },
  doneButton: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#468585" },
  doneButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
});
