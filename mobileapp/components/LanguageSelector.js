import React, { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { localization, translateLabel, useAppTranslation } from "../translations/i18n";
import ScaledText from "./ScaledText";
import { useTextSize } from "./TextSizeContext";
import { TEXT_SIZE_STEPS } from "../utils/textSizePreference";

export default function LanguageSelector() {
  const { i18n } = useAppTranslation();
  const { percent, setPercent } = useTextSize();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const selectedRef = useRef(percent);
  useEffect(() => { selectedRef.current = percent; }, [percent]);
  const language = i18n.resolvedLanguage || "en";
  const changeSize = (value) => {
    if (value === selectedRef.current) return;
    selectedRef.current = value;
    void setPercent(value).catch(() => Alert.alert(i18n.t("textSize.title"), i18n.t("textSize.saveFailed")));
  };
  const changeSizeFromTouch = (event) => {
    if (!trackWidth) return;
    const x = Math.max(0, Math.min(trackWidth, event.nativeEvent.locationX));
    changeSize(TEXT_SIZE_STEPS[Math.round(x / trackWidth * (TEXT_SIZE_STEPS.length - 1))]);
  };
  async function choose(value) {
    setSaving(true);
    try { await localization.changeLanguage(value); }
    catch { Alert.alert(translateLabel("Language changed"), translateLabel("The language was changed for this session, but could not be saved. Please try again.")); }
    finally { setSaving(false); }
  }
  return <>
    <TouchableOpacity style={styles.button} onPress={() => setVisible(true)} disabled={saving}
      activeOpacity={0.7} accessibilityRole="button"
      accessibilityLabel={`${translateLabel("Language")}: ${language === "ms" ? "Bahasa Melayu" : language === "zh" ? "中文" : "English"}`}>
      <Ionicons name="language-outline" size={18} color="#35786F" />
      <ScaledText style={styles.shortLabel}>{language === "ms" ? "BM" : language === "zh" ? "中文" : "EN"}</ScaledText>
      <Ionicons name="chevron-down" size={13} color="#35786F" />
    </TouchableOpacity>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={[styles.overlay, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} accessibilityLabel={translateLabel("Cancel")} />
        <View style={[styles.sheet, { maxHeight: Math.max(200, height - insets.top - insets.bottom - 32) }]} accessibilityViewIsModal>
          <ScrollView showsVerticalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            <ScaledText style={styles.title}>{i18n.t("textSize.title")}</ScaledText>
            {[{ code: "en", name: "English", short: "EN" }, { code: "ms", name: "Bahasa Melayu", short: "BM" }, { code: "zh", name: "中文", short: "简体中文" }].map((option) =>
              <TouchableOpacity key={option.code} style={[styles.option, language === option.code && styles.selected]}
                onPress={() => choose(option.code)} accessibilityRole="radio" accessibilityState={{ checked: language === option.code }}>
                <View style={styles.optionText}><ScaledText style={styles.optionName}>{option.name}</ScaledText><ScaledText style={styles.optionCode}>{option.short}</ScaledText></View>
                {language === option.code && <Ionicons name="checkmark-circle" size={22} color="#35786F" />}
              </TouchableOpacity>,
            )}
            <View style={styles.divider} />
            <View style={styles.sizeHeading}><ScaledText style={styles.sizeTitle}>{i18n.t("textSize.size")}</ScaledText><ScaledText style={styles.percent}>{percent}%</ScaledText></View>
            <View style={styles.sliderRow}>
              <ScaledText style={styles.smallA} accessibilityElementsHidden>A</ScaledText>
              <View style={styles.track} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
                accessible accessibilityRole="adjustable" accessibilityLabel={i18n.t("textSize.size")}
                accessibilityValue={{ min: 100, max: 200, now: percent, text: `${percent}%` }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={(event) => changeSize(Math.max(100, Math.min(200, percent + (event.nativeEvent.actionName === "increment" ? 25 : -25))))}
                onStartShouldSetResponder={() => true} onResponderGrant={changeSizeFromTouch} onResponderMove={changeSizeFromTouch}>
                <View style={styles.trackLine} />
                <View style={[styles.trackFill, { width: `${percent - 100}%` }]} />
                <View style={[styles.thumb, { left: `${percent - 100}%` }]} />
              </View>
              <ScaledText style={styles.largeA} accessibilityElementsHidden>A</ScaledText>
            </View>
            <View style={styles.rangeLabels}><ScaledText style={styles.rangeLabel}>{i18n.t("textSize.normal")}</ScaledText><ScaledText style={styles.rangeLabel}>{i18n.t("textSize.maximum")}</ScaledText></View>
            <ScaledText style={styles.previewLabel}>{i18n.t("textSize.preview")}</ScaledText>
            <View style={styles.preview}><ScaledText style={styles.previewScientific}>Agave sisalana</ScaledText><ScaledText style={styles.previewCommon}>Sisal hemp</ScaledText></View>
            <TouchableOpacity style={styles.cancel} onPress={() => setVisible(false)} accessibilityRole="button"><ScaledText style={styles.shortLabel}>{translateLabel("Cancel")}</ScaledText></TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  button: { flexShrink: 0, minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#E7F2E2", borderRadius: 12 },
  shortLabel: { color: "#35786F", fontSize: 13, fontWeight: "700" },
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: 24, backgroundColor: "rgba(20,45,35,0.38)" },
  sheet: { backgroundColor: "#FFFFFF", borderRadius: 20, width: "100%", maxWidth: 420, alignSelf: "center", overflow: "hidden" },
  sheetContent: { padding: 20 },
  title: { fontSize: 19, fontWeight: "700", color: "#234B3A", marginBottom: 18 },
  option: { flexDirection: "row", alignItems: "center", padding: 15, borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 12, minHeight: 66, marginBottom: 10 },
  selected: { backgroundColor: "#EEF7EF", borderColor: "#8AB8A5" },
  optionText: { flex: 1 },
  optionName: { fontSize: 15, fontWeight: "600", color: "#234B3A", flexShrink: 1 },
  optionCode: { fontSize: 12, color: "#718078", marginTop: 4 },
  divider: { height: 1, backgroundColor: "#E2EDE0", marginVertical: 7 },
  sizeHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 7 },
  sizeTitle: { color: "#234B3A", fontSize: 15, fontWeight: "700", flexShrink: 1 },
  percent: { color: "#35786F", fontSize: 14, fontWeight: "700" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 9 },
  smallA: { color: "#526C5A", fontSize: 13, fontWeight: "700" },
  largeA: { color: "#526C5A", fontSize: 20, fontWeight: "700" },
  track: { flex: 1, height: 44, justifyContent: "center" },
  trackLine: { height: 4, borderRadius: 4, backgroundColor: "#D6E9D9" },
  trackFill: { position: "absolute", left: 0, height: 4, borderRadius: 4, backgroundColor: "#35786F" },
  thumb: { position: "absolute", width: 18, height: 18, marginLeft: -9, borderRadius: 9, backgroundColor: "#35786F", borderWidth: 2, borderColor: "#FFFFFF" },
  rangeLabels: { flexDirection: "row", justifyContent: "space-between" },
  rangeLabel: { color: "#718078", fontSize: 11 },
  previewLabel: { color: "#526C5A", fontSize: 12, fontWeight: "700", marginTop: 10 },
  preview: { padding: 9, borderRadius: 10, backgroundColor: "#F7FBF4", marginTop: 4 },
  previewScientific: { color: "#234B3A", fontSize: 14, fontStyle: "italic" },
  previewCommon: { color: "#526C5A", fontSize: 12, marginTop: 3 },
  cancel: { minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 4 },
});
