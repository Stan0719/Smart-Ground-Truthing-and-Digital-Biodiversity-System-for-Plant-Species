import React, {
  useState,
} from "react";

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

import {
  botanistPlantRecords,
} from "../data/mockData";

import {
  qrCodes,
  assignQRCode,
} from "../data/qrData";


export default function AddPlantScreen({
  route,
  navigation,
}) {

  const botanist =
    route.params?.botanist;


  // =====================================================
  // BASIC INFORMATION
  // =====================================================

  const [
    scientificName,
    setScientificName,
  ] = useState("");

  const [
    commonName,
    setCommonName,
  ] = useState("");

  const [
    family,
    setFamily,
  ] = useState("");

  const [
    category,
    setCategory,
  ] = useState("");


  // =====================================================
  // PLANT INFORMATION
  // =====================================================

  const [
    height,
    setHeight,
  ] = useState("");

  const [
    description,
    setDescription,
  ] = useState("");

  const [
    overview,
    setOverview,
  ] = useState("");

  const [
    habitat,
    setHabitat,
  ] = useState("");

  const [
    significance,
    setSignificance,
  ] = useState("");

  const [
    characteristics,
    setCharacteristics,
  ] = useState("");


  // =====================================================
  // LOCATION
  // =====================================================

  const [
    latitude,
    setLatitude,
  ] = useState("");

  const [
    longitude,
    setLongitude,
  ] = useState("");

  const [
    loadingLocation,
    setLoadingLocation,
  ] = useState(false);


  // =====================================================
  // PHOTOS
  // =====================================================

  const [
    photos,
    setPhotos,
  ] = useState([]);


  // =====================================================
  // QR CODE
  // =====================================================

  const [
    selectedQRCode,
    setSelectedQRCode,
  ] = useState("");

  const [
    showQRDropdown,
    setShowQRDropdown,
  ] = useState(false);


  // =====================================================
  // AVAILABLE QR CODES
  // =====================================================

  const availableQRCodes =
    qrCodes.filter(
      (qr) =>
        qr.status ===
        "AVAILABLE"
    );


  // =====================================================
  // GET LOCATION
  // =====================================================

  async function handleGetLocation() {

    try {

      setLoadingLocation(true);


      const {
        status,
      } =
        await Location.requestForegroundPermissionsAsync();


      if (
        status !==
        "granted"
      ) {

        Alert.alert(
          "Permission Required",
          "Location permission is required to record the plant location."
        );

        setLoadingLocation(false);

        return;
      }


      const location =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy.High,
          }
        );


      const lat =
        location.coords.latitude
          .toFixed(6);

      const lng =
        location.coords.longitude
          .toFixed(6);


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
        "Location Error",
        "Unable to get the current location."
      );

    } finally {

      setLoadingLocation(false);

    }
  }


  // =====================================================
  // TAKE PHOTO
  // =====================================================

  async function handleTakePhoto() {

    try {

      const {
        status,
      } =
        await ImagePicker.requestCameraPermissionsAsync();


      if (
        status !==
        "granted"
      ) {

        Alert.alert(
          "Permission Required",
          "Camera permission is required to take a plant photo."
        );

        return;
      }


      const result =
        await ImagePicker.launchCameraAsync(
          {
            mediaTypes: [
              "images",
            ],

            allowsEditing:
              true,

            aspect: [
              4,
              3,
            ],

            quality: 0.8,
          }
        );


      if (
        !result.canceled &&
        result.assets &&
        result.assets.length > 0
      ) {

        setPhotos(
          (previous) => [
            ...previous,
            result.assets[0].uri,
          ]
        );

      }

    } catch (error) {

      console.log(
        "Camera error:",
        error
      );

      Alert.alert(
        "Camera Error",
        "Unable to open the camera."
      );

    }
  }


  // =====================================================
  // SELECT PHOTOS
  // =====================================================

  async function handleSelectPhotos() {

    try {

      const {
        status,
      } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();


      if (
        status !==
        "granted"
      ) {

        Alert.alert(
          "Permission Required",
          "Photo library permission is required."
        );

        return;
      }


      const result =
        await ImagePicker.launchImageLibraryAsync(
          {
            mediaTypes: [
              "images",
            ],

            allowsEditing:
              false,

            allowsMultipleSelection:
              true,

            selectionLimit:
              10,

            quality: 0.8,
          }
        );


      if (
        !result.canceled &&
        result.assets
      ) {

        const selectedPhotos =
          result.assets.map(
            (asset) =>
              asset.uri
          );


        setPhotos(
          (previous) => [
            ...previous,
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
        "Gallery Error",
        "Unable to open the photo library."
      );

    }
  }


  // =====================================================
  // REMOVE PHOTO
  // =====================================================

  function handleRemovePhoto(
    index
  ) {

    setPhotos(
      (previous) =>
        previous.filter(
          (_, photoIndex) =>
            photoIndex !==
            index
        )
    );
  }


  // =====================================================
  // SELECT QR
  // =====================================================

  function handleSelectQRCode(
    qr
  ) {

    setSelectedQRCode(
      qr.id
    );

    setShowQRDropdown(
      false
    );

  }


  // =====================================================
  // SAVE PLANT
  // =====================================================

  function handleSavePlant() {

    // -------------------------------------------------
    // VALIDATION
    // -------------------------------------------------

    if (
      !selectedQRCode
    ) {

      Alert.alert(
        "QR Code Required",
        "Please select a QR code."
      );

      return;
    }


    if (
      !scientificName.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the scientific name."
      );

      return;
    }


    if (
      !commonName.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the common name."
      );

      return;
    }


    if (
      !family.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the plant family."
      );

      return;
    }


    if (
      !category.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the plant category."
      );

      return;
    }


    if (
      !latitude ||
      !longitude
    ) {

      Alert.alert(
        "Location Required",
        "Please capture the plant's GPS location."
      );

      return;
    }


    // -------------------------------------------------
    // CHARACTERISTICS
    // -------------------------------------------------

    const characteristicList =
      characteristics
        .split("\n")
        .map(
          (item) =>
            item.trim()
        )
        .filter(
          (item) =>
            item.length > 0
        );


    // -------------------------------------------------
    // PLANT ID
    // -------------------------------------------------

    const newPlantId =
      `NIAH-PLANT-${Date.now()}`;


    // -------------------------------------------------
    // SLUG
    // -------------------------------------------------

    const slug =
      scientificName
        .toLowerCase()
        .trim()
        .replace(
          /\s+/g,
          "-"
        );


    // -------------------------------------------------
    // SELECTED QR
    // -------------------------------------------------

    const selectedQR =
      qrCodes.find(
        (qr) =>
          qr.id ===
          selectedQRCode
      );


    if (!selectedQR) {

      Alert.alert(
        "QR Code Error",
        "The selected QR code could not be found."
      );

      return;
    }


    if (
      selectedQR.status !==
      "AVAILABLE"
    ) {

      Alert.alert(
        "QR Code Error",
        "The selected QR code is no longer available."
      );

      return;
    }


    // -------------------------------------------------
    // CREATE RECORD
    // -------------------------------------------------

    const newPlant = {

      id:
        newPlantId,

      slug:
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

      photos:
        photos,

      botanist:
        botanist?.name ||
        "Unknown",

      status:
        "pending",

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


    // -------------------------------------------------
    // ASSIGN QR
    // -------------------------------------------------

    const assigned =
      assignQRCode(
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


    // -------------------------------------------------
    // SAVE TO BOTANIST RECORDS
    // -------------------------------------------------

    botanistPlantRecords.push(
      newPlant
    );


    console.log(
      "New botanist plant:",
      newPlant
    );


    // -------------------------------------------------
    // SUCCESS
    // -------------------------------------------------

    Alert.alert(
      "Plant Submitted",
      "The plant record has been submitted for approval.",
      [
        {
          text: "OK",
          onPress: () =>
            navigation.goBack(),
        },
      ]
    );
  }


  // =====================================================
  // UI
  // =====================================================

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={
        styles.contentContainer
      }
      keyboardShouldPersistTaps="handled"
    >

      {/* HEADER */}

      <Text
        style={styles.title}
      >
        Add Plant Record
      </Text>


      <Text
        style={styles.subtitle}
      >
        Record a plant during your
        field survey
      </Text>


      {/* =================================================
          QR CODE
          ================================================= */}

      <Text
        style={styles.sectionTitle}
      >
        QR Code
      </Text>


      <TouchableOpacity
        style={
          styles.dropdown
        }
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
              styles.placeholder,
          ]}
        >

          {selectedQRCode ||
            "Select an available QR code"}

        </Text>


        <Text
          style={
            styles.dropdownArrow
          }
        >
          {showQRDropdown
            ? "▲"
            : "▼"}
        </Text>

      </TouchableOpacity>


      {showQRDropdown && (
        <View
          style={
            styles.dropdownList
          }
        >

          {availableQRCodes.length ===
            0 ? (

            <Text
              style={
                styles.noQRText
              }
            >
              No available QR codes.
              Generate a QR code first.
            </Text>

          ) : (

            availableQRCodes.map(
              (qr) => (

                <TouchableOpacity
                  key={qr.id}
                  style={
                    styles.dropdownItem
                  }
                  onPress={() =>
                    handleSelectQRCode(
                      qr
                    )
                  }
                >

                  <Text
                    style={
                      styles.dropdownItemText
                    }
                  >
                    {qr.id}
                  </Text>

                  <Text
                    style={
                      styles.availableText
                    }
                  >
                    AVAILABLE
                  </Text>

                </TouchableOpacity>

              )
            )

          )}

        </View>
      )}


      {/* =================================================
          BASIC INFORMATION
          ================================================= */}

      <Text
        style={styles.sectionTitle}
      >
        Basic Information
      </Text>


      <Text
        style={styles.label}
      >
        Scientific Name *
      </Text>

      <TextInput
        style={styles.input}
        value={
          scientificName
        }
        onChangeText={
          setScientificName
        }
        placeholder="e.g. Nepenthes rafflesiana"
        placeholderTextColor="#9AA7A0"
      />


      <Text
        style={styles.label}
      >
        Common Name *
      </Text>

      <TextInput
        style={styles.input}
        value={
          commonName
        }
        onChangeText={
          setCommonName
        }
        placeholder="e.g. Tropical Pitcher Plant"
        placeholderTextColor="#9AA7A0"
      />


      <Text
        style={styles.label}
      >
        Family *
      </Text>

      <TextInput
        style={styles.input}
        value={
          family
        }
        onChangeText={
          setFamily
        }
        placeholder="e.g. Nepenthaceae"
        placeholderTextColor="#9AA7A0"
      />


      <Text style={styles.label}>
  Category *
</Text>

<View style={styles.categoryContainer}>

  {[
    "Trees",
    "Flowers",
    "Ferns",
    "Climbers",
  ].map((item) => (

    <TouchableOpacity
      key={item}
      style={[
        styles.categoryOption,
        category === item &&
          styles.categoryOptionSelected,
      ]}
      onPress={() =>
        setCategory(item)
      }
      activeOpacity={0.8}
    >

      <Text
        style={[
          styles.categoryOptionText,
          category === item &&
            styles.categoryOptionTextSelected,
        ]}
      >
        {item}
      </Text>

    </TouchableOpacity>

  ))}

</View>


      {/* =================================================
          PLANT DETAILS
          ================================================= */}

      <Text
        style={styles.sectionTitle}
      >
        Plant Details
      </Text>


      <Text
        style={styles.label}
      >
        Height
      </Text>

      <TextInput
        style={styles.input}
        value={
          height
        }
        onChangeText={
          setHeight
        }
        placeholder="e.g. 80 cm"
        placeholderTextColor="#9AA7A0"
      />


      <Text
        style={styles.label}
      >
        Description
      </Text>

      <TextInput
        style={
          styles.textArea
        }
        value={
          description
        }
        onChangeText={
          setDescription
        }
        placeholder="Describe the plant..."
        placeholderTextColor="#9AA7A0"
        multiline
        textAlignVertical="top"
      />


      <Text
        style={styles.label}
      >
        Overview
      </Text>

      <TextInput
        style={
          styles.textArea
        }
        value={
          overview
        }
        onChangeText={
          setOverview
        }
        placeholder="General information..."
        placeholderTextColor="#9AA7A0"
        multiline
        textAlignVertical="top"
      />


      <Text
        style={styles.label}
      >
        Habitat
      </Text>

      <TextInput
        style={
          styles.textArea
        }
        value={
          habitat
        }
        onChangeText={
          setHabitat
        }
        placeholder="Describe the habitat..."
        placeholderTextColor="#9AA7A0"
        multiline
        textAlignVertical="top"
      />


      <Text
        style={styles.label}
      >
        Significance
      </Text>

      <TextInput
        style={
          styles.textArea
        }
        value={
          significance
        }
        onChangeText={
          setSignificance
        }
        placeholder="Why is this plant important?"
        placeholderTextColor="#9AA7A0"
        multiline
        textAlignVertical="top"
      />


      <Text
        style={styles.label}
      >
        Characteristics
      </Text>

      <Text
        style={
          styles.helperText
        }
      >
        Enter one characteristic
        per line.
      </Text>

      <TextInput
        style={
          styles.textArea
        }
        value={
          characteristics
        }
        onChangeText={
          setCharacteristics
        }
        placeholder={
          "Large leaves\nClimbing stem\nCarnivorous"
        }
        placeholderTextColor="#9AA7A0"
        multiline
        textAlignVertical="top"
      />


      {/* =================================================
          GPS
          ================================================= */}

      <Text
        style={styles.sectionTitle}
      >
        GPS Location
      </Text>


      <TouchableOpacity
        style={
          styles.locationButton
        }
        onPress={
          handleGetLocation
        }
        disabled={
          loadingLocation
        }
        activeOpacity={0.8}
      >

        {loadingLocation ? (

          <ActivityIndicator
            color="#FFFFFF"
          />

        ) : (

          <Text
            style={
              styles.locationButtonText
            }
          >
            📍 Capture Current Location
          </Text>

        )}

      </TouchableOpacity>


      <View
        style={styles.coordinatesRow}
      >

        <View
          style={
            styles.coordinateBox
          }
        >

          <Text
            style={
              styles.coordinateLabel
            }
          >
            Latitude
          </Text>

          <TextInput
            style={
              styles.coordinateInput
            }
            value={
              latitude
            }
            onChangeText={
              setLatitude
            }
            placeholder="0.000000"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

        </View>


        <View
          style={
            styles.coordinateBox
          }
        >

          <Text
            style={
              styles.coordinateLabel
            }
          >
            Longitude
          </Text>

          <TextInput
            style={
              styles.coordinateInput
            }
            value={
              longitude
            }
            onChangeText={
              setLongitude
            }
            placeholder="0.000000"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

        </View>

      </View>


      {/* =================================================
          PHOTOS
          ================================================= */}

      <Text
        style={styles.sectionTitle}
      >
        Plant Photos
      </Text>


      <View
        style={styles.photoButtons}
      >

        <TouchableOpacity
          style={
            styles.photoButton
          }
          onPress={
            handleTakePhoto
          }
          activeOpacity={0.8}
        >

          <Text
            style={
              styles.photoButtonText
            }
          >
            📷 Take Photo
          </Text>

        </TouchableOpacity>


        <TouchableOpacity
          style={
            styles.photoButton
          }
          onPress={
            handleSelectPhotos
          }
          activeOpacity={0.8}
        >

          <Text
            style={
              styles.photoButtonText
            }
          >
            🖼 Select Photos
          </Text>

        </TouchableOpacity>

      </View>


      {/* PHOTO PREVIEW */}

      {photos.length > 0 && (

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={
            false
          }
          style={
            styles.photoPreviewContainer
          }
        >

          {photos.map(
            (
              photo,
              index
            ) => (

              <View
                key={`${photo}-${index}`}
                style={
                  styles.photoWrapper
                }
              >

                <Image
                  source={{
                    uri: photo,
                  }}
                  style={
                    styles.photoPreview
                  }
                />


                <TouchableOpacity
                  style={
                    styles.removePhotoButton
                  }
                  onPress={() =>
                    handleRemovePhoto(
                      index
                    )
                  }
                >

                  <Text
                    style={
                      styles.removePhotoText
                    }
                  >
                    ×
                  </Text>

                </TouchableOpacity>

              </View>

            )
          )}

        </ScrollView>

      )}


      {/* =================================================
          BOTANIST
          ================================================= */}

      <View
        style={
          styles.botanistInfo
        }
      >

        <Text
          style={
            styles.botanistLabel
          }
        >
          Submitted by
        </Text>

        <Text
          style={
            styles.botanistName
          }
        >
          {botanist?.name ||
            "Unknown Botanist"}
        </Text>

      </View>


      {/* =================================================
          SAVE
          ================================================= */}

      <TouchableOpacity
        style={
          styles.saveButton
        }
        onPress={
          handleSavePlant
        }
        activeOpacity={0.8}
      >

        <Text
          style={
            styles.saveButtonText
          }
        >
          Submit Plant Record
        </Text>

      </TouchableOpacity>


      {/* CANCEL */}

      <TouchableOpacity
        style={
          styles.cancelButton
        }
        onPress={() =>
          navigation.goBack()
        }
        activeOpacity={0.8}
      >

        <Text
          style={
            styles.cancelButtonText
          }
        >
          Cancel
        </Text>

      </TouchableOpacity>

    </ScrollView>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles =
  StyleSheet.create({

    container: {
      flex: 1,
      backgroundColor: "#F7FBF4",
    },


    contentContainer: {
      padding: 20,
      paddingTop: 50,
      paddingBottom: 40,
    },


    title: {
      fontSize: 26,
      fontWeight: "700",
      color: "#234B3A",
    },


    subtitle: {
      marginTop: 5,
      marginBottom: 25,
      fontSize: 14,
      color: "#6D7F75",
    },


    // -------------------------------------------------
    // SECTION
    // -------------------------------------------------

    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#234B3A",
      marginTop: 20,
      marginBottom: 12,
    },


    label: {
      fontSize: 13,
      fontWeight: "600",
      color: "#365548",
      marginBottom: 6,
      marginTop: 10,
    },

    categoryContainer: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 10,
},

categoryOption: {
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 10,
  backgroundColor: "#FFFFFF",
  borderWidth: 1,
  borderColor: "#DCE8D6",
},

categoryOptionSelected: {
  backgroundColor: "#468585",
  borderColor: "#468585",
},

categoryOptionText: {
  fontSize: 13,
  fontWeight: "600",
  color: "#468585",
},

categoryOptionTextSelected: {
  color: "#FFFFFF",
},


    helperText: {
      fontSize: 11,
      color: "#7A8981",
      marginBottom: 5,
    },


    // -------------------------------------------------
    // INPUT
    // -------------------------------------------------

    input: {
      height: 48,
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#DCE8D6",
      borderRadius: 12,
      paddingHorizontal: 14,
      fontSize: 14,
      color: "#234B3A",
    },


    textArea: {
      minHeight: 100,
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#DCE8D6",
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      color: "#234B3A",
    },


    // -------------------------------------------------
    // QR
    // -------------------------------------------------

    dropdown: {
      minHeight: 50,
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#DCE8D6",
      borderRadius: 12,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },


    dropdownText: {
      flex: 1,
      fontSize: 14,
      color: "#234B3A",
    },


    placeholder: {
      color: "#9AA7A0",
    },


    dropdownArrow: {
      fontSize: 12,
      color: "#468585",
      marginLeft: 10,
    },


    dropdownList: {
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#DCE8D6",
      borderRadius: 12,
      marginTop: 5,
      overflow: "hidden",
    },


    dropdownItem: {
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor: "#EDF2EA",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },


    dropdownItemText: {
      fontSize: 14,
      fontWeight: "600",
      color: "#234B3A",
    },


    availableText: {
      fontSize: 10,
      fontWeight: "700",
      color: "#398344",
    },


    noQRText: {
      padding: 15,
      fontSize: 13,
      color: "#718078",
    },


    // -------------------------------------------------
    // LOCATION
    // -------------------------------------------------

    locationButton: {
      backgroundColor: "#50B498",
      borderRadius: 12,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },


    locationButtonText: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "700",
    },


    coordinatesRow: {
      flexDirection: "row",
      gap: 10,
    },


    coordinateBox: {
      flex: 1,
    },


    coordinateLabel: {
      fontSize: 11,
      color: "#6D7F75",
      marginBottom: 5,
    },


    coordinateInput: {
      height: 45,
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: "#DCE8D6",
      borderRadius: 10,
      paddingHorizontal: 10,
      color: "#234B3A",
      fontSize: 13,
    },


    // -------------------------------------------------
    // PHOTOS
    // -------------------------------------------------

    photoButtons: {
      flexDirection: "row",
      gap: 10,
    },


    photoButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: "#E8F5E4",
      alignItems: "center",
      justifyContent: "center",
    },


    photoButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: "#468585",
    },


    photoPreviewContainer: {
      marginTop: 14,
    },


    photoWrapper: {
      width: 110,
      height: 110,
      marginRight: 10,
      borderRadius: 12,
      overflow: "hidden",
      position: "relative",
    },


    photoPreview: {
      width: "100%",
      height: "100%",
    },


    removePhotoButton: {
      position: "absolute",
      top: 5,
      right: 5,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center",
      justifyContent: "center",
    },


    removePhotoText: {
      color: "#FFFFFF",
      fontSize: 20,
      lineHeight: 22,
    },


    // -------------------------------------------------
    // BOTANIST
    // -------------------------------------------------

    botanistInfo: {
      marginTop: 25,
      padding: 15,
      backgroundColor: "#E9F7E4",
      borderRadius: 12,
    },


    botanistLabel: {
      fontSize: 11,
      color: "#6D7F75",
    },


    botanistName: {
      marginTop: 4,
      fontSize: 15,
      fontWeight: "700",
      color: "#234B3A",
    },


    // -------------------------------------------------
    // SAVE
    // -------------------------------------------------

    saveButton: {
      marginTop: 25,
      minHeight: 52,
      borderRadius: 14,
      backgroundColor: "#468585",
      alignItems: "center",
      justifyContent: "center",
    },


    saveButtonText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "700",
    },


    // -------------------------------------------------
    // CANCEL
    // -------------------------------------------------

    cancelButton: {
      marginTop: 10,
      minHeight: 48,
      borderRadius: 14,
      backgroundColor: "#E8EEE6",
      alignItems: "center",
      justifyContent: "center",
    },


    cancelButtonText: {
      color: "#468585",
      fontSize: 14,
      fontWeight: "600",
    },

  });