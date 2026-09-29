import React, { useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from "react-native";

import { botanists } from "../data/mockData";

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleLogin() {
    const botanist = botanists.find(
      (item) =>
        item.username === username.trim() &&
        item.password === password
    );

    if (!botanist) {
      Alert.alert(
        "Login Failed",
        "Invalid username or password."
      );
      return;
    }

    navigation.replace(
      "BotanistDashboard",
      {
        botanist,
      }
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>
          🔬
        </Text>
      </View>

      <Text style={styles.title}>
        Botanist Login
      </Text>

      <Text style={styles.subtitle}>
        Sign in to manage your plant records
      </Text>

      <Text style={styles.label}>
        Username
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter username"
        placeholderTextColor="#8A9A8F"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />

      <Text style={styles.label}>
        Password
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter password"
        placeholderTextColor="#8A9A8F"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogin}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>
          Login
        </Text>
      </TouchableOpacity>

      <View style={styles.demoCard}>
        <Text style={styles.demoTitle}>
          Demo Accounts
        </Text>

        <Text style={styles.demoText}>
          Alice: alice / 123456
        </Text>

        <Text style={styles.demoText}>
          Bob: bob / 123456
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#DEF9C4",
    padding: 25,
    justifyContent: "center",
  },

  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#9CDBA6",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 20,
  },

  icon: {
    fontSize: 37,
  },

  title: {
    fontSize: 29,
    fontWeight: "800",
    color: "#468585",
    textAlign: "center",
  },

  subtitle: {
    color: "#687568",
    textAlign: "center",
    marginTop: 5,
    marginBottom: 25,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#468585",
    marginBottom: 6,
  },

  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    fontSize: 15,
    color: "#468585",
    borderWidth: 1,
    borderColor: "#9CDBA6",
  },

  button: {
    backgroundColor: "#50B498",
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    marginTop: 5,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  demoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 15,
    marginTop: 20,
  },

  demoTitle: {
    color: "#468585",
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 7,
  },

  demoText: {
    color: "#687568",
    textAlign: "center",
    fontSize: 13,
    marginTop: 3,
  },
});