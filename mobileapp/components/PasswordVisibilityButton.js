import React from "react";
import { TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t, useAppTranslation } from "../translations/i18n";

export default function PasswordVisibilityButton({ visible, onPress, disabled = false }) {
  useAppTranslation();
  return <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel={t(visible ? "login.hidePassword" : "login.showPassword")}
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
  ><Ionicons name={visible ? "eye-off" : "eye"} size={21} color="#DEF9C4" /></TouchableOpacity>;
}
