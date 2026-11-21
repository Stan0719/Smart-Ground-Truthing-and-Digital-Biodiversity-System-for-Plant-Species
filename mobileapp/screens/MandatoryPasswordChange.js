import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
﻿import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import Text, { ScaledTextInput as TextInput } from "../components/ScaledText";
import { SafeAreaView } from "react-native-safe-area-context";
import PasswordVisibilityButton from "../components/PasswordVisibilityButton";

// Rendered in place of Login; a pending bearer token never enters route parameters.
export default function MandatoryPasswordChangeScreen({ onSubmit, onCancel }) {
  useAppTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const submitting = useRef(false);
  const confirmationInput = useRef(null);
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
    <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View pointerEvents="none" style={styles.topGlow} />
      <View pointerEvents="none" style={styles.bottomGlow} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{t("mandatoryPasswordChange.changeYourTemporaryPassword")}</Text>
          <Text style={styles.description}>{t("mandatoryPasswordChange.chooseANewPasswordWith15To128CharactersBefore")}</Text>
          <View style={styles.field}>
            <TextInput accessibilityLabel={t("mandatoryPasswordChange.newPassword")} placeholder={t("mandatoryPasswordChange.newPassword")} placeholderTextColor="#9BBDB4" style={[styles.input, focusedField === "password" && styles.inputFocused]} onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)} value={password} onChangeText={setPassword} secureTextEntry={!passwordVisible} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} returnKeyType="next" onSubmitEditing={() => confirmationInput.current?.focus()} />
            <View style={styles.visibilityButton}><PasswordVisibilityButton visible={passwordVisible} onPress={() => setPasswordVisible((current) => !current)} disabled={busy} /></View>
          </View>
          <View style={styles.field}>
            <TextInput ref={confirmationInput} accessibilityLabel={t("mandatoryPasswordChange.confirmNewPassword")} placeholder={t("mandatoryPasswordChange.confirmNewPassword")} placeholderTextColor="#9BBDB4" style={[styles.input, focusedField === "confirmation" && styles.inputFocused]} onFocus={() => setFocusedField("confirmation")} onBlur={() => setFocusedField(null)} value={confirmation} onChangeText={setConfirmation} secureTextEntry={!confirmationVisible} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" editable={!busy} returnKeyType="done" onSubmitEditing={submit} />
            <View style={styles.visibilityButton}><PasswordVisibilityButton visible={confirmationVisible} onPress={() => setConfirmationVisible((current) => !current)} disabled={busy} /></View>
          </View>
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(error)}</Text>}
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={submit} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy ? t("common.pleaseWait") : t("mandatoryPasswordChange.changePassword")}</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={cancel} style={styles.cancel}><Text style={styles.cancelText}>{t("mandatoryPasswordChange.signOutAndReturnToLogin")}</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#244B47" },
  keyboardView: { flex: 1, backgroundColor: "#2B5651" },
  topGlow: { position: "absolute", top: -90, right: -80, width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(80, 180, 152, 0.13)" },
  bottomGlow: { position: "absolute", bottom: -130, left: -110, width: 270, height: 270, borderRadius: 135, backgroundColor: "rgba(31, 64, 61, 0.45)" },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 36 },
  card: { width: "100%", maxWidth: 390, alignSelf: "center", paddingTop: 36, paddingHorizontal: 32, paddingBottom: 32, gap: 14, borderWidth: 1, borderColor: "rgba(222, 249, 196, 0.18)", borderRadius: 22, backgroundColor: "#2B5651", shadowColor: "#0C2520", shadowOffset: { width: 0, height: 28 }, shadowOpacity: 0.38, shadowRadius: 35, elevation: 12 },
  title: { marginBottom: 9, color: "#FFF6DC", fontSize: 30, fontWeight: "700", textAlign: "center" },
  description: { marginBottom: 10, color: "#C9DDD6", fontSize: 16, lineHeight: 22, textAlign: "center" },
  field: { height: 54, position: "relative" },
  input: { width: "100%", height: "100%", paddingLeft: 18, paddingRight: 52, paddingTop: 6, borderWidth: 1, borderColor: "rgba(224, 235, 221, 0.2)", borderRadius: 12, backgroundColor: "#1F403D", color: "#FFF6DC", fontSize: 16 },
  visibilityButton: { position: "absolute", right: 4, top: 5 },
  inputFocused: { borderColor: "#76D1B5", backgroundColor: "#234944", shadowColor: "#50B498", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 4, elevation: 2 },
  button: { width: "100%", height: 52, marginTop: 5, borderRadius: 12, backgroundColor: "#50B498", justifyContent: "center", alignItems: "center", shadowColor: "#0C2822", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.24, shadowRadius: 9, elevation: 6 },
  disabledButton: { opacity: 0.65 },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16, textAlign: "center" },
  error: { color: "#F6C3C3", fontSize: 13, fontWeight: "500", textAlign: "center" },
  cancel: { width: "100%", minHeight: 52, borderWidth: 1, borderColor: "#50B498", borderRadius: 12, paddingHorizontal: 12, justifyContent: "center", alignItems: "center", backgroundColor: "transparent" },
  cancelText: { color: "#DEF9C4", fontWeight: "700", fontSize: 16, textAlign: "center" },
});
