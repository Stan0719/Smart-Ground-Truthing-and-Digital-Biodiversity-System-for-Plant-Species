import { canCollectDrafts } from "../utils/rbac";
import React, { useEffect, useState, useRef } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { plantApi } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { saveDraft, readDrafts } from "../utils/fieldStorage";
import { syncDrafts } from "../utils/fieldSync";
import { createFieldCapture } from "../utils/fieldCapture";
const fieldCapture = createFieldCapture({
  imagePicker: ImagePicker,
  location: Location,
});
const input = {
  borderWidth: 1,
  borderColor: "#b5cbbd",
  padding: 12,
  marginVertical: 6,
  borderRadius: 8,
  backgroundColor: "white",
};
const button = {
  padding: 14,
  marginVertical: 6,
  backgroundColor: "#d8eddf",
  borderRadius: 8,
};
export default function FieldCollection({ route, navigation, onLogout }) {
  const [user, setUser] = useState(null),
    [species, setSpecies] = useState([]),
    [rows, setRows] = useState([]),
    [draftCount, setDraftCount] = useState(0),
    [drafts, setDrafts] = useState([]);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState([]),
    [qr, setQr] = useState("");
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
    try {
      const coordinates = await fieldCapture.coordinates();
      setForm((old) => ({ ...old, ...coordinates }));
    } catch (e) {
      setError(e.message);
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
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        backgroundColor: "#f2f8ef",
        flexGrow: 1,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 25, color: "#234b3a" }}>
        {dashboard
          ? "Botanist dashboard"
          : mode === "PlantQRCode"
            ? "Plant QR codes"
            : edit
              ? "Correct observation"
              : newPlant
                ? "Register plant"
                : "Add observation"}
      </Text>
      <TouchableOpacity style={button} onPress={load}>
        <Text>Refresh</Text>
      </TouchableOpacity>
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: "#a02020" }}>
          {error}
        </Text>
      )}
      {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
      {user && dashboard && (
        <>
          {onLogout && (
            <TouchableOpacity style={button} onPress={onLogout}>
              <Text>Sign out</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={button}
            onPress={() => navigation.navigate("AddPlant", { botanist: user })}
          >
            <Text>Register new plant</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={button}
            disabled={busy}
            onPress={synchronize}
          >
            <Text>Synchronize {draftCount} saved drafts</Text>
          </TouchableOpacity>
        </>
      )}
      {user &&
        dashboard &&
        drafts.map((draft) => (
          <TouchableOpacity
            key={draft.client_key}
            style={button}
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
            <Text>
              Recover saved draft:{" "}
              {draft.body.content?.morphology?.slice(0, 60) || "Observation"}
            </Text>
          </TouchableOpacity>
        ))}
      {user && !dashboard && mode !== "PlantQRCode" && (
        <>
          <Text>Species reference</Text>
          {user.offline && newPlant && (
            <TextInput
              style={input}
              accessibilityLabel="Species ID from your field reference"
              placeholder="Known species ID"
              value={form.species_id}
              onChangeText={(value) => change("species_id", value)}
            />
          )}
          {species.map((s) => (
            <TouchableOpacity
              key={s.species_id}
              onPress={() => change("species_id", s.species_id)}
              style={button}
            >
              <Text>
                {String(form.species_id) === s.species_id ? "✓ " : ""}
                {s.scientific_name} — {s.common_name}
              </Text>
            </TouchableOpacity>
          ))}
          {mode === "AddObservation" && (
            <TextInput
              style={input}
              accessibilityLabel="Approved plant ID"
              placeholder="Approved plant ID"
              value={form.plant_id}
              onChangeText={(v) => change("plant_id", v)}
            />
          )}
          {[
            "heightCm",
            "healthStatus",
            "lifeStage",
            "morphology",
            "taxonomy",
            "notes",
            "latitude",
            "longitude",
            "accuracy_m",
          ].map((field) => (
            <View key={field}>
              <Text>{field}</Text>
              <TextInput
                accessibilityLabel={field}
                style={input}
                multiline={["notes", "morphology"].includes(field)}
                value={form[field]}
                onChangeText={(v) => change(field, v)}
              />
            </View>
          ))}
          <TouchableOpacity style={button} onPress={locate}>
            <Text>Record current GPS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={button} onPress={() => capture(true)}>
            <Text>Capture photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={button} onPress={() => capture(false)}>
            <Text>Attach photo</Text>
          </TouchableOpacity>
          {photos.map((p) => (
            <View key={p.client_key}>
              <Image
                source={{ uri: p.uri }}
                style={{ width: 120, height: 100 }}
              />
              <TouchableOpacity
                style={button}
                accessibilityLabel="Remove attached photo"
                onPress={() =>
                  setPhotos((old) =>
                    old.filter((photo) => photo.client_key !== p.client_key),
                  )
                }
              >
                <Text>Remove photo</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={button}
            disabled={busy}
            onPress={() => save(false)}
          >
            <Text>Save offline draft</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={button}
            disabled={busy}
            onPress={() => save(true)}
          >
            <Text>Submit and synchronize</Text>
          </TouchableOpacity>
        </>
      )}
      {user &&
        (dashboard || mode === "PlantQRCode") &&
        rows.map((row) => (
          <View
            key={row.id}
            style={{ padding: 14, marginVertical: 8, backgroundColor: "white" }}
          >
            <Text>
              Plant {row.plant_id} · {row.status}
            </Text>
            <Text>{row.content.morphology}</Text>
            <TouchableOpacity style={button} onPress={() => showQr(row)}>
              <Text>View persistent QR code</Text>
            </TouchableOpacity>
            {["Draft", "Correction Required", "Rejected"].includes(
              row.status,
            ) && (
              <TouchableOpacity
                style={button}
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
                  navigation.navigate("EditPlant", { observation: row });
                }}
              >
                <Text>Correct and resubmit own observation</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={button}
              onPress={() =>
                navigation.navigate("AddObservation", { plantId: row.plant_id })
              }
            >
              <Text>Add observation</Text>
            </TouchableOpacity>
          </View>
        ))}
      {!!qr && <QrDisplay value={qr} />}
    </ScrollView>
  );
}
function QrDisplay({ value }) {
  const QRCode = require("react-native-qrcode-svg").default;
  return (
    <View style={{ padding: 20, backgroundColor: "white" }}>
      <QRCode value={value} size={220} />
      <Text>Code is usable after Officer approval.</Text>
    </View>
  );
}
