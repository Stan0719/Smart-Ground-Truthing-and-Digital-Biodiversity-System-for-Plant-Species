import React from "react";
import {
  View,
  Text,
  StyleSheet,
} from "react-native";

import CustomButton from "../components/CustomButton";

export default function AccountScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.logoCircle}>
        <Text style={styles.logoIcon}>
          🌿
        </Text>
      </View>

      <Text style={styles.title}>
        Welcome
      </Text>

      <Text style={styles.subtitle}>
        Login as a botanist to manage plant records
      </Text>

      <CustomButton
        title="Botanist Login"
        onPress={() =>
          navigation.navigate("Login")
        }
      />

      <CustomButton
        title="Continue as Guest"
        secondary
        onPress={() => {}}
      />

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>
          Guest Access
        </Text>

        <Text style={styles.infoText}>
          You can browse plant information, scan QR codes and
          explore plant locations without logging in.
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

  logoCircle: {
    width: 105,
    height: 105,
    borderRadius: 53,
    backgroundColor: "#9CDBA6",
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
  },

  logoIcon: {
    fontSize: 50,
  },

  title: {
    fontSize: 29,
    fontWeight: "800",
    textAlign: "center",
    color: "#468585",
    marginTop: 20,
  },

  subtitle: {
    textAlign: "center",
    color: "#687568",
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 21,
  },

  infoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    padding: 17,
    marginTop: 25,
  },

  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#468585",
  },

  infoText: {
    fontSize: 13,
    color: "#687568",
    lineHeight: 20,
    marginTop: 5,
  },
});