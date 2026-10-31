import React, { useEffect, useRef, useState } from "react";

import {
  Animated,
  Alert,
  Switch,
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

import { router } from "expo-router";

import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { createFaceCameraController, FACE_CAPTURE_VERSION } from "../utils/faceCaptureFlow";
import { completeFaceLogin } from "../utils/completeFaceLogin";
import { faceSession } from "../utils/faceSession";
import { faceApi, validateFaceSession, faceDiagnostic, faceReference, probeAuthConnection } from "../utils/faceApi";
import MandatoryPasswordChangeScreen from "./MandatoryPasswordChange";
import { changeFirstLoginPassword } from "../utils/firstLoginPassword";
import FaceCameraModal, { faceCameraConfigured } from "../components/FaceCameraModal";


const BIOMETRIC_KEY = "niah.biometric.credentials";
const BIOMETRIC_OPTIONS = {
  requireAuthentication: true,
  keychainService: "niah.biometric.login",
  authenticationPrompt: "Unlock your saved Niah login",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};



function FloatingInput({
  label,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = "default",
  autoComplete,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  editable = true,
}) {
  const [isFocused, setIsFocused] = useState(false);

  const animation = useRef(
    new Animated.Value(value.length > 0 ? 1 : 0)
  ).current;

  const isFloating = isFocused || value.length > 0;

  useEffect(() => {
    Animated.timing(animation, {
      toValue: isFloating ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isFloating]);

  const labelTop = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [19, -8],
  });

  const labelLeft = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 19],
  });

  const labelSize = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 12],
  });

  const labelColor = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ["#9BBDB4", "#DEF9C4"],
  });

  const labelOpacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <View style={styles.inputGroup}>

      {/* Background behind the floating label */}
      <Animated.View
        style={[
          styles.labelCut,
          {
            opacity: labelOpacity,
          },
        ]}
      />

      <TextInput
        style={[
          styles.input,
          isFocused && styles.inputFocused,
        ]}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => { setIsFocused(true); onFocus?.(); }}
        editable={editable}
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

      <Animated.Text
        pointerEvents="none"
        style={[
          styles.floatingLabel,
          {
            top: labelTop,
            left: labelLeft,
            fontSize: labelSize,
            color: labelColor,
          },
        ]}
      >
        {label}
      </Animated.Text>

    </View>
  );
}


export default function LoginScreen({
  navigation,
  onLogin,
  route,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingPasswordSession, setPendingPasswordSession] = useState(null);
  const [loginError, setLoginError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [connectionCheck, setConnectionCheck] = useState("");
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [faceRequest, setFaceRequest] = useState(null);
  const [registerCameraFace, setRegisterCameraFace] = useState(false);
  const registrationIntent = useRef(false);
  function selectFaceRegistration(selected) {
    registrationIntent.current = selected;
    setRegisterCameraFace(selected);
  }
  const [cameraMessage, setCameraMessage] = useState("");
  const [manageLegacy, setManageLegacy] = useState(false);
  const [legacyEmail, setLegacyEmail] = useState("");
  const [legacyPassword, setLegacyPassword] = useState("");
  const faceCompletion = useRef(null);
  const faceCameraController = useRef(null);
  if (!faceCameraController.current) faceCameraController.current = createFaceCameraController({
    reference: faceReference, onChange: setFaceRequest, diagnostic: faceDiagnostic,
    clearMessages: () => { setCameraMessage(""); setLoginError(""); },
  });
  useEffect(() => {
    faceCameraController.current.reset();
    faceCompletion.current?.(null);
    faceCompletion.current = null;
    faceDiagnostic("login_screen_loaded", undefined, { flowVersion: FACE_CAPTURE_VERSION });
  }, []);
  const cameraEnabled = faceCameraConfigured() && Platform.OS !== "web";
  useEffect(() => () => {
    faceCameraController.current.reset();
    faceCompletion.current?.(null);
    faceCompletion.current = null;
  }, []);

  function finishFaceCamera(result, requestId) {
    const completed = faceCameraController.current.finish(requestId);
    if (!completed) return;
    if (completed.mode === "recognize" && result?.token && result?.user) {
      loginLock.current = true;
      completeFaceLogin({ result, session: faceSession, onLogin, navigation, diagnostic: faceDiagnostic }).then(() => {
        setEmail("");
        setPassword("");
        setLoginError("");
      }).catch((error) => {
        faceDiagnostic("session_or_navigation_failed", result.requestId, { code: error.code || "session_or_navigation_error" });
        setCameraMessage(error.message || "Session verification failed. Use email/password or retry face login.");
      }).finally(() => { loginLock.current = false; });
    } else if (completed.mode === "recognize" && result?.enrollmentRequired) {
      selectFaceRegistration(true);
      setCameraMessage("Sign in with your password to register your face. Complete any required password change, then sign in with your permanent password. Registration requires your consent.");
    } else if (result?.error) setCameraMessage(result.error);
    if (completed.mode === "enroll") {
      faceCompletion.current?.(result);
      faceCompletion.current = null;
    }
  }


  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [saveBiometric, setSaveBiometric] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricMessage, setBiometricMessage] = useState("");
  const biometricLock = useRef(false);
  const loginLock = useRef(false);
  const autoPrompted = useRef(false);

  useEffect(() => {
    // Face ID needs a native build with the permission configured.
    if (Platform.OS === "web" || Constants.appOwnership === "expo") return;
    let active = true;
    LocalAuthentication.isEnrolledAsync()
      .then((enrolled) => {
        if (active) setBiometricAvailable(enrolled && SecureStore.canUseBiometricAuthentication());
      })
      .catch(() => { if (active) setBiometricAvailable(false); });
    return () => { active = false; };
  }, []);

  async function fillFromBiometrics(automatic = false) {
    if (cameraEnabled || !biometricAvailable || biometricLock.current || loginLock.current) return;
    if (automatic && (autoPrompted.current || email || password)) return;
    autoPrompted.current = true;
    biometricLock.current = true;
    setBiometricBusy(true);
    setBiometricMessage("");
    try {
      const saved = await SecureStore.getItemAsync(BIOMETRIC_KEY, BIOMETRIC_OPTIONS);
      if (!saved) {
        setBiometricMessage("Sign in with your password and enable biometric autofill first. If your biometrics changed, enable it again.");
        return;
      }
      const credentials = JSON.parse(saved);
      if (typeof credentials.email !== "string" || typeof credentials.password !== "string") {
        throw new Error("Invalid saved credentials");
      }
      setEmail(credentials.email);
      setPassword(credentials.password);
      setLoginError("");
      setBiometricMessage("Login details filled. Tap Login to continue.");
    } catch {
      setBiometricMessage("Biometric autofill was cancelled or unavailable. Enter your details manually, or try again.");
    } finally {
      biometricLock.current = false;
      setBiometricBusy(false);
    }
  }

  async function forgetBiometricLogin() {
    if (biometricLock.current || loginLock.current) return;
    biometricLock.current = true;
    setBiometricBusy(true);
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_KEY, BIOMETRIC_OPTIONS);
      setEmail("");
      setPassword("");
      setSaveBiometric(false);
      setBiometricMessage("Saved biometric login removed from this device.");
    } catch {
      setBiometricMessage("Unable to remove saved login. Please try again.");
    } finally {
      biometricLock.current = false;
      setBiometricBusy(false);
    }
  }

  const screenFade = useRef(new Animated.Value(0)).current;
  const screenSlide = useRef(new Animated.Value(12)).current;
  const iconFloat = useRef(new Animated.Value(0)).current;


  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenFade, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),

      Animated.spring(screenSlide, {
        toValue: 0,
        tension: 55,
        friction: 8,
        useNativeDriver: true,
      }),

      Animated.loop(
        Animated.sequence([
          Animated.timing(iconFloat, {
            toValue: -3,
            duration: 1200,
            useNativeDriver: true,
          }),

          Animated.timing(iconFloat, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();
  }, []);

  useEffect(() => {
    const registeredEmail = route?.params?.registeredEmail;

    if (registeredEmail) {
      setEmail(registeredEmail);
      navigation.setParams({ registeredEmail: undefined });
    }
  }, [navigation, route?.params?.registeredEmail]);


  function updateEmail(value) {
    setEmail(value);

    if (loginError) {
      setLoginError("");
    }
  }


  function updatePassword(value) {
    setPassword(value);

    if (loginError) {
      setLoginError("");
    }
  }

  async function recoverLegacyFace(reenroll) {
    if (loginLock.current || biometricLock.current || faceRequest) return;
    if (!email.trim() || !password || !legacyEmail.trim() || !legacyPassword) {
      setCameraMessage("Enter your real account credentials above and your original enrollment credentials below.");
      return;
    }
    loginLock.current = true;
    let authenticated;
    try {
      const consent = await new Promise(resolve => Alert.alert(
        reenroll ? "Save a new enrollment?" : "Link existing enrollment?",
        reenroll
          ? "I own both accounts and consent to linking them and saving a new live template. The old template remains preserved but will leave active matching. Roles and permissions stay the same."
          : "I own both accounts and consent to linking the existing facial template to my real account. Linking does not improve recognition or confirm historical model compatibility.",
        [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "I own both accounts and agree", onPress: () => resolve(true) }],
        { cancelable: true, onDismiss: () => resolve(false) }
      ));
      if (!consent) return;
      authenticated = await faceApi("/password", { email: email.trim().toLowerCase(), password });
      validateFaceSession(authenticated);
      const proof = { realPassword: password, legacyEmail: legacyEmail.trim().toLowerCase(), legacyPassword };
      // Credentials exist only in transient memory and are cleared from the form.
      setPassword(""); setLegacyPassword("");
      let result;
      if (reenroll) {
        result = await new Promise(resolve => {
          faceCompletion.current = resolve;
          faceCameraController.current.openEnrollment({ ...authenticated, legacyProof: proof });
        });
      } else result = await faceApi("/legacy-link", { ...proof, consent: true }, authenticated.token);
      if (result?.enrolled === true) {
        setCameraMessage(reenroll
          ? "New enrollment saved; old template preserved. Log in with Face ID to verify a different capture."
          : "Existing enrollment linked. Face Login still requires a successful match.");
        setManageLegacy(false);
      } else if (result?.alreadyEnrolled) setCameraMessage("Your account already has a facial enrollment. It was not replaced.");
    } catch (error) {
      setCameraMessage(error.message || "Enrollment recovery failed. No authentication bypass was used.");
    } finally {
      setPassword(""); setLegacyPassword("");
      if (authenticated?.token) {
        try { await faceApi("/logout", {}, authenticated.token); }
        catch { setCameraMessage("Unable to confirm recovery-session logout. Use password login to check your account."); }
      }
      loginLock.current = false;
    }
  }


  async function handleLogin(forceRegistration = false) {
  if (loginLock.current || biometricLock.current || faceRequest) return;
  const wantsRegistration = forceRegistration === true || registrationIntent.current || registerCameraFace;
  loginLock.current = true;
  setPasswordBusy(true);
  setLoginError("");
  try {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    setLoginError("Enter your account email and password.");
    return;
  }

  let user = null;


  // =====================================================
  // BOTANIST LOGIN
  // =====================================================

  let serverToken;
  try {
    const result = await faceApi("/password", { email: normalizedEmail, password });
    validateFaceSession(result);
    if (result.user.mustChangePassword) {
      setPendingPasswordSession(result); setPassword(""); setLoginError(""); return;
    }
    user = result.user;
    serverToken = result.token;
  } catch (error) {
    setLoginError(error.message || "Account service is unavailable.");
    return;
  }


  // =====================================================
  // LOGIN FAILED
  // =====================================================

  if (!user) {
    setLoginError("Invalid email or password.");
    return;
  }


  // =====================================================
  // LOGIN SUCCESS
  // =====================================================

  if (!cameraEnabled && saveBiometric && biometricAvailable) {
    try {
      await SecureStore.setItemAsync(
        BIOMETRIC_KEY,
        JSON.stringify({ email: normalizedEmail, password }),
        BIOMETRIC_OPTIONS
      );
    } catch {
      Alert.alert("Biometric autofill not saved", "You can still sign in normally. Try enabling biometric autofill next time.");
    }
  }

  if (wantsRegistration && cameraEnabled) {
    try {
      const status = await faceApi("/enrollment-status", {}, serverToken);
      if (status.user?.id !== user.id || typeof status.enrolled !== "boolean") throw new Error("Unable to confirm enrollment for this account.");
      const result = status.enrolled ? { alreadyEnrolled: true } : await new Promise((resolve) => {
        faceCompletion.current = resolve;
        faceCameraController.current.openEnrollment({ token: serverToken, user });
      });
      if (result?.alreadyEnrolled) {
        selectFaceRegistration(false);
        setCameraMessage("Your face is already registered. You can now use Face Login.");
        Alert.alert("Face Login ready", "Your face is already registered. You can now use Face Login.");
      } else if (result?.enrolled === true && result.user?.id === user.id && result.user?.email === user.email) {
        selectFaceRegistration(false);
        Alert.alert("Face registered", "You can use Login with Face ID next time.");
      }
      else Alert.alert("Face registration not completed", "Your password login will continue. You can register your face next time.");
    } catch (error) {
      Alert.alert("Unable to check face registration", error.message || "Your password login will continue. Try again later.");
    }
  }

  if (serverToken) {
    try { user = await faceSession.establish({ token: serverToken, user }); }
    catch (error) { setLoginError(error.message || "Unable to securely store your session."); return; }
  }
  setEmail("");
  setPassword("");
  setLoginError("");


  // Do not log account details or session credentials.

  if (onLogin) {
    onLogin(user);
  } else {
    navigation.replace("MainTabs", { screen: user.role === "botanist" ? "AccountTab" : "HomeTab" });
  }
  } finally {
    loginLock.current = false;
    setPasswordBusy(false);
  }
  }


  function handleGuest() {
    setEmail("");
    setPassword("");
    setLoginError("");

    navigation.replace("MainTabs");
  }


  if (pendingPasswordSession) {
    return <MandatoryPasswordChangeScreen
      onSubmit={async (replacement, confirmation) => {
        await changeFirstLoginPassword({ api: faceApi, session: pendingPasswordSession, password: replacement, confirmation });
        setPendingPasswordSession(null); setPassword("");
        setLoginError("Password changed. Sign in with your new password.");
      }}
      onCancel={async () => {
        try { await faceApi("/logout", {}, pendingPasswordSession.token); }
        finally { setPendingPasswordSession(null); setPassword(""); setLoginError(""); }
      }}
    />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FaceCameraModal request={faceRequest} onClose={(requestId) => finishFaceCamera(null, requestId)} onResult={finishFaceCamera} isCurrent={(id) => faceCameraController.current.isCurrent(id)} />

            {typeof __DEV__ === "boolean" && __DEV__ ? (
              <View style={{ backgroundColor: "#E8F3ED", borderColor: "#397558", borderWidth: 1, borderRadius: 12, padding: 14, margin: 10, flexShrink: 0, gap: 8 }}>
                <Text style={{ color: "#174B35", fontWeight: "700" }}>Development build: 20261029.4</Text>
                <Text style={{ color: "#174B35", fontSize: 12 }}>Metro: {Constants.expoConfig?.hostUri || "Not supplied by runtime"}</Text>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check authentication connection (no credentials)" disabled={checkingConnection || passwordBusy} onPress={async () => {
                  setCheckingConnection(true); setConnectionCheck("Checking authentication connection…");
                  try { const result = await probeAuthConnection(); setConnectionCheck(`HTTP ${result.status}: Connected\n${result.base}\nReference: ${result.reference}`); }
                  catch (error) { setConnectionCheck(`${error.status ? `HTTP ${error.status} received` : "No HTTP response received"}\n${error.code || "API_CLIENT_ERROR"}: ${error.message}\nReference: ${error.requestId || "Not available"}`); }
                  finally { setCheckingConnection(false); }
                }} style={{ backgroundColor: "#175E3E", borderRadius: 8, padding: 12 }}>
                  <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{checkingConnection ? "Checking connection…" : "Check authentication connection (no credentials)"}</Text>
                </TouchableOpacity>
                {!!connectionCheck && <ScrollView style={{ maxHeight: 120 }} keyboardShouldPersistTaps="handled"><Text selectable accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: "#174B35", fontSize: 12 }}>{connectionCheck}</Text></ScrollView>}
              </View>
            ) : null}

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : "height"
        }
      >

        {/* Background decorations */}
        <View
          pointerEvents="none"
          style={styles.topGlow}
        />

        <View
          pointerEvents="none"
          style={styles.bottomGlow}
        />


        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          <Animated.View
            style={[
              styles.content,
              {
                opacity: screenFade,
                transform: [
                  {
                    translateY: screenSlide,
                  },
                ],
              },
            ]}
          >

            {/* User icon */}
            <Animated.View
              style={[
                styles.iconCircle,
                {
                  transform: [
                    {
                      translateY: iconFloat,
                    },
                  ],
                },
              ]}
            >
              <Ionicons
                name="person"
                size={23}
                color="#FFFFFF"
              />
            </Animated.View>


            {/* Title */}
            <Text style={styles.title}>
              Welcome Back
            </Text>


            {/* Subtitle */}
            <Text style={styles.subtitle}>
              Sign in to access the Niah Biodiversity System.
            </Text>




            {/* Form */}
            <View style={styles.form}>

              {/* Email */}
              <FloatingInput
                onFocus={() => fillFromBiometrics(true)}
                editable={!biometricBusy && !passwordBusy}
                label="Email"
                value={email}
                onChangeText={updateEmail}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />


              {/* Password */}
              <FloatingInput
                editable={!biometricBusy && !passwordBusy}
                label="Password"
                value={password}
                onChangeText={updatePassword}
                secureTextEntry
                autoComplete="current-password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />


              {!cameraEnabled && <View style={{ gap: 10 }}>
                <Text style={styles.biometricHelp}>
                  {biometricAvailable
                    ? "Sign in once and enable biometric autofill. Next time, tap Email to unlock your saved email and password with Face ID or fingerprint."
                    : "Biometric autofill needs a native app build and Face ID or fingerprint enabled in your phone settings. You can always sign in manually."}
                </Text>
                {biometricAvailable && <>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={[styles.biometricHelp, { flex: 1 }]}>Save this login for biometric autofill on this device</Text>
                    <Switch value={saveBiometric} onValueChange={setSaveBiometric} disabled={biometricBusy} accessibilityLabel="Save login for biometric autofill" />
                  </View>
                  <TouchableOpacity onPress={() => fillFromBiometrics()} disabled={biometricBusy} accessibilityRole="button">
                    <Text style={styles.guestButtonText}>{biometricBusy ? "Unlocking…" : "Autofill with biometrics"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={forgetBiometricLogin} disabled={biometricBusy} accessibilityRole="button">
                    <Text style={styles.biometricHelp}>Remove saved biometric login</Text>
                  </TouchableOpacity>
                </>}
                {!!biometricMessage && <Text style={styles.biometricHelp} accessibilityLiveRegion="polite">{biometricMessage}</Text>}
              </View>}

              {cameraEnabled && <View style={{ gap: 12 }}>
                <Text style={styles.biometricHelp}>Register once for your eligible account, then use Login with Face ID without typing your email or password.</Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={[styles.biometricHelp, { flex: 1 }]}>Register my face after password login</Text>
                  <Switch value={registerCameraFace} onValueChange={selectFaceRegistration} accessibilityLabel="Register face after login" />
                </View>
                {typeof __DEV__ === "boolean" && __DEV__ && <Text style={styles.biometricHelp}>Face flow: {FACE_CAPTURE_VERSION}</Text>}
                <TouchableOpacity accessibilityRole="button" disabled={passwordBusy} onPress={() => {
                  selectFaceRegistration(true);
                  return handleLogin(true);
                }}>
                  <Text style={styles.guestButtonText}>Register Face with password</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={() => {
                  if (!loginLock.current && !biometricLock.current && !faceRequest) {
                    if (registrationIntent.current || registerCameraFace) return handleLogin(true);
                    faceCameraController.current.openLogin();
                  }
                }}>
                  <Text style={styles.guestButtonText}>{registerCameraFace ? "Sign in and register my face" : "Login with Face ID"}</Text>
                </TouchableOpacity>
                {registerCameraFace && <Text style={styles.biometricHelp}>Enter your email and permanent password, then sign in to open Face Registration. No face is saved until you agree in the camera.</Text>}
                <TouchableOpacity accessibilityRole="button" onPress={() => {
                  if (!loginLock.current && !faceRequest) { setManageLegacy(!manageLegacy); setLegacyPassword(""); }
                }}><Text style={styles.biometricHelp}>Manage my existing facial enrollment</Text></TouchableOpacity>
                {manageLegacy && <View style={{ gap: 16 }}>
                  <Text style={styles.biometricHelp}>Enter your eligible real account email/password above. Enter your original face-enrollment credentials below. Never use another person's enrollment.</Text>
                  <FloatingInput label="Legacy email" value={legacyEmail} onChangeText={setLegacyEmail} keyboardType="email-address" />
                  <FloatingInput label="Legacy password" value={legacyPassword} onChangeText={setLegacyPassword} secureTextEntry />
                  <TouchableOpacity accessibilityRole="button" onPress={() => recoverLegacyFace(false)}><Text style={styles.guestButtonText}>Link my existing enrollment</Text></TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" onPress={() => recoverLegacyFace(true)}><Text style={styles.guestButtonText}>Enroll a new capture, preserve my old template</Text></TouchableOpacity>
                </View>}
                <TouchableOpacity accessibilityRole="button" onPress={async () => {
                  if (loginLock.current || biometricLock.current || faceRequest) return;
                  try {
                    const session = await faceApi("/password", { email: email.trim().toLowerCase(), password });
                    await faceApi("/delete-face", {}, session.token);
                    setCameraMessage("Face registration removed and sessions revoked.");
                  } catch (error) { setCameraMessage(error.message); }
                }}><Text style={styles.biometricHelp}>Remove my face (enter email and password above)</Text></TouchableOpacity>
                {!!cameraMessage && <Text style={styles.biometricHelp} accessibilityLiveRegion="polite">{cameraMessage}</Text>}
              </View>}

              {/* Forgot password */}
              <TouchableOpacity
                style={styles.forgotButton}
                onPress={() => router.push("/forgot-password")}
                activeOpacity={0.65}
                accessibilityRole="button"
              >
                <Text style={styles.forgotText}>
                  Forget password?
                </Text>
              </TouchableOpacity>


              {/* Error */}
              {loginError ? (
                <Text
                  style={styles.errorText}
                  accessibilityRole="alert"
                >
                  {loginError}
                </Text>
              ) : null}


              {/* Login */}
              <TouchableOpacity
                disabled={biometricBusy || passwordBusy}
                style={styles.loginButton}
                onPress={handleLogin}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.loginButtonText}>
                  {passwordBusy ? "Signing in…" : "Login with Email and Password"}
                </Text>
              </TouchableOpacity>


              {/* Visitor registration */}
              <TouchableOpacity
                style={styles.registerPrompt}
                onPress={() => navigation.navigate("VisitorRegister")}
                activeOpacity={0.65}
                accessibilityRole="button"
              >
                <Text style={styles.registerPromptText}>
                  New visitor?{" "}
                  <Text style={styles.registerLinkText}>
                    Create an account
                  </Text>
                </Text>
              </TouchableOpacity>


              {/* OR */}
              <View style={styles.dividerContainer}>

                <View style={styles.divider} />

                <Text style={styles.dividerText}>
                  OR
                </Text>

                <View style={styles.divider} />

              </View>


              {/* Guest */}
              <TouchableOpacity
                style={styles.guestButton}
                onPress={handleGuest}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.guestButtonText}>
                  Continue as Guest
                </Text>
              </TouchableOpacity>

            </View>

          </Animated.View>

        </ScrollView>

      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}


const styles = StyleSheet.create({

  biometricHelp: { color: "#C9DDD6", fontSize: 12, lineHeight: 18 },

  safeArea: {
    flex: 1,
    backgroundColor: "#244B47",
  },


  keyboardView: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#2B5651",
  },


  /* Top decorative circle */
  topGlow: {
    position: "absolute",
    top: -90,
    right: -80,

    width: 190,
    height: 190,

    borderRadius: 95,

    backgroundColor: "rgba(80, 180, 152, 0.13)",
  },


  /* Bottom decorative circle */
  bottomGlow: {
    position: "absolute",
    bottom: -130,
    left: -110,

    width: 270,
    height: 270,

    borderRadius: 135,

    backgroundColor: "rgba(31, 64, 61, 0.45)",
  },


  /* Screen content */
  scrollContent: {
    flexGrow: 1,

    justifyContent: "center",

    paddingHorizontal: 20,
    paddingVertical: 36,
  },


  /* Login card */
  content: {
    width: "100%",
    maxWidth: 390,

    alignSelf: "center",

    paddingTop: 36,
    paddingHorizontal: 32,
    paddingBottom: 32,

    borderWidth: 1,
    borderColor: "rgba(222, 249, 196, 0.18)",
    borderRadius: 22,

    backgroundColor: "#2B5651",

    shadowColor: "#0C2520",
    shadowOffset: {
      width: 0,
      height: 28,
    },
    shadowOpacity: 0.38,
    shadowRadius: 35,

    elevation: 12,
  },


  /* User icon */
  iconCircle: {
    width: 58,
    height: 58,

    borderRadius: 29,

    backgroundColor: "#50B498",

    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",

    marginBottom: 16,

    shadowColor: "#0F3029",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.32,
    shadowRadius: 11,

    elevation: 8,
  },


  /* Welcome Back */
  title: {
    marginBottom: 9,

    color: "#FFF6DC",

    fontSize: 30,
    fontWeight: "700",

    textAlign: "center",
  },


  /* Description */
  subtitle: {
    marginBottom: 34,

    color: "#C9DDD6",

    fontSize: 14,
    lineHeight: 22,

    textAlign: "center",
  },


  /* Form */
  form: {
    gap: 27,
  },


  /* Input container */
  inputGroup: {
    position: "relative",

    height: 54,
  },


  /* Input */
  input: {
    width: "100%",
    height: "100%",

    paddingHorizontal: 18,
    paddingTop: 6,

    borderWidth: 1,
    borderColor: "rgba(224, 235, 221, 0.2)",
    borderRadius: 12,

    backgroundColor: "#1F403D",

    color: "#FFF6DC",

    fontSize: 16,
  },


  /* Focused input */
  inputFocused: {
    borderColor: "#76D1B5",

    backgroundColor: "#234944",

    shadowColor: "#50B498",
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.16,
    shadowRadius: 4,

    elevation: 2,
  },


  /* Background behind floating label */
  labelCut: {
    position: "absolute",

    zIndex: 1,

    top: -5,
    left: 14,

    width: 82,
    height: 14,

    borderRadius: 7,

    backgroundColor: "#2B5651",
  },


  /* Floating label */
  floatingLabel: {
    position: "absolute",

    zIndex: 2,

    lineHeight: 16,
  },


  /* Forgot password */
  forgotButton: {
    alignSelf: "flex-end",

    marginTop: -16,
    marginBottom: -8,

    paddingVertical: 2,
  },


  forgotText: {
    color: "#C9DDD6",

    fontSize: 13,
  },


  /* Login error */
  errorText: {
    color: "#B84A4A",

    fontSize: 13,
    fontWeight: "500",

    textAlign: "center",

    marginTop: -8,
    marginBottom: -18,
  },


  /* Botanist Login */
  loginButton: {
    width: "100%",
    height: 52,

    marginTop: 5,

    borderRadius: 12,

    backgroundColor: "#50B498",

    justifyContent: "center",
    alignItems: "center",

    shadowColor: "#0C2822",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.24,
    shadowRadius: 9,

    elevation: 6,
  },


  loginButtonText: {
    color: "#FFFFFF",

    fontSize: 16,
    fontWeight: "700",
  },


  registerPrompt: {
    alignSelf: "center",

    marginTop: -12,
    marginBottom: -8,

    paddingVertical: 2,
  },


  registerPromptText: {
    color: "#C9DDD6",

    fontSize: 13,
  },


  registerLinkText: {
    color: "#DEF9C4",

    fontWeight: "700",
  },


  /* OR separator */
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",

    marginVertical: -4,
  },


  divider: {
    flex: 1,

    height: 1,

    backgroundColor: "rgba(224, 235, 221, 0.18)",
  },


  dividerText: {
    marginHorizontal: 12,

    color: "#9BBDB4",

    fontSize: 11,
    fontWeight: "600",
  },


  /* Guest button */
  guestButton: {
    width: "100%",
    height: 52,

    borderRadius: 12,

    justifyContent: "center",
    alignItems: "center",

    backgroundColor: "transparent",

    borderWidth: 1,
    borderColor: "#50B498",
  },


  guestButtonText: {
    color: "#DEF9C4",

    fontSize: 16,
    fontWeight: "600",
  },

});
