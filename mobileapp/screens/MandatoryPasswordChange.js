import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
﻿import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Rendered in place of Login; a pending bearer token never enters route parameters.
export default function MandatoryPasswordChangeScreen({ onSubmit, onCancel }) {
  useAppTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onSubmit(password, confirmation); }
    catch (failure) { setError(failure.message || "Unable to change password. Please try again."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function cancel() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try { await onCancel(); }
    catch { setError("Unable to confirm sign out. Please try again."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <SafeAreaView style={styles.page}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>{t("mandatoryPasswordChange.changeYourTemporaryPassword")}</Text>
        <Text style={styles.description}>{t("mandatoryPasswordChange.chooseANewPasswordWith15To128CharactersBefore")}</Text>
        <TextInput accessibilityLabel={t("mandatoryPasswordChange.newPassword")} placeholder={t("mandatoryPasswordChange.newPassword")} style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} />
        <TextInput accessibilityLabel={t("mandatoryPasswordChange.confirmNewPassword")} placeholder={t("mandatoryPasswordChange.confirmNewPassword")} style={styles.input} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" editable={!busy} returnKeyType="done" onSubmitEditing={submit} />
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(error)}</Text>}
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={submit} style={styles.button}><Text style={styles.buttonText}>{busy ? t("common.pleaseWait") : t("mandatoryPasswordChange.changePassword")}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={cancel} style={styles.cancel}><Text>{t("mandatoryPasswordChange.signOutAndReturnToLogin")}</Text></TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F8F5" },
  content: { flexGrow: 1, justifyContent: "center", padding: 28, gap: 20 },
  title: { fontSize: 26, fontWeight: "700", color: "#174B35" },
  description: { fontSize: 16, lineHeight: 24, color: "#34483D" },
  input: { borderWidth: 1, borderColor: "#A4B6AA", borderRadius: 12, padding: 16, backgroundColor: "#FFFFFF", color: "#17291F" },
  button: { backgroundColor: "#175E3E", borderRadius: 12, padding: 16, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  error: { color: "#A51E2C", fontSize: 15 },
  cancel: { padding: 12, alignItems: "center" },
});
