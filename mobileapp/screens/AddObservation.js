import { t, translateLabel, useAppTranslation } from "../translations/i18n";
import React, { useState } from "react";

import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  addPlantObservation,
  getPlantById,
  getSpeciesBySlug,
} from "../data/mockData";

const HEALTH_STATUSES = ["Healthy", "Monitoring", "Poor"];
const LIFE_STAGES = ["Seedling", "Juvenile", "Mature", "Flowering"];

const getLocalDateParts = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
};

export default function AddObservation({ route, navigation, user }) {
  useAppTranslation();
  const plantId = route.params?.plantId;
  const plant = getPlantById(plantId);
  const species = plant ? getSpeciesBySlug(plant.speciesSlug) : null;
  const current = plant?.latestApproved || {};
  const initialDate = getLocalDateParts();

  const [height, setHeight] = useState(String(current.heightCm ?? ""));
  const [healthStatus, setHealthStatus] = useState(current.healthStatus || "Healthy");
  const [lifeStage, setLifeStage] = useState(current.lifeStage || "");
  const [morphology, setMorphology] = useState(current.morphology || "");
  const [notes, setNotes] = useState("");
  const [observationDate, setObservationDate] = useState(initialDate.date);
  const [observationTime, setObservationTime] = useState(initialDate.time);

  const isBotanist = user?.role === "botanist";

  const handleSubmit = () => {
    if (!isBotanist) {
      Alert.alert(t("addObservation.notAvailable"), t("addObservation.onlyBotanistsCanAddObservations"));
      return;
    }

    if (morphology.trim().length > 4000 || notes.trim().length > 4000) {
      Alert.alert(t("addObservation.textTooLong"), t("addObservation.morphologyAndFieldNotesMustBe4000CharactersOr"));
      return;
    }

    const heightCm = Number(height);

    if (!Number.isFinite(heightCm) || heightCm <= 0) {
      Alert.alert(t("addObservation.invalidHeight"), t("addObservation.enterAValidPlantHeightInCentimetres"));
      return;
    }

    if (!healthStatus || !lifeStage || !morphology.trim()) {
      Alert.alert(
        t("addObservation.missingInformation"),
        t("addObservation.completeTheHealthStatusLifeStageAndMorphologyFields")
      );
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) {
      Alert.alert(t("addObservation.invalidDate"), t("addObservation.useTheDateFormatYyyyMmDd"));
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(observationTime)) {
      Alert.alert(t("addObservation.invalidTime"), t("addObservation.useTheTimeFormatHhMm"));
      return;
    }

    const observation = addPlantObservation(plantId, {
      recordedBy: user.name || user.username || "Botanist",
      date: observationDate,
      observedAt: `${observationDate}T${observationTime}:00`,
      heightCm,
      healthStatus,
      lifeStage,
      morphology: morphology.trim(),
      notes: notes.trim(),
    });

    if (!observation) {
      Alert.alert(t("common.error"), t("addObservation.plantRecordNotFound"));
      return;
    }

    Alert.alert(
      t("addObservation.observationSubmitted"),
      t("addObservation.theNewObservationIsPendingReview"),
      [{ text: t("common.ok"), onPress: () => navigation.goBack() }]
    );
  };

  if (!plant || !isBotanist) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableTitle}>{t("addObservation.observationUnavailable")}</Text>
        <Text style={styles.unavailableText}>
          {!plant
            ? t("addObservation.theSelectedPlantRecordCouldNotBeFound")
            : t("addObservation.onlyBotanistsCanAddObservations")}
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>{t("common.goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>{t("addObservation.fieldObservation")}</Text>
      <Text style={styles.title}>{t("navigation.addNewObservation")}</Text>
      <Text style={styles.description}>{t("addObservation.recordANewVisitFor")}{species?.name || plant.speciesSlug}{t("addObservation.theVerifiedRecordWillRemainUnchangedUntilThisObservationIs")}</Text>

      <View style={styles.identityCard}>
        <Text style={styles.identityLabel}>{t("addObservation.plantId")}</Text>
        <Text style={styles.identityValue}>{plant.plantId}</Text>
        <Text style={styles.locationNote}>{t("addObservation.locationRemains")}{plant.location.zone}{t("addObservation.gpsDetailsCannotBeChangedHere")}</Text>
      </View>

      <View style={styles.formCard}>
        <FieldLabel text="Height (cm)" />
        <TextInput
          style={styles.input}
          value={height}
          onChangeText={setHeight}
          keyboardType="decimal-pad"
          placeholder="e.g. 86"
          placeholderTextColor="#93A099"
        />

        <FieldLabel text="Health status" />
        <OptionRow options={HEALTH_STATUSES} value={healthStatus} onChange={setHealthStatus} />

        <FieldLabel text="Life stage" />
        <OptionRow options={LIFE_STAGES} value={lifeStage} onChange={setLifeStage} />

        <FieldLabel text="Morphology" />
        <TextInput
          style={styles.textArea}
          value={morphology}
          onChangeText={setMorphology}
          multiline
          textAlignVertical="top"
          placeholder={t("addObservation.describeTheCurrentPlantCondition")}
          placeholderTextColor="#93A099"
        />

        <FieldLabel text="Field notes" />
        <TextInput
          style={styles.textArea}
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
          placeholder={t("addObservation.optionalNotesFromThisVisit")}
          placeholderTextColor="#93A099"
        />

        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <FieldLabel text="Observation date" />
            <TextInput
              style={styles.input}
              value={observationDate}
              onChangeText={setObservationDate}
              placeholder={t("addObservation.yyyyMmDd")}
              placeholderTextColor="#93A099"
            />
          </View>
          <View style={styles.timeField}>
            <FieldLabel text="Time" />
            <TextInput
              style={styles.input}
              value={observationTime}
              onChangeText={setObservationTime}
              placeholder={t("addObservation.hhMm")}
              placeholderTextColor="#93A099"
            />
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.submitButton} activeOpacity={0.8} onPress={handleSubmit}>
        <Text style={styles.submitButtonText}>{t("addObservation.submitForReview")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FieldLabel({ text }) {
  useAppTranslation();
  return <Text style={styles.label}>{translateLabel(text)}</Text>;
}

function OptionRow({ options, value, onChange }) {
  useAppTranslation();
  return (
    <View style={styles.options}>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[styles.option, value === option && styles.optionSelected]}
          onPress={() => onChange(option)}
        >
          <Text style={[styles.optionText, value === option && styles.optionTextSelected]}>
            {translateLabel(option)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F6EE" },
  content: { padding: 20, paddingBottom: 42 },
  sectionLabel: { color: "#50A078", fontSize: 10, fontWeight: "700", letterSpacing: 1.7 },
  title: { marginTop: 8, color: "#234A3C", fontSize: 28, fontWeight: "700" },
  description: { marginTop: 10, color: "#60756F", fontSize: 13, lineHeight: 20 },
  identityCard: { marginTop: 20, padding: 16, borderRadius: 14, backgroundColor: "#E8EFE3" },
  identityLabel: { color: "#6B7D74", fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  identityValue: { marginTop: 5, color: "#234A3C", fontSize: 20, fontWeight: "700" },
  locationNote: { marginTop: 8, color: "#526A60", fontSize: 11, lineHeight: 17 },
  formCard: { marginTop: 16, padding: 16, borderRadius: 16, backgroundColor: "#FFFFFF", elevation: 2 },
  label: { marginTop: 14, marginBottom: 7, color: "#526A60", fontSize: 11, fontWeight: "700" },
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#D7DED7", borderRadius: 11, backgroundColor: "#FAFAF6", color: "#254B42", fontSize: 13 },
  textArea: { minHeight: 100, padding: 12, borderWidth: 1, borderColor: "#D7DED7", borderRadius: 11, backgroundColor: "#FAFAF6", color: "#254B42", fontSize: 13, lineHeight: 19 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  option: { minHeight: 38, justifyContent: "center", paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: "#C7D3CB", borderRadius: 999, backgroundColor: "#F7F6EF" },
  optionSelected: { borderColor: "#315B49", backgroundColor: "#315B49" },
  optionText: { color: "#405F56", fontSize: 10, fontWeight: "600" },
  optionTextSelected: { color: "#FFFFFF" },
  dateRow: { flexDirection: "row", gap: 10 },
  dateField: { flex: 1.4 },
  timeField: { flex: 0.8 },
  submitButton: { minHeight: 48, marginTop: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: 14, backgroundColor: "#315B49" },
  submitButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#F8F6EE" },
  unavailableTitle: { color: "#234A3C", fontSize: 22, fontWeight: "700" },
  unavailableText: { marginTop: 8, color: "#63736A", fontSize: 12, lineHeight: 18, textAlign: "center" },
  backButton: { minHeight: 44, marginTop: 18, justifyContent: "center", paddingHorizontal: 18, borderRadius: 999, backgroundColor: "#315B49" },
  backButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
