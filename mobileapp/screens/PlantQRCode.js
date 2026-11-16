import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
// PlantQRCode.js

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
  RefreshControl,
  Platform,
} from "react-native";

import QRCode from "react-native-qrcode-svg";
import Ionicons from "@expo/vector-icons/Ionicons";

import * as Print from "expo-print";

import { plantApi } from "../utils/plantApi";
import RefreshButton from "../components/RefreshButton";

import { createQRInventoryLoader, emptyQRInventory } from "../utils/qrInventory";
import { A4_PRINT_OPTIONS, buildQRPrintHtml } from "../utils/qrPrint";


export default function PlantQRCodeScreen({ route }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const [numberOfCodes, setNumberOfCodes] = useState("3");
  const [activeTab, setActiveTab] = useState("unused");
  const [expandedQrId, setExpandedQrId] = useState(null);
  const [inventory, setInventory] = useState(emptyQRInventory);
  const [generating, setGenerating] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const generatingRef = useRef(false);
  const printingRef = useRef(false);
  const deletingRef = useRef(false);
  const focusedRef = useRef(false);
  const loader = useMemo(() => createQRInventoryLoader(
    () => plantApi("/qr-codes", { expectedAccountId: accountId }),
    setInventory,
  ), [accountId]);
  const { records: plantQRCodes, loading: loadingRecords, hasLoaded, error: loadError } = inventory;
  const availableQRCodes = plantQRCodes.filter((qr) => !qr.plantId && qr.status === "generated");
  const assignedQRCodes = plantQRCodes.filter((qr) => qr.status !== "retired" && (Boolean(qr.plantId) || qr.status === "assigned" || qr.status === "active"));
  const activeQRCodesCount = availableQRCodes.length + assignedQRCodes.length;
  const visibleQRCodes = activeTab === "assigned" ? assignedQRCodes : availableQRCodes;
  const loadingPrint = printingId !== null;

  const loadPlantQRCodes = useCallback(() => {
    if (generatingRef.current) return Promise.resolve(false);
    return loader.refresh();
  }, [loader]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadPlantQRCodes();
      return () => {
        focusedRef.current = false;
        loader.cancel();
      };
    }, [loader, loadPlantQRCodes]),
  );

  async function handleGenerate() {
    if (generatingRef.current || loader.getState().loading) return;
    const count = Number(numberOfCodes);
    if (!Number.isInteger(count) || count < 1 || count > 3) {
      Alert.alert(t("plantQRCode.invalidNumber"), t("plantQRCode.generateBetween1And3QrCodesAtATime"));
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    try {
      const result = await plantApi("/qr-codes", {
        method: "POST",
        body: { count },
        expectedAccountId: accountId,
      });
      if (!focusedRef.current) return;
      // Keep confirmed creations visible even if the following refresh fails.
      const generated = loader.addGenerated(result);
      setActiveTab("unused");
      setExpandedQrId(null);
      await loader.refresh();
      if (focusedRef.current) Alert.alert(t("plantQRCode.qrCodesGenerated"), t("plantQRCode.generatedReady", { count: generated }));
    } catch (error) {
      if (focusedRef.current) Alert.alert(t("plantQRCode.qrGenerationFailed"), error instanceof Error ? translateUIMessage(error.message) : t("plantQRCode.couldNotGenerateQrCodesRefreshBeforeTryingAgain"));
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function printCodes(records, id) {
    if (printingRef.current) return;
    if (Platform.OS === "web") {
      Alert.alert(t("plantQRCode.printQrTags"), t("plantQRCode.openThisPageInTheMobileAppToPrintThe"));
      return;
    }
    if (!records.length) {
      Alert.alert(t("plantQRCode.noQrCodes"), t("plantQRCode.generateAnUnusedQrCodeBeforePrinting"));
      return;
    }
    printingRef.current = true;
    setPrintingId(id);
    try {
      const pages = [];
      for (const qr of records) {
        pages.push({ qr });
      }
      await Print.printAsync({ ...A4_PRINT_OPTIONS, html: buildQRPrintHtml(pages, {
        park: t("qrPrint.park"), plant: t("qrPrint.plant"),
        tag: t("qrPrint.tag"), instruction: t("qrPrint.instruction"),
      }) });
    } catch (error) {
      // Closing the iOS print dialog is a normal cancellation.
      if (!/cancel/i.test(String(error?.code || "") + " " + String(error?.message || ""))) {
        Alert.alert(t("plantQRCode.unableToPrint"), t("plantQRCode.thePrintWorkflowCouldNotFinishCheckYourPrinterConnection"));
      }
    } finally {
      printingRef.current = false;
      setPrintingId(null);
    }
  }

  const handlePrintQR = (qr) => printCodes([qr], qr.id);
  const handlePrintAll = () => printCodes(availableQRCodes, "all");
  async function deleteQR(qr) {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingId(qr.id);
    try {
      await plantApi(`/qr-codes/${encodeURIComponent(qr.id)}`, {
        method: "DELETE",
        body: {},
        expectedAccountId: accountId,
      });
      loader.retire(qr.id);
      setExpandedQrId(null);
      await loader.refresh();
      if (focusedRef.current) {
        Alert.alert(t("plantQRCode.qrCodeDeleted"), t("plantQRCode.qrCodeDeletedMessage", { label: qr.label }));
      }
    } catch (error) {
      await loader.refresh();
      if (focusedRef.current) {
        Alert.alert(t("plantQRCode.qrCodeDeleteFailed"), translateUIMessage(error instanceof Error ? error.message : "Could not delete this QR code."));
      }
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }
  function confirmDeleteQR(qr) {
    Alert.alert(
      t("plantQRCode.confirmDeleteQrCodeTitle"),
      t("plantQRCode.confirmDeleteQrCodeMessage", { label: qr.label }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: () => { void deleteQR(qr); } },
      ],
    );
  }

  const tabs = [
    { key: "unused", label: t("plantQRCode.unused"), count: availableQRCodes.length },
    { key: "assigned", label: t("plantQRCode.assigned"), count: assignedQRCodes.length },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={hasLoaded && loadingRecords}
            onRefresh={loadPlantQRCodes}
            enabled={!generating}
            tintColor="#468585"
            colors={["#468585"]}
          />
        }
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageDescription}>{t("plantQRCode.pageDescription")}</Text>
        </View>

        <View style={styles.summaryRow}>
          {[
            { key: "total", label: t("plantQRCode.totalCodes"), count: activeQRCodesCount },
            { key: "unused", label: t("plantQRCode.unusedCodes"), count: availableQRCodes.length },
            { key: "assigned", label: t("plantQRCode.assignedCodes"), count: assignedQRCodes.length },
          ].map((item) => (
            <View key={item.key} style={styles.summaryCard}>
              <Text style={styles.summaryCount}>{hasLoaded ? item.count : "—"}</Text>
              <Text style={styles.summaryLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.generateHeading}>
            <View style={styles.generateIcon}><Ionicons name="qr-code-outline" size={21} color="#2F6B4F" /></View>
            <View style={styles.generateCopy}>
              <Text style={styles.cardTitle}>{t("plantQRCode.generateQrCodes")}</Text>
              <Text style={styles.cardDescription}>{t("plantQRCode.generateDescription")}</Text>
            </View>
          </View>
          <View style={styles.generateRow}>
            <View style={styles.quantityField}>
              <Text style={styles.inputLabel}>{t("plantQRCode.quantity")}</Text>
              <TextInput
                style={styles.numberInput}
                value={numberOfCodes}
                onChangeText={setNumberOfCodes}
                keyboardType="number-pad"
                maxLength={1}
                accessibilityLabel={t("plantQRCode.numberOfQrCodesToGenerate")}
              />
            </View>
            <TouchableOpacity
              style={[styles.generateButton, (loadingRecords || generating) && styles.disabledButton]}
              accessibilityRole="button"
              accessibilityLabel={t("plantQRCode.generate")}
              accessibilityState={{ disabled: loadingRecords || generating, busy: generating }}
              onPress={handleGenerate}
              disabled={loadingRecords || generating}
              activeOpacity={0.8}
            >
              {generating ? <ActivityIndicator color="#FFFFFF" /> : <>
                <Ionicons name="add" size={20} color="#FFFFFF" />
                <Text style={styles.generateButtonText}>{t("plantQRCode.generate")}</Text>
              </>}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.inventoryHeader}>
            <View style={styles.inventoryHeading}>
              <Text style={styles.cardTitle}>{t("plantQRCode.qrCodeInventory")}</Text>
              {hasLoaded && <Text style={styles.inventoryTotal}>{t("plantQRCode.totalCodes")}: {activeQRCodesCount}</Text>}
            </View>
            <RefreshButton
              onPress={loadPlantQRCodes}
              loading={loadingRecords || generating}
              label={t("plantQRCode.refreshQrCodes")}
            />
          </View>

          {!!loadError && (
            <View style={styles.errorNotice} accessibilityRole="alert">
              <Text style={styles.errorTitle}>{hasLoaded ? t("plantQRCode.couldNotRefreshQrCodes") : t("plantQRCode.couldNotLoadQrCodes")}</Text>
              <Text style={styles.errorText}>{translateUIMessage(loadError)}</Text>
              {hasLoaded && <Text style={styles.errorText}>{t("plantQRCode.showingYourLastSuccessfullyLoadedRecords")}</Text>}
            </View>
          )}

          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tab, selected && styles.selectedTab]}
                  onPress={() => { setActiveTab(tab.key); setExpandedQrId(null); }}
                  activeOpacity={0.8}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                >
                  <Text numberOfLines={1} style={[styles.tabText, selected && styles.selectedTabText]}>{tab.label}</Text>
                  <Text style={[styles.tabCount, selected && styles.selectedTabText]}>{hasLoaded ? tab.count : "—"}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {!hasLoaded && loadingRecords ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#468585" />
              <Text style={styles.emptyStateText}>{t("plantQRCode.loadingYourPlantQrCodes")}</Text>
            </View>
          ) : hasLoaded && visibleQRCodes.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="qr-code-outline" size={25} color="#789083" />
              <Text style={styles.emptyStateTitle}>
                {activeTab === "unused"
                  ? plantQRCodes.length ? t("plantQRCode.noUnusedQrCodes") : t("plantQRCode.noQrCodesYet")
                  : t("plantQRCode.noAssignedQrCodes")}
              </Text>
              {activeTab === "unused" && <Text style={styles.emptyStateText}>{t("plantQRCode.generateCodesAboveToPrintThemBeforeYourFieldVisit")}</Text>}
            </View>
          ) : (
            <View style={styles.codeList}>
              {visibleQRCodes.map((qr) => {
                const expanded = expandedQrId === qr.id;
                const unused = !qr.plantId && qr.status === "generated";
                const statusLabel = unused ? t("plantQRCode.unused") : t("plantQRCode.assigned");
                const subtitle = unused
                  ? t("plantQRCode.availableForAssignment")
                  : qr.plantName || (qr.plantId ? t("plantQRCode.plant", { plantId: qr.plantId }) : t("plantQRCode.notAssignedToAPlant"));
                return (
                  <View key={qr.id} style={[styles.qrCard, expanded && styles.expandedQrCard]}>
                    <TouchableOpacity
                      style={styles.qrCardHeader}
                      onPress={() => setExpandedQrId(expanded ? null : qr.id)}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                      accessibilityLabel={`${expanded ? t("plantQRCode.collapseQrCode") : t("plantQRCode.expandQrCode")} ${qr.label}, ${statusLabel}`}
                      accessibilityState={{ expanded }}
                    >
                      <View style={styles.qrInfo}>
                        <Text style={styles.qrId} numberOfLines={1} selectable>{qr.label}</Text>
                        <Text style={styles.qrSubtitle} numberOfLines={2}>{subtitle}</Text>
                      </View>
                      <View style={[styles.statusBadge, unused ? styles.unusedBadge : styles.assignedBadge]}>
                        <Text style={styles.statusText}>{statusLabel}</Text>
                      </View>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={19} color="#5F7F70" />
                    </TouchableOpacity>

                    {expanded && (
                      <View style={styles.expandedContent}>
                        <View style={styles.qrPreview}>
                          <QRCode value={qr.value} size={100} quietZone={20} backgroundColor="#FFFFFF" color="#000000" />
                        </View>
                        <View style={styles.qrActions}>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.printButton, loadingPrint && styles.disabledButton]}
                            onPress={() => handlePrintQR(qr)}
                            disabled={loadingPrint}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={t("plantQRCode.print", { label: qr.label })}
                            accessibilityState={{ disabled: loadingPrint, busy: printingId === qr.id }}
                          >
                            {printingId === qr.id ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="print-outline" size={17} color="#FFFFFF" />}
                            <Text style={styles.actionButtonText}>{t("plantQRCode.printAction")}</Text>
                          </TouchableOpacity>
                          {unused && <TouchableOpacity
                            style={[styles.actionButton, styles.deleteButton, (loadingRecords || generating || deletingId !== null) && styles.disabledButton]}
                            onPress={() => confirmDeleteQR(qr)}
                            disabled={loadingRecords || generating || deletingId !== null}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={t("plantQRCode.deleteQrCode", { label: qr.label })}
                            accessibilityState={{ disabled: loadingRecords || generating || deletingId !== null, busy: deletingId === qr.id }}
                          >
                            {deletingId === qr.id ? <ActivityIndicator size="small" color="#A34740" /> : <Ionicons name="trash-outline" size={17} color="#A34740" />}
                            <Text style={styles.deleteButtonText}>{t("plantQRCode.deleteAction")}</Text>
                          </TouchableOpacity>}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

              {activeTab === "unused" && availableQRCodes.length > 0 && <TouchableOpacity
                style={[styles.printAllButton, loadingPrint && styles.disabledButton]}
                onPress={handlePrintAll}
                disabled={loadingPrint}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t("plantQRCode.printAllUnusedQrCodes")}
              >
                {printingId === "all" ? <ActivityIndicator color="#FFFFFF" /> : <>
                  <Ionicons name="print-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.printAllText}>{t("plantQRCode.printAllUnusedQrCodes")}</Text>
                </>}
              </TouchableOpacity>}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FBF4" },
  scrollContent: { width: "100%", maxWidth: 960, alignSelf: "center", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 12 },
  pageHeader: { paddingHorizontal: 2, paddingBottom: 1 },
  pageDescription: { color: "#63776D", fontSize: 13, lineHeight: 19 },

  summaryRow: { flexDirection: "row", gap: 8 },
  summaryCard: { flex: 1, minWidth: 0, minHeight: 76, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 10, borderWidth: 1, borderColor: "#E0EAE1", borderRadius: 14, backgroundColor: "#FFFFFF" },
  summaryCount: { color: "#234B3A", fontSize: 21, lineHeight: 26, fontWeight: "800" },
  summaryLabel: { marginTop: 3, color: "#63776D", fontSize: 10, lineHeight: 14, fontWeight: "600" },

  card: { padding: 16, borderWidth: 1, borderColor: "#E0EAE1", borderRadius: 16, backgroundColor: "#FFFFFF" },
  cardTitle: { color: "#234B3A", fontSize: 16, lineHeight: 21, fontWeight: "700" },
  cardDescription: { marginTop: 3, color: "#63776D", fontSize: 12, lineHeight: 17 },
  generateHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  generateIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#E9F7E4" },
  generateCopy: { flex: 1, minWidth: 0 },
  generateRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: 14 },
  quantityField: { width: 78, gap: 5 },
  inputLabel: { color: "#52665A", fontSize: 11, fontWeight: "600" },
  numberInput: { width: 72, minHeight: 48, borderWidth: 1, borderColor: "#D6E5D0", borderRadius: 11, paddingHorizontal: 12, fontSize: 16, color: "#234B3A", backgroundColor: "#FAFDF9", textAlign: "center" },
  generateButton: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 14, borderRadius: 11, backgroundColor: "#2F6B4F" },
  generateButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  disabledButton: { opacity: 0.52 },

  inventoryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  inventoryHeading: { flex: 1, minWidth: 0 },
  inventoryTotal: { marginTop: 3, color: "#718078", fontSize: 11 },
  errorNotice: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: "#F2D6BC", borderRadius: 12, backgroundColor: "#FFF8EF" },
  errorTitle: { marginBottom: 4, color: "#87562F", fontSize: 13, fontWeight: "700" },
  errorText: { color: "#785F4B", fontSize: 12, lineHeight: 18 },
  tabs: { flexDirection: "row", gap: 6, marginTop: 14, padding: 4, borderRadius: 13, backgroundColor: "#F1F6F2" },
  tab: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 5, borderRadius: 10 },
  selectedTab: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE8D6" },
  tabText: { flexShrink: 1, color: "#63776D", fontSize: 11, fontWeight: "600" },
  tabCount: { color: "#718078", fontSize: 10, fontWeight: "700" },
  selectedTabText: { color: "#2F6B4F" },
  codeList: { gap: 8, marginTop: 10 },
  qrCard: { overflow: "hidden", borderWidth: 1, borderColor: "#E1EAE4", borderRadius: 13, backgroundColor: "#FFFFFF" },
  expandedQrCard: { borderColor: "#BFD8C6" },
  qrCardHeader: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12, paddingVertical: 10 },
  qrInfo: { flex: 1, minWidth: 0 },
  qrId: { color: "#234A3C", fontSize: 14, lineHeight: 19, fontWeight: "700" },
  qrSubtitle: { marginTop: 3, color: "#6B7C73", fontSize: 11, lineHeight: 16 },
  statusBadge: { maxWidth: "34%", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9 },
  unusedBadge: { backgroundColor: "#FFF3D6" },
  assignedBadge: { backgroundColor: "#DEF2E5" },
  statusText: { color: "#426454", fontSize: 10, lineHeight: 13, fontWeight: "700" },
  expandedContent: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 12, padding: 12, borderTopWidth: 1, borderTopColor: "#EAF0E6", backgroundColor: "#FCFDFC" },
  qrPreview: { width: 120, height: 120, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E3EBE3", borderRadius: 12, backgroundColor: "#FFFFFF" },
  qrActions: { flex: 1, minWidth: 132, flexDirection: "row", gap: 7 },
  actionButton: { flex: 1, minWidth: 62, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 6, borderWidth: 1, borderRadius: 10 },
  printButton: { borderColor: "#2F6B4F", backgroundColor: "#2F6B4F" },
  deleteButton: { borderColor: "#EDD1CC", backgroundColor: "#FFF2F0" },
  actionButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  deleteButtonText: { color: "#A34740", fontSize: 11, fontWeight: "700" },
  printAllButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 2, paddingHorizontal: 12, borderRadius: 11, backgroundColor: "#2F6B4F" },
  printAllText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },

  emptyState: { minHeight: 128, alignItems: "center", justifyContent: "center", gap: 7, marginTop: 10, padding: 18, borderWidth: 1, borderStyle: "dashed", borderColor: "#DCE8D6", borderRadius: 12, backgroundColor: "#FAFCFA" },
  emptyStateTitle: { color: "#426454", fontSize: 14, fontWeight: "700", textAlign: "center" },
  emptyStateText: { color: "#718078", fontSize: 12, lineHeight: 17, textAlign: "center" },
});
