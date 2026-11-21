import React from "react";
import { PixelRatio, StyleSheet, Text, TextInput, useWindowDimensions } from "react-native";
import { useTextSize } from "./TextSizeContext";
import { appTextFactor } from "../utils/textSizePreference";

export function scaledTextStyle(style, percent, systemFontScale) {
  const factor = appTextFactor(percent, systemFontScale);
  if (factor === 1) return style;
  const flattened = StyleSheet.flatten(style) || {};
  return [style, {
    fontSize: typeof flattened.fontSize === "number" ? flattened.fontSize * factor : 14 * factor,
    ...(typeof flattened.lineHeight === "number" ? { lineHeight: flattened.lineHeight * factor } : {}),
  }];
}

const ScaledText = React.forwardRef(function ScaledText({ style, ...props }, ref) {
  const { percent } = useTextSize();
  const { fontScale } = useWindowDimensions();
  return <Text {...props} ref={ref} style={scaledTextStyle(style, percent, fontScale || PixelRatio.getFontScale())} />;
});

export default ScaledText;

export const ScaledTextInput = React.forwardRef(function ScaledTextInput({ style, ...props }, ref) {
  const { percent } = useTextSize();
  const { fontScale } = useWindowDimensions();
  return <TextInput {...props} ref={ref} style={scaledTextStyle(style, percent, fontScale || PixelRatio.getFontScale())} />;
});
