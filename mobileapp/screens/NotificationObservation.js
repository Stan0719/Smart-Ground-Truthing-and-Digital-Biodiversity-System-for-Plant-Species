import { useAppTranslation, t, translateLabel, translateUIMessage, translateFieldValue } from "../translations/i18n";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ownedNotificationObservation } from "../utils/botanistNotifications";

export default function NotificationObservation({ route, navigation, user }) {
  useAppTranslation();
  const [state, setState] = useState({ loading: true, observation: null, error: "" });
  const [retry, setRetry] = useState(0);
  const accountId = user?.role === "botanist" ? user.id : null;
  const observationId = route.params?.observationId;
  useFocusEffect(useCallback(() => {
    let active = true;
    setState({ loading: true, observation: null, error: "" });
    if (!accountId) { setState({ loading: false, observation: null, error: "Sign in as the Botanist who submitted this observation." }); return undefined; }
    ownedNotificationObservation(accountId, observationId).then((observation) => {
      if (active) setState({ loading: false, observation, error: "" });
    }).catch((error) => {
      if (active) setState({ loading: false, observation: null, error: `${error.message} The record may be unavailable or you may be offline.` });
    });
    return () => { active = false; };
  }, [accountId, observationId, retry]));

  const row = state.observation?.owner_subject === `staff:${accountId}` ? state.observation : null;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {state.loading && <ActivityIndicator color="#468585" />}
    {!!state.error && <View style={styles.card}>
      <Text style={styles.error} accessibilityRole="alert">{translateUIMessage(state.error)}</Text>
      <TouchableOpacity style={styles.button} onPress={() => setRetry((value) => value + 1)}><Text style={styles.buttonText}>{t("common.tryAgain")}</Text></TouchableOpacity>
    </View>}
    {row && <View style={styles.card}>
      <Text style={styles.title}>{t("fieldCollection.plant")}{row.plant_id}</Text>
      <Text style={styles.reference}>{t("notificationObservation.observation")}{row.id}</Text>
      <Text style={styles.status}>{translateLabel(row.status)}</Text>
      {!!row.review_comment && <View style={styles.feedback}><Text style={styles.label}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.text}>{row.review_comment}</Text></View>}
      {[
        ["Height (cm)", row.content?.heightCm], ["Health", row.content?.healthStatus],
        ["Life stage", row.content?.lifeStage], ["Morphology", row.content?.morphology], ["Notes", row.content?.notes],
      ].map(([label, value]) => value != null && value !== "" ? <View key={label} style={styles.field}><Text style={styles.label}>{translateLabel(label)}</Text><Text style={styles.text}>{translateFieldValue(label, String(value))}</Text></View> : null)}
      {["Draft", "Correction Required", "Rejected"].includes(row.status) && <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id })}
        accessibilityRole="button"
      ><Text style={styles.buttonText}>{t("fieldCollection.correctObservation")}</Text></TouchableOpacity>}
    </View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { padding: 18 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "#E2EDE0" },
  title: { color: "#234B3A", fontSize: 22, fontWeight: "700" },
  reference: { color: "#718078", fontSize: 12, marginTop: 8 },
  status: { color: "#35786F", fontSize: 14, fontWeight: "700", marginVertical: 16 },
  feedback: { backgroundColor: "#EEF7EF", padding: 14, borderRadius: 12, marginBottom: 12 },
  field: { marginVertical: 10 },
  label: { color: "#234B3A", fontSize: 13, fontWeight: "700", marginBottom: 5 },
  text: { color: "#52665A", fontSize: 14, lineHeight: 21 },
  error: { color: "#A34740", fontSize: 14, lineHeight: 21 },
  button: { minHeight: 46, borderRadius: 12, backgroundColor: "#35786F", alignItems: "center", justifyContent: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
