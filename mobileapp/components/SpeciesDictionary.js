import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppTranslation } from "../translations/i18n";
import { applySpeciesFieldUpdates, commitSpeciesReview, planSpeciesFieldUpdates, searchSpeciesDictionary, speciesReviewRows } from "../utils/speciesDictionary";

export default function SpeciesDictionary({ fields, reviewPresentation = "alert" }) {
  const { t } = useAppTranslation();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false); const [error, setError] = useState("");
  const [review, setReview] = useState(null);
  async function search() {
    if (busy) return;
    setBusy(true); setSearched(true); setError(""); setResults([]);
    try { setResults(await searchSpeciesDictionary(query)); }
    catch (searchError) { setError(searchError?.status === 429 ? t("speciesDictionary.rateLimited") : t("speciesDictionary.error")); }
    finally { setBusy(false); }
  }
  function choose(item) {
    const plan = planSpeciesFieldUpdates(item, fields);
    if (!plan.length) return Alert.alert(t("speciesDictionary.noFieldsTitle"), t("speciesDictionary.noFields"));
    const empty = plan.filter((entry) => !entry.current.trim());
    const existing = plan.filter((entry) => entry.current.trim());
    if (reviewPresentation === "modal") {
      setReview({ updates: plan, hasExisting: existing.length > 0 });
      return;
    }
    const names = plan.map((entry) => `${entry.label || t(`speciesDictionary.fields.${entry.key}`)}: ${entry.value}`).join("\n");
    Alert.alert(t("speciesDictionary.reviewTitle"), `${t("speciesDictionary.reviewMessage")}\n\n${names}`, [
      { text: t("common.cancel"), style: "cancel" },
      ...(empty.length ? [{ text: t("speciesDictionary.fillEmpty"), onPress: () => applySpeciesFieldUpdates(empty, fields) }] : []),
      ...(existing.length ? [{ text: t("speciesDictionary.replaceExisting"), style: "destructive", onPress: () => applySpeciesFieldUpdates(plan, fields, true) }] : []),
    ]);
  }
  function cancelReview() {
    if (review) commitSpeciesReview(review.updates, fields, { confirmed: false });
    setReview(null);
  }
  function confirmReview() {
    if (review) commitSpeciesReview(review.updates, fields, { confirmed: true, replace: review.hasExisting });
    setReview(null);
  }
  const rows = review ? speciesReviewRows(review.updates) : [];
  return <>
  <View style={styles.card}>
    <Text style={styles.title}>{t("speciesDictionary.title")}</Text><Text style={styles.helper}>{t("speciesDictionary.helper")}</Text>
    <View style={styles.searchRow}><Ionicons name="search" size={19} color="#52665A" accessibilityElementsHidden /><TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t("speciesDictionary.placeholder")} placeholderTextColor="#89978D" accessibilityLabel={t("speciesDictionary.placeholder")} returnKeyType="search" onSubmitEditing={search} maxLength={100} /></View>
    <TouchableOpacity style={styles.button} onPress={search} disabled={busy || query.trim().length < 2} accessibilityRole="button" accessibilityState={{ disabled: busy || query.trim().length < 2 }}><Text style={styles.buttonText}>{t("speciesDictionary.search")}</Text></TouchableOpacity>
    {busy && <View style={styles.status}><ActivityIndicator color="#2F6B4F" /><Text style={styles.helper}>{t("speciesDictionary.loading")}</Text></View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!busy && !error && searched && !results.length && <Text style={styles.helper}>{t("speciesDictionary.empty")}</Text>}
    {results.map((item) => <View key={item.id} style={styles.result}>{!!item.commonName && <Text style={styles.common}>{item.commonName}</Text>}<Text style={styles.scientific}>{item.scientificName}</Text>{!!(item.family || item.rank) && <Text style={styles.helper}>{[item.family && `${t("speciesDictionary.family")}: ${item.family}`, item.rank && `${t("speciesDictionary.rank")}: ${item.rank}`].filter(Boolean).join(" · ")}</Text>}{!!item.description && <Text style={styles.helper}>{t("speciesDictionary.description")}: {item.description}</Text>}<TouchableOpacity onPress={() => Linking.openURL(item.sourceUrl)} accessibilityRole="link" style={styles.link}><Text style={styles.linkText}>{t("speciesDictionary.source")}: {item.sourceName}</Text></TouchableOpacity><TouchableOpacity style={styles.button} onPress={() => choose(item)} accessibilityRole="button"><Text style={styles.buttonText}>{t("speciesDictionary.use")}</Text></TouchableOpacity></View>)}
    <Text style={styles.attribution}>{t("speciesDictionary.attribution")}</Text>
  </View>
  {reviewPresentation === "modal" && <Modal visible={Boolean(review)} transparent animationType="fade" statusBarTranslucent onRequestClose={cancelReview}>
    <View style={dialogStyles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={cancelReview} accessibilityRole="button" accessibilityLabel={t("common.cancel")} />
      <View style={[dialogStyles.dialog, { maxHeight: Math.min(height * 0.84, 640) }]} accessibilityViewIsModal>
        <ScrollView style={dialogStyles.scroll} contentContainerStyle={dialogStyles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
          <Text style={dialogStyles.title}>{t("speciesDictionary.reviewTitle")}</Text>
          <Text style={dialogStyles.intro}>{t("speciesDictionary.reviewMessage")}</Text>
          <View style={dialogStyles.rows}>{rows.map((row) => <View style={dialogStyles.row} key={row.key}>
            <Text style={dialogStyles.label}>{row.label}:</Text>
            <Text style={[dialogStyles.value, row.italic && dialogStyles.italic]}>{row.value}</Text>
          </View>)}</View>
          <View style={dialogStyles.actions}>
            <TouchableOpacity style={dialogStyles.cancel} onPress={cancelReview} accessibilityRole="button"><Text style={dialogStyles.cancelText}>{t("common.cancel")}</Text></TouchableOpacity>
            <TouchableOpacity style={dialogStyles.apply} onPress={confirmReview} accessibilityRole="button"><Text style={dialogStyles.applyText}>{t(review?.hasExisting ? "speciesDictionary.replaceExisting" : "speciesDictionary.applyListedFields")}</Text></TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>}
  </>;
}

const styles = StyleSheet.create({ card: { backgroundColor: "#FFFFFF", borderColor: "#E2EDE0", borderWidth: 1, borderRadius: 16, padding: 14, gap: 9 }, title: { color: "#234B3A", fontSize: 17, fontWeight: "700" }, helper: { color: "#52665A", lineHeight: 20, flexShrink: 1 }, searchRow: { minHeight: 46, borderColor: "#CDE3DC", borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 }, input: { flex: 1, minWidth: 0, color: "#234B3A", paddingVertical: 9 }, button: { minHeight: 44, borderRadius: 10, backgroundColor: "#2F6B4F", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, buttonText: { color: "#FFFFFF", fontWeight: "700" }, status: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 }, error: { color: "#A34436" }, result: { borderColor: "#E2EDE0", borderWidth: 1, borderRadius: 12, padding: 12, gap: 7 }, common: { color: "#234B3A", fontWeight: "700" }, scientific: { color: "#234B3A", fontStyle: "italic" }, link: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" }, linkText: { color: "#2F6B4F", textDecorationLine: "underline" }, attribution: { color: "#66756B", fontSize: 12 } });

const dialogStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.60)", justifyContent: "center", alignItems: "center", paddingHorizontal: 18, paddingVertical: 22 },
  dialog: { width: "100%", maxWidth: 480, backgroundColor: "#FFFFFF", borderRadius: 3, elevation: 20, shadowColor: "#000000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, overflow: "hidden" },
  scroll: { flexGrow: 0 }, content: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 16, gap: 13 },
  title: { color: "#202124", fontSize: 21, lineHeight: 27, fontWeight: "600" }, intro: { color: "#303134", fontSize: 16, lineHeight: 23 }, rows: { gap: 2, paddingTop: 2 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 5, paddingVertical: 1 }, label: { color: "#303134", fontSize: 16, lineHeight: 22, fontWeight: "500" }, value: { color: "#303134", fontSize: 16, lineHeight: 22, flexShrink: 1 }, italic: { fontStyle: "italic" },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingTop: 8 }, cancel: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 9 }, cancelText: { color: "#52665A", fontSize: 14, fontWeight: "700", letterSpacing: 0.35, textTransform: "uppercase" },
  apply: { minHeight: 44, justifyContent: "center", paddingHorizontal: 15, borderRadius: 9, backgroundColor: "#2F6B4F", maxWidth: "100%" }, applyText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", textAlign: "center" },
});
