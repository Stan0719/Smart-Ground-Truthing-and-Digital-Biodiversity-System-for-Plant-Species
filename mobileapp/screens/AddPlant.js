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

import {
  plants,
  botanistPlantRecords,
  botanistSpeciesRequests,
} from "../data/mockData";


import {
  qrCodes,
  assignQRCode,
} from "../data/qrData";

const CONSERVATION_STATUSES = [
  "Not Assessed",
  "Least Concern",
  "Near Threatened",
  "Vulnerable",
  "Endangered",
  "Critically Endangered",
];

const PHOTO_GUIDES = [
  {
    key: "wholePlant",
    title: "Whole Plant",
    description: "Capture the entire plant from a clear distance.",
    required: true,
  },
  {
    key: "leafCloseUp",
    title: "Leaf Close-up",
    description: "Capture the leaf shape and surface clearly.",
    required: true,
  },
  {
    key: "stemBark",
    title: "Stem / Bark",
    description: "Capture the stem, trunk, or bark texture clearly.",
    required: true,
  },
  {
    key: "flowerFruit",
    title: "Flower / Fruit",
    description: "Optional — capture only if currently present.",
    required: false,
  },
];

const REQUIRED_PHOTO_KEYS = PHOTO_GUIDES
  .filter((guide) => guide.required)
  .map((guide) => guide.key);

// =====================================================
// MAIN SCREEN
// =====================================================

export default function AddPlantScreen({
  route,
  navigation,
}) {

  const botanist = route.params?.botanist;


  // ===================================================
  // PLANT INFORMATION
  // ===================================================

  const [scientificName, setScientificName] =
    useState("");

  const [category, setCategory] =
    useState("");

  const [height, setHeight] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [characteristics, setCharacteristics] =
    useState("");

  const [healthStatus, setHealthStatus] = useState("Healthy");
  const [growthStage, setGrowthStage] = useState("");
  const [morphology, setMorphology] = useState("");
  const [zone, setZone] = useState("");

  // ===================================================
  // LOCATION
  // ===================================================

  const [latitude, setLatitude] =
    useState("");

  const [longitude, setLongitude] =
    useState("");

  const [loadingLocation, setLoadingLocation] =
    useState(false);
  
  const [altitude, setAltitude] = useState("");
  const [gpsAccuracy, setGpsAccuracy] = useState("");

  // ===================================================
  // PHOTOS
  // ===================================================

  const [guidedPhotos, setGuidedPhotos] = useState({
    wholePlant: null,
    leafCloseUp: null,
    stemBark: null,
    flowerFruit: null,
  });

  const [additionalPhotos, setAdditionalPhotos] = useState([]);

  const completedRequiredPhotos = REQUIRED_PHOTO_KEYS.filter(
    (key) => Boolean(guidedPhotos[key])
  ).length;


  // ===================================================
  // QR CODE
  // ===================================================

  const [selectedQRCode, setSelectedQRCode] =
    useState("");

  const [showQRDropdown, setShowQRDropdown] =
    useState(false);


  // ===================================================
  // NEW SPECIES REQUEST
  // ===================================================

  const [showSpeciesForm, setShowSpeciesForm] =
    useState(false);


  // These fields belong ONLY to the species request.

  const [speciesScientificName, setSpeciesScientificName] = useState("");
  const [speciesCommonName, setSpeciesCommonName] = useState("");
  const [speciesGenus, setSpeciesGenus] = useState("");
  const [speciesFamily, setSpeciesFamily] = useState("");

  const [showConservationDropdown, setShowConservationDropdown] =
    useState(false);

  const [speciesConservationStatus, setSpeciesConservationStatus] =
    useState("Not Assessed");

  const [speciesDescription, setSpeciesDescription] = useState("");
  const [speciesHabitat, setSpeciesHabitat] = useState("");
  const [speciesImages, setSpeciesImages] = useState([]);


  // ===================================================
  // SPECIES REQUEST ID
  // ===================================================

  const [speciesRequestId, setSpeciesRequestId] =
    useState(null);


  // ===================================================
  // SPECIES REQUEST PREPARED
  // ===================================================

  const [speciesRequestAdded, setSpeciesRequestAdded] =
    useState(false);


  // ===================================================
  // AVAILABLE QR CODES
  // ===================================================

  const availableQRCodes = qrCodes.filter(
    (qr) => qr.status === "AVAILABLE"
  );


  // ===================================================
  // GET CURRENT LOCATION
  // ===================================================

  async function handleGetLocation() {

    try {

      setLoadingLocation(true);


      const {
        status,
      } =
        await Location.requestForegroundPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          "Permission Required",
          "Location permission is required to get the plant location."
        );

        return;
      }


      const location =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });


      const lat = location.coords.latitude.toFixed(6);
      const lng = location.coords.longitude.toFixed(6);

      setLatitude(lat);
      setLongitude(lng);

      setAltitude(
        location.coords.altitude != null
          ? location.coords.altitude.toFixed(2)
          : ""
      );

      setGpsAccuracy(
        location.coords.accuracy != null
          ? location.coords.accuracy.toFixed(2)
          : ""
      );

    } catch (error) {

      console.log(
        "Location error:",
        error
      );

      Alert.alert(
        "Location Error",
        "Unable to get your current location."
      );

    } finally {

      setLoadingLocation(false);

    }
  }


  // ===================================================
  // TAKE PHOTO
  // ===================================================

  async function handleTakeGuidedPhoto(photoKey) {

    try {

      const {
        status,
      } =
        await ImagePicker.requestCameraPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          "Permission Required",
          "Camera permission is required."
        );

        return;
      }


      const result =
        await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.8,
        });


      if (!result.canceled) {

        const uri =
          result.assets[0].uri;


        setGuidedPhotos((current) => ({
          ...current,
          [photoKey]: uri,
        }));

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

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== "granted") {
        Alert.alert("Permission Required", "Camera permission is required.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });

      if (!result.canceled) {
        setAdditionalPhotos((current) => [
          ...current,
          result.assets[0].uri,
        ]);
      }
    } catch (error) {
      console.log("Camera error:", error);
      Alert.alert("Camera Error", "Unable to open the camera.");
    }
  }


  // ===================================================
  // PICK PHOTO FROM GALLERY
  // ===================================================

  async function handlePickGuidedPhoto(photoKey) {

    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== "granted") {
        Alert.alert("Permission Required", "Gallery permission is required.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.8,
      });

      if (!result.canceled) {
        setGuidedPhotos((current) => ({
          ...current,
          [photoKey]: result.assets[0].uri,
        }));
      }
    } catch (error) {
      console.log("Gallery error:", error);
      Alert.alert("Gallery Error", "Unable to open the gallery.");
    }
  }

  async function handlePickPhoto() {

    try {

      const {
        status,
      } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();


      if (status !== "granted") {

        Alert.alert(
          "Permission Required",
          "Gallery permission is required."
        );

        return;
      }


      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          quality: 0.8,
        });


      if (!result.canceled) {

        const selectedPhotos =
          result.assets.map(
            (asset) => asset.uri
          );


        setAdditionalPhotos((current) => [
          ...current,
          ...selectedPhotos,
        ]);

      }

    } catch (error) {

      console.log(
        "Gallery error:",
        error
      );

      Alert.alert(
        "Gallery Error",
        "Unable to open the gallery."
      );

    }
  }


  // ===================================================
  // REMOVE PHOTO
  // ===================================================

  function handleRemovePhoto(index) {

    setAdditionalPhotos((current) =>
      current.filter(
        (_, photoIndex) =>
          photoIndex !== index
      )
    );

  }

  function handleRemoveGuidedPhoto(photoKey) {
    setGuidedPhotos((current) => ({
      ...current,
      [photoKey]: null,
    }));
  }


  // ===================================================
  // ADD SPECIES REQUEST
  //
  // IMPORTANT:
  //
  // This does NOT submit anything.
  //
  // It only prepares the species request.
  //
  // The actual species request will be saved when
  // "Submit Plant Record" is pressed.
  // ===================================================

  
async function handleTakeSpeciesPhoto() {
  try {
    const { status } =
      await ImagePicker.requestCameraPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Camera permission is required to take a species photo."
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length > 0) {
      setSpeciesImages((current) => [
        ...current,
        result.assets[0].uri,
      ]);
    }
  } catch (error) {
    console.log("Species camera error:", error);
    Alert.alert("Camera Error", "Unable to open the camera.");
  }
}

async function handlePickSpeciesPhoto() {
  try {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Gallery permission is required to select species photos."
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const selectedImages = result.assets.map(
        (asset) => asset.uri
      );

      setSpeciesImages((current) => [
        ...current,
        ...selectedImages,
      ]);
    }
  } catch (error) {
    console.log("Species gallery error:", error);
    Alert.alert("Gallery Error", "Unable to open the gallery.");
  }
}

function handleRemoveSpeciesPhoto(index) {
  setSpeciesImages((current) =>
    current.filter((_, imageIndex) => imageIndex !== index)
  );
}


  function handleAddSpeciesRequest() {

    // -------------------------------------------------
    // VALIDATE SPECIES INFORMATION
    // -------------------------------------------------

    if (
      !speciesScientificName.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the scientific name of the new species."
      );

      return;
    }


    if (
      !speciesCommonName.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the common name of the new species."
      );

      return;
    }

    if (!speciesGenus.trim()) {
      Alert.alert(
        "Missing Information",
        "Please enter the genus of the new species."
      );

      return;
    }


    if (
      !speciesFamily.trim()
    ) {

      Alert.alert(
        "Missing Information",
        "Please enter the family of the new species."
      );

      return;
    }

    
    // -------------------------------------------------
    // CREATE SPECIES REQUEST ID
    // -------------------------------------------------

    const requestId =
      `NIAH-SPECIES-${Date.now()}`;


    setSpeciesRequestId(
      requestId
    );


    setSpeciesRequestAdded(
      true
    );


    // -------------------------------------------------
    // CLOSE FORM
    // -------------------------------------------------

    setShowSpeciesForm(false);


    Alert.alert(
      "Species Request Added",
      "The new species request has been added. It will be submitted together with the plant record."
    );
  }




  // ===================================================
  // EDIT SPECIES REQUEST
  // ===================================================

  function handleEditSpeciesRequest() {

    setShowSpeciesForm(true);

    setSpeciesRequestAdded(false);
  }


  // ===================================================
  // REMOVE SPECIES REQUEST
  // ===================================================

  function handleRemoveSpeciesRequest() {

    Alert.alert(
      "Remove Species Request",
      "Are you sure you want to remove this new species request?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },

        {
          text: "Remove",
          style: "destructive",

          onPress: () => {

            setSpeciesRequestId(
              null
            );

            setSpeciesRequestAdded(
              false
            );

            setSpeciesScientificName(
              ""
            );

            setSpeciesCommonName(
              ""
            );

            setSpeciesGenus(
              ""
            );

            setSpeciesFamily(
              ""
            );

            setSpeciesConservationStatus("Not Assessed");

            setSpeciesDescription("");
            setSpeciesHabitat("");
            setSpeciesImages([]);
            setShowConservationDropdown(false);

          },
        },
      ]
    );
  }


  // ===================================================
  // SUBMIT PLANT RECORD
  //
  // This is the ONLY final submit.
  //
  // It can submit:
  //
  // 1. Plant record
  //
  // 2. Species request if one was added
  //
  // ===================================================

  function handleSubmitPlant() {

    // =================================================
    // VALIDATE PLANT INFORMATION
    // =================================================

    if (!scientificName.trim()) {

      Alert.alert(
        "Missing Information",
        "Please enter the scientific name."
      );

      return;
    }

    if (!speciesRequestId && !category) {
      Alert.alert(
        "Missing Information",
        "Please select a category."
      );

      return;
    }


    // =================================================
    // VALIDATE LOCATION
    // =================================================

    if (!latitude || !longitude) {

      Alert.alert(
        "Missing Location",
        "Please get the current GPS location before submitting the plant record."
      );

      return;
    }


    // =================================================
    // VALIDATE QR CODE
    // =================================================

    if (!selectedQRCode) {

      Alert.alert(
        "Missing QR Code",
        "Please select a QR code."
      );

      return;
    }

    if (completedRequiredPhotos !== REQUIRED_PHOTO_KEYS.length) {
      Alert.alert(
        "Missing Required Photos",
        "Please capture the Whole Plant, Leaf Close-up, and Stem / Bark photos before submitting."
      );

      return;
    }


    const selectedQR =
      qrCodes.find(
        (qr) =>
          qr.id === selectedQRCode
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
        "QR Code Unavailable",
        "The selected QR code is no longer available."
      );

      return;
    }


    // =================================================
    // CREATE PLANT ID
    // =================================================

    const newPlantId =
      `NIAH-PLANT-${Date.now()}`;


    // =================================================
    // CREATE PLANT SLUG
    // =================================================

    const slug =
      scientificName
        .toLowerCase()
        .trim()
        .replace(
          /\s+/g,
          "-"
        );


    // =================================================
    // PLANT CHARACTERISTICS
    // =================================================

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


    // =================================================
    // CREATE PLANT RECORD
    //
    // THIS ONLY CONTAINS PLANT INFORMATION.
    // =================================================

    const newPlant = {

      // -----------------------------------------------
      // IDENTIFICATION
      // -----------------------------------------------

      id:
        newPlantId,

      plantId:
        newPlantId,

      slug:
        slug,


      // -----------------------------------------------
      // PLANT SPECIES INFORMATION
      // -----------------------------------------------

      scientificName: scientificName.trim(),

      speciesName: scientificName.trim(),

      category: category.trim(),

      speciesId: speciesRequestId
        ? null
        : (
            plants.find(
              (item) =>
                item.scientificName?.toLowerCase().trim() ===
                scientificName.trim().toLowerCase()
            )?.speciesId ||
            plants.find(
              (item) =>
                item.scientificName?.toLowerCase().trim() ===
                scientificName.trim().toLowerCase()
            )?.id ||
            null
          ),
      
      // -----------------------------------------------
      // PLANT DETAILS
      // -----------------------------------------------

      height: height.trim(),

      description: description.trim(),

      characteristics: characteristicList,

      // -----------------------------------------------
      // PLANT OBSERVATION DETAILS
      // -----------------------------------------------

      healthStatus: healthStatus.trim(),

      growthStage: growthStage.trim(),

      morphology: morphology.trim(),

      zone: zone.trim(),

      // Keep the same data structure used by the
      // existing mock plant records.
      latestApproved: {
        heightCm: height.trim(),
        healthStatus: healthStatus.trim(),
        lifeStage: growthStage.trim(),
        morphology: morphology.trim(),
        notes: description.trim(),
      },



      // -----------------------------------------------
      // LOCATION
      // -----------------------------------------------

      latitude: Number(latitude),

      longitude: Number(longitude),

      altitude: altitude.trim()
        ? Number(altitude)
        : null,

      gpsAccuracy: gpsAccuracy.trim()
        ? Number(gpsAccuracy)
        : null,


      // -----------------------------------------------
      // PHOTOS
      // -----------------------------------------------

      photos: [
        guidedPhotos.wholePlant,
        guidedPhotos.leafCloseUp,
        guidedPhotos.stemBark,
        guidedPhotos.flowerFruit,
        ...additionalPhotos,
      ].filter(Boolean),

      guidedPhotos: {
        ...guidedPhotos,
      },


      // -----------------------------------------------
      // BOTANIST
      // -----------------------------------------------

      botanist:
        botanist?.name ||
        "Unknown",


      // -----------------------------------------------
      // PLANT APPROVAL
      // -----------------------------------------------

      status:
        "pending",

      approvalStatus:
        "PENDING_APPROVAL",


      // -----------------------------------------------
      // LINK TO SPECIES REQUEST
      //
      // null if existing species
      // ID if new species was requested
      // -----------------------------------------------

      speciesRequestId:
        speciesRequestId ||
        null,


      speciesStatus:
        speciesRequestId
          ? "pending"
          : "existing",


      // -----------------------------------------------
      // QR CODE
      // -----------------------------------------------

      qrCode:
        selectedQRCode,

      qrStatus:
        "PENDING_APPROVAL",

      qrGenerated:
        true,

      qrValue:
        selectedQR.value,


      // -----------------------------------------------
      // SYNC
      // -----------------------------------------------

      syncStatus:
        "Pending Sync",


      // -----------------------------------------------
      // DATE
      // -----------------------------------------------

      createdAt:
        new Date().toISOString(),
    };


    // =================================================
    // ASSIGN QR CODE
    // =================================================

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


    // =================================================
    // CREATE SPECIES REQUEST
    //
    // ONLY IF THE BOTANIST ADDED A NEW SPECIES REQUEST
    //
    // THIS IS SEPARATE FROM THE PLANT RECORD.
    // =================================================

    if (
      speciesRequestId
    ) {

      const speciesRequest = {

        // ---------------------------------------------
        // SPECIES REQUEST ID
        // ---------------------------------------------

        id:
          speciesRequestId,


        // ---------------------------------------------
        // SPECIES INFORMATION
        // ---------------------------------------------

        scientificName: speciesScientificName.trim(),
        commonName: speciesCommonName.trim(),
        genus: speciesGenus.trim(),
        family: speciesFamily.trim(),
        conservationStatus: speciesConservationStatus,
        description: speciesDescription.trim(),
        habitat: speciesHabitat.trim(),
        images: speciesImages,


        // ---------------------------------------------
        // BOTANIST
        // ---------------------------------------------

        botanist:
          botanist?.name ||
          "Unknown",


        // ---------------------------------------------
        // SPECIES APPROVAL
        // ---------------------------------------------

        status:
          "pending",

        approvalStatus:
          "PENDING_APPROVAL",


        // ---------------------------------------------
        // LINK TO PLANT
        // ---------------------------------------------

        plantRecordId:
          newPlantId,


        // ---------------------------------------------
        // DATE
        // ---------------------------------------------

        createdAt:
          new Date().toISOString(),
      };


      botanistSpeciesRequests.push(
        speciesRequest
      );
    }


    // =================================================
    // SAVE PLANT RECORD
    // =================================================

    botanistPlantRecords.push(
      newPlant
    );


    // =================================================
    // SUCCESS MESSAGE
    // =================================================

    if (
      speciesRequestId
    ) {

      Alert.alert(
        "Submitted Successfully",
        "The plant record and new species request have both been submitted. Both will remain pending until they are reviewed and approved.",
        [
          {
            text: "OK",
            onPress: () =>
              navigation.goBack(),
          },
        ]
      );

    } else {

      Alert.alert(
        "Plant Submitted",
        "The plant record has been submitted and is waiting for administrator approval.",
        [
          {
            text: "OK",
            onPress: () =>
              navigation.goBack(),
          },
        ]
      );

    }
  }


  // ===================================================
  // CANCEL
  // ===================================================

  function handleCancel() {

    Alert.alert(
      "Cancel",
      "Are you sure you want to leave? Your entered information will be lost.",
      [
        {
          text: "Stay",
          style: "cancel",
        },

        {
          text: "Leave",
          style: "destructive",

          onPress: () =>
            navigation.goBack(),
        },
      ]
    );
  }


  // ===================================================
  // UI
  // ===================================================

  return (

    <View style={styles.container}>

      {/* =================================================
          SCROLL FORM
      ================================================= */}

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={
          styles.scrollContent
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >


        {/* =================================================
            PLANT INFORMATION
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >
            Plant Information
          </Text>

          {/* ---------------------------------------------
              Category
          --------------------------------------------- */}

          {!showSpeciesForm && !speciesRequestAdded && (

          <>
            <Text style={styles.label}>
              Species *
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
                    setCategory(
                      category === item ? "" : item
                    )
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
          </>

        )}


          {/* =================================================
              NEW SPECIES REQUEST
          ================================================= */}

          <View
            style={styles.speciesDivider}
          />


          <Text
            style={styles.speciesQuestion}
          >
            Can't find this species?
          </Text>


          <Text
            style={
              styles.speciesQuestionDescription
            }
          >
            Request a new species to be added to
            the system. The species request will
            be submitted together with this plant
            record.
          </Text>


          {!speciesRequestAdded && (

            <TouchableOpacity
            style={styles.requestSpeciesButton}
            onPress={() => {

              if (!showSpeciesForm) {
                // Opening new species request
                // means the existing plant category
                // should be cleared.
                setCategory("");
              }

              setShowSpeciesForm(
                !showSpeciesForm
              );

            }}
            activeOpacity={0.8}
          >

              <Text
                style={
                  styles.requestSpeciesButtonText
                }
              >
                {showSpeciesForm
                  ? "− Hide New Species Form"
                  : "+ Request to Add New Species"}
              </Text>

            </TouchableOpacity>

          )}


          {/* =================================================
              INLINE SPECIES REQUEST FORM
          ================================================= */}

          {showSpeciesForm &&
            !speciesRequestAdded && (

            <View
              style={
                styles.speciesRequestCard
              }
            >

              <Text
                style={
                  styles.speciesRequestTitle
                }
              >
                New Species Information
              </Text>


              <Text
                style={
                  styles.speciesRequestSubtitle
                }
              >
                Enter information about the species
                that is not currently available in
                the system.
              </Text>


              {/* -------------------------------------------
                  Species Scientific Name
              ------------------------------------------- */}

              <Text style={styles.label}>
                Scientific Name *
              </Text>

              <TextInput
                style={styles.input}
                value={
                  speciesScientificName
                }
                onChangeText={
                  setSpeciesScientificName
                }
                placeholder="e.g. Nepenthes mirabilis"
                placeholderTextColor="#9AA7A0"
              />


              {/* -------------------------------------------
                  Species Common Name
              ------------------------------------------- */}

              <Text style={styles.label}>
                Common Name *
              </Text>

              <TextInput
                style={styles.input}
                value={
                  speciesCommonName
                }
                onChangeText={
                  setSpeciesCommonName
                }
                placeholder="e.g. Swamp Pitcher Plant"
                placeholderTextColor="#9AA7A0"
              />

              {/* Species Genus */}

              <Text style={styles.label}>
                Genus *
              </Text>

              <TextInput
                style={styles.input}
                value={speciesGenus}
                onChangeText={setSpeciesGenus}
                placeholder="e.g. Nepenthes"
                placeholderTextColor="#9AA7A0"
              />


              {/* -------------------------------------------
                  Species Family
              ------------------------------------------- */}

              <Text style={styles.label}>
                Family *
              </Text>

              <TextInput
                style={styles.input}
                value={
                  speciesFamily
                }
                onChangeText={
                  setSpeciesFamily
                }
                placeholder="e.g. Nepenthaceae"
                placeholderTextColor="#9AA7A0"
              />

              
              <Text style={styles.label}>Conservation Status</Text>

              <TouchableOpacity
                style={styles.qrSelector}
                onPress={() =>
                  setShowConservationDropdown((current) => !current)
                }
                activeOpacity={0.8}
              >
                <Text style={styles.qrSelectedText}>
                  {speciesConservationStatus}
                </Text>

                <Text style={styles.dropdownArrow}>
                  {showConservationDropdown ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>

              {showConservationDropdown && (
                <View style={styles.qrDropdown}>
                  {CONSERVATION_STATUSES.map((status) => (
                    <TouchableOpacity
                      key={status}
                      style={styles.qrOption}
                      onPress={() => {
                        setSpeciesConservationStatus(status);
                        setShowConservationDropdown(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.qrOptionText}>
                        {status}
                      </Text>

                      <Text style={styles.dropdownArrow}>
                        {speciesConservationStatus === status ? "✓" : ""}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}



              
              {/* Species Description */}

              <Text style={styles.label}>
                Description
              </Text>

              <TextInput
                style={styles.textArea}
                value={speciesDescription}
                onChangeText={setSpeciesDescription}
                placeholder="Describe the species and its identifying features..."
                placeholderTextColor="#9AA7A0"
                multiline
                textAlignVertical="top"
              />

              {/* Habitat / Ecological Information */}

              <Text style={styles.label}>
                Habitat / Ecological Information
              </Text>

              <TextInput
                style={styles.textArea}
                value={speciesHabitat}
                onChangeText={setSpeciesHabitat}
                placeholder="Describe its natural habitat, growing conditions, and ecological role..."
                placeholderTextColor="#9AA7A0"
                multiline
                textAlignVertical="top"
              />

              
              {/* Species Photos */}

              <Text style={styles.label}>
                Species Photos
              </Text>

              <View style={styles.photoButtonRow}>
                <TouchableOpacity
                  style={styles.photoButton}
                  onPress={handleTakeSpeciesPhoto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.photoButtonText}>
                    📷 Camera
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.photoButton}
                  onPress={handlePickSpeciesPhoto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.photoButtonText}>
                    🖼 Gallery
                  </Text>
                </TouchableOpacity>
              </View>

              {speciesImages.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.speciesPhotoScroll}
                  contentContainerStyle={styles.speciesPhotoRow}
                >
                  {speciesImages.map((photo, index) => (
                    <View
                      key={`${photo}-${index}`}
                      style={styles.speciesPhotoItem}
                    >
                      <Image
                        source={{ uri: photo }}
                        style={styles.speciesPhotoPreview}
                        resizeMode="cover"
                      />

                      <TouchableOpacity
                        style={styles.removeSpeciesPhotoButton}
                        onPress={() => handleRemoveSpeciesPhoto(index)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.removeSpeciesPhotoText}>
                          ✕ Remove
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}




              {/* -------------------------------------------
                  SPECIES APPROVAL INFO
              ------------------------------------------- */}

              <View
                style={styles.approvalInfo}
              >

                <Text
                  style={
                    styles.approvalTitle
                  }
                >
                  Species Approval Required
                </Text>

                <Text
                  style={
                    styles.approvalText
                  }
                >
                  This species request will be submitted
                  together with the plant record. It will
                  remain pending until an administrator
                  reviews and approves it.
                </Text>

              </View>


              {/* -------------------------------------------
                  ADD SPECIES REQUEST
              ------------------------------------------- */}

              <TouchableOpacity
                style={
                  styles.useSpeciesButton
                }
                onPress={
                  handleAddSpeciesRequest
                }
                activeOpacity={0.8}
              >

                <Text
                  style={
                    styles.useSpeciesButtonText
                  }
                >
                  Add Species Request
                </Text>

              </TouchableOpacity>

            </View>

          )}


          {/* =================================================
              SPECIES REQUEST SUMMARY
          ================================================= */}

          {speciesRequestAdded && (

            <View
              style={
                styles.pendingSpeciesCard
              }
            >

              <View
                style={
                  styles.pendingSpeciesHeader
                }
              >

                <Text
                  style={
                    styles.pendingSpeciesTitle
                  }
                >
                  New Species Request
                </Text>

                <View
                  style={
                    styles.pendingBadge
                  }
                >

                  <Text
                    style={
                      styles.pendingBadgeText
                    }
                  >
                    Pending
                  </Text>

                </View>

              </View>


              <Text
                style={
                  styles.pendingSpeciesName
                }
              >
                {speciesCommonName}
              </Text>


              <Text
                style={
                  styles.pendingSpeciesScientific
                }
              >
                {speciesScientificName}
              </Text>


              <Text
                style={
                  styles.pendingSpeciesText
                }
              >
                This species request will be submitted
                together with the plant record.
              </Text>


              <View
                style={
                  styles.speciesActionRow
                }
              >

                <TouchableOpacity
                  style={
                    styles.editSpeciesButton
                  }
                  onPress={
                    handleEditSpeciesRequest
                  }
                  activeOpacity={0.8}
                >

                  <Text
                    style={
                      styles.editSpeciesText
                    }
                  >
                    Edit
                  </Text>

                </TouchableOpacity>


                <TouchableOpacity
                  style={
                    styles.removeSpeciesButton
                  }
                  onPress={
                    handleRemoveSpeciesRequest
                  }
                  activeOpacity={0.8}
                >

                  <Text
                    style={
                      styles.removeSpeciesText
                    }
                  >
                    Remove
                  </Text>

                </TouchableOpacity>

              </View>

            </View>

          )}


          {/* ---------------------------------------------
              Scientific Name
          --------------------------------------------- */}

          <Text style={styles.label}>
            Scientific Name *
          </Text>

          <TextInput
            style={styles.input}
            value={scientificName}
            onChangeText={
              setScientificName
            }
            placeholder="e.g. Nepenthes rafflesiana"
            placeholderTextColor="#9AA7A0"
          />


          {/* Height */}

          <Text style={styles.label}>
            Height (cm)
          </Text>

          <TextInput
            style={styles.input}
            value={height}
            onChangeText={setHeight}
            placeholder="e.g. 80"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          {/* Health Status */}

          <Text style={styles.label}>
            Health Status *
          </Text>

          <TextInput
            style={styles.input}
            value={healthStatus}
            onChangeText={setHealthStatus}
            placeholder="e.g. Healthy, Monitoring, Poor"
            placeholderTextColor="#9AA7A0"
          />

          {/* Growth Stage */}

          <Text style={styles.label}>
            Growth Stage *
          </Text>

          <TextInput
            style={styles.input}
            value={growthStage}
            onChangeText={setGrowthStage}
            placeholder="e.g. Seedling, Juvenile, Mature, Flowering"
            placeholderTextColor="#9AA7A0"
          />

          {/* Morphology */}

          <Text style={styles.label}>
            Morphology *
          </Text>

          <TextInput
            style={styles.textArea}
            value={morphology}
            onChangeText={setMorphology}
            placeholder="Describe the plant's physical characteristics..."
            placeholderTextColor="#9AA7A0"
            multiline
            textAlignVertical="top"
          />

          {/* Location Zone */}

          <Text style={styles.label}>
            Location (Zone) *
          </Text>

          <TextInput
            style={styles.input}
            value={zone}
            onChangeText={setZone}
            placeholder="e.g. Zone A"
            placeholderTextColor="#9AA7A0"
          />


          

        </View>


        {/* =================================================
            ADDITIONAL PLANT INFORMATION
        ================================================= */}

        <View style={styles.card}>

          <Text style={styles.sectionTitle}>
            Staff Record
          </Text>

          <Text style={styles.sectionDescription}>
            Record the GPS information and assign a QR tag
            to the plant.
          </Text>

          
        {/* =================================================
            LOCATION
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >
            GPS Information
          </Text>


          <Text
            style={styles.sectionDescription}
          >
            Use your current GPS location to record
            where this plant was found.
          </Text>


          {/* Latitude */}

          <Text style={styles.label}>
            Latitude *
          </Text>

          <TextInput
            style={styles.input}
            value={latitude}
            onChangeText={
              setLatitude
            }
            placeholder="e.g. 3.812345"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />


          {/* Longitude */}

          <Text style={styles.label}>
            Longitude *
          </Text>

          <TextInput
            style={styles.input}
            value={longitude}
            onChangeText={
              setLongitude
            }
            placeholder="e.g. 113.812345"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          <Text style={styles.label}>
            Altitude (m)
          </Text>

          <TextInput
            style={styles.input}
            value={altitude}
            onChangeText={setAltitude}
            placeholder="GPS altitude in metres"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />

          <Text style={styles.label}>
            GPS Accuracy (m)
          </Text>

          <TextInput
            style={styles.input}
            value={gpsAccuracy}
            onChangeText={setGpsAccuracy}
            placeholder="GPS accuracy in metres"
            placeholderTextColor="#9AA7A0"
            keyboardType="numeric"
          />


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
                📍 Get Current Location
              </Text>

            )}

          </TouchableOpacity>

          

        </View>

         {/* =================================================
            QR CODE
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >
            QR Code
          </Text>


          <Text
            style={styles.sectionDescription}
          >
            Select an available QR code for this plant.
          </Text>


          <TouchableOpacity
            style={
              styles.qrSelector
            }
            onPress={() =>
              setShowQRDropdown(
                !showQRDropdown
              )
            }
            activeOpacity={0.8}
          >

            <Text
              style={
                selectedQRCode
                  ? styles.qrSelectedText
                  : styles.qrPlaceholder
              }
            >
              {selectedQRCode ||
                "Select QR Code"}
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
                styles.qrDropdown
              }
            >

              {availableQRCodes.length === 0 ? (

                <Text
                  style={
                    styles.noQRText
                  }
                >
                  No available QR codes.
                </Text>

              ) : (

                availableQRCodes.map(
                  (qr) => (

                    <TouchableOpacity
                      key={qr.id}
                      style={
                        styles.qrOption
                      }
                      onPress={() => {

                        setSelectedQRCode(
                          qr.id
                        );

                        setShowQRDropdown(
                          false
                        );

                      }}
                    >

                      <Text
                        style={
                          styles.qrOptionText
                        }
                      >
                        {qr.id}
                      </Text>


                      <Text
                        style={
                          styles.qrAvailableText
                        }
                      >
                        Available
                      </Text>

                    </TouchableOpacity>

                  )
                )

              )}

            </View>

          )}

        </View>
        </View>






        {/* =================================================
            PHOTOS
        ================================================= */}

        <View style={styles.card}>

          <Text
            style={styles.sectionTitle}
          >
            Plant Photos
          </Text>


          <Text
            style={styles.sectionDescription}
          >
            Capture the required views to support plant
            identification and verification.
          </Text>

          <View style={styles.photoProgress}>
            <Text style={styles.photoProgressText}>
              {completedRequiredPhotos} of {REQUIRED_PHOTO_KEYS.length} required photos completed
            </Text>
          </View>

          {PHOTO_GUIDES.map((item) => {
            const photo = guidedPhotos[item.key];

            return (
              <View key={item.key} style={styles.photoGuideCard}>
                <View style={styles.photoGuideHeader}>
                  <Text style={styles.photoGuideTitle}>{item.title}</Text>
                  <Text
                    style={
                      photo
                        ? styles.photoGuideCompleteBadge
                        : item.required
                          ? styles.photoGuideRequiredBadge
                          : styles.photoGuideOptionalBadge
                    }
                  >
                    {photo ? "✓ Captured" : item.required ? "Required" : "Optional"}
                  </Text>
                </View>

                <Text style={styles.photoGuideDescription}>
                  {item.description}
                </Text>

                {photo && (
                  <Image
                    source={{ uri: photo }}
                    style={styles.guidedPhotoPreview}
                    resizeMode="cover"
                  />
                )}

                <View style={styles.guidedPhotoActions}>
                  <TouchableOpacity
                    style={styles.guidedPhotoActionButton}
                    onPress={() => handleTakeGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.photoButtonText}>
                      {photo ? "Retake" : "Take Photo"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.guidedPhotoActionButton}
                    onPress={() => handlePickGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.photoButtonText}>
                      {photo ? "Choose Another" : "Gallery"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {photo && (
                  <TouchableOpacity
                    style={styles.removeGuidedPhotoButton}
                    onPress={() => handleRemoveGuidedPhoto(item.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.removePhotoText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          <View style={styles.additionalPhotosHeader}>
            <Text style={styles.additionalPhotosTitle}>Additional Photos</Text>
            <Text style={styles.photoGuideDescription}>
              Optional — add any other useful plant views.
            </Text>
          </View>


          <View
            style={styles.photoButtonRow}
          >

            <TouchableOpacity
              style={styles.photoButton}
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
                📷 Camera
              </Text>

            </TouchableOpacity>


            <TouchableOpacity
              style={styles.photoButton}
              onPress={
                handlePickPhoto
              }
              activeOpacity={0.8}
            >

              <Text
                style={
                  styles.photoButtonText
                }
              >
                🖼 Gallery
              </Text>

            </TouchableOpacity>

          </View>


          {additionalPhotos.length > 0 && (

            <View
              style={styles.photoList}
            >

              {additionalPhotos.map(
                (photo, index) => (

                  <View
                    key={`${photo}-${index}`}
                    style={
                      styles.photoItem
                    }
                  >

                    <Image
                      source={{ uri: photo }}
                      style={styles.additionalPhotoPreview}
                      resizeMode="cover"
                    />

                    <Text
                      style={
                        styles.photoName
                      }
                      numberOfLines={1}
                    >
                      Photo {index + 1}
                    </Text>


                    <TouchableOpacity
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
                        Remove
                      </Text>

                    </TouchableOpacity>

                  </View>

                )
              )}

            </View>

          )}

        </View>


       


        {/* =================================================
            FINAL APPROVAL INFORMATION
        ================================================= */}

        <View
          style={
            styles.finalApprovalCard
          }
        >

          <Text
            style={
              styles.finalApprovalTitle
            }
          >
            Approval Required
          </Text>


          <Text
            style={
              styles.finalApprovalText
            }
          >
            This plant record will be submitted
            for administrator approval.
          </Text>


          {speciesRequestAdded && (

            <Text
              style={
                styles.finalApprovalText
              }
            >
              Your new species request will also be
              submitted together with this plant record
              and will remain pending until approved.
            </Text>

          )}

        </View>


        {/* =================================================
            FINAL SUBMIT
        ================================================= */}

        <TouchableOpacity
          style={
            styles.submitButton
          }
          onPress={
            handleSubmitPlant
          }
          activeOpacity={0.8}
        >

          <Text
            style={
              styles.submitButtonText
            }
          >
            Submit Plant Record
          </Text>

        </TouchableOpacity>


        {/* =================================================
            CANCEL
        ================================================= */}

        <TouchableOpacity
          style={
            styles.cancelButton
          }
          onPress={
            handleCancel
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

    </View>
  );
}


// =====================================================
// STYLES
// =====================================================

const styles = StyleSheet.create({

  // ===================================================
  // MAIN
  // ===================================================

  container: {
    flex: 1,
    backgroundColor: "#F5F9F3",
  },


  scrollView: {
    flex: 1,
  },


  scrollContent: {
    padding: 20,
    paddingBottom: 50,
  },


  // ===================================================
  // CARD
  // ===================================================

  card: {
    marginBottom: 18,
    padding: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E0EADF",
    elevation: 2,
    shadowColor: "#234B3A",
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },


  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#234B3A",
    marginBottom: 6,
  },


  sectionDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
    marginBottom: 12,
  },


  // ===================================================
  // FORM
  // ===================================================

  label: {
    marginTop: 15,
    marginBottom: 7,
    fontSize: 13,
    fontWeight: "600",
    color: "#234B3A",
  },


  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    backgroundColor: "#FAFCF9",
    color: "#234B3A",
    fontSize: 14,
  },


  textArea: {
    minHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    backgroundColor: "#FAFCF9",
    color: "#234B3A",
    fontSize: 14,
  },

  // ===================================================
  // CATEGORY
  // ===================================================

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


  // ===================================================
  // SPECIES REQUEST
  // ===================================================

  speciesDivider: {
    height: 1,
    backgroundColor: "#E5ECE2",
    marginTop: 22,
    marginBottom: 18,
  },


  speciesQuestion: {
    fontSize: 15,
    fontWeight: "700",
    color: "#234B3A",
  },


  speciesQuestionDescription: {
    marginTop: 5,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
  },


  requestSpeciesButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#468585",
    backgroundColor: "#F2FAF0",
    alignItems: "center",
    justifyContent: "center",
  },


  requestSpeciesButtonText: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "700",
  },


  speciesRequestCard: {
    marginTop: 15,
    padding: 18,
    backgroundColor: "#F8FBF7",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DCE8D6",
  },


  speciesRequestTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#234B3A",
  },


  speciesRequestSubtitle: {
    marginTop: 5,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    color: "#6D7F75",
  },


  approvalInfo: {
    marginTop: 20,
    padding: 14,
    backgroundColor: "#E9F7E4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4EBD0",
  },


  approvalTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#234B3A",
  },


  approvalText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: "#5F7067",
  },


  useSpeciesButton: {
    marginTop: 15,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },


  useSpeciesButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },


  // ===================================================
  // SPECIES REQUEST SUMMARY
  // ===================================================

  pendingSpeciesCard: {
    marginTop: 15,
    padding: 15,
    backgroundColor: "#E9F7E4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D4EBD0",
  },


  pendingSpeciesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },


  pendingSpeciesTitle: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "700",
  },


  pendingBadge: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: "#FFF1C9",
  },


  pendingBadgeText: {
    color: "#77612A",
    fontSize: 10,
    fontWeight: "700",
  },


  pendingSpeciesName: {
    marginTop: 12,
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },


  pendingSpeciesScientific: {
    marginTop: 3,
    color: "#6D7F75",
    fontSize: 12,
    fontStyle: "italic",
  },


  pendingSpeciesText: {
    marginTop: 8,
    color: "#5F7067",
    fontSize: 12,
    lineHeight: 18,
  },


  speciesActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },


  editSpeciesButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },


  editSpeciesText: {
    color: "#468585",
    fontSize: 12,
    fontWeight: "700",
  },


  removeSpeciesButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#FFF0F0",
    borderWidth: 1,
    borderColor: "#E6BABA",
    alignItems: "center",
    justifyContent: "center",
  },


  removeSpeciesText: {
    color: "#C85C5C",
    fontSize: 12,
    fontWeight: "700",
  },

  
      speciesPhotoScroll: {
        marginTop: 15,
      },

      speciesPhotoRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingRight: 5,
      },

      speciesPhotoItem: {
        width: 240,
        padding: 10,
        backgroundColor: "#F5F9F3",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#DCE8D6",
      },

      speciesPhotoPreview: {
        width: "100%",
        height: 220,
        borderRadius: 8,
        backgroundColor: "#E8EEE6",
      },

      removeSpeciesPhotoButton: {
        marginTop: 10,
        minHeight: 38,
        borderRadius: 8,
        backgroundColor: "#FFF0F0",
        alignItems: "center",
        justifyContent: "center",
      },

      removeSpeciesPhotoText: {
        color: "#C85C5C",
        fontSize: 12,
        fontWeight: "600",
      },



  // ===================================================
  // LOCATION
  // ===================================================

  locationButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#50B498",
    alignItems: "center",
    justifyContent: "center",
  },


  locationButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },


  // ===================================================
  // PHOTOS
  // ===================================================

  photoProgress: {
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#EAF6E7",
  },

  photoProgressText: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "700",
  },

  photoGuideCard: {
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D5E8D1",
    borderRadius: 12,
    backgroundColor: "#FAFCF9",
  },

  photoGuideHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  photoGuideTitle: {
    flex: 1,
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },

  photoGuideDescription: {
    marginTop: 6,
    color: "#6D7F75",
    fontSize: 12,
    lineHeight: 18,
  },

  photoGuideRequiredBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#6E5A24",
    backgroundColor: "#FFF8E8",
    fontSize: 11,
    fontWeight: "700",
  },

  photoGuideOptionalBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#6D7F75",
    backgroundColor: "#EDF2EA",
    fontSize: 11,
    fontWeight: "700",
  },

  photoGuideCompleteBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: "hidden",
    color: "#FFFFFF",
    backgroundColor: "#50B498",
    fontSize: 11,
    fontWeight: "700",
  },

  guidedPhotoPreview: {
    width: "100%",
    height: 180,
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: "#E8EEE6",
  },

  guidedPhotoActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },

  guidedPhotoActionButton: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D5E8D1",
    backgroundColor: "#EAF6E7",
    alignItems: "center",
    justifyContent: "center",
  },

  removeGuidedPhotoButton: {
    minHeight: 44,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  additionalPhotosHeader: {
    marginTop: 6,
  },

  additionalPhotosTitle: {
    color: "#234B3A",
    fontSize: 15,
    fontWeight: "700",
  },

  photoButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 5,
  },


  photoButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#EAF6E7",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D5E8D1",
  },


  photoButtonText: {
    color: "#468585",
    fontSize: 13,
    fontWeight: "700",
  },


  photoList: {
    marginTop: 15,
  },


  photoItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#F5F9F3",
    borderRadius: 10,
    marginBottom: 8,
  },

  additionalPhotoPreview: {
    width: 54,
    height: 54,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: "#E8EEE6",
  },


  photoName: {
    flex: 1,
    marginRight: 10,
    color: "#234B3A",
    fontSize: 12,
  },


  removePhotoText: {
    color: "#C85C5C",
    fontSize: 12,
    fontWeight: "600",
  },


  // ===================================================
  // QR CODE
  // ===================================================

  qrSelector: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    backgroundColor: "#FAFCF9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },


  qrSelectedText: {
    color: "#234B3A",
    fontSize: 14,
    fontWeight: "600",
  },


  qrPlaceholder: {
    color: "#9AA7A0",
    fontSize: 14,
  },


  dropdownArrow: {
    color: "#468585",
    fontSize: 12,
  },


  qrDropdown: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: "#DCE8D6",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },


  qrOption: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2EA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },


  qrOptionText: {
    color: "#234B3A",
    fontSize: 13,
    fontWeight: "600",
  },


  qrAvailableText: {
    color: "#50B498",
    fontSize: 11,
    fontWeight: "600",
  },


  noQRText: {
    padding: 15,
    color: "#7C8A82",
    fontSize: 12,
  },


  // ===================================================
  // FINAL APPROVAL
  // ===================================================

  finalApprovalCard: {
    marginBottom: 15,
    padding: 15,
    backgroundColor: "#FFF8E8",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F0DFB1",
  },


  finalApprovalTitle: {
    color: "#6E5A24",
    fontSize: 14,
    fontWeight: "700",
  },


  finalApprovalText: {
    marginTop: 5,
    color: "#776B4C",
    fontSize: 12,
    lineHeight: 18,
  },


  // ===================================================
  // SUBMIT
  // ===================================================

  submitButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#468585",
    alignItems: "center",
    justifyContent: "center",
  },


  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },


  // ===================================================
  // CANCEL
  // ===================================================

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
