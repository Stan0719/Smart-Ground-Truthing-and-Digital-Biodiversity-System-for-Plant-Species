import React, { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { localization, translateLabel, useAppTranslation } from "../translations/i18n";

export default function LanguageSelector() {
  const { i18n } = useAppTranslation();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const language = i18n.resolvedLanguage || "en";
  async function choose(value) {
    setSaving(true);
    setVisible(false);
    try { await localization.changeLanguage(value); }
    catch { Alert.alert(translateLabel("Language changed"), translateLabel("The language was changed for this session, but could not be saved. Please try again.")); }
    finally { setSaving(false); }
  }
  return <>
    <TouchableOpacity
      style={styles.button} onPress={() => setVisible(true)} disabled={saving}
      activeOpacity={0.7} accessibilityRole="button"
      accessibilityLabel={`${translateLabel("Language")}: ${language === "ms" ? "Bahasa Melayu" : "English"}`}
    >
      <Ionicons name="language-outline" size={18} color="#35786F" />
      <Text style={styles.shortLabel}>{language === "ms" ? "BM" : "EN"}</Text>
      <Ionicons name="chevron-down" size={13} color="#35786F" />
    </TouchableOpacity>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} accessibilityLabel={translateLabel("Cancel")} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>{translateLabel("Choose language")}</Text>
          {[{ code: "en", name: "English", short: "EN" }, { code: "ms", name: "Bahasa Melayu", short: "BM" }].map((option) =>
            <TouchableOpacity key={option.code} style={[styles.option, language === option.code && styles.selected]} onPress={() => choose(option.code)} accessibilityRole="radio" accessibilityState={{ checked: language === option.code }}>
              <View style={styles.optionText}><Text style={styles.optionName}>{option.name}</Text><Text style={styles.optionCode}>{option.short}</Text></View>
              {language === option.code && <Ionicons name="checkmark-circle" size={22} color="#35786F" />}
            </TouchableOpacity>,
          )}
          <TouchableOpacity style={styles.cancel} onPress={() => setVisible(false)} accessibilityRole="button"><Text style={styles.shortLabel}>{translateLabel("Cancel")}</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  button: { flexShrink: 0, minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#E7F2E2", borderRadius: 12 },
  shortLabel: { color: "#35786F", fontSize: 13, fontWeight: "700" },
  overlay: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(20,45,35,0.38)" },
  sheet: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20, width: "100%", maxWidth: 420, alignSelf: "center" },
  title: { fontSize: 19, fontWeight: "700", color: "#234B3A", marginBottom: 18 },
  option: { flexDirection: "row", alignItems: "center", padding: 15, borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 12, minHeight: 66, marginBottom: 10 },
  selected: { backgroundColor: "#EEF7EF", borderColor: "#8AB8A5" },
  optionText: { flex: 1 },
  optionName: { fontSize: 15, fontWeight: "600", color: "#234B3A", flexShrink: 1 },
  optionCode: { fontSize: 12, color: "#718078", marginTop: 4 },
  cancel: { minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 4 },
});
