import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import Text from "./ScaledText";
import MapView from "react-native-maps";
import { t, useAppTranslation } from "../translations/i18n";
import { validGpsPoint } from "../utils/gpsLocation";

// Form values and map camera are separate; only completed movements update GPS.
export default function GpsLocationPicker({ location, onChange, onInteractionChange, inputActive = false }) {
  useAppTranslation();
  const mapRef = useRef(null);
  const emitted = useRef({ latitude: Number(location.latitude), longitude: Number(location.longitude) });
  const pendingCenter = useRef(null);
  const active = useRef(true);
  const gesture = useRef(false);
  const ready = useRef(false);
  const tilesLoaded = useRef(false);
  const generation = useRef(0);
  const [hasLayout, setHasLayout] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mapStatus, setMapStatus] = useState("loading");
  const latest = useRef({ location, onChange, onInteractionChange, inputActive });
  useEffect(() => {
    latest.current = { location, onChange, onInteractionChange, inputActive };
    if (inputActive) gesture.current = false;
  }, [location, onChange, onInteractionChange, inputActive]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; latest.current.onInteractionChange?.(false); };
  }, []);
  const latitude = Number(location.latitude), longitude = Number(location.longitude);
  const syncCamera = () => {
    const point = latest.current.location;
    if (!ready.current || !validGpsPoint(point)) return;
    const center = { latitude: Number(point.latitude), longitude: Number(point.longitude) };
    pendingCenter.current = center;
    mapRef.current?.animateCamera({ center }, { duration: 0 });
  };
  useEffect(() => {
    if (!validGpsPoint(location)) return;
    if (inputActive) return;
    if (emitted.current?.latitude === latitude && emitted.current?.longitude === longitude) return;
    pendingCenter.current = { latitude, longitude };
    gesture.current = false;
    if (ready.current) mapRef.current?.animateCamera({ center: { latitude, longitude } }, { duration: 0 });
  }, [latitude, longitude, location, inputActive]);
  useEffect(() => {
    if (!hasLayout || mapStatus !== "loading") return;
    const timeout = setTimeout(() => {
      if (active.current && (!ready.current || (Platform.OS === "android" && !tilesLoaded.current))) {
        gesture.current = false;
        latest.current.onInteractionChange?.(false);
        setMapStatus("error");
      }
    }, 15000);
    return () => clearTimeout(timeout);
  }, [hasLayout, attempt, mapStatus]);
  const retry = () => {
    generation.current += 1;
    ready.current = false; tilesLoaded.current = false; gesture.current = false;
    latest.current.onInteractionChange?.(false);
    emitted.current = { latitude: Number(latest.current.location.latitude), longitude: Number(latest.current.location.longitude) };
    pendingCenter.current = null;
    setMapStatus("loading"); setAttempt((value) => value + 1);
  };
  return <View style={styles.section}>
    <Text style={styles.title}>{t("gpsPicker.chooseLocationOnMap")}</Text>
    <Text style={styles.instruction}>{t("gpsPicker.moveMap")}</Text>
    <View style={styles.mapArea} collapsable={false} onLayout={(event) => {
      const { width, height } = event.nativeEvent.layout;
      setHasLayout(width > 0 && height > 0);
    }}>
      {hasLayout && <MapView key={attempt} ref={mapRef} style={styles.map}
        initialRegion={{ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        mapType="standard" loadingEnabled
        zoomEnabled scrollEnabled rotateEnabled={false} pitchEnabled={false}
        accessibilityLabel={t("gpsPicker.chooseLocationOnMap")}
        onMapReady={() => {
          if (!active.current || attempt !== generation.current) return;
          ready.current = true;
          syncCamera();
          // Apple Maps has no onMapLoaded event in react-native-maps.
          if (Platform.OS !== "android" || tilesLoaded.current) setMapStatus("ready");
        }}
        onMapLoaded={() => {
          if (!active.current || attempt !== generation.current) return;
          tilesLoaded.current = true; if (ready.current) setMapStatus("ready");
        }}
        onTouchStart={() => {
          if (!ready.current || mapStatus !== "ready" || latest.current.inputActive) return;
          gesture.current = true; pendingCenter.current = null; latest.current.onInteractionChange?.(true);
        }}
        onPanDrag={() => {
          if (ready.current && mapStatus === "ready" && !latest.current.inputActive) {
            gesture.current = true; pendingCenter.current = null;
          }
        }}
        onTouchEnd={() => latest.current.onInteractionChange?.(false)}
        onTouchCancel={() => latest.current.onInteractionChange?.(false)}
        onRegionChangeComplete={(region) => {
          if (!active.current || attempt !== generation.current || !ready.current || mapStatus !== "ready" || latest.current.inputActive || !validGpsPoint(region)) return;
          const point = { latitude: region.latitude, longitude: region.longitude };
          const pending = pendingCenter.current;
          if (pending && (Math.abs(pending.latitude - point.latitude) > 0.0000005 ||
            Math.abs(pending.longitude - point.longitude) > 0.0000005)) return;
          pendingCenter.current = null;
          latest.current.onInteractionChange?.(false);
          if (!gesture.current) return;
          gesture.current = false;
          const current = latest.current.location;
          if (Number(current.latitude) === point.latitude && Number(current.longitude) === point.longitude) return;
          emitted.current = point;
          latest.current.onChange({ latitude: String(point.latitude), longitude: String(point.longitude), accuracy_m: "" });
        }} />}
      {mapStatus === "ready" && <View pointerEvents="none" style={styles.pinOverlay}>
        <View style={styles.pinHead}><View style={styles.pinDot} /></View>
        <View style={styles.pinTip} />
      </View>}
      {mapStatus === "loading" && <View pointerEvents="none" style={styles.loading}>
        <ActivityIndicator color="#20583D" /><Text style={styles.instruction}>{t("gpsPicker.loadingMap")}</Text>
      </View>}
      {mapStatus === "error" && <View style={styles.errorPanel}>
        <Text accessibilityRole="alert" style={styles.errorText}>{t("gpsPicker.mapUnavailable")}</Text>
        <TouchableOpacity onPress={retry} style={styles.retry} accessibilityRole="button"><Text style={styles.retryText}>{t("gpsPicker.retryMap")}</Text></TouchableOpacity>
      </View>}
    </View>
    {mapStatus !== "error" && <TouchableOpacity onPress={retry} style={styles.retryLink} accessibilityRole="button">
      <Text style={styles.instruction}>{t("gpsPicker.blankMapRetry")}</Text>
    </TouchableOpacity>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 12, marginBottom: 12 },
  title: { color: "#234B3A", fontSize: 16, fontWeight: "700" },
  instruction: { color: "#52665A", fontSize: 13, lineHeight: 19 },
  mapArea: { height: 260, width: "100%", overflow: "hidden", borderRadius: 16, backgroundColor: "#E7F2E2" },
  map: { flex: 1, width: "100%", height: "100%" },
  loading: { position: "absolute", top: 12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 8, backgroundColor: "#FFFFFF" },
  errorPanel: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 20, gap: 12, backgroundColor: "#F7FBF4" },
  errorText: { color: "#B42318", lineHeight: 20, textAlign: "center" },
  retry: { minHeight: 44, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#397C69", borderRadius: 10 },
  retryText: { color: "#FFFFFF", fontWeight: "700" },
  retryLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  pinOverlay: { position: "absolute", top: "50%", left: "50%", width: 40, height: 40, marginLeft: -20, marginTop: -40, alignItems: "center", justifyContent: "center" },
  pinHead: { position: "absolute", top: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: "#20583D", alignItems: "center", justifyContent: "center" },
  pinDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#FFFFFF" },
  pinTip: { position: "absolute", bottom: 0, width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 16, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#20583D" },
});
