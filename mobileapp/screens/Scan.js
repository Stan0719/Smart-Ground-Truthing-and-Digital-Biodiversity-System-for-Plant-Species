import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";

import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";

import { fetchPlantByQRCode } from "../utils/plantApi";
import { recordVisitorScan } from "../utils/visitorFeatures";


export default function ScanScreen({ navigation, user }) {
  useAppTranslation();

  const [permission, requestPermission] =
    useCameraPermissions();

  const [cameraKey, setCameraKey] = useState(0);
  const scanInProgress = useRef(false);
  useEffect(() => navigation.addListener("focus", () => { scanInProgress.current = false; }), [navigation]);


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
    try {
      let token = String(data || "").trim();
      if (/^https?:\/\//i.test(token)) {
        const scannedUrl = new URL(token);
        const qrRoute = scannedUrl.pathname.match(/\/(?:api\/)?qr\/([^/]+)\/?$/);
        if (!qrRoute) {
          throw new Error("This QR code is not a plant record code.");
        }
        token = decodeURIComponent(qrRoute[1]);
      }

      let result;
      let historyError = null;
      if (user?.role?.toLowerCase() === "visitor") {
        try {
          result = await recordVisitorScan(user.id, token);
        } catch (error) {
          historyError = error;
          // Preserve QR navigation if history storage is temporarily unavailable.
          // This fallback never writes a scan event.
          result = await fetchPlantByQRCode(token);
        }
      } else {
        result = await fetchPlantByQRCode(token);
      }
      if (result?.assigned === false) {
        Alert.alert(t("scan.plantQrUnavailable"), t("scan.qrCodeNotAssigned"));
        setCameraKey((current) => current + 1);
        return;
      }
      const plantId = result?.plant?.plant_id;
      if (!plantId) throw new Error("The QR code did not resolve to a plant record.");
      if (historyError) Alert.alert(t("scanHistory.historySaveFailedTitle"), translateUIMessage(historyError.message || "Unable to save this scan."));
      // PlantDetail loads by the plantId route parameter. Passing a plant object
      // here left its required ID undefined and rendered the not-found screen.
      navigation.navigate("PlantDetails", { plantId: String(plantId) });
      navigated = true;
    } catch (error) {
      Alert.alert(
        t("scan.plantQrUnavailable"),
        error instanceof Error
          ? translateUIMessage(error.message)
          : t("scan.couldNotLoadThePlantRecordForThisQrCode"),
      );
      setCameraKey((current) => current + 1);
    } finally {
      if (!navigated) scanInProgress.current = false;
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

    </View>
  );
}


// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({

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
