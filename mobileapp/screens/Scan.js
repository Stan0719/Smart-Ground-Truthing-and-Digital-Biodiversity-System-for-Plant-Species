import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";

import { plants } from "../data/mockData";

export default function ScanScreen({ navigation }) {
  const [permission, requestPermission] =
    useCameraPermissions();

  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>
          Loading camera...
        </Text>
      </View>
    );
  }

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

  function handleBarcodeScanned({ data }) {
    if (scanned) {
      return;
    }

    setScanned(true);

    const plant = plants.find(
      (item) => item.id === data
    );

    if (plant) {
      navigation.navigate("PlantDetails", {
        plant,
      });
    }
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={
          scanned
            ? undefined
            : handleBarcodeScanned
        }
      />

      <View style={styles.overlay}>
        <Text style={styles.title}>
          Scan Plant QR
        </Text>

        <Text style={styles.subtitle}>
          Scan the QR code attached to a plant
        </Text>

        <View style={styles.scanBox}>
          <View style={styles.cornerTopLeft} />
          <View style={styles.cornerTopRight} />
          <View style={styles.cornerBottomLeft} />
          <View style={styles.cornerBottomRight} />
        </View>

        <Text style={styles.instruction}>
          Position the QR code inside the box
        </Text>

        {scanned && (
          <TouchableOpacity
            style={styles.button}
            onPress={() => setScanned(false)}
          >
            <Text style={styles.buttonText}>
              Scan Again
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },

  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#DEF9C4",
  },

  loadingText: {
    color: "#468585",
  },

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

  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 25,
  },

  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
  },

  subtitle: {
    color: "#FFFFFF",
    fontSize: 14,
    marginTop: 7,
    marginBottom: 35,
  },

  scanBox: {
    width: 270,
    height: 270,
    position: "relative",
  },

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

  instruction: {
    color: "#FFFFFF",
    fontSize: 14,
    marginTop: 25,
  },

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