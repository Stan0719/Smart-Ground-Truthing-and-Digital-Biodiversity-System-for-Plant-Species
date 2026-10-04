import React, { useEffect, useRef, useState } from "react";

import {
  Animated,
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
import {
  getNextVisitorId,
  getVisitorAccounts,
  saveVisitorAccount,
} from "../utils/visitorStorage";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function FloatingInput({
  label,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = "default",
  autoComplete,
  autoCapitalize = "none",
  returnKeyType,
  onSubmitEditing,
}) {
  const [isFocused, setIsFocused] = useState(false);
  const animation = useRef(new Animated.Value(value.length > 0 ? 1 : 0)).current;
  const isFloating = isFocused || value.length > 0;

  useEffect(() => {
    Animated.timing(animation, {
      toValue: isFloating ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [animation, isFloating]);

  return (
    <View style={styles.inputGroup}>
      <Animated.View
        style={[styles.labelCut, { opacity: animation }]}
        pointerEvents="none"
      />
      <TextInput
        style={[styles.input, isFocused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
      />
      <Animated.Text
        pointerEvents="none"
        style={[
          styles.floatingLabel,
          {
            top: animation.interpolate({ inputRange: [0, 1], outputRange: [19, -8] }),
            left: animation.interpolate({ inputRange: [0, 1], outputRange: [18, 19] }),
            fontSize: animation.interpolate({ inputRange: [0, 1], outputRange: [15, 12] }),
            color: animation.interpolate({ inputRange: [0, 1], outputRange: ["#9BBDB4", "#DEF9C4"] }),
          },
        ]}
      >
        {label}
      </Animated.Text>
    </View>
  );
}

export default function VisitorRegisterScreen({ navigation }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const screenFade = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenFade, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.spring(screenSlide, { toValue: 0, tension: 55, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [screenFade, screenSlide]);

  function updateField(field, setter) {
    return (value) => {
      setter(value);
      if (errors[field] || errors.form) {
        setErrors((current) => ({ ...current, [field]: "", form: "" }));
      }
    };
  }

  async function handleRegister() {
    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors = {};

    if (!trimmedName) nextErrors.name = "Full Name is required.";
    if (!normalizedEmail) nextErrors.email = "Email is required.";
    else if (!EMAIL_PATTERN.test(normalizedEmail)) nextErrors.email = "Enter a valid email address.";
    if (!password) nextErrors.password = "Password is required.";
    else if (password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    if (!confirmPassword) nextErrors.confirmPassword = "Confirm Password is required.";
    else if (password !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      const visitors = await getVisitorAccounts();
      const emailExists = visitors.some(
        (visitor) => visitor.email.trim().toLowerCase() === normalizedEmail
      );

      if (emailExists) {
        setErrors({ email: "An account with this email already exists." });
        return;
      }

      // PROTOTYPE ONLY: replace local password storage with backend authentication and password hashing.
      const visitor = {
        id: getNextVisitorId(visitors),
        name: trimmedName,
        email: normalizedEmail,
        password,
        role: "Visitor",
        status: "Active",
        createdAt: new Date().toISOString(),
      };

      await saveVisitorAccount(visitor);
      setRegisteredEmail(normalizedEmail);
    } catch {
      setErrors({ form: "Unable to create the account. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  function continueToLogin() {
    navigation.navigate("Login", { registeredEmail });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View pointerEvents="none" style={styles.topGlow} />
        <View pointerEvents="none" style={styles.bottomGlow} />
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.content, { opacity: screenFade, transform: [{ translateY: screenSlide }] }]}>
            <View style={styles.iconCircle}>
              <Ionicons name={registeredEmail ? "checkmark" : "person-add"} size={23} color="#FFFFFF" />
            </View>

            {registeredEmail ? (
              <>
                <Text style={styles.title}>Account Created</Text>
                <Text style={styles.subtitle}>Your Visitor account has been created successfully.</Text>
                <TouchableOpacity style={styles.primaryButton} onPress={continueToLogin} activeOpacity={0.75} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>Continue to Login</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.title}>Create Account</Text>
                <Text style={styles.subtitle}>Register as a Visitor to explore the Niah Biodiversity System.</Text>
                <View style={styles.form}>
                  <View>
                    <FloatingInput label="Full Name" value={name} onChangeText={updateField("name", setName)} autoComplete="name" autoCapitalize="words" returnKeyType="next" />
                    {errors.name ? <Text style={styles.fieldError}>{errors.name}</Text> : null}
                  </View>
                  <View>
                    <FloatingInput label="Email" value={email} onChangeText={updateField("email", setEmail)} keyboardType="email-address" autoComplete="email" returnKeyType="next" />
                    {errors.email ? <Text style={styles.fieldError}>{errors.email}</Text> : null}
                  </View>
                  <View>
                    <FloatingInput label="Password" value={password} onChangeText={updateField("password", setPassword)} secureTextEntry autoComplete="new-password" returnKeyType="next" />
                    {errors.password ? <Text style={styles.fieldError}>{errors.password}</Text> : null}
                  </View>
                  <View>
                    <FloatingInput label="Confirm Password" value={confirmPassword} onChangeText={updateField("confirmPassword", setConfirmPassword)} secureTextEntry autoComplete="new-password" returnKeyType="done" onSubmitEditing={handleRegister} />
                    {errors.confirmPassword ? <Text style={styles.fieldError}>{errors.confirmPassword}</Text> : null}
                  </View>
                  {errors.form ? <Text style={styles.formError} accessibilityRole="alert">{errors.form}</Text> : null}
                  <TouchableOpacity style={[styles.primaryButton, isSubmitting && styles.disabledButton]} onPress={handleRegister} disabled={isSubmitting} activeOpacity={0.75} accessibilityRole="button">
                    <Text style={styles.primaryButtonText}>{isSubmitting ? "Creating Account..." : "Create Account"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.loginPrompt} onPress={() => navigation.goBack()} activeOpacity={0.65} accessibilityRole="button">
                    <Text style={styles.promptText}>Already have an account? <Text style={styles.promptLink}>Login</Text></Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#244B47" },
  keyboardView: { flex: 1, overflow: "hidden", backgroundColor: "#2B5651" },
  topGlow: { position: "absolute", top: -90, right: -80, width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(80, 180, 152, 0.13)" },
  bottomGlow: { position: "absolute", bottom: -130, left: -110, width: 270, height: 270, borderRadius: 135, backgroundColor: "rgba(31, 64, 61, 0.45)" },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 36 },
  content: { width: "100%", maxWidth: 390, alignSelf: "center", paddingTop: 32, paddingHorizontal: 32, paddingBottom: 28, borderWidth: 1, borderColor: "rgba(222, 249, 196, 0.18)", borderRadius: 22, backgroundColor: "#2B5651", shadowColor: "#0C2520", shadowOffset: { width: 0, height: 28 }, shadowOpacity: 0.38, shadowRadius: 35, elevation: 12 },
  iconCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#50B498", justifyContent: "center", alignItems: "center", alignSelf: "center", marginBottom: 16, shadowColor: "#0F3029", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 11, elevation: 8 },
  title: { marginBottom: 9, color: "#FFF6DC", fontSize: 30, fontWeight: "700", textAlign: "center" },
  subtitle: { marginBottom: 30, color: "#C9DDD6", fontSize: 14, lineHeight: 22, textAlign: "center" },
  form: { gap: 22 },
  inputGroup: { position: "relative", height: 54 },
  input: { width: "100%", height: "100%", paddingHorizontal: 18, paddingTop: 6, borderWidth: 1, borderColor: "rgba(224, 235, 221, 0.2)", borderRadius: 12, backgroundColor: "#1F403D", color: "#FFF6DC", fontSize: 16 },
  inputFocused: { borderColor: "#76D1B5", backgroundColor: "#234944", shadowColor: "#50B498", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 4, elevation: 2 },
  labelCut: { position: "absolute", zIndex: 1, top: -5, left: 14, width: 112, height: 14, borderRadius: 7, backgroundColor: "#2B5651" },
  floatingLabel: { position: "absolute", zIndex: 2, lineHeight: 16 },
  fieldError: { color: "#F3A6A6", fontSize: 12, marginTop: 5, marginLeft: 4 },
  formError: { color: "#F3A6A6", fontSize: 13, textAlign: "center" },
  primaryButton: { width: "100%", height: 52, marginTop: 5, borderRadius: 12, backgroundColor: "#50B498", justifyContent: "center", alignItems: "center", shadowColor: "#0C2822", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.24, shadowRadius: 9, elevation: 6 },
  disabledButton: { opacity: 0.65 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  loginPrompt: { alignSelf: "center", paddingVertical: 2 },
  promptText: { color: "#C9DDD6", fontSize: 13 },
  promptLink: { color: "#DEF9C4", fontWeight: "700" },
});
