import { useAppTranslation, t, translateUIMessage } from "../../translations/i18n";
import React, { useRef, useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { faceApi } from "../../utils/faceApi";
import BackButton from "../../components/BackButton";

export default function ForgotPassword() {
  useAppTranslation();
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const requestLock = useRef(false);

  async function submit() {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!requestId) {
        const result = await faceApi("/recovery/request", { email: email.trim().toLowerCase() });
        if (!/^[a-f0-9]{32}$/.test(result.recoveryId || ""))
          throw Error(t("forgot-password.invalidRecoveryResponse"));
        setRequestId(result.recoveryId);
        setMessage(result.message);
      } else {
        if (password !== confirm) throw Error(t("forgot-password.passwordsDoNotMatch"));
        const result = await faceApi("/recovery/confirm", { recoveryId: requestId, code, password });
        if (result.reset !== true) throw Error(t("forgot-password.passwordResetWasNotConfirmed"));
        setPassword("");
        setConfirm("");
        setCode("");
        setRequestId("");
        setDone(true);
        setMessage(t("forgot-password.passwordUpdatedReturnToLoginAndUseYourNewPassword"));
      }
    } catch (failure) {
      setError(failure.message || t("forgot-password.recoveryRequestFailed"));
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  const hasRecoveryCode = Boolean(requestId);
  const title = done
    ? t("forgot-password.passwordUpdatedTitle")
    : hasRecoveryCode
      ? t("forgot-password.recoveryStepTitle")
      : t("forgot-password.forgotPasswordHeading");
  const description = hasRecoveryCode
      ? t("forgot-password.enterTheSixDigitEmailCodeWithinFiveMinutesUse")
      : t("forgot-password.recoveryIntro");

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            <BackButton
              label={t("forgot-password.returnToLogin")}
              onPress={() => router.back()}
              variant="plain"
              style={styles.backLink}
            />

            <View style={styles.content}>
              <View style={styles.heroIcon}>
                <Ionicons name={done ? "checkmark" : "lock-closed-outline"} size={25} color="#2F6B4F" />
              </View>
              <Text style={styles.title}>{title}</Text>
              {!done && <Text style={styles.description}>{description}</Text>}

              {!done && (
                <View style={styles.formCard}>
                  {!hasRecoveryCode ? (
                    <>
                      <Text style={styles.fieldLabel}>{t("forgot-password.accountEmail")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="mail-outline" size={20} color="#468585" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("forgot-password.accountEmail")}
                          placeholder={t("login.email")}
                          placeholderTextColor="#89988D"
                          value={email}
                          onChangeText={setEmail}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="email-address"
                          textContentType="emailAddress"
                          autoComplete="email"
                          editable={!busy}
                          returnKeyType="done"
                          onSubmitEditing={submit}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.fieldLabel}>{t("forgot-password.recoveryCode")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="key-outline" size={20} color="#468585" />
                        <TextInput
                          style={[styles.input, styles.codeInput]}
                          accessibilityLabel={t("forgot-password.recoveryCode")}
                          placeholder="000000"
                          placeholderTextColor="#89988D"
                          value={code}
                          onChangeText={setCode}
                          keyboardType="number-pad"
                          textContentType="oneTimeCode"
                          autoComplete="one-time-code"
                          maxLength={6}
                          editable={!busy}
                        />
                      </View>
                      <Text style={styles.fieldLabel}>{t("mandatoryPasswordChange.newPassword")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="lock-closed-outline" size={20} color="#468585" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("mandatoryPasswordChange.newPassword")}
                          placeholder={t("mandatoryPasswordChange.newPassword")}
                          placeholderTextColor="#89988D"
                          secureTextEntry
                          value={password}
                          onChangeText={setPassword}
                          autoComplete="new-password"
                          textContentType="newPassword"
                          maxLength={128}
                          editable={!busy}
                        />
                      </View>
                      <Text style={styles.passwordHint}>{t("firstLoginPassword.useMatchingPasswordsWith15To128Characters")}</Text>
                      <Text style={styles.fieldLabel}>{t("forgot-password.confirmPassword")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="checkmark-circle-outline" size={20} color="#468585" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("mandatoryPasswordChange.confirmNewPassword")}
                          placeholder={t("forgot-password.confirmPassword")}
                          placeholderTextColor="#89988D"
                          secureTextEntry
                          value={confirm}
                          onChangeText={setConfirm}
                          autoComplete="new-password"
                          textContentType="newPassword"
                          editable={!busy}
                        />
                      </View>
                    </>
                  )}

                  {!!message && <Text accessibilityLiveRegion="polite" style={styles.feedback}>{translateUIMessage(message)}</Text>}
                  {!!error && <Text accessibilityRole="alert" style={styles.error}>{translateUIMessage(error)}</Text>}

                  <TouchableOpacity
                    style={[styles.primaryButton, busy && styles.disabledButton]}
                    disabled={busy}
                    onPress={submit}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel={busy ? t("common.pleaseWait") : hasRecoveryCode ? t("forgot-password.resetPassword") : t("forgot-password.requestRecoveryCode")}
                  >
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>
                      {busy ? t("common.pleaseWait") : hasRecoveryCode ? t("forgot-password.resetPassword") : t("forgot-password.requestRecoveryCode")}
                    </Text>
                  </TouchableOpacity>

                  {hasRecoveryCode && (
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      disabled={busy}
                      onPress={() => {
                        setRequestId(""); setCode(""); setPassword(""); setConfirm(""); setMessage(""); setError("");
                      }}
                      activeOpacity={0.78}
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryButtonText}>{t("forgot-password.requestANewCode")}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {done && !!message && (
                <View style={styles.successCard}>
                  <Ionicons name="checkmark-circle" size={22} color="#468585" />
                  <Text style={styles.feedback}>{translateUIMessage(message)}</Text>
                </View>
              )}
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerPrompt}>{t("forgot-password.rememberYourPassword")}</Text>
              <TouchableOpacity onPress={() => router.back()} activeOpacity={0.75} accessibilityRole="button">
                <Text style={styles.footerLink}>{done ? t("forgot-password.returnToLogin") : t("forgot-password.signIn")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F1F6F2" },
  flex: { flex: 1, backgroundColor: "#F1F6F2" },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 20 },
  page: { width: "100%", maxWidth: 420, alignSelf: "center", padding: 24, borderWidth: 1, borderColor: "#E0EAE1", borderRadius: 20, backgroundColor: "#FFFFFF", shadowColor: "#173B2B", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 6 },
  backLink: { alignSelf: "flex-start", maxWidth: "100%" },
  content: { width: "100%", alignItems: "stretch", paddingTop: 16 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#E2F5E8", alignItems: "center", justifyContent: "center", alignSelf: "flex-start", marginBottom: 14 },
  title: { color: "#234A3C", fontSize: 23, lineHeight: 29, fontWeight: "700", textAlign: "left", marginBottom: 7 },
  description: { color: "#63736A", fontSize: 14, lineHeight: 21, textAlign: "left", marginBottom: 18 },
  formCard: { width: "100%", backgroundColor: "transparent", borderRadius: 0, borderWidth: 0, padding: 0, gap: 9 },
  fieldLabel: { color: "#315B49", fontSize: 13, lineHeight: 19, fontWeight: "600", marginTop: 3 },
  inputShell: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "#D6E5D0", backgroundColor: "#FAFDF9" },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 10, color: "#234A3C", fontSize: 16 },
  codeInput: { letterSpacing: 4, fontVariant: ["tabular-nums"] },
  passwordHint: { color: "#6D7F75", fontSize: 12, lineHeight: 17, marginTop: -5 },
  feedback: { flex: 1, color: "#2F6B4F", fontSize: 13, lineHeight: 19, textAlign: "left" },
  error: { color: "#9D342D", backgroundColor: "#FFF1EF", borderRadius: 12, borderWidth: 1, borderColor: "#F0C8C2", padding: 12, fontSize: 13, lineHeight: 19 },
  primaryButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 5, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#2F6B4F" },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  secondaryButton: { minHeight: 44, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 4, borderRadius: 0, backgroundColor: "transparent", borderWidth: 0 },
  secondaryButtonText: { color: "#468585", fontSize: 14, fontWeight: "600", textAlign: "left" },
  successCard: { width: "100%", minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 10, padding: 14, borderRadius: 14, backgroundColor: "#F3F8F4", borderWidth: 1, borderColor: "#DCE9DE" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: 5, paddingTop: 18, marginTop: 18, borderTopWidth: 1, borderTopColor: "#E6EEE7" },
  footerPrompt: { color: "#63736A", fontSize: 13, lineHeight: 20, textAlign: "center" },
  footerLink: { color: "#2F6B4F", fontSize: 14, lineHeight: 20, fontWeight: "700" },
});
