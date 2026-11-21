import { t, translateUIMessage, useAppTranslation } from "../translations/i18n";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import ScaledText from "./ScaledText";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { faceApi, validateFaceSession, faceReference, faceDiagnostic } from "../utils/faceApi";
import { runFaceCapture } from "../utils/faceCaptureFlow";
export { faceCameraConfigured } from "../utils/faceApi";

function captureFeedback(failure, mode) {
  if (mode !== "recognize") return translateUIMessage(failure.message || t("faceCameraModal.unableToVerifyFaceTryAgainOrUseYourPassword"));
  if (failure.code === "no_face") return t("faceCameraModal.noFaceDetected");
  if (failure.code === "multiple_faces") return t("faceCameraModal.multipleFacesDetected");
  if (["API_UNREACHABLE", "API_TIMEOUT", "API_CONFIGURATION"].includes(failure.code)) return t("faceCameraModal.connectionUnavailable");
  return t("faceCameraModal.recognitionFailed");
}

function Capture({ request, onClose, onResult, isCurrent }) {
  useAppTranslation();
  const [permission, askPermission] = useCameraPermissions();
  const camera = useRef(null);
  const lock = useRef(false);
  const active = useRef(true);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState();
  const sizeConfigured = useRef(false);
  const autoAttempted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, setStage] = useState("");
  const { width, height } = useWindowDimensions();
  const previewWidth = Math.min(width - 40, 400, Math.max(160, (height - 280) * 0.75));
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function cameraReady() {
    if (!sizeConfigured.current) {
      sizeConfigured.current = true;
      try {
        const sizes = await camera.current.getAvailablePictureSizesAsync();
        const options = sizes.map((size) => {
          const [width, height] = size.split("x").map(Number);
          return { size, width, height, area: width * height };
        }).filter(({ width, height }) => width >= 640 && height >= 480 && Math.max(width, height) <= 1600)
          .sort((a, b) => b.area - a.area);
        if (active.current && options[0]) {
          setPictureSize(options[0].size);
        }
      } catch { /* Keep native default; upload bounds still apply. */ }
    }
    if (active.current) setReady(true);
  }
  const scan = React.useCallback(async (consent = false) => {
    if (lock.current || !ready || !camera.current) return;
    lock.current = true; setBusy(true); setError("");
    const reference = faceReference();
    faceDiagnostic("capture_started", reference, { mode: request.mode, cameraRequestId: request.id });
    try {
      const result = await runFaceCapture({
        request, api: faceApi, reference, consent, validateSession: validateFaceSession,
        isActive: () => active.current && isCurrent(request.id), stage: setStage, diagnostic: faceDiagnostic,
        capture: async () => {
          const photo = await camera.current.takePictureAsync({ base64: true, quality: 0.8, skipProcessing: false, exif: true });
          faceDiagnostic("photo_captured", reference, { width: photo?.width, height: photo?.height, exifOrientation: Number(photo?.exif?.Orientation || 1), mirrored: false });
          return photo;
        },
      });
      if (result && active.current && isCurrent(request.id)) onResult(result, request.id);
    } catch (failure) {
      faceDiagnostic("capture_failed", reference, { code: failure.code || "capture_or_response_error" });
      if (request.mode === "recognize" && failure.code === "not_enrolled") {
        if (active.current && isCurrent(request.id)) onResult({ enrollmentRequired: true }, request.id);
        return;
      }
      if (request.mode === "enroll" && failure.status === 409 && failure.code === "already_enrolled") {
        if (active.current && isCurrent(request.id)) onResult({ alreadyEnrolled: true }, request.id);
        return;
      }
      if (active.current && isCurrent(request.id)) setError(captureFeedback(failure, request.mode));
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }, [ready, request, onResult, isCurrent]);
  const scanRef = useRef(scan);
  React.useEffect(() => { scanRef.current = scan; }, [scan]);
  React.useEffect(() => {
    if (request.mode !== "recognize" || !permission?.granted || !ready || autoAttempted.current) return;
    const timer = setTimeout(() => { autoAttempted.current = true; scanRef.current(); }, 900);
    return () => clearTimeout(timer);
  }, [request.mode, permission?.granted, ready]);
  return <SafeAreaView style={styles.screen}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator>
      <View style={styles.content}>
        <TouchableOpacity style={styles.backButton} accessibilityRole="button" accessibilityLabel={t("faceCameraModal.backToLogin")}
          disabled={busy} onPress={onClose}>
          <ScaledText style={styles.backText}>{"\u2039  "}{t("faceCameraModal.backToLogin")}</ScaledText>
        </TouchableOpacity>
        <ScaledText accessibilityRole="header" style={styles.title}>{request.mode === "enroll" ? t("faceCameraModal.faceRegistration") : t("faceCameraModal.faceLogin")}</ScaledText>
        <ScaledText style={styles.subtitle}>{request.mode === "enroll"
          ? request.legacyProof
            ? t("faceCameraModal.agreeToSaveANewLiveFacialTemplateForYour")
            : t("faceCameraModal.agreeToSendAFacePhotoToYourProjectS")
          : t("faceCameraModal.positionFaceInsideFrame")}</ScaledText>
        <View style={[styles.preview, { width: previewWidth }]}>
          {permission?.granted ? <>
            <CameraView ref={camera} style={styles.camera} facing="front" mirror={false} pictureSize={pictureSize}
              onCameraReady={cameraReady} onMountError={() => setError(t("faceCameraModal.cameraCouldNotStartUsePasswordLogin"))} />
            <View pointerEvents="none" accessible={false} style={styles.faceGuide} />
          </> : <View style={styles.permissionState}>
            <ScaledText style={styles.permissionText}>{!permission ? t("faceCameraModal.startingCamera") :
              permission.canAskAgain === false ? t("faceCameraModal.cameraPermissionSettings") : t("faceCameraModal.cameraPermissionNeeded")}</ScaledText>
          </View>}
        </View>
        {permission?.granted && <ScaledText style={styles.hint}>{t("faceCameraModal.keepFaceVisible")}</ScaledText>}
        {!!error && <ScaledText accessibilityRole="alert" style={styles.error}>{error}</ScaledText>}
        {permission && !permission.granted && permission.canAskAgain !== false ? <TouchableOpacity style={styles.primaryButton} accessibilityRole="button"
          accessibilityLabel={t("faceCameraModal.allowCamera")} onPress={askPermission}>
          <ScaledText style={styles.primaryText}>{t("faceCameraModal.allowCamera")}</ScaledText>
        </TouchableOpacity> : permission?.granted && <TouchableOpacity style={[styles.primaryButton, (!ready || busy) && styles.disabledButton]}
          accessibilityRole="button" accessibilityState={{ disabled: !ready || busy, busy }} disabled={!ready || busy}
          onPress={() => scan(request.mode === "enroll")}>
          {busy && <ActivityIndicator color="#173B36" size="small" />}
          <ScaledText style={styles.primaryText}>{busy ? t("faceCameraModal.checkingFace") : request.mode === "enroll"
            ? t("faceCameraModal.agreeAndRegisterMyFace") : error ? t("faceCameraModal.retryFaceLogin") : t("faceCameraModal.scanAndSignIn")}</ScaledText>
        </TouchableOpacity>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
export default function FaceCameraModal({ request, onClose, onResult, isCurrent }) {
  useAppTranslation();
  if (!request) return null;
  return <Modal visible animationType="slide" onRequestClose={() => onClose(request.id)}>
    {request && <Capture key={request.id} request={request} onClose={() => onClose(request.id)} onResult={onResult} isCurrent={isCurrent} />}
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#244B47" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20 },
  content: { width: "100%", maxWidth: 440, alignItems: "center", gap: 14 },
  backButton: { alignSelf: "flex-start", minHeight: 48, paddingHorizontal: 8, justifyContent: "center" },
  backText: { color: "#DEF9C4", fontSize: 16, fontWeight: "600" },
  title: { color: "#FFF6DC", fontSize: 26, fontWeight: "700", textAlign: "center" },
  subtitle: { color: "#E0EDE5", fontSize: 16, lineHeight: 23, textAlign: "center" },
  preview: { aspectRatio: 3 / 4, borderRadius: 18, overflow: "hidden", backgroundColor: "#193B37",
    justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(222, 249, 196, 0.3)" },
  camera: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  faceGuide: { width: "62%", height: "70%", borderRadius: 999, borderWidth: 2,
    borderColor: "rgba(255, 246, 220, 0.8)" },
  permissionState: { paddingHorizontal: 22 },
  permissionText: { color: "#E0EDE5", fontSize: 16, lineHeight: 23, textAlign: "center" },
  hint: { color: "#E0EDE5", fontSize: 16, lineHeight: 22, textAlign: "center" },
  error: { width: "100%", color: "#FFF6DC", backgroundColor: "#6B3532", borderRadius: 10,
    padding: 12, fontSize: 16, lineHeight: 22, textAlign: "center" },
  primaryButton: { width: "100%", minHeight: 54, flexDirection: "row", gap: 9,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, backgroundColor: "#50B498" },
  disabledButton: { opacity: 0.65 },
  primaryText: { color: "#173B36", fontSize: 17, fontWeight: "700", textAlign: "center" },
});
