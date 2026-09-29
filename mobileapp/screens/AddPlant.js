import React, { useState } from "react";

import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from "react-native";

import * as Location from "expo-location";

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

  const [height, setHeight] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [latitude, setLatitude] =
    useState("");

  const [longitude, setLongitude] =
    useState("");

  async function getLocation() {
    const { status } =
      await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permission Denied",
        "Location permission is required to get the plant GPS location."
      );
      return;
    }

    const location =
      await Location.getCurrentPositionAsync({});

    setLatitude(
      location.coords.latitude.toString()
    );

    setLongitude(
      location.coords.longitude.toString()
    );

    Alert.alert(
      "Location Captured",
      "Current GPS location has been added."
    );
  }

  function handlePhoto() {
    Alert.alert(
      "Plant Photo",
      "Photo selection will be connected to the camera or image picker."
    );
  }

  function handleSave() {
    if (
      !scientificName ||
      !commonName ||
      !family
    ) {
      Alert.alert(
        "Missing Information",
        "Please enter the scientific name, common name and family."
      );
      return;
    }

    Alert.alert(
      "Plant Saved",
      `Plant record has been saved locally for ${botanist?.name}. It is marked as pending sync.`,
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
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>
        Add New Plant
      </Text>

      <Text style={styles.subtitle}>
        Record plant information during field work
      </Text>

      <Text style={styles.sectionTitle}>
        Basic Information
      </Text>

      <Input
        label="Scientific Name *"
        placeholder="e.g. Nepenthes ampullaria"
        value={scientificName}
        onChangeText={setScientificName}
      />

      <Input
        label="Common Name *"
        placeholder="e.g. Common Pitcher Plant"
        value={commonName}
        onChangeText={setCommonName}
      />

      <Input
        label="Family *"
        placeholder="e.g. Nepenthaceae"
        value={family}
        onChangeText={setFamily}
      />

      <Input
        label="Plant Height"
        placeholder="e.g. 45 cm"
        value={height}
        onChangeText={setHeight}
      />

      <Text style={styles.sectionTitle}>
        Description
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder="Enter plant description..."
        placeholderTextColor="#8A9A8F"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
      />

      <Text style={styles.sectionTitle}>
        GPS Location
      </Text>

      <TouchableOpacity
        style={styles.locationButton}
        onPress={getLocation}
      >
        <Text style={styles.locationButtonText}>
          📍 Get Current Location
        </Text>
      </TouchableOpacity>

      <View style={styles.locationRow}>
        <View style={styles.locationInput}>
          <Input
            label="Latitude"
            placeholder="Latitude"
            value={latitude}
            onChangeText={setLatitude}
          />
        </View>

        <View style={styles.locationInput}>
          <Input
            label="Longitude"
            placeholder="Longitude"
            value={longitude}
            onChangeText={setLongitude}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        Plant Photo
      </Text>

      <TouchableOpacity
        style={styles.photoButton}
        onPress={handlePhoto}
      >
        <Text style={styles.photoIcon}>
          📷
        </Text>

        <Text style={styles.photoText}>
          Add Plant Photo
        </Text>

        <Text style={styles.photoSubtext}>
          Take or select a photo
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.saveButton}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>
          Save Plant Record
        </Text>
      </TouchableOpacity>

      <View style={styles.offlineCard}>
        <Text style={styles.offlineTitle}>
          📱 Offline Field Collection
        </Text>

        <Text style={styles.offlineText}>
          Plant records can be saved locally and synchronised
          when an internet connection becomes available.
        </Text>
      </View>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

function Input({
  label,
  placeholder,
  value,
  onChangeText,
}) {
  return (
    <View style={styles.inputContainer}>
      <Text style={styles.label}>
        {label}
      </Text>

      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor="#8A9A8F"
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#E0EBDD",
    paddingHorizontal: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#468585",
    marginTop: 20,
  },

  subtitle: {
    color: "#687568",
    marginTop: 5,
    lineHeight: 20,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#468585",
    marginTop: 23,
    marginBottom: 10,
  },

  inputContainer: {
    marginBottom: 12,
  },

  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#468585",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: "#468585",
    borderWidth: 1,
    borderColor: "#9CDBA6",
  },

  textArea: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    minHeight: 120,
    textAlignVertical: "top",
    color: "#468585",
    borderWidth: 1,
    borderColor: "#9CDBA6",
  },

  locationButton: {
    backgroundColor: "#9CDBA6",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },

  locationButtonText: {
    color: "#468585",
    fontWeight: "700",
  },

  locationRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },

  locationInput: {
    flex: 1,
  },

  photoButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#9CDBA6",
    borderStyle: "dashed",
  },

  photoIcon: {
    fontSize: 35,
  },

  photoText: {
    color: "#468585",
    fontWeight: "700",
    marginTop: 8,
  },

  photoSubtext: {
    color: "#888",
    fontSize: 12,
    marginTop: 4,
  },

  saveButton: {
    backgroundColor: "#50B498",
    borderRadius: 13,
    padding: 16,
    alignItems: "center",
    marginTop: 20,
  },

  saveButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },

  offlineCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 15,
    marginTop: 15,
  },

  offlineTitle: {
    color: "#468585",
    fontWeight: "700",
  },

  offlineText: {
    color: "#687568",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },

  bottomSpace: {
    height: 30,
  },
});