import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
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
import QRRefreshButton from "../components/QRRefreshButton";

import { createQRInventoryLoader, emptyQRInventory } from "../utils/qrInventory";
import { buildQRPrintHtml, qrImageData } from "../utils/qrPrint";


export default function PlantQRCodeScreen({ route }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const [numberOfCodes, setNumberOfCodes] = useState("3");
  const [inventory, setInventory] = useState(emptyQRInventory);
  const [generating, setGenerating] = useState(false);
  const [printingId, setPrintingId] = useState(null);
  const generatingRef = useRef(false);
  const printingRef = useRef(false);
  const focusedRef = useRef(false);
  const qrImages = useRef(new Map());
  const loader = useMemo(() => createQRInventoryLoader(
    () => plantApi("/qr-codes", { expectedAccountId: accountId }),
    setInventory,
  ), [accountId]);
  const { records: plantQRCodes, loading: loadingRecords, hasLoaded, error: loadError } = inventory;
  const availableQRCodes = plantQRCodes.filter((qr) => qr.status === "generated" && !qr.plantId);
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
        const rendered = qrImages.current.get(qr.id);
        if (rendered?.value !== qr.value) throw Error("QR image is not ready. Please try again.");
        pages.push({ qr, image: await qrImageData(rendered.svg) });
      }
      await Print.printAsync({ html: buildQRPrintHtml(pages, {
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

  function getStatusText(status) {
    return ({
      generated: "Available to print",
      assigned: "Assigned to plant",
      active: "Active",
      retired: "Retired",
    })[status] || status || "Status unavailable";
  }


  function getStatusStyle(status) {
    switch (status) {
      case "active":
        return styles.approvedBadge;
      case "generated":
      case "assigned":
        return styles.pendingBadge;
      case "retired":
        return styles.rejectedBadge;
      default:
        return styles.availableBadge;
    }
  }


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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("plantQRCode.generateQrCodes")}</Text>
          <Text style={styles.sectionDescription}>{t("plantQRCode.createPrintableCodesNowThenChooseOneWhenYouRegister")}</Text>
          <View style={styles.generateRow}>
            <TextInput
              style={styles.numberInput}
              value={numberOfCodes}
              onChangeText={setNumberOfCodes}
              keyboardType="number-pad"
              maxLength={1}
              accessibilityLabel={t("plantQRCode.numberOfQrCodesToGenerate")}
            />
            <TouchableOpacity
              style={[styles.generateButton, (loadingRecords || generating) && styles.disabledButton]}
              accessibilityRole="button"
              accessibilityState={{ disabled: loadingRecords || generating, busy: generating }}
              onPress={handleGenerate}
              disabled={loadingRecords || generating}
              activeOpacity={0.8}
            >
              {generating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.generateButtonText}>{t("plantQRCode.generate")}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderContent}>
              <Text style={styles.sectionTitle}>{t("plantQRCode.qrCodeInventory")}</Text>
              <Text style={styles.sectionDescription}>{t("plantQRCode.printUnusedTagsForYourFieldVisitOrReprintAn")}</Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{hasLoaded ? plantQRCodes.length : "—"}</Text>
            </View>
          </View>

          <QRRefreshButton
            style={styles.refreshSpacing}
            onPress={loadPlantQRCodes}
            loading={loadingRecords || generating}
            label={t("plantQRCode.refreshQrCodes")}
          />
          {plantQRCodes.length === 500 && (
            <Text style={styles.inventoryLimit}>{t("plantQRCode.showingTheLatest500QrCodes")}</Text>
          )}

          {!!loadError && (
            <View style={styles.errorNotice} accessibilityRole="alert">
              <Text style={styles.errorTitle}>{hasLoaded ? t("plantQRCode.couldNotRefreshQrCodes") : t("plantQRCode.couldNotLoadQrCodes")}</Text>
              <Text style={styles.errorText}>{translateUIMessage(loadError)}</Text>
              {hasLoaded && <Text style={styles.errorText}>{t("plantQRCode.showingYourLastSuccessfullyLoadedRecords")}</Text>}
            </View>
          )}

          {!hasLoaded && loadingRecords ? (
            <View style={styles.emptyQR}>
              <ActivityIndicator color="#468585" />
              <Text style={styles.emptyQRText}>{t("plantQRCode.loadingYourPlantQrCodes")}</Text>
            </View>
          ) : hasLoaded && !loadError && plantQRCodes.length === 0 ? (
            <View style={styles.emptyQR}>
              <Text style={styles.emptyQRTitle}>{t("plantQRCode.noQrCodesYet")}</Text>
              <Text style={styles.emptyQRText}>{t("plantQRCode.generateCodesAboveToPrintThemBeforeYourFieldVisit")}</Text>
            </View>
          ) : plantQRCodes.length > 0 ? (
            <View>
              {plantQRCodes.map((qr) => (
                <View key={qr.id} style={styles.qrCard}>
                  <View style={styles.qrDetails}>
                    <View style={styles.qrPreview}>
                      <QRCode
                        value={qr.value}
                        size={96}
                        quietZone={20}
                        backgroundColor="#FFFFFF"
                        color="#000000"
                        getRef={(svg) => {
                          if (svg) qrImages.current.set(qr.id, { svg, value: qr.value });
                          else qrImages.current.delete(qr.id);
                        }}
                      />
                    </View>
                    <View style={styles.qrInfo}>
                      <Text style={styles.qrId} selectable>{qr.label}</Text>
                      <Text style={styles.qrPlantId}>{qr.plantId ? t("plantQRCode.plant", { plantId: qr.plantId }) : t("plantQRCode.notAssignedToAPlant")}</Text>
                      <View style={[styles.statusBadge, getStatusStyle(qr.status)]}>
                        <Text style={styles.statusText}>{translateLabel(getStatusText(qr.status))}</Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.qrActions}>
                    <TouchableOpacity
                      style={[styles.recordButton, styles.printButton, loadingPrint && styles.disabledButton]}
                      onPress={() => handlePrintQR(qr)}
                      disabled={loadingPrint}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={t("plantQRCode.print", { label: qr.label })}
                      accessibilityState={{ disabled: loadingPrint, busy: printingId === qr.id }}
                    >
                      {printingId === qr.id ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="print-outline" size={18} color="#FFFFFF" />}
                      <Text style={styles.recordButtonText}>{printingId === qr.id ? t("plantQRCode.preparing") : t("common.print")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.recordButton, styles.deleteButton, styles.disabledButton]}
                      disabled
                      accessibilityRole="button"
                      accessibilityLabel={t("plantQRCode.deleteUnavailable", { label: qr.label })}
                      accessibilityState={{ disabled: true }}
                      accessibilityHint={qr.plantId ? t("plantQRCode.assignedQrCodesAreProtected") : t("plantQRCode.qrDeletionIsNotAvailableYet")}
                    >
                      <Ionicons name="trash-outline" size={18} color="#A34740" />
                      <Text style={[styles.recordButtonText, styles.deleteButtonText]}>{t("common.delete")}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.deleteHint}>{qr.plantId ? t("plantQRCode.assignedTagProtectedFromDeletion") : t("plantQRCode.deletionIsNotAvailableYet")}</Text>
                </View>
              ))}

              {availableQRCodes.length > 0 && <TouchableOpacity
                style={[styles.printAllButton, loadingPrint && styles.disabledButton]}
                onPress={handlePrintAll}
                disabled={loadingPrint}
                activeOpacity={0.8}
              >
                {printingId === "all" ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.printAllText}>{t("plantQRCode.printAllUnusedQrCodes")}</Text>
                )}
              </TouchableOpacity>}
            </View>
          ) : null}

        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("plantQRCode.qrCodeStatus")}</Text>
          {!hasLoaded ? (
            <Text style={styles.noStatusText}>{loadError ? t("plantQRCode.statusUnavailableUntilQrCodesLoad") : t("plantQRCode.loadingQrCodeStatus")}</Text>
          ) : plantQRCodes.length === 0 ? (
            <Text style={styles.noStatusText}>{loadError ? t("plantQRCode.couldNotRefreshQrCodeStatus") : t("plantQRCode.noQrCodesToShow")}</Text>
          ) : (
            plantQRCodes.map((qr) => (
              <View key={qr.id} style={styles.statusRow}>
                <Text style={styles.statusQRId}>
                  {qr.plantId ? t("plantQRCode.plant", { plantId: qr.plantId }) : qr.label}
                </Text>
                <View style={[styles.statusBadge, getStatusStyle(qr.status)]}>
                  <Text style={styles.statusText}>{translateLabel(getStatusText(qr.status))}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.workflowCard}>

          <Text style={styles.workflowTitle}>{t("plantQRCode.fieldSurveyWorkflow")}</Text>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                1
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.addAPlantRecordWithItsFieldDetailsAndPhotos")}</Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                2
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.submitThePlantRecordForOfficerReview")}</Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                3
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.theBackendAssignsAUniqueQrCodeToTheSaved")}</Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                4
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.theBackendAssignsTheQrCodeToTheSavedPlant")}</Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                5
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.printTheCodeAndAttachItToTheDocumentedPlant")}</Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                6
              </Text>
            </View>

            <Text style={styles.stepText}>{t("plantQRCode.theQrLinkBecomesPubliclyAvailableAfterApproval")}</Text>

          </View>

        </View>


        <View style={styles.bottomSpace} />

      </ScrollView>

    </View>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F3F8F4",
  },

  topBar: {
    height: 65,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    backgroundColor: "#F3F8F4",
    borderBottomWidth: 1,
    borderBottomColor: "#E1EAE4",
  },

  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E2F5E8",
    justifyContent: "center",
    alignItems: "center",
  },

  closeButtonText: {
    color: "#468585",
    fontSize: 20,
    fontWeight: "600",
  },

  topTitle: {
    color: "#234A3C",
    fontSize: 19,
    fontWeight: "700",
  },

  topRightSpace: {
    width: 40,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },

  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },

  sectionHeaderContent: {
    flex: 1,
    paddingRight: 10,
  },

  sectionTitle: {
    color: "#468585",
    fontSize: 19,
    fontWeight: "700",
  },

  sectionDescription: {
    color: "#777",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },

  countBadge: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#DEF9C4",
    alignItems: "center",
    justifyContent: "center",
  },

  countText: {
    color: "#35652F",
    fontSize: 14,
    fontWeight: "700",
  },

  generateRow: {
    flexDirection: "row",
    marginTop: 15,
    gap: 10,
  },

  numberInput: {
    width: 90,
    height: 50,
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#FAFDF9",
    textAlign: "center",
  },

  refreshSpacing: {
    marginBottom: 16,
  },

  generateButton: {
    flex: 1,
    height: 50,
    borderRadius: 10,
    backgroundColor: "#50B498",
    alignItems: "center",
    justifyContent: "center",
  },

  generateButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  qrCard: {
    backgroundColor: "#F7FBF4",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E1EAE4",
  },

  qrDetails: {
    flexDirection: "row",
    alignItems: "center",
  },

  qrPreview: {
    width: 100,
    height: 100,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  qrInfo: {
    flex: 1,
    minWidth: 0,
    marginLeft: 13,
  },

  qrId: {
    color: "#234A3C",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 8,
  },

  qrPlantId: {
    color: "#6B7C73",
    fontSize: 12,
    marginBottom: 8,
    flexShrink: 1,
  },

  statusBadge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },

  availableBadge: {
    backgroundColor: "#E2F5E8",
  },

  pendingBadge: {
    backgroundColor: "#FFF3D6",
  },

  approvedBadge: {
    backgroundColor: "#DEF9C4",
  },

  rejectedBadge: {
    backgroundColor: "#FFE3E3",
  },

  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#468585",
  },

  qrActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  recordButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
  },

  printButton: { backgroundColor: "#35786F", borderColor: "#35786F" },
  deleteButton: { backgroundColor: "#FFF2F0", borderColor: "#EDD1CC" },
  disabledButton: { opacity: 0.5 },
  recordButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", flexShrink: 1 },
  deleteButtonText: { color: "#A34740" },
  deleteHint: { color: "#77847C", fontSize: 11, lineHeight: 16, marginTop: 8 },
  errorNotice: { backgroundColor: "#FFF6E8", borderRadius: 12, padding: 12, marginBottom: 14 },
  errorTitle: { color: "#87562F", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  errorText: { color: "#785F4B", fontSize: 13, lineHeight: 19 },
  inventoryLimit: { color: "#6B7C73", fontSize: 12, marginBottom: 12 },

  printAllButton: {
    backgroundColor: "#468585",
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  printAllText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  emptyQR: {
    alignItems: "center",
    paddingVertical: 25,
  },

  emptyQRIcon: {
    fontSize: 40,
    color: "#9CDBA6",
    marginBottom: 10,
  },

  emptyQRTitle: {
    color: "#468585",
    fontSize: 16,
    fontWeight: "700",
  },

  emptyQRText: {
    color: "#777",
    fontSize: 13,
    textAlign: "center",
    marginTop: 5,
    lineHeight: 19,
  },

  noStatusText: {
    color: "#777",
    fontSize: 13,
    marginTop: 10,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF3EF",
  },

  statusQRId: {
    color: "#468585",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    marginRight: 8,
  },

  workflowCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  workflowTitle: {
    color: "#234A3C",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 15,
  },

  workflowStep: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 13,
  },

  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#DEF9C4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  stepNumber: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "700",
  },

  stepText: {
    flex: 1,
    color: "#5F6F65",
    fontSize: 13,
    lineHeight: 19,
  },

  bottomSpace: {
    height: 20,
  },

});
