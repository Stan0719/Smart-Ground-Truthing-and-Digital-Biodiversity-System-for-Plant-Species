import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { fetchBotanistPlant } from "../utils/botanistRecords";
import { fetchSpeciesCatalog, plantApi } from "../utils/plantApi";
import { normalizeQRCodes } from "../utils/qrInventory";
import { useAppTranslation, t, translateUIMessage } from "../translations/i18n";

const fields = ["scientific_name", "heightCm", "healthStatus", "lifeStage", "morphology", "notes", "zone", "latitude", "longitude", "accuracy_m", "altitudeM"];
const numeric = new Set(["heightCm", "latitude", "longitude", "accuracy_m", "altitudeM"]);
const str = (value) => value == null ? "" : String(value);
const key = () => `edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function EditPlantRecord({ route, navigation }) {
  useAppTranslation();
  const plantId = String(route.params?.plantId || ""), accountId = route.params?.botanist?.id;
  const [state, setState] = useState({ loading: true, error: "", plant: null, species: [], available: false });
  const [form, setForm] = useState(null), [removedPhotos, setRemovedPhotos] = useState([]), [newPhotos, setNewPhotos] = useState([]);
  const [qrList, setQrList] = useState([]), [qrError, setQrError] = useState(""), [qrLoading, setQrLoading] = useState(false);
  const [saving, setSaving] = useState(false), [locating, setLocating] = useState(false);
  const [reload, setReload] = useState(0);
  const busy = useRef(false), clientKey = useRef(key());
  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      try {
        const plant = await fetchBotanistPlant(accountId, plantId);
        const [species, capabilities] = await Promise.all([fetchSpeciesCatalog({ accountId }), plantApi("/record-changes/capabilities", { expectedAccountId: accountId })]);
        if (!active) return;
        const content = (plant.status === "Approved"
          ? plant.observations?.find((observation) => observation.status === "Approved")?.content
          : plant.latestObservation?.content) || plant.latest_submission || plant.latest_approved || {};
        setForm({ scientific_name: str(plant.scientificName), species_id: str(plant.speciesId), qr_id: str(plant.qrId),
          ...Object.fromEntries(fields.slice(1).map((field) => [field, str(content[field] ??
            ({ latitude: plant.location?.latitude, longitude: plant.location?.longitude,
              accuracy_m: plant.location?.accuracyM, altitudeM: plant.location?.altitudeM })[field])])) });
        setRemovedPhotos([]); setNewPhotos([]);
        const ownPendingSpecies = plant.speciesDetails && !species.some((item) => String(item.id) === String(plant.speciesId))
          ? [{ ...plant.speciesDetails, id: String(plant.speciesId) }] : [];
        setState({ loading: false, error: "", plant, species: [...ownPendingSpecies, ...species], available: capabilities.approved_edits_available });
        void refreshQr();
      } catch (error) { if (active) setState((old) => ({ ...old, loading: false, error: error.message })); }
    })();
    return () => { active = false; };
  }, [accountId, plantId, reload]));
  const change = (field, value) => setForm((old) => ({ ...old, [field]: value }));
  async function refreshQr() {
    setQrLoading(true); setQrError("");
    try { const result = await plantApi("/qr-codes", { expectedAccountId: accountId }); setQrList(normalizeQRCodes(result)); }
    catch (error) { setQrError(error.message || t("recordEdits.qrLoadFailed")); }
    finally { setQrLoading(false); }
  }
  async function detectLocation() {
    if (locating) return;
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return Alert.alert(t("addPlant.permissionRequired"), t("addPlant.locationPermissionIsRequiredToGetThePlantLocation"));
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm((old) => ({ ...old, latitude: location.coords.latitude.toFixed(6), longitude: location.coords.longitude.toFixed(6),
        altitudeM: location.coords.altitude == null ? old.altitudeM : location.coords.altitude.toFixed(2),
        accuracy_m: location.coords.accuracy == null ? old.accuracy_m : location.coords.accuracy.toFixed(2) }));
    } catch { Alert.alert(t("addPlant.locationError"), t("addPlant.unableToGetYourCurrentLocation")); }
    finally { setLocating(false); }
  }
  function addPicked(assets) {
    const existingCount = (state.plant?.latestObservation?.assets || []).length - removedPhotos.length + newPhotos.length;
    if (existingCount + assets.length > 8) return Alert.alert(t("common.error"), t("recordEdits.maxPhotos"));
    setNewPhotos((current) => [...current, ...assets.map((asset) => asset.uri)]);
  }
  async function pickPhotos(camera) {
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return Alert.alert(t("addPlant.permissionRequired"), camera ? t("addPlant.cameraPermissionIsRequired") : t("addPlant.galleryPermissionIsRequired"));
      const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8, quality: 0.8 });
      if (!result.canceled) addPicked(result.assets);
    } catch { Alert.alert(t("common.error"), camera ? t("addPlant.unableToOpenTheCamera") : t("addPlant.unableToOpenTheGallery")); }
  }
  function removeExisting(id) {
    Alert.alert(t("recordEdits.removePhotoTitle"), t("recordEdits.removePhotoConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("recordEdits.removePhoto"), style: "destructive", onPress: () => setRemovedPhotos((current) => [...current, id]) },
    ]);
  }
  function validate() {
    if (!form?.species_id || !state.species.some((item) => String(item.id) === form.species_id)) return t("recordEdits.selectSpecies");
    if (!form.scientific_name.trim() || form.scientific_name.length > 200) return t("recordEdits.plantNameRequired");
    if (!Number.isFinite(Number(form.heightCm)) || Number(form.heightCm) <= 0 || !form.healthStatus.trim() || !form.lifeStage.trim() || !form.morphology.trim()) return t("recordEdits.plantFieldsRequired");
    if (!form.latitude.trim() || !form.longitude.trim() || !Number.isFinite(Number(form.latitude)) || Math.abs(Number(form.latitude)) > 90 ||
      !Number.isFinite(Number(form.longitude)) || Math.abs(Number(form.longitude)) > 180) return t("recordEdits.locationRequired");
    if ((form.altitudeM.trim() && !Number.isFinite(Number(form.altitudeM))) ||
      (form.accuracy_m.trim() && (!Number.isFinite(Number(form.accuracy_m)) || Number(form.accuracy_m) < 0))) return t("recordEdits.locationRequired");
    const count = (state.plant?.latestObservation?.assets || []).length - removedPhotos.length + newPhotos.length;
    if ((removedPhotos.length || newPhotos.length) && (count < 3 || count > 8)) return t("recordEdits.threePhotos");
    if (form.qr_id !== str(state.plant.qrId) && !qrList.some((qr) => qr.id === form.qr_id && qr.status === "generated" && qr.plantId == null))
      return t("recordEdits.qrUnavailable");
    return "";
  }
  function submit() {
    if (busy.current) return;
    const error = validate();
    if (error) return Alert.alert(t("common.error"), error);
    if (state.plant.status === "Approved" && !state.available) return Alert.alert(t("common.error"), t("recordEdits.migrationRequired"));
    Alert.alert(t("recordEdits.confirmTitle"), t("recordEdits.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" }, { text: t("recordEdits.submitChanges"), onPress: save },
    ]);
  }
  async function save() {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const content = { heightCm: Number(form.heightCm), healthStatus: form.healthStatus.trim(), lifeStage: form.lifeStage.trim(),
        morphology: form.morphology.trim(), notes: form.notes.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude),
        zone: form.zone.trim() || null, accuracy_m: form.accuracy_m.trim() ? Number(form.accuracy_m) : null,
        altitudeM: form.altitudeM.trim() ? Number(form.altitudeM) : null };
      const proposed = { species_id: Number(form.species_id), scientific_name: form.scientific_name.trim(), content };
      if (form.qr_id !== str(state.plant.qrId)) proposed.qr_id = Number(form.qr_id);
      if (removedPhotos.length || newPhotos.length) {
        proposed.photo_ids = (state.plant.latestObservation?.assets || []).map((asset) => asset.id).filter((id) => !removedPhotos.includes(id));
        proposed.photos = [];
        for (const uri of newPhotos) proposed.photos.push({ content_type: /\.png(?:$|[?#])/i.test(uri) ? "image/png" : "image/jpeg",
          base64: await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }) });
      }
      if (state.plant.status === "Approved") await plantApi("/record-changes", { method: "POST", expectedAccountId: accountId,
        body: { kind: "plant", target_id: Number(plantId), proposed, client_key: clientKey.current } });
      else await plantApi(`/my-plants/${encodeURIComponent(plantId)}`, { method: "PATCH", expectedAccountId: accountId,
        body: { ...proposed, expected_revision: state.plant.latestObservation?.revision } });
      Alert.alert(t("recordEdits.savedTitle"), t("recordEdits.savedMessage"), [{ text: t("common.ok"), onPress: () => navigation.goBack() }]);
    } catch (error) { Alert.alert(t("common.error"), translateUIMessage(error.message)); }
    finally { busy.current = false; setSaving(false); }
  }
  if (state.loading) return <View style={styles.center}><ActivityIndicator color="#468585" /></View>;
  if (state.error || !form) return <View style={styles.center}><Text style={styles.error}>{translateUIMessage(state.error)}</Text>
    <TouchableOpacity style={styles.secondary} onPress={() => { setState((old) => ({ ...old, loading: true, error: "" })); setReload((old) => old + 1); }}>
      <Text style={styles.secondaryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>;
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>{t("recordEdits.editPlant")}</Text>
    <Text style={styles.note}>{state.plant.status === "Approved" ? t("recordEdits.approvedNotice") : t("recordEdits.pendingNotice")}</Text>
    {state.plant.status === "Approved" && !state.available && <Text style={styles.error}>{t("recordEdits.migrationRequired")}</Text>}
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.plantInformation")}</Text><Text style={styles.label}>{t("recordEdits.species")}</Text>
      {state.species.map((item) => <TouchableOpacity key={item.id} style={[styles.speciesOption, form.species_id === String(item.id) && styles.selected]} onPress={() => change("species_id", String(item.id))}>
        <Text style={styles.optionText}>{item.scientificName} · {item.commonName}</Text></TouchableOpacity>)}
      {fields.map((field) => <View key={field}>
        {field === "latitude" && <TouchableOpacity style={styles.secondary} onPress={detectLocation} disabled={locating} accessibilityRole="button" accessibilityLabel={t("addPlant.getCurrentLocation")}>
          {locating ? <ActivityIndicator color="#28665E" /> : <Text style={styles.secondaryText}>{t("addPlant.getCurrentLocation")}</Text>}
        </TouchableOpacity>}
        <Text style={styles.label}>{t(`recordEdits.${field}`)}</Text>
        <TextInput style={[styles.input, ["morphology", "notes"].includes(field) && styles.multiline]} value={form[field]} onChangeText={(next) => change(field, next)}
          multiline={["morphology", "notes"].includes(field)} keyboardType={numeric.has(field) ? "decimal-pad" : "default"} /></View>)}
    </View>
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.qrAssignment")}</Text>
      <Text style={styles.note}>{t("recordEdits.currentQr")}: {state.plant.qrCode || t("botanistPlantDetail.notAssigned")}</Text>
      <Text style={styles.note}>{t("recordEdits.qrRequiredNote")}</Text>
      {qrLoading && <ActivityIndicator color="#468585" />}
      {!!qrError && <Text style={styles.error}>{translateUIMessage(qrError)}</Text>}
      <TouchableOpacity style={styles.secondary} onPress={refreshQr} disabled={qrLoading} accessibilityRole="button" accessibilityLabel={t("recordEdits.refreshQr")}>
        <Text style={styles.secondaryText}>{t("recordEdits.refreshQr")}</Text></TouchableOpacity>
      {qrList.map((qr) => { const current = qr.id === str(state.plant.qrId);
        const available = current || (qr.status === "generated" && qr.plantId == null);
        return <TouchableOpacity key={qr.id} style={[styles.speciesOption, form.qr_id === qr.id && styles.selected, !available && styles.disabled]}
          disabled={!available} onPress={() => change("qr_id", qr.id)} accessibilityRole="radio" accessibilityState={{ selected: form.qr_id === qr.id, disabled: !available }}>
          <Text style={styles.optionText}>{qr.label} · {current ? t("recordEdits.currentQr") : available ? t("recordEdits.availableQr") : t("recordEdits.unavailableQr")}</Text>
        </TouchableOpacity>; })}
    </View>
    <View style={styles.card}><Text style={styles.heading}>{t("recordEdits.plantPhotos")}</Text>
      <View style={styles.photoRow}>{(state.plant.latestObservation?.assets || []).map((asset, index) => removedPhotos.includes(asset.id) ? null :
        <View key={asset.id} style={styles.photoTile}><Image source={state.plant.photos?.[index]} style={styles.photo} />
          <TouchableOpacity style={styles.removePhoto} onPress={() => removeExisting(asset.id)} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}>
            <Ionicons name="close" size={17} color="#FFFFFF" /></TouchableOpacity></View>)}
        {newPhotos.map((uri, index) => <View key={`${uri}-${index}`} style={styles.photoTile}><Image source={{ uri }} style={styles.photo} />
          <TouchableOpacity style={styles.removePhoto} onPress={() => setNewPhotos((current) => current.filter((_, item) => item !== index))} accessibilityRole="button" accessibilityLabel={t("recordEdits.removePhoto")}>
            <Ionicons name="close" size={17} color="#FFFFFF" /></TouchableOpacity></View>)}</View>
      <View style={styles.photoActions}><TouchableOpacity style={styles.secondary} onPress={() => pickPhotos(true)} accessibilityRole="button"><Text style={styles.secondaryText}>{t("recordEdits.takePhoto")}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => pickPhotos(false)} accessibilityRole="button"><Text style={styles.secondaryText}>{t("recordEdits.addGallery")}</Text></TouchableOpacity></View>
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
  heading: { color: "#234B3A", fontSize: 18, fontWeight: "700" }, label: { color: "#52665A", fontSize: 13, fontWeight: "600", marginTop: 6 },
  input: { borderWidth: 1, borderColor: "#CDE3DC", backgroundColor: "#FFFFFF", borderRadius: 11, padding: 12, color: "#234B3A", minHeight: 44 },
  multiline: { minHeight: 90, textAlignVertical: "top" }, speciesOption: { borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 10, padding: 11 },
  selected: { backgroundColor: "#E4F5EC", borderColor: "#468585" }, optionText: { color: "#234B3A" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, photoTile: { position: "relative" }, photo: { width: 90, height: 90, borderRadius: 10 },
  removePhoto: { position: "absolute", top: -5, right: -5, width: 32, height: 32, borderRadius: 16, backgroundColor: "#A34436", alignItems: "center", justifyContent: "center" },
  photoActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primary: { backgroundColor: "#468585", borderRadius: 12, padding: 15, minHeight: 44, alignItems: "center" }, primaryText: { color: "#FFFFFF", fontWeight: "700" },
  secondary: { borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 12, padding: 12, minHeight: 44, alignItems: "center" }, secondaryText: { color: "#28665E", fontWeight: "700" },
  disabled: { opacity: 0.6 }, error: { color: "#A34436", lineHeight: 21 },
});
