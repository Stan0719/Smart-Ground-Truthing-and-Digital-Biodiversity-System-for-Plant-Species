import React, { useState } from "react";

import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const TEST_EMAIL = "admin@niah.com";
const TEST_PASSWORD = "admin123";

function FloatingInput({ label, value, onChangeText, secureTextEntry = false, keyboardType = "default", autoComplete, returnKeyType, onSubmitEditing }) {
  const [isFocused, setIsFocused] = useState(false);
  const isFloating = isFocused || value.length > 0;

  return (
    <View style={styles.inputGroup}>
      {isFloating && <View style={styles.labelCut} />}
      <TextInput
        style={[styles.input, isFocused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
      />
      <Text pointerEvents="none" style={[styles.floatingLabel, isFloating && styles.floatingLabelRaised]}>
        {label}
      </Text>
    </View>
  );
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  function updateEmail(value) {
    setEmail(value);
    if (loginError) setLoginError("");
  }

  function updatePassword(value) {
    setPassword(value);
    if (loginError) setLoginError("");
  }

  function handleLogin() {
    if (email.trim() !== TEST_EMAIL || password !== TEST_PASSWORD) {
      setLoginError("Invalid email or password.");
      return;
    }

    const botanist = { username: "admin", email: TEST_EMAIL, name: "Admin" };
    setEmail("");
    setPassword("");
    setLoginError("");
    navigation.replace("BotanistDashboard", { botanist });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View pointerEvents="none" style={styles.topGlow} />
        <View pointerEvents="none" style={styles.bottomGlow} />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons name="person" size={25} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Sign in to access the Niah Biodiversity System.</Text>

            <View style={styles.form}>
              <FloatingInput label="Email" value={email} onChangeText={updateEmail} keyboardType="email-address" autoComplete="email" returnKeyType="next" />
              <FloatingInput label="Password" value={password} onChangeText={updatePassword} secureTextEntry autoComplete="current-password" returnKeyType="done" onSubmitEditing={handleLogin} />

              <TouchableOpacity style={styles.forgotButton} activeOpacity={0.7} accessibilityRole="button">
                <Text style={styles.forgotText}>Forget password?</Text>
              </TouchableOpacity>

              {loginError ? <Text style={styles.errorText} accessibilityRole="alert">{loginError}</Text> : null}

              <TouchableOpacity style={styles.loginButton} onPress={handleLogin} activeOpacity={0.82} accessibilityRole="button">
                <Text style={styles.loginButtonText}>Login</Text>
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
  keyboardView: { flex: 1, overflow: "hidden", backgroundColor: "#2B5651" },
  topGlow: { position: "absolute", top: -85, right: -75, width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(80, 180, 152, 0.13)" },
  bottomGlow: { position: "absolute", bottom: -150, left: -120, width: 310, height: 310, borderRadius: 155, backgroundColor: "rgba(31, 64, 61, 0.52)" },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 42 },
  content: { width: "100%", maxWidth: 430, alignSelf: "center" },
  iconCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#50B498", justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 18, shadowColor: "#0F3029", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.34, shadowRadius: 12, elevation: 8 },
  title: { color: "#FFF6DC", fontSize: 31, fontWeight: "700", textAlign: "center", letterSpacing: 0.2 },
  subtitle: { color: "#C9DDD6", fontSize: 14, lineHeight: 22, textAlign: "center", marginTop: 9, marginBottom: 38 },
  form: { gap: 25 },
  inputGroup: { position: "relative", height: 56 },
  input: { width: "100%", height: "100%", paddingHorizontal: 18, paddingTop: 7, borderWidth: 1, borderColor: "rgba(224, 235, 221, 0.22)", borderRadius: 12, backgroundColor: "#1F403D", color: "#FFF6DC", fontSize: 16 },
  inputFocused: { borderColor: "#76D1B5", backgroundColor: "#234944", shadowColor: "#50B498", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 5, elevation: 2 },
  labelCut: { position: "absolute", zIndex: 1, top: -5, left: 14, width: 82, height: 12, borderRadius: 6, backgroundColor: "#2B5651" },
  floatingLabel: { position: "absolute", zIndex: 2, top: 19, left: 18, color: "#9BBDB4", fontSize: 15, lineHeight: 18 },
  floatingLabelRaised: { top: -8, left: 20, paddingHorizontal: 4, color: "#DEF9C4", fontSize: 12, lineHeight: 16 },
  forgotButton: { alignSelf: "flex-end", marginTop: -13, paddingVertical: 3 },
  forgotText: { color: "#C9DDD6", fontSize: 13 },
  errorText: { color: "#FFB4AB", fontSize: 13, fontWeight: "500", textAlign: "center", marginTop: -8, marginBottom: -8 },
  loginButton: { height: 54, borderRadius: 12, backgroundColor: "#50B498", justifyContent: "center", alignItems: "center", marginTop: 2, shadowColor: "#0C2822", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 6 },
  loginButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
