import { useAppTranslation, t } from "../translations/i18n";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function QRRefreshButton({ onPress, loading, label, style }) {
  useAppTranslation();
  return (
    <TouchableOpacity
      style={[styles.button, loading && styles.loading, style]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
    >
      <View style={styles.icon}>
        {loading ? (
          <ActivityIndicator size="small" color="#28665E" />
        ) : (
          <Ionicons name="refresh-outline" size={19} color="#28665E" />
        )}
      </View>
      <Text style={styles.label}>{loading ? t("botanistNotifications.refreshing") : label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#CDE3DC",
    backgroundColor: "#EFF8F4",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loading: { opacity: 0.65 },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DDEFE7",
  },
  label: {
    flexShrink: 1,
    color: "#28665E",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
});
