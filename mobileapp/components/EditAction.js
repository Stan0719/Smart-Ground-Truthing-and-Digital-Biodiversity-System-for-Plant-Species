import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t, useAppTranslation } from "../translations/i18n";

export default function EditAction({ onPress, testID }) {
  useAppTranslation();
  return <TouchableOpacity style={styles.button} onPress={onPress} accessibilityRole="button" accessibilityLabel={t("recordEdits.edit")}
    activeOpacity={0.8} testID={testID}>
    <Ionicons name="pencil-outline" size={18} color="#28665E" />
    <Text style={styles.label}>{t("recordEdits.edit")}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({ button: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 12,
  borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#EFF8F4", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  label: { color: "#28665E", fontWeight: "700", fontSize: 13 } });
