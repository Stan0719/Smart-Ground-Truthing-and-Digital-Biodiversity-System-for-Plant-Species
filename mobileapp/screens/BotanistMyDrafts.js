import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t, translateUIMessage, useAppTranslation } from "../translations/i18n";
import { faceSession } from "../utils/faceSession";
import { readDrafts, removeDraft } from "../utils/fieldStorage";
import { deleteBotanistFormDraft } from "../utils/botanistFormDrafts";
import { retryBotanistDraftAutosave, stopBotanistDraftAutosave, subscribeBotanistDraftAutosaveFailures } from "../utils/botanistDraftAutosave";
import { CardListSkeleton } from "../components/BotanicalSkeleton";

function draftType(draft) {
  if (draft.kind === "botanist-form") return draft.form_type;
  if (draft.method === "PATCH") return "correct-observation";
  if (draft.path === "/plants") return "field-plant";
  return "observation";
}
export function draftCategory(draft) {
  const type = draftType(draft);
  if (["add-plant", "edit-plant", "field-plant"].includes(type)) return "plant-records";
  if (["add-species", "edit-species"].includes(type)) return "species-requests";
  if (type === "correct-observation") return "corrections";
  if (type === "observation") return "observations";
  return "other";
}
export function filterBotanistDrafts(drafts, category = "all", query = "") {
  const needle = query.trim().toLocaleLowerCase();
  return drafts.filter((draft) => (category === "all" || draftCategory(draft) === category) &&
    (!needle || `${draftLabel(draft)} ${draftDescription(draft)} ${draft.target_id ?? ""} ${draft.client_key ?? ""}`.toLocaleLowerCase().includes(needle)));
}
function draftLabel(draft) {
  const keys = { "add-plant": "botanistDrafts.addPlant", "add-species": "botanistDrafts.addSpecies", "edit-plant": "botanistDrafts.editPlant",
    "edit-species": "botanistDrafts.editSpecies", "correct-observation": "botanistDrafts.correctObservation",
    "field-plant": "botanistDrafts.fieldPlant", observation: "botanistDrafts.observation" };
  return t(keys[draftType(draft)] || "botanistDrafts.observation");
}
function draftDescription(draft) {
  const form = draft.form || {};
  if (draft.title) return draft.title;
  if (form.plant_name || form.plantScientificName) return form.plant_name || form.plantScientificName;
  if (form.qr_id || form.qrCode || form.selectedQRCode?.label || form.selectedQRCode?.qr_code) return `${t("botanistDrafts.qrIdentifier")}: ${form.qr_id || form.qrCode || form.selectedQRCode?.label || form.selectedQRCode?.qr_code}`;
  if (draft.form_type === "edit-species" && draft.target_id) return `${t("botanistDrafts.speciesRequestId")}: ${draft.target_id}`;
  const plantId = draft.target_id || draft.plant_id || draft.path?.match(/^\/plants\/(\d+)/)?.[1];
  if (plantId) return `${t("botanistDrafts.plantId")}: ${plantId}`;
  if (form.scientific_name || form.speciesScientificName) return form.scientific_name || form.speciesScientificName;
  return t("botanistDrafts.noIdentifier");
}

export default function BotanistMyDrafts({ route, navigation }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [state, setState] = useState({ drafts: [], loading: true, error: "" });
  const [autosaveFailures, setAutosaveFailures] = useState([]);
  const [retryingAutosave, setRetryingAutosave] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const autoResumedDraftRef = useRef(null);
  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: "" }));
    try {
      const user = await faceSession.restore({ allowOffline: true });
      if (!accountId || user?.id !== accountId || user.role !== "botanist") throw Error("Sign in with the Botanist account that owns these drafts.");
      const drafts = await readDrafts(accountId);
      setState({ drafts, loading: false, error: "" });
    } catch (error) { setState((old) => ({ ...old, loading: false, error: error.message || t("botanistDrafts.loadFailed") })); }
  }, [accountId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => subscribeBotanistDraftAutosaveFailures((failures) => {
    setAutosaveFailures(failures.filter((failure) => failure.key.startsWith(`${accountId}:`)));
  }), [accountId]);

  const retryAutosave = async (key) => {
    setRetryingAutosave(key);
    try { await retryBotanistDraftAutosave(key); await load(); }
    catch { /* The failure remains in the shared queue and can be retried again. */ }
    finally { setRetryingAutosave(""); }
  };

  const resume = useCallback((draft) => {
    const botanist = route.params?.botanist;
    if (draft.kind === "botanist-form") {
      if (draft.form_type === "add-plant") navigation.navigate("AddPlant", { botanist, formDraftKey: draft.client_key });
      else if (draft.form_type === "add-species") navigation.navigate("AddSpeciesRequest", { botanist, formDraftKey: draft.client_key });
      else if (draft.form_type === "edit-plant") navigation.navigate("EditPlant", { botanist, plantId: draft.target_id, formDraftKey: draft.client_key });
      else if (draft.form_type === "edit-species") navigation.navigate("EditSpeciesRequest", { botanist, requestId: String(draft.target_id), formDraftKey: draft.client_key });
      return;
    }
    navigation.navigate(draft.method === "PATCH" ? "FieldCollectionEdit" : draft.path === "/plants" ? "FieldCollectionPlant" : "FieldCollection", { botanist, draft });
  }, [route.params?.botanist, navigation]);
  useEffect(() => {
    const draftKey = route.params?.openDraftKey;
    if (!draftKey) { autoResumedDraftRef.current = null; return; }
    if (state.loading || autoResumedDraftRef.current === draftKey) return;
    const draft = state.drafts.find((row) => row.client_key === draftKey);
    if (!draft) return;
    autoResumedDraftRef.current = draftKey;
    navigation.setParams({ openDraftKey: undefined });
    resume(draft);
  }, [route.params?.openDraftKey, state.loading, state.drafts, navigation, resume]);
  const confirmDelete = (draft) => Alert.alert(t("fieldCollection.deleteDraftTitle"), t("fieldCollection.deleteDraftConfirmation"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("fieldCollection.deleteDraft"), style: "destructive", onPress: () => { void (async () => {
      try {
        await stopBotanistDraftAutosave(accountId, draft.client_key);
        const removed = draft.kind === "botanist-form"
          ? await deleteBotanistFormDraft(accountId, draft.client_key, draft.saved_at)
          : await removeDraft(accountId, draft.client_key, draft);
        if (!removed) throw Error(t("botanistDrafts.draftChanged"));
        await load();
      } catch (error) { setState((old) => ({ ...old, error: error.message || t("botanistDrafts.deleteFailed") })); }
    })(); } },
  ]);
  const visibleDrafts = filterBotanistDrafts(state.drafts, category, query).slice()
    .sort((a, b) => new Date(b.saved_at || b.updated_at || 0) - new Date(a.saved_at || a.updated_at || 0));
  const categories = ["all", "plant-records", "species-requests", "observations", "corrections"];

  return <SafeAreaView style={styles.page} edges={["top", "left", "right"]}>
    <ScrollView contentContainerStyle={[styles.content, tablet && styles.tabletContent]}
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => { void load(); }} tintColor="#2F6B4F" />}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("botanistDrafts.title")}</Text>
        <Text style={styles.subtitle}>{t("botanistDrafts.subtitle")}</Text>
      </View>
      <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder={t("botanistDrafts.searchPlaceholder")}
        placeholderTextColor="#7B8A80" accessibilityLabel={t("botanistDrafts.searchPlaceholder")} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} accessibilityRole="tablist">
        {categories.map((value) => <TouchableOpacity key={value} testID={`draft-filter-${value}`} accessibilityRole="button"
          accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)} style={[styles.filterChip, category === value && styles.filterChipSelected]}>
          <Text style={[styles.filterLabel, category === value && styles.filterLabelSelected]}>{t(`botanistDrafts.filter.${value}`)}</Text>
        </TouchableOpacity>)}
      </ScrollView>
      {state.drafts.length > 0 && <Text style={styles.resultCount}>{t("botanistDrafts.matchingDrafts", { count: visibleDrafts.length })}</Text>}
      {!!state.error && <View style={styles.errorBox}><Text style={styles.errorText} accessibilityRole="alert">{translateUIMessage(state.error)}</Text>
        <TouchableOpacity style={styles.retry} onPress={() => { void load(); }}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
      {autosaveFailures.map((failure) => <View key={failure.key} style={styles.errorBox}>
        <Text style={styles.errorText} accessibilityRole="alert">{t("botanistDrafts.autoSaveFailed")}{failure.message ? ` · ${translateUIMessage(failure.message)}` : ""}</Text>
        <TouchableOpacity style={styles.retry} disabled={retryingAutosave === failure.key} onPress={() => { void retryAutosave(failure.key); }} accessibilityRole="button" accessibilityState={{ disabled: retryingAutosave === failure.key }}>
          <Text style={styles.retryText}>{retryingAutosave === failure.key ? t("botanistDrafts.autoSaving") : t("common.tryAgain")}</Text>
        </TouchableOpacity>
      </View>)}
      {state.loading && !state.drafts.length ? <CardListSkeleton label={t("botanistDrafts.loading")} count={3} />
        : state.error && !state.drafts.length ? null
        : !state.drafts.length ? <View style={styles.empty}><Ionicons name="document-text-outline" size={34} color="#7B9482" />
          <Text style={styles.emptyTitle}>{t("botanistDrafts.empty")}</Text><Text style={styles.muted}>{t("botanistDrafts.emptyHint")}</Text></View>
          : !visibleDrafts.length ? <View style={styles.empty}><Ionicons name="search-outline" size={32} color="#7B9482" /><Text style={styles.emptyTitle}>{t("botanistDrafts.noMatches")}</Text></View>
          : visibleDrafts.map((draft) => <View key={draft.client_key} testID={`my-draft-${draft.client_key}`} style={styles.card}>
            <View style={styles.cardTop}><View style={styles.icon}><Ionicons name="document-text-outline" size={21} color="#2F6B4F" /></View>
              <View style={styles.cardHeading}><Text style={styles.formType}>{draftLabel(draft)}</Text><Text style={styles.identifier}>{draftDescription(draft)}</Text></View>
              <View style={styles.status}><Text style={styles.statusText}>{t("botanistDrafts.savedStatus")}</Text></View>
            </View>
            <Text style={styles.date}>{draft.saved_at || draft.updated_at ? `${t("botanistDrafts.lastSaved")}: ${new Date(draft.saved_at || draft.updated_at).toLocaleString()}` : t("botanistDrafts.savedLocally")}</Text>
            {(draft.photo_refs?.length || draft.assets?.length) > 0 && <Text style={styles.photoCount}>{t("botanistDrafts.photoCount", { count: draft.photo_refs?.length || draft.assets?.length })}</Text>}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.resume} onPress={() => resume(draft)} accessibilityRole="button"><Ionicons name="play-outline" size={17} color="#FFFFFF" /><Text style={styles.resumeText}>{t("botanistDrafts.resume")}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.delete} onPress={() => confirmDelete(draft)} accessibilityRole="button" accessibilityLabel={t("fieldCollection.deleteDraft")}><Ionicons name="trash-outline" size={18} color="#A34436" /><Text style={styles.deleteText}>{t("fieldCollection.deleteDraft")}</Text></TouchableOpacity>
            </View>
          </View>)}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FAFBF7" }, content: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 16, paddingBottom: 32, gap: 12 },
  tabletContent: { padding: 24 }, header: { marginBottom: 4 },
  title: { color: "#2F6B4F", fontSize: 25, fontWeight: "800" }, subtitle: { color: "#64766B", fontSize: 14, lineHeight: 20, marginTop: 4 },
  search: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "#DCEBDD", paddingHorizontal: 13, backgroundColor: "#FFFFFF", color: "#2F6B4F", fontSize: 14 },
  filters: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2 }, filterChip: { minHeight: 38, justifyContent: "center", borderRadius: 20, borderWidth: 1, borderColor: "#DCEBDD", backgroundColor: "#FFFFFF", paddingHorizontal: 12 },
  filterChipSelected: { backgroundColor: "#D6E9D9", borderColor: "#2F6B4F" }, filterLabel: { color: "#64766B", fontSize: 12 }, filterLabelSelected: { color: "#2F6B4F", fontWeight: "700" },
  resultCount: { color: "#64766B", fontSize: 12, marginTop: -5 },
  card: { padding: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCEBDD", borderRadius: 17, marginBottom: 2 }, cardTop: { flexDirection: "row", alignItems: "center", gap: 10 }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#E8EDDA", alignItems: "center", justifyContent: "center" }, cardHeading: { flex: 1, minWidth: 0 }, formType: { color: "#2F6B4F", fontSize: 15, fontWeight: "750" }, identifier: { color: "#66776C", fontSize: 13, marginTop: 3 }, status: { backgroundColor: "#F5EBD6", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 }, statusText: { color: "#77501D", fontSize: 11, fontWeight: "700" },
  date: { color: "#718078", fontSize: 12, marginTop: 11 }, photoCount: { color: "#718078", fontSize: 12, marginTop: 5 }, actions: { flexDirection: "row", gap: 9, marginTop: 13 }, resume: { flex: 1, minHeight: 44, borderRadius: 11, backgroundColor: "#2F6B4F", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, resumeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" }, delete: { minHeight: 44, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: "#E5C8C3", backgroundColor: "#FFF8F6", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, deleteText: { color: "#A34436", fontSize: 12, fontWeight: "700" },
  empty: { padding: 28, minHeight: 150, alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCEBDD" }, emptyTitle: { color: "#2F6B4F", fontSize: 16, fontWeight: "700", textAlign: "center" }, muted: { color: "#718078", textAlign: "center", lineHeight: 20 }, errorBox: { padding: 13, backgroundColor: "#FFF2EB", borderRadius: 12 }, errorText: { color: "#A34436", lineHeight: 20 }, retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 3 }, retryText: { color: "#2F6B4F", fontWeight: "700" },
});
