import React from "react";
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions } from "react-native";
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
  const { width } = useWindowDimensions();
  const plain = variant === "plain";
  const maxButtonWidth = Math.min(150, Math.max(84, width * 0.29));
  const visibleLabel = stripArrowGlyphs(label);
  const visibleAccessibilityLabel = stripArrowGlyphs(accessibilityLabel || label);

  return (
    <TouchableOpacity
      style={[
        styles.button,
        plain
          ? [styles.plainButton, { maxWidth: maxButtonWidth }]
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
      {!!visibleLabel && <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.label, plain && styles.plainLabel, { color: tone.color }, labelStyle]}>{visibleLabel}</Text>}
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
    gap: 7,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 12,
    flexShrink: 0,
  },
  plainButton: { justifyContent: "flex-start", gap: 4, paddingHorizontal: 0, borderWidth: 0, borderRadius: 0, backgroundColor: "transparent" },
  label: { fontSize: 14, lineHeight: 19, fontWeight: "700", flexShrink: 1 },
  plainLabel: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
});
