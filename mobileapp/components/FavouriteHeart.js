import React from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t, useAppTranslation } from "../translations/i18n";

export default function FavouriteHeart({ active, pending, disabled, onPress, style, size = 21 }) {
  useAppTranslation();
  const label = active ? t("favourites.removeFavourite") : t("favourites.addFavourite");
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled || pending) }}
      disabled={disabled || pending}
      hitSlop={6}
      style={[styles.button, style, (disabled || pending) && styles.disabled]}
      onPress={onPress}
    >
      {pending ? <ActivityIndicator size="small" color="#B83B5E" /> : (
        <Ionicons name={active ? "heart" : "heart-outline"} size={size} color={active ? "#B83B5E" : "#315B49"} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFFE8" },
  disabled: { opacity: 0.6 },
});
