import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { fetchBotanistSpeciesRequest } from "../utils/botanistRecords";
import { plantApi } from "../utils/plantApi";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";
import OriginalUpdatedField from "../components/OriginalUpdatedField";

const fields = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"];
const makeKey = () => `species-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function EditSpeciesRequest({ route, navigation }) {
  useAppTranslation();
  const requestId = String(route.params?.requestId || ""), accountId = route.params?.botanist?.id;
  const [state, setState] = useState({ loading: true, error: "", request: null, available: false });
  const [form, setForm] = useState(null), [photo, setPhoto] = useState(null), [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const busy = useRef(false), clientKey = useRef(makeKey());
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const [request, capabilities] = await Promise.all([fetchBotanistSpeciesRequest(accountId, requestId),
          plantApi("/record-changes/capabilities", { expectedAccountId: accountId })]);
        if (!active) return;
        setForm(Object.fromEntries(fields.map((field) => [field, String(request[field] ?? "")])));
        setState({ loading: false, error: "", request, available: capabilities.approved_edits_available });
      } catch (error) { if (active) setState((old) => ({ ...old, loading: false, error: error.message })); }
    })();
    return () => { active = false; };
  }, [accountId, requestId, reload]));
  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert(t("common.error"), t("recordEdits.photoPermission"));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0].uri);
  }
  function submit() {
    if (busy.current) return;
    if (fields.some((field) => !form[field].trim() || form[field].length > (["description", "habitat"].includes(field) ? 4000 : 200)))
      return Alert.alert(t("common.error"), t("recordEdits.speciesFieldsRequired"));
    if (state.request.request_status === "Approved" && !state.available)
      return Alert.alert(t("common.error"), t("recordEdits.migrationRequired"));
    Alert.alert(t("recordEdits.confirmTitle"), t("recordEdits.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" }, { text: t("recordEdits.submitChanges"), onPress: save },
    ]);
  }
  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const proposed = Object.fromEntries(fields.map((field) => [field, form[field].trim()]));
      if (photo) proposed.photo = { content_type: /\.png(?:$|[?#])/i.test(photo) ? "image/png" : "image/jpeg",
        base64: await FileSystem.readAsStringAsync(photo, { encoding: FileSystem.EncodingType.Base64 }) };
      if (state.request.request_status === "Approved") await plantApi("/record-changes", { method: "POST", expectedAccountId: accountId,
        body: { kind: "species", target_id: Number(requestId), proposed, client_key: clientKey.current } });
      else await plantApi(`/my-species-requests/${encodeURIComponent(requestId)}`, { method: "PATCH", expectedAccountId: accountId, body: proposed });
      Alert.alert(t("recordEdits.savedTitle"), t("recordEdits.savedMessage"), [{ text: t("common.ok"), onPress: () => navigation.goBack() }]);
    } catch (error) { Alert.alert(t("common.error"), translateUIMessage(error.message)); }
    finally { busy.current = false; setSaving(false); }
  }
  if (state.loading) return <View style={styles.center}><ActivityIndicator color="#468585" /></View>;
  if (state.error || !form) return <View style={styles.center}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
    <TouchableOpacity style={styles.secondary} onPress={() => { setState((old) => ({ ...old, loading: true, error: "" })); setReload((old) => old + 1); }}>
      <Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{t("recordEdits.editSpecies")}</Text>
    <Text style={styles.note}>{state.request.request_status === "Approved" ? t("recordEdits.approvedNotice") : t("recordEdits.pendingNotice")}</Text>
    {state.request.request_status === "Approved" && !state.available && <Text style={styles.error}>{t("recordEdits.migrationRequired")}</Text>}
    <View style={styles.card}>{fields.map((field) => <OriginalUpdatedField key={field} label={t(`recordEdits.${field}`)} originalValue={state.request[field]}>
      <TextInput style={[styles.input, ["description", "habitat"].includes(field) && styles.multiline]} value={form[field]}
        onChangeText={(next) => setForm((old) => ({ ...old, [field]: next }))} multiline={["description", "habitat"].includes(field)} />
    </OriginalUpdatedField>)}
      <OriginalUpdatedField label={t("recordEdits.speciesPhoto")}
        originalContent={state.request.photo ? <Image source={state.request.photo} style={styles.photo} resizeMode="cover" /> : null}>
        {photo ? <Image source={{ uri: photo }} style={styles.photo} resizeMode="cover" />
          : <Text style={styles.secondaryText}>{t("recordEdits.keepExistingPhotos")}</Text>}
        <TouchableOpacity style={styles.secondary} onPress={pickPhoto}><Text style={styles.secondaryText}>{t("recordEdits.replacePhoto")}</Text></TouchableOpacity>
        {!!photo && <TouchableOpacity onPress={() => setPhoto(null)}><Text style={styles.secondaryText}>{t("recordEdits.keepExistingPhotos")}</Text></TouchableOpacity>}
      </OriginalUpdatedField>
    </View>
    <TouchableOpacity style={[styles.primary, saving && styles.disabled]} onPress={submit} disabled={saving}><Text style={styles.primaryText}>{saving ? t("recordEdits.saving") : t("recordEdits.submitChanges")}</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondary} onPress={() => navigation.goBack()} disabled={saving}><Text style={styles.secondaryText}>{t("common.cancel")}</Text></TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F7FBF4" }, content: { padding: 20, paddingBottom: 50, gap: 16, width: "100%", maxWidth: 820, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F7FBF4" },
  title: { color: "#234B3A", fontSize: 26, fontWeight: "800" }, note: { color: "#52665A", lineHeight: 21 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 18, padding: 18, gap: 10 },
  label: { color: "#52665A", fontSize: 13, fontWeight: "600", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#FFFFFF", borderRadius: 11, padding: 12, color: "#234B3A", minHeight: 44 },
  multiline: { minHeight: 90, textAlignVertical: "top" }, photo: { width: "100%", height: 210, borderRadius: 12 },
  primary: { backgroundColor: "#468585", borderRadius: 12, padding: 15, minHeight: 44, alignItems: "center" }, primaryText: { color: "#FFFFFF", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 12, padding: 12, minHeight: 44, alignItems: "center" }, secondaryText: { color: "#28665E", fontWeight: "700" },
  disabled: { opacity: 0.6 }, error: { color: "#A34436", lineHeight: 21 },
});
