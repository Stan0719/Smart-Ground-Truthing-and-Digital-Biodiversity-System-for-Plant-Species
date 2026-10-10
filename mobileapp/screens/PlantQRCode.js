// PlantQRCode.js

import React, { useState } from "react";

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";

import QRCode from "react-native-qrcode-svg";

import * as Print from "expo-print";

import {
  qrCodes,
  generateQRCodes,
  deleteQRCode,
} from "../data/qrData";


export default function PlantQRCodeScreen({
  route,
  navigation,
}) {
  const botanist = route.params?.botanist;

  const [numberOfCodes, setNumberOfCodes] = useState("5");

  const [loadingPrint, setLoadingPrint] =
    useState(false);

  const [refresh, setRefresh] =
    useState(0);


  const availableQRCodes =
    qrCodes.filter(
      (qr) => qr.status === "AVAILABLE"
    );


  function handleGenerate() {
    const amount =
      parseInt(numberOfCodes, 10);

    if (
      !amount ||
      amount < 1 ||
      amount > 100
    ) {
      Alert.alert(
        "Invalid Number",
        "Please enter a number between 1 and 100."
      );

      return;
    }

    generateQRCodes(
      amount,
      botanist?.name || "Unknown"
    );

    setRefresh((value) => value + 1);

    Alert.alert(
      "QR Codes Generated",
      `${amount} QR code${amount > 1 ? "s have" : " has"} been generated successfully.`
    );
  }


  function handleDelete(qrId) {
    Alert.alert(
      "Delete QR Code",
      `Are you sure you want to delete ${qrId}?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },

        {
          text: "Delete",
          style: "destructive",

          onPress: () => {
            const deleted =
              deleteQRCode(qrId);

            if (deleted) {
              setRefresh((value) => value + 1);

              Alert.alert(
                "Deleted",
                `${qrId} has been deleted.`
              );
            } else {
              Alert.alert(
                "Cannot Delete",
                "Only available QR codes can be deleted."
              );
            }
          },
        },
      ]
    );
  }


  async function handlePrintQR(qr) {
    try {
      setLoadingPrint(true);

      const encodedQR =
        encodeURIComponent(qr.value);

      const qrImage =
        `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodedQR}`;

      const html = `
        <!DOCTYPE html>

        <html>

        <head>

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <style>

            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 40px;
            }

            .container {
              max-width: 500px;
              margin: auto;
            }

            h1 {
              color: #234A3C;
              margin-bottom: 8px;
            }

            .qr-id {
              color: #468585;
              font-size: 22px;
              font-weight: bold;
              margin-top: 15px;
            }

            img {
              width: 300px;
              height: 300px;
              margin: 20px auto;
            }

            .instruction {
              color: #666;
              font-size: 14px;
              margin-top: 20px;
              line-height: 20px;
            }

          </style>

        </head>

        <body>

          <div class="container">

            <h1>
              Niah National Park
            </h1>

            <div class="qr-id">
              ${qr.value}
            </div>

            <img
              src="${qrImage}"
            />

            <div class="instruction">
              Biodiversity Plant Identification QR Code
              <br />
              Attach this QR code to a documented plant.
            </div>

          </div>

        </body>

        </html>
      `;

      await Print.printAsync({
        html,
      });

    } catch (error) {

      console.log(
        "Print error:",
        error
      );

      Alert.alert(
        "Print Error",
        "Unable to print the QR code."
      );

    } finally {

      setLoadingPrint(false);
    }
  }


  async function handlePrintAll() {
    if (availableQRCodes.length === 0) {
      Alert.alert(
        "No QR Codes",
        "Please generate QR codes first."
      );

      return;
    }

    try {
      setLoadingPrint(true);

      const qrSections =
        availableQRCodes
          .map((qr) => {

            const encodedQR =
              encodeURIComponent(qr.value);

            const qrImage =
              `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodedQR}`;

            return `
              <div class="qr-item">

                <h2>
                  ${qr.value}
                </h2>

                <img
                  src="${qrImage}"
                />

                <p>
                  Niah National Park
                </p>

                <p class="instruction">
                  Attach this QR code to a documented plant.
                </p>

              </div>
            `;
          })
          .join("");

      const html = `
        <!DOCTYPE html>

        <html>

        <head>

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <style>

            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 30px;
            }

            h1 {
              color: #234A3C;
            }

            .qr-item {
              page-break-after: always;
              padding: 20px;
            }

            .qr-item h2 {
              color: #468585;
              font-size: 24px;
            }

            img {
              width: 300px;
              height: 300px;
            }

            p {
              color: #555;
            }

            .instruction {
              font-size: 14px;
              color: #777;
            }

          </style>

        </head>

        <body>

          <h1>
            Niah National Park
          </h1>

          ${qrSections}

        </body>

        </html>
      `;

      await Print.printAsync({
        html,
      });

    } catch (error) {

      console.log(
        "Print all error:",
        error
      );

      Alert.alert(
        "Print Error",
        "Unable to print the QR codes."
      );

    } finally {

      setLoadingPrint(false);
    }
  }


  function getStatusText(status) {
    switch (status) {

      case "AVAILABLE":
        return "Available";

      case "PENDING_APPROVAL":
        return "Pending Approval";

      case "APPROVED":
        return "Approved";

      case "REJECTED":
        return "Rejected";

      default:
        return status;
    }
  }


  function getStatusStyle(status) {
    switch (status) {

      case "AVAILABLE":
        return styles.availableBadge;

      case "PENDING_APPROVAL":
        return styles.pendingBadge;

      case "APPROVED":
        return styles.approvedBadge;

      case "REJECTED":
        return styles.rejectedBadge;

      default:
        return styles.availableBadge;
    }
  }


  return (
    <View style={styles.container}>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.scrollContent
        }
      >

        {/* Introduction */}

        <View style={styles.introCard}>

          <Text style={styles.introIcon}>
            ▦
          </Text>

          <View style={styles.introContent}>

            <Text style={styles.introTitle}>
              Prepare QR Codes
            </Text>

            <Text style={styles.introText}>
              Generate and print QR codes before
              going to Niah National Park. Attach
              one QR code to each plant during
              your field survey.
            </Text>

          </View>

        </View>


        {/* Generate */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            Generate QR Codes
          </Text>

          <Text style={styles.sectionDescription}>
            Enter the number of QR codes you want
            to prepare for your field survey.
          </Text>


          <View style={styles.generateRow}>

            <TextInput
              style={styles.numberInput}
              value={numberOfCodes}
              onChangeText={setNumberOfCodes}
              keyboardType="number-pad"
              maxLength={3}
            />


            <TouchableOpacity
              style={styles.generateButton}
              onPress={handleGenerate}
              activeOpacity={0.8}
            >

              <Text style={styles.generateButtonText}>
                + Generate
              </Text>

            </TouchableOpacity>

          </View>

        </View>


        {/* Available QR Codes */}

        <View style={styles.section}>

          <View style={styles.sectionHeader}>

            <View style={styles.sectionHeaderContent}>

              <Text style={styles.sectionTitle}>
                Available QR Codes
              </Text>

              <Text style={styles.sectionDescription}>
                Print these codes before your field trip.
              </Text>

            </View>

            <View style={styles.countBadge}>

              <Text style={styles.countText}>
                {availableQRCodes.length}
              </Text>

            </View>

          </View>


          {availableQRCodes.length === 0 ? (

            <View style={styles.emptyQR}>

              <Text style={styles.emptyQRIcon}>
                ▦
              </Text>

              <Text style={styles.emptyQRTitle}>
                No QR codes available
              </Text>

              <Text style={styles.emptyQRText}>
                Generate QR codes above before
                your field survey.
              </Text>

            </View>

          ) : (

            <View>

              {availableQRCodes.map((qr) => (

                <View
                  key={qr.id}
                  style={styles.qrCard}
                >

                  {/* QR Preview */}

                  <View style={styles.qrPreview}>

                    <QRCode
                      value={qr.value}
                      size={85}
                      backgroundColor="#FFFFFF"
                      color="#234A3C"
                    />

                  </View>


                  {/* QR Information */}

                  <View style={styles.qrInfo}>

                    <Text style={styles.qrId}>
                      {qr.value}
                    </Text>

                    <View
                      style={[
                        styles.statusBadge,
                        getStatusStyle(qr.status),
                      ]}
                    >

                      <Text style={styles.statusText}>
                        {getStatusText(qr.status)}
                      </Text>

                    </View>

                  </View>


                  {/* Print and Delete */}

                  <View style={styles.qrActions}>

                    <TouchableOpacity
                      style={styles.printSmallButton}
                      onPress={() => handlePrintQR(qr)}
                      disabled={loadingPrint}
                      activeOpacity={0.8}
                    >

                      <Text style={styles.printSmallText}>
                        🖨
                      </Text>

                    </TouchableOpacity>


                    <TouchableOpacity
                      style={styles.deleteSmallButton}
                      onPress={() => handleDelete(qr.id)}
                      activeOpacity={0.8}
                    >

                      <Text style={styles.deleteSmallText}>
                        🗑
                      </Text>

                    </TouchableOpacity>

                  </View>

                </View>

              ))}


              {/* Print All */}

              <TouchableOpacity
                style={styles.printAllButton}
                onPress={handlePrintAll}
                disabled={loadingPrint}
                activeOpacity={0.8}
              >

                {loadingPrint ? (

                  <ActivityIndicator
                    color="#FFFFFF"
                  />

                ) : (

                  <Text style={styles.printAllText}>
                    🖨 Print All Available QR Codes
                  </Text>

                )}

              </TouchableOpacity>

            </View>

          )}

        </View>


        {/* QR Status */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            QR Code Status
          </Text>


          {qrCodes.length === 0 ? (

            <Text style={styles.noStatusText}>
              No QR codes have been generated yet.
            </Text>

          ) : (

            qrCodes.map((qr) => (

              <View
                key={qr.id}
                style={styles.statusRow}
              >

                <Text style={styles.statusQRId}>
                  {qr.value}
                </Text>

                <View
                  style={[
                    styles.statusBadge,
                    getStatusStyle(qr.status),
                  ]}
                >

                  <Text style={styles.statusText}>
                    {getStatusText(qr.status)}
                  </Text>

                </View>

              </View>

            ))

          )}

        </View>


        {/* Workflow */}

        <View style={styles.workflowCard}>

          <Text style={styles.workflowTitle}>
            Field Survey Workflow
          </Text>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                1
              </Text>
            </View>

            <Text style={styles.stepText}>
              Generate QR codes before visiting Niah.
            </Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                2
              </Text>
            </View>

            <Text style={styles.stepText}>
              Print the QR codes.
            </Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                3
              </Text>
            </View>

            <Text style={styles.stepText}>
              Attach a printed QR code to each plant.
            </Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                4
              </Text>
            </View>

            <Text style={styles.stepText}>
              Create the plant record and select its QR code.
            </Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                5
              </Text>
            </View>

            <Text style={styles.stepText}>
              Submit the plant record for approval.
            </Text>

          </View>


          <View style={styles.workflowStep}>

            <View style={styles.stepCircle}>
              <Text style={styles.stepNumber}>
                6
              </Text>
            </View>

            <Text style={styles.stepText}>
              Once approved, the QR code becomes active.
            </Text>

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
    paddingTop: 20,
    paddingBottom: 40,
  },

  introCard: {
    flexDirection: "row",
    backgroundColor: "#DEF9C4",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },

  introIcon: {
    fontSize: 36,
    color: "#468585",
    marginRight: 14,
  },

  introContent: {
    flex: 1,
  },

  introTitle: {
    color: "#35652F",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 5,
  },

  introText: {
    color: "#466047",
    fontSize: 13,
    lineHeight: 19,
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F7FBF4",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E1EAE4",
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
    marginLeft: 13,
  },

  qrId: {
    color: "#234A3C",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 8,
  },

  statusBadge: {
    alignSelf: "flex-start",
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
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
    gap: 8,
  },

  printSmallButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },

  printSmallText: {
    fontSize: 19,
    color: "#FFFFFF",
  },

  deleteSmallButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#D9534F",
    alignItems: "center",
    justifyContent: "center",
  },

  deleteSmallText: {
    fontSize: 18,
    color: "#FFFFFF",
  },

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