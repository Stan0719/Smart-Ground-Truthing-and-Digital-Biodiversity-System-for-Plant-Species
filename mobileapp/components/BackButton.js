import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const tones = {
  light: { backgroundColor: "#E7F2E2", borderColor: "#CDE3DC", color: "#28665E" },
  glass: { backgroundColor: "rgba(255,255,255,0.82)", borderColor: "rgba(255,255,255,0.92)", color: "#28665E" },
  dark: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(222,249,196,0.2)", color: "#DEF9C4" },
  plain: { backgroundColor: "transparent", borderColor: "transparent", color: "#468585" },
};

function stripArrowGlyphs(value) {
  return typeof value === "string"
    ? value.replace(/[‹←⟵⟸❮⮜◀◁⇐]/gu, "").replace(/\s{2,}/g, " ").trim()
    : value;
}

export default function BackButton({
  onPress,
  label,
  accessibilityLabel,
  variant = "light",
  style,
  labelStyle,
  testID,
}) {
  const tone = tones[variant] || tones.light;
  const plain = variant === "plain";
  const visibleAccessibilityLabel = stripArrowGlyphs(accessibilityLabel || label) || "Back";

  return (
    <TouchableOpacity
      style={[
        styles.button,
        plain
          ? styles.plainButton
          : { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={visibleAccessibilityLabel}
      hitSlop={6}
      testID={testID}
    >
      <Ionicons name="chevron-back" size={20} color={tone.color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
    borderWidth: 1,
    borderRadius: 12,
    flexShrink: 0,
  },
  plainButton: { justifyContent: "center", borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
});
