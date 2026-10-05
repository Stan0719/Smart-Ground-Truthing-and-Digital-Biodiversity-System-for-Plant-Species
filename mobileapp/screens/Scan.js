import React, { useState } from "react";

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

import { plants } from "../data/mockData";


export default function ScanScreen({ navigation }) {

  const [permission, requestPermission] =
    useCameraPermissions();

  const [cameraKey, setCameraKey] = useState(0);


  // ==========================================
  // Loading
  // ==========================================

  if (!permission) {

    return (
      <View style={styles.loading}>

        <Text style={styles.loadingText}>
          Loading camera...
        </Text>

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


        <Text style={styles.permissionTitle}>
          Camera Permission
        </Text>


        <Text style={styles.permissionText}>
          Camera access is required to scan plant QR codes.
        </Text>


        <TouchableOpacity
          style={styles.button}
          onPress={requestPermission}
        >

          <Text style={styles.buttonText}>
            Allow Camera
          </Text>

        </TouchableOpacity>

      </View>
    );
  }


  // ==========================================
  // QR Scanner
  // ==========================================

  function handleBarcodeScanned({ data }) {

    console.log("QR DATA:", data);


    let plantId = data;


    // ========================================
    // Extract Plant ID from URL
    // ========================================

    if (data.includes("/plants/")) {

      plantId =
        data.split("/plants/")[1];


      plantId =
        plantId.split("?")[0];


      plantId =
        plantId.split("#")[0];
    }


    console.log("PLANT ID:", plantId);


    // ========================================
    // Find Plant
    // ========================================

    const plant = plants.find(
      (item) =>
        item.id === plantId ||
        `NIAH-PLANT-${item.slug}` === plantId
    );


    // ========================================
    // Plant Not Found
    // ========================================

    if (!plant) {

      Alert.alert(
        "Plant Not Found",
        `No plant was found for:\n${plantId}`
      );

      return;
    }


    // ========================================
    // Add ID if Missing
    // ========================================

    if (!plant.id) {

      plant.id =
        `NIAH-PLANT-${plant.slug}`;
    }


    console.log(
      "Plant Found:",
      plant.name
    );


    // ========================================
    // Open Plant Details
    // ========================================

    navigation.navigate(
      "PlantDetails",
      {
        plant,
      }
    );
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

        <Text style={styles.title}>
          Scan Plant QR
        </Text>

        <Text style={styles.subtitle}>
          Scan the QR code attached to a plant
        </Text>

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

      <Text style={styles.instruction}>
        Position the QR code inside the box
      </Text>

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

    backgroundColor: "#DEF9C4",
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

    backgroundColor: "#DEF9C4",
  },


  permissionIcon: {
    width: 100,
    height: 100,

    borderRadius: 50,

    backgroundColor: "#9CDBA6",

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

    borderColor: "#DEF9C4",

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

    borderColor: "#DEF9C4",

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

    borderColor: "#DEF9C4",

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

    borderColor: "#DEF9C4",

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
    backgroundColor: "#50B498",

    paddingHorizontal: 28,

    paddingVertical: 14,

    borderRadius: 12,

    marginTop: 20,
  },


  buttonText: {
    color: "#FFFFFF",

    fontWeight: "700",

    fontSize: 15,
  },

});