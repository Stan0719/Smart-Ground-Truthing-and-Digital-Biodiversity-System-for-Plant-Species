import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t, useAppTranslation } from "../translations/i18n";

export default function EditAction({ onPress, testID, disabled = false, labelKey = "recordEdits.edit" }) {
  useAppTranslation();
  const label = t(labelKey);
  return <TouchableOpacity style={[styles.button, disabled && styles.disabled]} onPress={onPress} disabled={disabled}
    accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    activeOpacity={0.8} testID={testID}>
    <Ionicons name={disabled ? "lock-closed-outline" : "pencil-outline"} size={18} color={disabled ? "#8A7654" : "#28665E"} />
    <Text style={[styles.label, disabled && styles.disabledLabel]}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({ button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12,
  borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#EFF8F4", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  label: { color: "#28665E", fontWeight: "700", fontSize: 13 }, disabled: { borderColor: "#E5D8B8", backgroundColor: "#F8F3E8", opacity: 0.82 },
  disabledLabel: { color: "#786747" } });
