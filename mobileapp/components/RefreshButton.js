import React from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function RefreshButton({ onPress, loading = false, label, style, testID }) {
  return (
    <TouchableOpacity
      style={[styles.button, loading && styles.loading, style]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#28665E" />
      ) : (
        <Ionicons name="refresh-outline" size={21} color="#28665E" />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#CDE3DC",
    backgroundColor: "#EFF8F4",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  loading: { opacity: 0.72 },
});
