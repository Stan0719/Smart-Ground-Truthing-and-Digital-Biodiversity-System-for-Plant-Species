import { t, translateLabel, translateUIMessage, useAppTranslation, translateFieldLabel } from "../translations/i18n";
import { canCollectDrafts } from "../utils/rbac";
import React, { useEffect, useState, useRef } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  ActivityIndicator,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { saveDraft, readDrafts } from "../utils/fieldStorage";
import { syncDrafts } from "../utils/fieldSync";
import { createFieldCapture } from "../utils/fieldCapture";
import { fieldFormStyles } from "../components/fieldFormStyles";
const fieldCapture = createFieldCapture({
  imagePicker: ImagePicker,
  location: Location,
});
export default function FieldCollection({ route, navigation, onLogout }) {
  useAppTranslation();
  const [user, setUser] = useState(null),
    [species, setSpecies] = useState([]),
    [rows, setRows] = useState([]),
    [draftCount, setDraftCount] = useState(0),
    [drafts, setDrafts] = useState([]);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState([]),
    [qr, setQr] = useState(""),
    [plantRecord, setPlantRecord] = useState(null),
    [locating, setLocating] = useState(false);
  const [form, setForm] = useState({
    species_id: "",
    plant_id: String(route.params?.plantId || ""),
    heightCm: "",
    healthStatus: "Healthy",
    lifeStage: "Mature",
    morphology: "",
    taxonomy: "",
    notes: "",
    latitude: "",
    longitude: "",
    accuracy_m: "",
  });
  const capturing = useRef(false);
  const draftKey = useRef(
    route.params?.draftKey ||
      `field-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const mode = route.name,
    edit = mode === "EditPlant" || mode === "FieldCollectionEdit",
    newPlant = mode === "AddPlant" || mode === "FieldCollectionPlant",
    dashboard = mode === "BotanistDashboard" || mode === "AccountTab";
  const change = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  async function load() {
    setError("");
    try {
      const verified = await faceSession.restore({ allowOffline: true });
      if (!canCollectDrafts(verified))
        throw Error("An active Botanist account is required.");
      setUser(verified);
      const saved = await readDrafts(verified.id);
      setDrafts(saved);
      setDraftCount(saved.length);
      if (verified.offline) {
        setSpecies([]);
        setRows([]);
        setMessage(
          "Offline draft mode: local drafts only. Reconnect to synchronize; access expires after 15 minutes from the last online verification.",
        );
        return;
      }
      const [catalog, observations] = await Promise.all([
        plantApi("/species?scope=scientific"),
        plantApi("/observations"),
      ]);
      setSpecies(catalog.species);
      setRows(observations.observations);
      if (mode === "AddObservation" && form.plant_id) {
        setPlantRecord(null);
        try {
          const result = await plantApi(`/plants/${encodeURIComponent(form.plant_id)}`);
          setPlantRecord(result.plant || null);
        } catch {
          // Keep the assigned plant ID visible when the details endpoint is unavailable.
        }
      }
    } catch (e) {
      setUser(null);
      setDrafts([]);
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    if (route.params?.observation)
      setForm((old) => ({
        ...old,
        ...Object.fromEntries(
          Object.entries(route.params.observation.content).map(([k, v]) => [
            k,
            String(v),
          ]),
        ),
      }));
    if (route.params?.draft) {
      const draft = route.params.draft;
      draftKey.current = draft.client_key;
      setForm((old) => ({
        ...old,
        ...Object.fromEntries(
          Object.entries(draft.body.content).map(([k, v]) => [k, String(v)]),
        ),
        species_id: String(draft.body.species_id || ""),
        plant_id: draft.path.match(/^\/plants\/(\d+)\//)?.[1] || "",
      }));
      setPhotos(
        (draft.assets || []).map((a) => ({
          ...a,
          uri: `data:${a.content_type};base64,${a.base64}`,
        })),
      );
    }
  }, [route.params?.observation?.id, route.params?.draft?.client_key]);
  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const owner = user.id;
    const timer = setInterval(async () => {
      try {
        const verified = await faceSession.restore({ allowOffline: true });
        if (!active) return;
        if (verified?.id !== owner) throw Error("Owner session changed.");
        setUser(verified);
      } catch {
        if (active) {
          setUser(null);
          setDrafts([]);
          setError(
            "Offline access expired or the session was rejected. Reconnect and sign in to recover saved drafts. Your current form remains in memory.",
          );
        }
      }
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  async function locate() {
    setLocating(true);
    try {
      const coordinates = await fieldCapture.coordinates();
      setForm((old) => ({ ...old, ...coordinates }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }
  async function capture(camera) {
    if (capturing.current) return;
    capturing.current = true;
    setError("");
    try {
      const asset = await fieldCapture.photo(camera, photos.length);
      if (asset)
        setPhotos((old) => [
          ...old,
          {
            ...asset,
            client_key: `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          },
        ]);
    } catch (e) {
      setError(e.message);
    } finally {
      capturing.current = false;
    }
  }
  function content() {
    const height = Number(form.heightCm);
    if (!Number.isFinite(height) || height <= 0 || !form.morphology.trim())
      throw Error("Enter a positive height and morphology.");
    for (const [field, max] of Object.entries({ healthStatus: 100, lifeStage: 100, morphology: 4000, notes: 4000, taxonomy: 1000 })) {
      if (typeof form[field] !== "string" || form[field].length > max)
        throw Error(`${field} must be text with ${max} characters or fewer.`);
    }
    if (!form.healthStatus.trim() || !form.lifeStage.trim())
      throw Error("Enter health status and life stage.");
    const result = {
      heightCm: height,
      healthStatus: form.healthStatus.trim(),
      lifeStage: form.lifeStage.trim(),
      morphology: form.morphology.trim(),
      notes: form.notes.trim(),
      ...(form.taxonomy ? { taxonomy: form.taxonomy.trim() } : {}),
    };
    if (form.latitude || form.longitude) {
      if (!form.latitude || !form.longitude)
        throw Error("Both coordinates are required.");
      result.latitude = Number(form.latitude);
      result.longitude = Number(form.longitude);
      if (form.accuracy_m) result.accuracy_m = Number(form.accuracy_m);
    }
    if (
      result.latitude !== undefined &&
      (!Number.isFinite(result.latitude) ||
        Math.abs(result.latitude) > 90 ||
        !Number.isFinite(result.longitude) ||
        Math.abs(result.longitude) > 180)
    )
      throw Error("Enter valid latitude and longitude.");
    if (
      result.accuracy_m !== undefined &&
      (!Number.isFinite(result.accuracy_m) || result.accuracy_m < 0)
    )
      throw Error("Accuracy must be a nonnegative number.");
    return result;
  }
  async function save(online) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const active = await faceSession.restore({ allowOffline: !online });
      if (active?.id !== user.id || !canCollectDrafts(active))
        throw Error("Sign in with the observation owner account.");
      const data = content();
      if (edit) {
        const recovered = route.params?.draft;
        const observation =
          route.params?.observation ||
          (recovered?.method === "PATCH"
            ? {
                id: recovered.path.split("/").pop(),
                plant_id: recovered.plant_id,
                revision: recovered.body.revision,
              }
            : null);
        if (!observation)
          throw Error(
            "Select an owned editable observation from the dashboard.",
          );
        await saveDraft(user.id, {
          client_key: draftKey.current,
          method: "PATCH",
          path: `/observations/${observation.id}`,
          plant_id: observation.plant_id,
          body: { content: data, revision: observation.revision },
          assets: photos.map(({ uri, ...asset }) => asset),
        });
        setMessage("Correction draft saved on this device.");
        if (online) {
          await syncDrafts(user.id);
          setMessage("Observation resubmitted for review.");
        }
        const saved = await readDrafts(user.id);
        setDrafts(saved);
        setDraftCount(saved.length);
        return;
      }
      const key = draftKey.current;
      const isNew = newPlant;
      if (isNew && (!form.species_id || data.latitude === undefined))
        throw Error("Select a species and record GPS.");
      if (!isNew && !form.plant_id) throw Error("Enter an approved plant ID.");
      const body = isNew
        ? {
            species_id: Number(form.species_id),
            latitude: data.latitude,
            longitude: data.longitude,
            ...(data.accuracy_m === undefined
              ? {}
              : { accuracy_m: data.accuracy_m }),
            content: data,
            client_key: key,
          }
        : { content: data, client_key: key };
      await saveDraft(user.id, {
        client_key: key,
        path: isNew ? "/plants" : `/plants/${form.plant_id}/observations`,
        body,
        assets: photos.map(({ uri, ...asset }) => asset),
      });
      setMessage("Draft saved on this device.");
      if (online) {
        const synced = await syncDrafts(user.id);
        setMessage(`${synced} record(s) synchronized for Officer review.`);
        if (synced > 0) {
          draftKey.current = `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setPhotos([]);
        }
      }
      const saved = await readDrafts(user.id);
      setDrafts(saved);
      setDraftCount(saved.length);
    } catch (e) {
      setError(e.message + " Any saved draft remains available for retry.");
    } finally {
      setBusy(false);
    }
  }
  async function synchronize() {
    setBusy(true);
    try {
      const count = await syncDrafts(user.id);
      setMessage(`${count} draft(s) synchronized.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function showQr(row) {
    try {
      const result = await plantApi(`/plants/${row.plant_id}/qr`);
      setQr(result.qr_token);
      setMessage(`QR status: ${result.rbac_status}`);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={styles.page}>
      <Text style={styles.pageTitle}>
        {dashboard
          ? t("fieldCollection.botanistDashboard")
          : mode === "PlantQRCode"
            ? t("fieldCollection.plantQrCodes")
            : edit
              ? t("fieldCollection.correctObservation")
              : newPlant
                ? t("fieldCollection.registerPlant")
                : t("fieldCollection.addObservation")}
      </Text>
      <TouchableOpacity style={styles.secondaryButton} onPress={load} accessibilityRole="button">
        <Text>{t("common.refresh")}</Text>
      </TouchableOpacity>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
          {translateUIMessage(error)}
        </Text>
      )}
      {!!message && <Text accessibilityLiveRegion="polite">{translateUIMessage(message)}</Text>}
      {user && dashboard && (
        <>
          {onLogout && (
            <TouchableOpacity style={styles.secondaryButton} onPress={onLogout}>
              <Text>{t("fieldCollection.signOut")}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate("AddPlant", { botanist: user })}
          >
            <Text>{t("fieldCollection.registerNewPlant")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            disabled={busy}
            onPress={synchronize}
          >
            <Text>{t("fieldCollection.synchronize")}{draftCount}{t("fieldCollection.savedDrafts")}</Text>
          </TouchableOpacity>
        </>
      )}
      {user &&
        dashboard &&
        drafts.map((draft) => (
          <TouchableOpacity
            key={draft.client_key}
            style={styles.secondaryButton}
            onPress={() =>
              navigation.navigate(
                draft.method === "PATCH"
                  ? "FieldCollectionEdit"
                  : draft.path === "/plants"
                    ? "FieldCollectionPlant"
                    : "FieldCollection",
                { draft },
              )
            }
          >
            <Text>{t("fieldCollection.recoverSavedDraft")}{" "}
              {draft.body.content?.morphology?.slice(0, 60) || t("fieldCollection.observation")}
            </Text>
          </TouchableOpacity>
        ))}
      {user && !dashboard && mode !== "PlantQRCode" && (
        <>
          <View style={styles.card}>
          {mode === "AddObservation" ? (
            <>
              <Text style={styles.sectionTitle}>{t("fieldCollection.plantSpeciesSection")}</Text>
              <View style={styles.plantSummary}>
                <Text style={styles.summaryLabel}>{t("fieldCollection.plant")}{form.plant_id || "—"}</Text>
                {!!(plantRecord?.scientific_name || plantRecord?.species_details?.scientific_name) && (
                  <Text style={styles.summaryName}>{plantRecord.scientific_name || plantRecord.species_details.scientific_name}</Text>
                )}
                {!!(plantRecord?.common_name || plantRecord?.species_details?.common_name) && (
                  <Text style={styles.summaryCommon}>{plantRecord.common_name || plantRecord.species_details.common_name}</Text>
                )}
                {!!(plantRecord?.status || plantRecord?.rbac_status) && (
                  <Text style={styles.summaryStatus}>{translateLabel(plantRecord.status || plantRecord.rbac_status)}</Text>
                )}
              </View>
              <Text style={styles.label}>{t("fieldCollection.approvedPlantId")}</Text>
              <TextInput style={styles.input} accessibilityLabel={t("fieldCollection.approvedPlantId")}
                placeholder={t("fieldCollection.approvedPlantId")} value={form.plant_id}
                placeholderTextColor="#9AA7A0" onChangeText={(v) => { change("plant_id", v); setPlantRecord(null); }}
                onEndEditing={async () => {
                  if (!/^\d+$/.test(form.plant_id)) return;
                  try {
                    const result = await plantApi(`/plants/${encodeURIComponent(form.plant_id)}`);
                    setPlantRecord(result.plant || null);
                  } catch {
                    setPlantRecord(null);
                  }
                }} keyboardType="number-pad" />
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>{t("fieldCollection.plantSpeciesSection")}</Text>
              <Text style={styles.label}>{t("fieldCollection.speciesReference")}</Text>
              {user.offline && newPlant && (
                <TextInput style={styles.input}
                  accessibilityLabel={t("fieldCollection.speciesIdFromYourFieldReference")}
                  placeholder={t("fieldCollection.knownSpeciesId")} value={form.species_id}
                  onChangeText={(value) => change("species_id", value)} />
              )}
              {species.map((s) => (
                <TouchableOpacity key={s.species_id} onPress={() => change("species_id", s.species_id)}
                  style={[styles.choiceButton, String(form.species_id) === s.species_id && styles.selectedChoice]}
                  accessibilityRole="button" accessibilityState={{ selected: String(form.species_id) === s.species_id }}>
                  <Text>{String(form.species_id) === s.species_id ? "✓ " : ""}{s.scientific_name} · {s.common_name}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fieldCollection.observationSection")}</Text>
          {["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes"].map((field) => (
            <View key={field} style={styles.fieldGroup}>
              <Text style={styles.label}>{translateFieldLabel(field)}</Text>
              <TextInput accessibilityLabel={translateFieldLabel(field)} style={[styles.input, ["notes", "morphology"].includes(field) && styles.multiline]}
                multiline={["notes", "morphology"].includes(field)} value={form[field]} onChangeText={(v) => change(field, v)} />
            </View>
          ))}
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fieldCollection.locationSection")}</Text>
          {["latitude", "longitude", "accuracy_m"].map((field) => (
            <View key={field} style={styles.fieldGroup}>
              <Text style={styles.label}>{translateFieldLabel(field)}</Text>
              <TextInput accessibilityLabel={translateFieldLabel(field)} style={styles.input} value={form[field]} onChangeText={(v) => change(field, v)} keyboardType="decimal-pad" />
            </View>
          ))}
          <TouchableOpacity style={styles.locationButton} onPress={locate} disabled={locating} accessibilityRole="button" accessibilityState={{ disabled: locating }}>
            {locating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.locationButtonText}>{t("addPlant.getCurrentLocation")}</Text>}
          </TouchableOpacity>
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fieldCollection.photosSection")}</Text>
          <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.photoButton, styles.actionFlex]} onPress={() => capture(true)} accessibilityRole="button">
            <Text style={styles.photoButtonText}>{t("addPlant.camera")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.photoButton, styles.actionFlex]} onPress={() => capture(false)} accessibilityRole="button">
            <Text style={styles.photoButtonText}>{t("addPlant.gallery")}</Text>
          </TouchableOpacity>
          </View>
          <View style={styles.photoList}>
          {photos.map((p) => (
            <View key={p.client_key} style={styles.photoItem}>
              <Image source={{ uri: p.uri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity style={styles.removePhotoButton}
                accessibilityRole="button" accessibilityLabel={t("fieldCollection.removeAttachedPhoto")}
                onPress={() => setPhotos((old) => old.filter((photo) => photo.client_key !== p.client_key))}>
                <Ionicons name="close" size={18} color="#C85C5C" />
              </TouchableOpacity>
            </View>
          ))}
          </View>
          </View>
          <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fieldCollection.submissionSection")}</Text>
          <TouchableOpacity style={[styles.primaryButton, busy && styles.disabledButton]} disabled={busy} onPress={() => save(false)} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            <Text style={styles.primaryButtonText}>{t("fieldCollection.saveOfflineDraft")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryButton, styles.submitButton, busy && styles.disabledButton]} disabled={busy} onPress={() => save(true)} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
            <Text style={styles.primaryButtonText}>{t("fieldCollection.submitAndSynchronize")}</Text>
          </TouchableOpacity>
          </View>
        </>
      )}
      {user &&
        (dashboard || mode === "PlantQRCode") &&
        rows.map((row) => (
          <View
            key={row.id}
            style={styles.card}
          >
            <Text>{t("fieldCollection.plant")}{row.plant_id} · {translateLabel(row.status)}
            </Text>
            <Text>{row.content.morphology}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => showQr(row)}>
              <Text>{t("fieldCollection.viewPersistentQrCode")}</Text>
            </TouchableOpacity>
            {["Draft", "Correction Required", "Rejected"].includes(
              row.status,
            ) && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  setForm((old) => ({
                    ...old,
                    ...Object.fromEntries(
                      Object.entries(row.content).map(([k, v]) => [
                        k,
                        String(v),
                      ]),
                    ),
                  }));
                  navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id });
                }}
              >
                <Text>{t("fieldCollection.correctAndResubmitOwnObservation")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                navigation.navigate("AddObservation", { plantId: row.plant_id })
              }
            >
              <Text>{t("fieldCollection.addObservation")}</Text>
            </TouchableOpacity>
          </View>
        ))}
      {!!qr && <QrDisplay value={qr} />}
      </View>
    </ScrollView>
  );
}
function QrDisplay({ value }) {
  useAppTranslation();
  const QRCode = require("react-native-qrcode-svg").default;
  return (
    <View style={{ padding: 20, backgroundColor: "white" }}>
      <QRCode value={value} size={220} />
      <Text>{t("fieldCollection.codeIsUsableAfterOfficerApproval")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: fieldFormStyles.container,
  scrollContent: { flexGrow: 1, alignItems: "center", paddingHorizontal: 16, paddingTop: 18, paddingBottom: 36 },
  page: { width: "100%", maxWidth: 900, gap: 12 },
  pageTitle: { fontSize: 27, fontWeight: "700", color: "#234B3A", marginBottom: 2 },
  card: fieldFormStyles.card,
  sectionTitle: fieldFormStyles.sectionTitle,
  label: fieldFormStyles.label,
  fieldGroup: { marginBottom: 7 },
  input: [fieldFormStyles.input, { width: "100%", marginTop: 6 }],
  multiline: fieldFormStyles.textArea,
  choiceButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 11, marginTop: 7, borderRadius: 11, backgroundColor: "#f3f8f4", borderWidth: 1, borderColor: "#e0ebe3" },
  selectedChoice: { backgroundColor: "#e4f2e9", borderColor: "#468585" },
  secondaryButton: { minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11, marginVertical: 4, borderRadius: 12, backgroundColor: "#e8f2eb", borderWidth: 1, borderColor: "#d4e5d9" },
  secondaryButtonText: { color: "#2b5948", fontWeight: "600", fontSize: 15, textAlign: "center" },
  primaryButton: [fieldFormStyles.submitButton, { marginTop: 8, paddingHorizontal: 18, paddingVertical: 13 }],
  submitButton: { backgroundColor: "#234B3A" },
  disabledButton: { opacity: 0.55 },
  primaryButtonText: [fieldFormStyles.submitButtonText, { fontSize: 16, textAlign: "center" }],
  locationButton: fieldFormStyles.locationButton,
  locationButtonText: fieldFormStyles.locationButtonText,
  photoButton: [fieldFormStyles.photoButton, { flexDirection: "row", gap: 7 }],
  photoButtonText: fieldFormStyles.photoButtonText,
  actionRow: fieldFormStyles.photoButtonRow,
  actionFlex: { flex: 1 },
  photoList: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 },
  photoItem: { width: 112, position: "relative" },
  photoPreview: fieldFormStyles.photoPreview,
  removePhotoButton: fieldFormStyles.removePhotoButton,
  plantSummary: { padding: 14, borderRadius: 12, backgroundColor: "#F5F9F3", borderWidth: 1, borderColor: "#E0EADF", marginVertical: 6 },
  summaryLabel: { color: "#234B3A", fontSize: 15, fontWeight: "700" },
  summaryName: { color: "#234B3A", fontSize: 17, fontWeight: "700", marginTop: 5 },
  summaryCommon: { color: "#6D7F75", fontSize: 14, marginTop: 2 },
  summaryStatus: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: "hidden", color: "#2C6956", backgroundColor: "#EAF6E7", fontSize: 12, fontWeight: "700" },
});
