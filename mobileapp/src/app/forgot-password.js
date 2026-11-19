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
import { authNavigationStyles } from "../../components/authNavigationStyles";
import PasswordVisibilityButton from "../../components/PasswordVisibilityButton";

export default function ForgotPassword() {
  useAppTranslation();
  const [email, setEmail] = useState("");
  const [requestId, setRequestId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
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
              variant="dark"
              style={styles.backLink}
            />

            <View style={styles.content}>
              <View style={styles.heroIcon}>
                <Ionicons name={done ? "checkmark" : "lock-closed-outline"} size={25} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>{title}</Text>
              {!done && <Text style={styles.description}>{description}</Text>}

              {!done && (
                <View style={styles.formCard}>
                  {!hasRecoveryCode ? (
                    <>
                      <Text style={styles.fieldLabel}>{t("forgot-password.accountEmail")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="mail-outline" size={20} color="#DEF9C4" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("forgot-password.accountEmail")}
                          placeholder={t("login.email")}
                          placeholderTextColor="#9BBDB4"
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
                        <Ionicons name="key-outline" size={20} color="#DEF9C4" />
                        <TextInput
                          style={[styles.input, styles.codeInput]}
                          accessibilityLabel={t("forgot-password.recoveryCode")}
                          placeholder="000000"
                          placeholderTextColor="#9BBDB4"
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
                        <Ionicons name="lock-closed-outline" size={20} color="#DEF9C4" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("mandatoryPasswordChange.newPassword")}
                          placeholder={t("mandatoryPasswordChange.newPassword")}
                          placeholderTextColor="#9BBDB4"
                          secureTextEntry={!passwordVisible}
                          value={password}
                          onChangeText={setPassword}
                          autoComplete="new-password"
                          textContentType="newPassword"
                          maxLength={128}
                          editable={!busy}
                        />
                        <PasswordVisibilityButton visible={passwordVisible} onPress={() => setPasswordVisible((current) => !current)} disabled={busy} />
                      </View>
                      <Text style={styles.passwordHint}>{t("firstLoginPassword.useMatchingPasswordsWith15To128Characters")}</Text>
                      <Text style={styles.fieldLabel}>{t("forgot-password.confirmPassword")}</Text>
                      <View style={styles.inputShell}>
                        <Ionicons name="checkmark-circle-outline" size={20} color="#DEF9C4" />
                        <TextInput
                          style={styles.input}
                          accessibilityLabel={t("mandatoryPasswordChange.confirmNewPassword")}
                          placeholder={t("forgot-password.confirmPassword")}
                          placeholderTextColor="#89988D"
                          secureTextEntry={!confirmVisible}
                          value={confirm}
                          onChangeText={setConfirm}
                          autoComplete="new-password"
                          textContentType="newPassword"
                          editable={!busy}
                        />
                        <PasswordVisibilityButton visible={confirmVisible} onPress={() => setConfirmVisible((current) => !current)} disabled={busy} />
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
                <Text style={[authNavigationStyles.text, styles.footerLink]}>{done ? t("forgot-password.returnToLogin") : t("forgot-password.signIn")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#244B47" },
  flex: { flex: 1, backgroundColor: "#2B5651" },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 36 },
  page: { width: "100%", maxWidth: 390, alignSelf: "center", paddingTop: 30, paddingHorizontal: 28, paddingBottom: 28, borderWidth: 1, borderColor: "rgba(222, 249, 196, 0.18)", borderRadius: 22, backgroundColor: "#2B5651", shadowColor: "#0C2520", shadowOffset: { width: 0, height: 28 }, shadowOpacity: 0.38, shadowRadius: 35, elevation: 12 },
  backLink: { alignSelf: "flex-start", maxWidth: "100%" },
  content: { width: "100%", alignItems: "stretch", paddingTop: 16 },
  heroIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#50B498", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16 },
  title: { color: "#FFF6DC", fontSize: 30, lineHeight: 36, fontWeight: "700", textAlign: "center", marginBottom: 9 },
  description: { color: "#C9DDD6", fontSize: 16, lineHeight: 22, textAlign: "center", marginBottom: 24 },
  formCard: { width: "100%", backgroundColor: "transparent", borderRadius: 0, borderWidth: 0, padding: 0, gap: 14 },
  fieldLabel: { color: "#DEF9C4", fontSize: 14, lineHeight: 19, fontWeight: "600", marginTop: 3 },
  inputShell: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(224, 235, 221, 0.2)", backgroundColor: "#1F403D" },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 10, color: "#FFF6DC", fontSize: 16 },
  codeInput: { letterSpacing: 4, fontVariant: ["tabular-nums"] },
  passwordHint: { color: "#C9DDD6", fontSize: 12, lineHeight: 17, marginTop: -5 },
  feedback: { flex: 1, color: "#DEF9C4", fontSize: 13, lineHeight: 19, textAlign: "left" },
  error: { color: "#FFF6DC", backgroundColor: "rgba(157, 52, 45, 0.35)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255, 214, 207, 0.45)", padding: 12, fontSize: 13, lineHeight: 19 },
  primaryButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 5, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#50B498" },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  secondaryButton: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(80, 180, 152, 0.1)", borderWidth: 1, borderColor: "#50B498" },
  secondaryButtonText: { color: "#DEF9C4", fontSize: 14, fontWeight: "700", textAlign: "center" },
  successCard: { width: "100%", minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 10, padding: 14, borderRadius: 14, backgroundColor: "rgba(80, 180, 152, 0.10)", borderWidth: 1, borderColor: "rgba(222, 249, 196, 0.18)" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: 5, paddingTop: 18, marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(224, 235, 221, 0.18)" },
  footerPrompt: { color: "#C9DDD6", fontSize: 13, lineHeight: 20, textAlign: "center" },
  footerLink: { width: "auto", minHeight: 0, paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, backgroundColor: "transparent", textDecorationLine: "underline" },
});
