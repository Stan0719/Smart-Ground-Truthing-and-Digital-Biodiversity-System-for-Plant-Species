import React, { useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";

import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";

import { plants } from "../data/mockData";

import {
  qrCodes,
  assignQRCode,
} from "../data/qrData";


export default function AddPlantScreen({
  route,
  navigation,
}) {
  const botanist = route.params?.botanist;

  const [scientificName, setScientificName] =
    useState("");

  const [commonName, setCommonName] =
    useState("");

  const [family, setFamily] =
    useState("");

  const [category, setCategory] =
    useState("");

  const [height, setHeight] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [overview, setOverview] =
    useState("");

  const [habitat, setHabitat] =
    useState("");

  const [significance, setSignificance] =
    useState("");

  const [characteristics, setCharacteristics] =
    useState("");

  const [latitude, setLatitude] =
    useState("");

  const [longitude, setLongitude] =
    useState("");

  const [loadingLocation, setLoadingLocation] =
    useState(false);

  const [photos, setPhotos] =
    useState([]);

  const [selectedQRCode, setSelectedQRCode] =
    useState("");

  const [showQRDropdown, setShowQRDropdown] =
    useState(false);


  const availableQRCodes =
    qrCodes.filter(
      (qr) => qr.status === "AVAILABLE"
    );


  async function getCurrentLocation() {
    try {
      setLoadingLocation(true);

      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Permission Required",
          "Location permission is required to record the plant location."
        );

        return;
      }

      const location =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

      const lat =
        location.coords.latitude.toFixed(6);

      const lng =
        location.coords.longitude.toFixed(6);

      setLatitude(lat);
      setLongitude(lng);

      Alert.alert(
        "Location Captured",
        `Latitude: ${lat}\nLongitude: ${lng}`
      );

    } catch (error) {

      console.log(
        "Location error:",
        error
      );

      Alert.alert(
        "Error",
        "Unable to get your current location."
      );

    } finally {

      setLoadingLocation(false);

    }
  }


  async function takePhoto() {
    try {

      const { status } =
        await ImagePicker.requestCameraPermissionsAsync();

      if (status !== "granted") {

        Alert.alert(
          "Permission Required",
          "Camera permission is required to take a plant photo."
        );

        return;
      }


      const result =
        await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
        });


      if (
        !result.canceled &&
        result.assets?.length > 0
      ) {

        const newPhoto =
          result.assets[0].uri;

        setPhotos(
          (currentPhotos) => [
            ...currentPhotos,
            newPhoto,
          ]
        );

      }

    } catch (error) {

      console.log(
        "Camera error:",
        error
      );

      Alert.alert(
        "Error",
        "Unable to take the plant photo."
      );

    }
  }


  async function selectPhotos() {
    try {

      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== "granted") {

        Alert.alert(
          "Permission Required",
          "Photo library permission is required to select plant photos."
        );

        return;
      }


      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: 10,
          quality: 0.8,
        });


      if (
        !result.canceled &&
        result.assets?.length > 0
      ) {

        const selectedPhotos =
          result.assets.map(
            (asset) => asset.uri
          );

        setPhotos(
          (currentPhotos) => [
            ...currentPhotos,
            ...selectedPhotos,
          ]
        );

      }

    } catch (error) {

      console.log(
        "Gallery error:",
        error
      );

      Alert.alert(
        "Error",
        "Unable to select plant photos."
      );

    }
  }


  function handlePhoto() {

    Alert.alert(
      "Add Plant Photo",
      "Choose how you want to add photos.",
      [
        {
          text: "Take Photo",
          onPress: takePhoto,
        },

        {
          text: "Choose from Gallery",
          onPress: selectPhotos,
        },

        {
          text: "Cancel",
          style: "cancel",
        },
      ]
    );
  }


  function removePhoto(index) {

    Alert.alert(
      "Remove Photo",
      "Do you want to remove this photo?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },

        {
          text: "Remove",
          style: "destructive",

          onPress: () => {

            setPhotos(
              (currentPhotos) =>
                currentPhotos.filter(
                  (_, photoIndex) =>
                    photoIndex !== index
                )
            );

          },
        },
      ]
    );
  }


  function handleSelectQRCode(qr) {

    setSelectedQRCode(qr.id);

    setShowQRDropdown(false);
  }


  function handleSave() {

    if (!selectedQRCode) {

      Alert.alert(
        "QR Code Required",
        "Please select the QR code attached to this plant."
      );

      return;
    }


    if (!scientificName.trim()) {

      Alert.alert(
        "Missing Information",
        "Please enter the scientific name."
      );

      return;
    }


    if (!commonName.trim()) {

      Alert.alert(
        "Missing Information",
        "Please enter the common name."
      );

      return;
    }


    if (!family.trim()) {

      Alert.alert(
        "Missing Information",
        "Please enter the plant family."
      );

      return;
    }


    if (!category.trim()) {

      Alert.alert(
        "Missing Information",
        "Please enter the plant category."
      );

      return;
    }


    if (!latitude || !longitude) {

      Alert.alert(
        "Location Required",
        "Please capture the current GPS location before submitting the plant."
      );

      return;
    }


    const selectedQR =
      qrCodes.find(
        (qr) => qr.id === selectedQRCode
      );


    if (!selectedQR) {

      Alert.alert(
        "QR Code Error",
        "The selected QR code could not be found."
      );

      return;
    }


    if (selectedQR.status !== "AVAILABLE") {

      Alert.alert(
        "QR Code Unavailable",
        "This QR code has already been assigned to another plant."
      );

      return;
    }


    const characteristicList =
      characteristics
        .split("\n")
        .map(
          (item) => item.trim()
        )
        .filter(
          (item) => item.length > 0
        );


    const newPlantId =
      `NIAH-PLANT-${Date.now()}`;


    const slug =
      scientificName
        .toLowerCase()
        .trim()
        .replace(
          /\s+/g,
          "-"
        );


    const newPlant = {

      id: newPlantId,

      slug,

      name:
        commonName.trim(),

      scientificName:
        scientificName.trim(),

      category:
        category.trim(),

      family:
        family.trim(),

      height:
        height.trim(),

      description:
        description.trim(),

      overview:
        overview.trim(),

      habitat:
        habitat.trim(),

      significance:
        significance.trim(),

      characteristics:
        characteristicList,

      latitude:
        Number(latitude),

      longitude:
        Number(longitude),

      photos,

      botanist:
        botanist?.name ||
        "Unknown",

      // Approval status
      status:
        "pending",

      // New QR relationship
      qrCode:
        selectedQRCode,

      qrStatus:
        "PENDING_APPROVAL",

      qrGenerated:
        true,

      qrValue:
        selectedQR.value,

      syncStatus:
        "Pending Sync",

      createdAt:
        new Date().toISOString(),

    };


    console.log(
      "New plant:",
      newPlant
    );


    const assigned = assignQRCode(
  selectedQRCode,
  newPlantId
);

if (!assigned) {
  Alert.alert(
    "QR Code Error",
    "The selected QR code is no longer available."
  );

  return;
}

plants.push(newPlant);

    Alert.alert(
      "Plant Record Submitted",
      `QR ${selectedQRCode} has been linked to this plant record.\n\nThe record is now waiting for officer approval.`,
      [
        {
          text: "OK",
          onPress: () =>
            navigation.goBack(),
        },
      ]
    );
  }


  return (
    <View style={styles.container}>

      <ScrollView
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={
          false
        }
      >

        <View style={styles.header}>

          <Text style={styles.title}>
            Add New Plant
          </Text>

          <Text style={styles.subtitle}>
            Record plant information during your
            Niah National Park field survey.
          </Text>

        </View>


        {/* QR Code */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            Plant QR Code
          </Text>

          <Text style={styles.qrDescription}>
            Select the QR code that you attached
            to this plant during the field survey.
          </Text>


          {availableQRCodes.length === 0 ? (

            <View style={styles.noQRBox}>

              <Text style={styles.noQRIcon}>
                ▦
              </Text>

              <Text style={styles.noQRTitle}>
                No QR codes available
              </Text>

              <Text style={styles.noQRText}>
                Please generate and print QR codes
                from QR Code Management before
                starting your field survey.
              </Text>


              <TouchableOpacity
                style={styles.goQRButton}
                onPress={() =>
                  navigation.navigate(
                    "PlantQRCode",
                    { botanist }
                  )
                }
                activeOpacity={0.8}
              >

                <Text style={styles.goQRButtonText}>
                  Go to QR Code Management
                </Text>

              </TouchableOpacity>

            </View>

          ) : (

            <View>

              <TouchableOpacity
                style={styles.dropdown}
                onPress={() =>
                  setShowQRDropdown(
                    !showQRDropdown
                  )
                }
                activeOpacity={0.8}
              >

                <Text
                  style={[
                    styles.dropdownText,
                    !selectedQRCode &&
                      styles.dropdownPlaceholder,
                  ]}
                >
                  {selectedQRCode ||
                    "Select QR Code"}
                </Text>

                <Text style={styles.dropdownArrow}>
                  {showQRDropdown
                    ? "▲"
                    : "▼"}
                </Text>

              </TouchableOpacity>


              {showQRDropdown && (

                <View style={styles.dropdownList}>

                  {availableQRCodes.map(
                    (qr) => (

                      <TouchableOpacity
                        key={qr.id}
                        style={styles.dropdownItem}
                        onPress={() =>
                          handleSelectQRCode(
                            qr
                          )
                        }
                        activeOpacity={0.7}
                      >

                        <Text style={styles.dropdownItemText}>
                          {qr.value}
                        </Text>

                        <Text style={styles.availableText}>
                          Available
                        </Text>

                      </TouchableOpacity>

                    )
                  )}

                </View>

              )}


              {selectedQRCode && (

                <View style={styles.selectedQRBox}>

                  <Text style={styles.selectedQRIcon}>
                    ✓
                  </Text>

                  <View style={styles.selectedQRContent}>

                    <Text style={styles.selectedQRTitle}>
                      {selectedQRCode}
                    </Text>

                    <Text style={styles.selectedQRText}>
                      This QR code will be linked to
                      this plant after submission.
                    </Text>

                  </View>

                </View>

              )}

            </View>

          )}

        </View>


        {/* Basic Information */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            Basic Information
          </Text>


          <Text style={styles.label}>
            Common Name *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter common name"
            placeholderTextColor="#999"
            value={commonName}
            onChangeText={setCommonName}
          />


          <Text style={styles.label}>
            Scientific Name *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter scientific name"
            placeholderTextColor="#999"
            value={scientificName}
            onChangeText={setScientificName}
          />


          <Text style={styles.label}>
            Family *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter plant family"
            placeholderTextColor="#999"
            value={family}
            onChangeText={setFamily}
          />


          <Text style={styles.label}>
            Category *
          </Text>

          <TextInput
            style={styles.input}
            placeholder="e.g. Tree, Flower, Fern, Climber"
            placeholderTextColor="#999"
            value={category}
            onChangeText={setCategory}
          />

        </View>


        {/* Plant Information */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            Plant Information
          </Text>


          <Text style={styles.label}>
            Height
          </Text>

          <TextInput
            style={styles.input}
            placeholder="e.g. 5 metres"
            placeholderTextColor="#999"
            value={height}
            onChangeText={setHeight}
          />


          <Text style={styles.label}>
            Description
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder="Enter a short description"
            placeholderTextColor="#999"
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />


          <Text style={styles.label}>
            Overview
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder="Enter plant overview"
            placeholderTextColor="#999"
            value={overview}
            onChangeText={setOverview}
            multiline
            textAlignVertical="top"
          />


          <Text style={styles.label}>
            Habitat
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder="Describe the plant habitat"
            placeholderTextColor="#999"
            value={habitat}
            onChangeText={setHabitat}
            multiline
            textAlignVertical="top"
          />


          <Text style={styles.label}>
            Significance
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder="Describe ecological or cultural significance"
            placeholderTextColor="#999"
            value={significance}
            onChangeText={setSignificance}
            multiline
            textAlignVertical="top"
          />


          <Text style={styles.label}>
            Characteristics
          </Text>

          <TextInput
            style={styles.textArea}
            placeholder={
              "Enter one characteristic per line\nExample: Large green leaves\nExample: Woody stem"
            }
            placeholderTextColor="#999"
            value={characteristics}
            onChangeText={setCharacteristics}
            multiline
            textAlignVertical="top"
          />

        </View>


        {/* Photos */}

        <View style={styles.section}>

          <View style={styles.photoHeader}>

            <View>

              <Text style={styles.sectionTitle}>
                Plant Photos
              </Text>

              <Text style={styles.photoCount}>
                {photos.length} photo
                {photos.length !== 1
                  ? "s"
                  : ""}
              </Text>

            </View>


            <TouchableOpacity
              style={styles.addPhotoSmallButton}
              onPress={handlePhoto}
              activeOpacity={0.8}
            >

              <Text style={styles.addPhotoSmallText}>
                + Add
              </Text>

            </TouchableOpacity>

          </View>


          {photos.length === 0 ? (

            <TouchableOpacity
              style={styles.photoButton}
              onPress={handlePhoto}
              activeOpacity={0.8}
            >

              <Text style={styles.photoIcon}>
                📷
              </Text>

              <Text style={styles.photoButtonText}>
                Add Plant Photos
              </Text>

              <Text style={styles.photoSubtext}>
                Take photos or select multiple photos from gallery
              </Text>

            </TouchableOpacity>

          ) : (

            <View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={
                  false
                }
                contentContainerStyle={
                  styles.photoList
                }
              >

                {photos.map(
                  (
                    photoUri,
                    index
                  ) => (

                    <View
                      key={`${photoUri}-${index}`}
                      style={styles.photoItem}
                    >

                      <Image
                        source={{
                          uri: photoUri,
                        }}
                        style={
                          styles.photoPreview
                        }
                      />


                      <View style={styles.photoNumber}>

                        <Text style={styles.photoNumberText}>
                          {index + 1}
                        </Text>

                      </View>


                      <TouchableOpacity
                        style={
                          styles.removePhotoButton
                        }
                        onPress={() =>
                          removePhoto(
                            index
                          )
                        }
                        activeOpacity={0.8}
                      >

                        <Text style={styles.removePhotoText}>
                          ×
                        </Text>

                      </TouchableOpacity>

                    </View>

                  )
                )}

              </ScrollView>


              <TouchableOpacity
                style={
                  styles.addAnotherPhotoButton
                }
                onPress={handlePhoto}
                activeOpacity={0.8}
              >

                <Text style={styles.addAnotherPhotoText}>
                  + Add Another Photo
                </Text>

              </TouchableOpacity>

            </View>

          )}

        </View>


        {/* GPS */}

        <View style={styles.section}>

          <Text style={styles.sectionTitle}>
            GPS Location
          </Text>

          <Text style={styles.locationDescription}>
            Capture the current location of the
            plant using your device GPS.
          </Text>


          <TouchableOpacity
            style={styles.locationButton}
            onPress={getCurrentLocation}
            disabled={loadingLocation}
            activeOpacity={0.8}
          >

            {loadingLocation ? (

              <ActivityIndicator
                size="small"
                color="#FFFFFF"
              />

            ) : (

              <Text style={styles.locationIcon}>
                📍
              </Text>

            )}


            <Text style={styles.locationButtonText}>
              {loadingLocation
                ? "Getting Location..."
                : "Capture Current Location"}
            </Text>

          </TouchableOpacity>


          <View style={styles.coordinatesContainer}>

            <View style={styles.coordinateBox}>

              <Text style={styles.coordinateLabel}>
                Latitude
              </Text>

              <Text style={styles.coordinateValue}>
                {latitude ||
                  "Not captured"}
              </Text>

            </View>


            <View style={styles.coordinateBox}>

              <Text style={styles.coordinateLabel}>
                Longitude
              </Text>

              <Text style={styles.coordinateValue}>
                {longitude ||
                  "Not captured"}
              </Text>

            </View>

          </View>

        </View>


        {/* Information */}

        <View style={styles.infoBox}>

          <Text style={styles.infoIcon}>
            ℹ️
          </Text>

          <Text style={styles.infoText}>
            The QR code will remain pending until
            the plant record is reviewed and approved
            by an authorised officer.
          </Text>

        </View>


        {/* Submit */}

        <TouchableOpacity
          style={[
            styles.saveButton,
            !selectedQRCode &&
              styles.disabledButton,
          ]}
          onPress={handleSave}
          activeOpacity={0.8}
        >

          <Text style={styles.saveButtonText}>
            Submit Plant Record
          </Text>

        </TouchableOpacity>


        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() =>
            navigation.goBack()
          }
          activeOpacity={0.8}
        >

          <Text style={styles.cancelButtonText}>
            Cancel
          </Text>

        </TouchableOpacity>

      </ScrollView>

    </View>
  );
}


const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F7FBF4",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  header: {
    marginBottom: 24,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 6,
  },

  subtitle: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },


  /* Sections */

  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: {
      width: 0,
      height: 2,
    },
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 4,
  },


  /* QR */

  qrDescription: {
    fontSize: 13,
    color: "#777",
    lineHeight: 19,
    marginBottom: 14,
  },

  dropdown: {
    height: 52,
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 10,
    paddingHorizontal: 14,
    backgroundColor: "#FAFDF9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  dropdownText: {
    fontSize: 15,
    color: "#468585",
    fontWeight: "600",
  },

  dropdownPlaceholder: {
    color: "#999",
    fontWeight: "400",
  },

  dropdownArrow: {
    fontSize: 12,
    color: "#468585",
  },

  dropdownList: {
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 10,
    marginTop: 5,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },

  dropdownItem: {
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#EEF3EF",
  },

  dropdownItemText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#468585",
  },

  availableText: {
    fontSize: 11,
    color: "#5F8C65",
    fontWeight: "600",
  },

  selectedQRBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E2F5E8",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },

  selectedQRIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#50B498",
    color: "#FFFFFF",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 18,
    fontWeight: "700",
    marginRight: 10,
  },

  selectedQRContent: {
    flex: 1,
  },

  selectedQRTitle: {
    fontSize: 14,
    color: "#35652F",
    fontWeight: "700",
  },

  selectedQRText: {
    fontSize: 12,
    color: "#5F6F65",
    lineHeight: 17,
    marginTop: 2,
  },

  noQRBox: {
    alignItems: "center",
    backgroundColor: "#FFF8E8",
    borderRadius: 12,
    padding: 18,
    marginTop: 10,
  },

  noQRIcon: {
    fontSize: 36,
    color: "#B68A2C",
    marginBottom: 8,
  },

  noQRTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#7C641F",
  },

  noQRText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#806F43",
    textAlign: "center",
    marginTop: 6,
  },

  goQRButton: {
    backgroundColor: "#468585",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 9,
    marginTop: 13,
  },

  goQRButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },


  /* Inputs */

  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
    marginBottom: 7,
    marginTop: 8,
  },

  input: {
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#333",
    backgroundColor: "#FAFDF9",
    marginBottom: 8,
  },

  textArea: {
    borderWidth: 1,
    borderColor: "#D6E5D0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#333",
    backgroundColor: "#FAFDF9",
    minHeight: 110,
    marginBottom: 8,
  },


  /* Photos */

  photoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  photoCount: {
    fontSize: 12,
    color: "#777",
    marginTop: 3,
  },

  addPhotoSmallButton: {
    backgroundColor: "#50B498",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },

  addPhotoSmallText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  photoButton: {
    borderWidth: 1.5,
    borderColor: "#9CDBA6",
    borderStyle: "dashed",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7FCF5",
    minHeight: 150,
  },

  photoIcon: {
    fontSize: 40,
    marginBottom: 8,
  },

  photoButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 5,
  },

  photoSubtext: {
    fontSize: 13,
    color: "#777",
    textAlign: "center",
  },

  photoList: {
    paddingVertical: 4,
    paddingRight: 10,
  },

  photoItem: {
    width: 145,
    height: 145,
    marginRight: 12,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },

  photoPreview: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },

  photoNumber: {
    position: "absolute",
    left: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(70, 133, 133, 0.9)",
    alignItems: "center",
    justifyContent: "center",
  },

  photoNumberText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  removePhotoButton: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    justifyContent: "center",
  },

  removePhotoText: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 23,
    fontWeight: "500",
  },

  addAnotherPhotoButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#9CDBA6",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },

  addAnotherPhotoText: {
    color: "#468585",
    fontSize: 14,
    fontWeight: "700",
  },


  /* GPS */

  locationDescription: {
    fontSize: 13,
    color: "#777",
    lineHeight: 19,
    marginBottom: 14,
  },

  locationButton: {
    minHeight: 50,
    backgroundColor: "#50B498",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },

  locationIcon: {
    fontSize: 20,
    marginRight: 8,
  },

  locationButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },

  coordinatesContainer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  coordinateBox: {
    flex: 1,
    backgroundColor: "#F1F8EE",
    borderRadius: 10,
    padding: 12,
  },

  coordinateLabel: {
    fontSize: 12,
    color: "#777",
    marginBottom: 5,
  },

  coordinateValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#468585",
  },


  /* Info */

  infoBox: {
    flexDirection: "row",
    backgroundColor: "#DEF9C4",
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },

  infoIcon: {
    fontSize: 18,
    marginRight: 10,
  },

  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: "#466047",
  },


  /* Buttons */

  saveButton: {
    backgroundColor: "#468585",
    borderRadius: 12,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  disabledButton: {
    backgroundColor: "#A9BDB4",
  },

  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  cancelButton: {
    backgroundColor: "#E8F1E5",
    borderRadius: 12,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },

  cancelButtonText: {
    color: "#468585",
    fontSize: 15,
    fontWeight: "700",
  },

});