import React, { useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
} from "react-native";

export default function EditPlantScreen({
  route,
  navigation,
}) {
  const { plant, botanist } = route.params;

  const [scientificName, setScientificName] =
    useState(plant.scientificName);

  const [commonName, setCommonName] =
    useState(plant.commonName);

  const [height, setHeight] =
    useState(plant.height);

  const [description, setDescription] =
    useState(plant.description);

  function handleUpdate() {
    if (!scientificName || !commonName) {
      Alert.alert(
        "Missing Information",
        "Scientific name and common name are required."
      );
      return;
    }

    Alert.alert(
      "Plant Updated",
      `${scientificName} has been updated successfully.`,
      [
        {
          text: "OK",
          onPress: () =>
            navigation.goBack(),
        },
      ]
    );
  }

  function handleDelete() {
    Alert.alert(
      "Delete Plant",
      `Are you sure you want to delete ${plant.scientificName}?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Deleted",
              "The plant record has been deleted.",
              [
                {
                  text: "OK",
                  onPress: () =>
                    navigation.goBack(),
                },
              ]
            );
          },
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
        Edit Plant Record
      </Text>

      <Text style={styles.subtitle}>
        Update information for {plant.id}
      </Text>

      <Text style={styles.label}>
        Scientific Name
      </Text>

      <TextInput
        style={styles.input}
        value={scientificName}
        onChangeText={setScientificName}
      />

      <Text style={styles.label}>
        Common Name
      </Text>

      <TextInput
        style={styles.input}
        value={commonName}
        onChangeText={setCommonName}
      />

      <Text style={styles.label}>
        Plant Height
      </Text>

      <TextInput
        style={styles.input}
        value={height}
        onChangeText={setHeight}
      />

      <Text style={styles.label}>
        Description
      </Text>

      <TextInput
        style={styles.textArea}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
      />

      <View style={styles.recordCard}>
        <Text style={styles.recordTitle}>
          Record Information
        </Text>

        <Text style={styles.recordText}>
          Plant ID: {plant.id}
        </Text>

        <Text style={styles.recordText}>
          Botanist: {botanist?.name}
        </Text>

        <Text style={styles.recordText}>
          GPS: {plant.latitude}, {plant.longitude}
        </Text>

        <Text style={styles.recordText}>
          Sync Status: {plant.syncStatus}
        </Text>
      </View>

      <TouchableOpacity
        style={styles.updateButton}
        onPress={handleUpdate}
      >
        <Text style={styles.updateButtonText}>
          Save Changes
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={handleDelete}
      >
        <Text style={styles.deleteButtonText}>
          Delete Plant Record
        </Text>
      </TouchableOpacity>

      <View style={styles.bottomSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#DEF9C4",
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
    marginBottom: 22,
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
    marginBottom: 15,
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
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#9CDBA6",
  },

  recordCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 16,
    marginTop: 5,
  },

  recordTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#468585",
    marginBottom: 8,
  },

  recordText: {
    color: "#687568",
    fontSize: 13,
    marginTop: 5,
  },

  updateButton: {
    backgroundColor: "#50B498",
    borderRadius: 13,
    padding: 16,
    alignItems: "center",
    marginTop: 18,
  },

  updateButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },

  deleteButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D96C6C",
    borderRadius: 13,
    padding: 15,
    alignItems: "center",
    marginTop: 10,
  },

  deleteButtonText: {
    color: "#C55252",
    fontWeight: "700",
  },

  bottomSpace: {
    height: 30,
  },
});