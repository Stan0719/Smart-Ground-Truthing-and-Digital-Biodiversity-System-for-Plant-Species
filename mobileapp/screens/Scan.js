import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";

import { fetchPlantByQRCode } from "../utils/plantApi";
import { recordVisitorScan } from "../utils/visitorFeatures";
import { parsePlantQrPayload } from "../utils/qrPayload";


export default function ScanScreen({ navigation, user }) {
  useAppTranslation();

  const [permission, requestPermission] =
    useCameraPermissions();

  const [cameraKey, setCameraKey] = useState(0);
  const [prompt, setPrompt] = useState(null);
  const scanInProgress = useRef(false);
  useEffect(() => navigation.addListener("focus", () => { scanInProgress.current = false; }), [navigation]);
  const dismissPrompt = () => { setPrompt(null); setCameraKey((current) => current + 1); scanInProgress.current = false; };


  // ==========================================
  // Loading
  // ==========================================

  if (!permission) {

    return (
      <View style={styles.loading}>

        <Text style={styles.loadingText}>{t("scan.loadingCamera")}</Text>

      </View>
    );
  }


  // ==========================================
  // Permission
  // ==========================================

  if (!permission.granted) {

    return (
      <View style={styles.permissionContainer}>

        <View style={styles.permissionIcon}>

          <Text style={styles.cameraIcon}>
            📷
          </Text>

        </View>


        <Text style={styles.permissionTitle}>{t("scan.cameraPermission")}</Text>


        <Text style={styles.permissionText}>{t("scan.cameraAccessIsRequiredToScanPlantQrCodes")}</Text>


        <TouchableOpacity
          style={styles.button}
          onPress={requestPermission}
        >

          <Text style={styles.buttonText}>{t("scan.allowCamera")}</Text>

        </TouchableOpacity>

      </View>
    );
  }


  // ==========================================
  // QR Scanner
  // ==========================================

  async function handleBarcodeScanned({ data }) {
    if (scanInProgress.current) return;
    scanInProgress.current = true;
    let navigated = false;
    let prompted = false;
    try {
      const token = parsePlantQrPayload(data);

      const result = await fetchPlantByQRCode(token);
      if (result?.assigned === false) {
        const botanist = user?.role?.toLowerCase() === "botanist";
        setPrompt({ kind: result.status === "retired" ? "retired" : result.status === "generated" ? "unassigned" : "unavailable",
          qrId: botanist && result.status === "generated" && /^[1-9]\d*$/.test(String(result.qr_id)) ? String(result.qr_id) : null,
          token: botanist && result.status === "generated" ? token : null });
        prompted = true;
        return;
      }
      const plantId = result?.plant?.plant_id;
      if (!plantId) throw new Error("The QR code did not resolve to a plant record.");
      // PlantDetail loads by the plantId route parameter. Passing a plant object
      // here left its required ID undefined and rendered the not-found screen.
      navigation.navigate("PlantDetails", { plantId: String(plantId) });
      navigated = true;
      if (result?.assigned && user?.role?.toLowerCase() === "visitor") {
        void recordVisitorScan(user.id, token).catch((error) => {
          Alert.alert(t("scanHistory.historySaveFailedTitle"), translateUIMessage(error.message || "Unable to save this scan."));
        });
      }
    } catch (error) {
      Alert.alert(
        t("scan.plantQrUnavailable"),
        error instanceof Error
          ? translateUIMessage(error.message)
          : t("scan.couldNotLoadThePlantRecordForThisQrCode"),
      );
      setCameraKey((current) => current + 1);
    } finally {
      if (!navigated && !prompted) scanInProgress.current = false;
    }
  }


  // ==========================================
  // Camera Screen
  // ==========================================

  return (

    <View style={styles.container}>

      {/* ====================================
          CAMERA
          ==================================== */}

      <CameraView
        key={cameraKey}

        style={styles.camera}

        facing="back"

        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}

        onBarcodeScanned={
          handleBarcodeScanned
        }
      />


      {/* ====================================
          UI
          ==================================== */}

      <View style={styles.topContent}>

        <Text style={styles.title}>{t("scan.scanPlantQr")}</Text>

        <Text style={styles.subtitle}>{t("scan.scanTheQrCodeAttachedToAPlant")}</Text>

      </View>


      {/* ====================================
          Scan Box
          ==================================== */}

      <View style={styles.scanBox}>

        <View style={styles.cornerTopLeft} />

        <View style={styles.cornerTopRight} />

        <View style={styles.cornerBottomLeft} />

        <View style={styles.cornerBottomRight} />

      </View>


      {/* ====================================
          Instruction
          ==================================== */}

      <Text style={styles.instruction}>{t("scan.positionTheQrCodeInsideTheBox")}</Text>

      <Modal visible={Boolean(prompt)} transparent animationType="fade" onRequestClose={dismissPrompt}>
        <View style={styles.promptBackdrop}><View style={styles.promptCard}>
          <Ionicons name="qr-code-outline" size={28} color="#2F6B4F" />
          <Text style={styles.promptTitle}>{t(prompt?.kind === "unassigned" ? "scan.noPlantRecordFound" : "scan.plantQrUnavailable")}</Text>
          <Text style={styles.promptMessage}>{t(prompt?.kind === "retired" ? "scan.qrRetired" : prompt?.kind === "unassigned" && prompt.qrId ? "scan.botanistUnassigned" : prompt?.kind === "unassigned" ? "scan.visitorUnassigned" : "scan.plantQrUnavailable")}</Text>
          <View style={styles.promptActions}>
            {prompt?.qrId && <TouchableOpacity style={styles.promptSecondary} onPress={dismissPrompt} accessibilityRole="button"><Text style={styles.promptSecondaryText}>{t("common.cancel")}</Text></TouchableOpacity>}
            <TouchableOpacity style={styles.promptPrimary} accessibilityRole="button" onPress={() => {
              const selected = prompt;
              setPrompt(null);
              if (selected?.qrId && user?.role?.toLowerCase() === "botanist") navigation.navigate("AddPlant", {
                botanist: user, formDraftKey: undefined, entrySource: "qr-scan", scannedQrId: selected.qrId, scannedQrToken: selected.token,
              });
              else dismissPrompt();
            }}><Text style={styles.promptPrimaryText}>{t(prompt?.qrId ? "scan.addNewPlant" : "common.ok")}</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

    </View>
  );
}


// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({
  promptBackdrop: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(8,29,24,0.65)" },
  promptCard: { width: "100%", maxWidth: 420, alignSelf: "center", padding: 20, gap: 12, borderRadius: 20, backgroundColor: "#F7FBF4" },
  promptTitle: { color: "#234B3A", fontSize: 20, fontWeight: "700" },
  promptMessage: { color: "#52665A", fontSize: 15, lineHeight: 22 },
  promptActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" },
  promptPrimary: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderRadius: 12, backgroundColor: "#2F6B4F" },
  promptPrimaryText: { color: "#FFFFFF", fontWeight: "700" },
  promptSecondary: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#C9DEC9" },
  promptSecondaryText: { color: "#2F6B4F", fontWeight: "700" },

  container: {
    flex: 1,
    backgroundColor: "#000000",
  },


  camera: {
    flex: 1,
    width: "100%",
    height: "100%",
  },


  // ==========================================
  // Loading
  // ==========================================

  loading: {
    flex: 1,

    justifyContent: "center",
    alignItems: "center",

    backgroundColor: "#E7F2E2",
  },


  loadingText: {
    color: "#468585",
    fontSize: 16,
  },


  // ==========================================
  // Permission
  // ==========================================

  permissionContainer: {
    flex: 1,

    justifyContent: "center",
    alignItems: "center",

    padding: 30,

    backgroundColor: "#E7F2E2",
  },


  permissionIcon: {
    width: 100,
    height: 100,

    borderRadius: 50,

    backgroundColor: "#E9F7E4",

    justifyContent: "center",
    alignItems: "center",
  },


  cameraIcon: {
    fontSize: 45,
  },


  permissionTitle: {
    fontSize: 25,

    fontWeight: "800",

    color: "#468585",

    marginTop: 20,
  },


  permissionText: {
    textAlign: "center",

    color: "#687568",

    marginTop: 10,
    marginBottom: 20,

    lineHeight: 21,
  },


  // ==========================================
  // Top Content
  // ==========================================

  topContent: {
    position: "absolute",

    top: 55,

    left: 0,
    right: 0,

    alignItems: "center",

    paddingHorizontal: 25,
  },


  title: {
    color: "#FFFFFF",

    fontSize: 28,

    fontWeight: "800",

    textAlign: "center",
  },


  subtitle: {
    color: "#FFFFFF",

    fontSize: 14,

    marginTop: 7,

    textAlign: "center",
  },


  // ==========================================
  // Scan Box
  // ==========================================

  scanBox: {
    position: "absolute",

    top: "50%",

    left: "50%",

    width: 270,
    height: 270,

    marginLeft: -135,
    marginTop: -135,
  },


  // ==========================================
  // Top Left
  // ==========================================

  cornerTopLeft: {
    position: "absolute",

    top: 0,
    left: 0,

    width: 45,
    height: 45,

    borderTopWidth: 4,
    borderLeftWidth: 4,

    borderColor: "#E7F2E2",

    borderTopLeftRadius: 12,
  },


  // ==========================================
  // Top Right
  // ==========================================

  cornerTopRight: {
    position: "absolute",

    top: 0,
    right: 0,

    width: 45,
    height: 45,

    borderTopWidth: 4,
    borderRightWidth: 4,

    borderColor: "#E7F2E2",

    borderTopRightRadius: 12,
  },


  // ==========================================
  // Bottom Left
  // ==========================================

  cornerBottomLeft: {
    position: "absolute",

    bottom: 0,
    left: 0,

    width: 45,
    height: 45,

    borderBottomWidth: 4,
    borderLeftWidth: 4,

    borderColor: "#E7F2E2",

    borderBottomLeftRadius: 12,
  },


  // ==========================================
  // Bottom Right
  // ==========================================

  cornerBottomRight: {
    position: "absolute",

    bottom: 0,
    right: 0,

    width: 45,
    height: 45,

    borderBottomWidth: 4,
    borderRightWidth: 4,

    borderColor: "#E7F2E2",

    borderBottomRightRadius: 12,
  },


  // ==========================================
  // Instruction
  // ==========================================

  instruction: {
    position: "absolute",

    top: "50%",

    marginTop: 155,

    left: 0,
    right: 0,

    color: "#FFFFFF",

    fontSize: 14,

    textAlign: "center",
  },


  // ==========================================
  // Permission Button
  // ==========================================

  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#468585",

    paddingHorizontal: 28,

    paddingVertical: 14,

    borderRadius: 14,

    marginTop: 20,
  },


  buttonText: {
    color: "#FFFFFF",

    fontWeight: "700",

    fontSize: 15,
  },

});
