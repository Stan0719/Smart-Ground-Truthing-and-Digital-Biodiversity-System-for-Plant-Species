import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Text from "./ScaledText";
import { useAppTranslation } from "../translations/i18n";
import Ionicons from "@expo/vector-icons/Ionicons";

const OPTIONS = [
  ["en", "textLanguage.english"],
  ["ms", "textLanguage.malay"],
  ["zh-CN", "textLanguage.chinese"],
  ["unknown", "textLanguage.unknown"],
];

export default function TextLanguageSelect({ value = "unknown", onChange, disabled = false }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const selected = OPTIONS.find(([locale]) => locale === value) || OPTIONS[3];
  return <View style={styles.wrap}>
    <Text style={styles.label}>{t("textLanguage.label")}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => setOpen(true)} style={styles.trigger}>
      <Text style={styles.value}>{t(selected[1])}</Text><Ionicons name="chevron-down" size={18} color="#2F6B4F" />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
        <Pressable style={styles.dialog} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>{t("textLanguage.label")}</Text>
          {OPTIONS.map(([locale, key]) => <Pressable key={locale} accessibilityRole="button"
            accessibilityState={{ selected: value === locale }} style={[styles.option, value === locale && styles.selected]}
            onPress={() => { onChange(locale); setOpen(false); }}>
            <Text style={[styles.optionText, value === locale && styles.selectedText]}>{t(key)}</Text>
          </Pressable>)}
        </Pressable>
      </Pressable>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 7, marginBottom: 4 },
  label: { color: "#496258", fontSize: 12, fontWeight: "700", marginBottom: 5 },
  trigger: { minHeight: 42, borderWidth: 1, borderColor: "#CCD9D0", borderRadius: 10, backgroundColor: "#FFFFFF", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  value: { color: "#244B3C", fontSize: 14 }, chevron: { color: "#2F6B4F", fontSize: 20 },
  backdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(11,32,24,0.48)" },
  dialog: { borderRadius: 16, padding: 18, backgroundColor: "#FFFFFF", elevation: 8 },
  title: { color: "#173C31", fontSize: 18, fontWeight: "700", marginBottom: 10 },
  option: { minHeight: 46, justifyContent: "center", paddingHorizontal: 12, borderRadius: 9 },
  selected: { backgroundColor: "#E7F1E8" }, optionText: { color: "#263C32", fontSize: 15 },
  selectedText: { color: "#1F6449", fontWeight: "700" },
});
