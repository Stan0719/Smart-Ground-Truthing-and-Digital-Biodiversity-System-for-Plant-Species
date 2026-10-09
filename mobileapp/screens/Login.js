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

import { router } from "expo-router";

import { Ionicons } from "@expo/vector-icons";
import { getVisitorAccounts } from "../utils/visitorStorage";

const TEST_BOTANIST = {
  id: 1,
  name: "Admin",
  email: "admin@niah.com",
  password: "admin123",
  role: "botanist",
  status: "Active",
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
  const [loginError, setLoginError] = useState("");

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


  async function handleLogin() {
  const normalizedEmail = email.trim().toLowerCase();

  let user = null;


  // =====================================================
  // BOTANIST LOGIN
  // =====================================================

  if (
    normalizedEmail === TEST_BOTANIST.email.toLowerCase() &&
    password === TEST_BOTANIST.password
  ) {
    user = {
      id: TEST_BOTANIST.id,
      name: TEST_BOTANIST.name,
      email: TEST_BOTANIST.email,
      role: TEST_BOTANIST.role,
    };
  }


  // =====================================================
  // VISITOR LOGIN
  // =====================================================

  if (!user) {
    try {
      const visitors = await getVisitorAccounts();

      const visitor = visitors.find(
        (visitor) =>
          visitor.email?.trim().toLowerCase() === normalizedEmail &&
          visitor.password === password &&
          visitor.role === "Visitor" &&
          visitor.status === "Active"
      );

      if (visitor) {
        user = {
          id: visitor.id,
          name: visitor.name,
          email: visitor.email,
          role: "visitor",
        };
      }

    } catch (error) {
      console.log("Unable to load visitor accounts:", error);
    }
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

  setEmail("");
  setPassword("");
  setLoginError("");


  console.log("LOGGED IN USER:", user);

  if (onLogin) {
    onLogin(user);
  } else {
    navigation.replace("MainTabs");
  }}


  function handleGuest() {
    setEmail("");
    setPassword("");
    setLoginError("");

    navigation.replace("MainTabs");
  }


  return (
    <SafeAreaView style={styles.safeArea}>

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
                label="Email"
                value={email}
                onChangeText={updateEmail}
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />


              {/* Password */}
              <FloatingInput
                label="Password"
                value={password}
                onChangeText={updatePassword}
                secureTextEntry
                autoComplete="current-password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />


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
                style={styles.loginButton}
                onPress={handleLogin}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Text style={styles.loginButtonText}>
                  Login
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
