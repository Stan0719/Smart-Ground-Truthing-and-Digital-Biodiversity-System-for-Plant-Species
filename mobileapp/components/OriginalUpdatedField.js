import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTranslation, t } from "../translations/i18n";

const isMissing = (value) => value === null || value === undefined || value === "";

export default function OriginalUpdatedField({ label, originalValue, originalContent, children }) {
  useAppTranslation();
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Text style={styles.sectionLabel}>{t("recordEdits.originalInformation")}</Text>
      {originalContent || <Text style={styles.originalValue}>{isMissing(originalValue) ? t("recordEdits.informationNotAvailable") : String(originalValue)}</Text>}
      <Text style={styles.sectionLabel}>{t("recordEdits.updatedInformation")}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6, marginBottom: 10 },
  fieldLabel: { marginTop: 6, color: "#52665A", fontSize: 13, fontWeight: "700" },
  sectionLabel: { marginTop: 2, color: "#718078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.35 },
  originalValue: { minHeight: 40, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: "#E2EDE0", backgroundColor: "#F7FBF4", color: "#52665A", fontSize: 14, lineHeight: 20, textAlignVertical: "center" },
});
