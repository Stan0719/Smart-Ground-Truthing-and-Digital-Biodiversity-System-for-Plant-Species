import { t, translateUIMessage, useAppTranslation } from "../translations/i18n";
import React, { useRef, useState } from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { faceApi, validateFaceSession, faceReference, faceDiagnostic } from "../utils/faceApi";
import { runFaceCapture, FACE_CAPTURE_VERSION } from "../utils/faceCaptureFlow";
export { faceCameraConfigured } from "../utils/faceApi";

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
  const [stage, setStage] = useState("");
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
      if (active.current && isCurrent(request.id)) setError(failure.message || "Unable to verify face. Try again or use your password.");
    } finally { lock.current = false; if (active.current) setBusy(false); }
  }, [ready, request, onResult, isCurrent]);
  const scanRef = useRef(scan);
  React.useEffect(() => { scanRef.current = scan; }, [scan]);
  React.useEffect(() => {
    if (request.mode !== "recognize" || !permission?.granted || !ready || autoAttempted.current) return;
    const timer = setTimeout(() => { autoAttempted.current = true; scanRef.current(); }, 900);
    return () => clearTimeout(timer);
  }, [request.mode, permission?.granted, ready]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#244B47", padding: 20 }}>
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onClose}><Text style={{ color: "white", fontSize: 20, padding: 16 }}>{t("faceCameraModal.closeUsePassword")}</Text></TouchableOpacity>
    <Text accessibilityRole="header" style={{ color: "white", fontSize: 22, padding: 16 }}>{request.mode === "enroll" ? t("faceCameraModal.faceRegistration") : t("faceCameraModal.faceLogin")}</Text>
    {typeof __DEV__ === "boolean" && __DEV__ && <Text style={{ color: "white", padding: 8 }}>{t("login.faceFlow")}{FACE_CAPTURE_VERSION} · {request.mode}</Text>}
    <Text style={{ color: "white", fontSize: 18, padding: 16 }}>{request.mode === "enroll"
      ? request.legacyProof
        ? t("faceCameraModal.agreeToSaveANewLiveFacialTemplateForYour")
        : t("faceCameraModal.agreeToSendAFacePhotoToYourProjectS")
      : t("faceCameraModal.faceLoginPrototypeFaceTheCameraInGoodLightingYour")}</Text>
    {!permission?.granted ? <TouchableOpacity onPress={askPermission}><Text style={{ color: "#DEF9C4", fontSize: 22, padding: 16 }}>{t("faceCameraModal.allowCamera")}</Text></TouchableOpacity>
      : <CameraView ref={camera} style={{ flex: 1 }} facing="front" mirror={false} pictureSize={pictureSize} onCameraReady={cameraReady} onMountError={() => setError("Camera could not start. Use password login.")} />}
    {permission?.granted && <Text style={{ color: "white", padding: 8 }}>{t("faceCameraModal.keepYourForeheadChinAndBothCheeksVisibleHoldStill")}</Text>}
    {busy && <Text style={{ color: "white", padding: 12 }}>{translateUIMessage(stage)}{t("faceCameraModal.pleaseWaitBeforeClosing")}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: "white", padding: 12 }}>{translateUIMessage(error)}</Text>}
    <View style={{ padding: 16 }}><TouchableOpacity accessibilityRole="button" disabled={!permission?.granted || !ready || busy} onPress={() => scan(request.mode === "enroll")}>
      <Text style={{ color: "#DEF9C4", fontSize: 22 }}>{busy ? t("faceCameraModal.checkingFace") : request.mode === "enroll" ? t("faceCameraModal.agreeAndRegisterMyFace") : error ? t("faceCameraModal.retryFaceLogin") : t("faceCameraModal.scanAndSignIn")}</Text>
    </TouchableOpacity></View>
  </SafeAreaView>;
}
export default function FaceCameraModal({ request, onClose, onResult, isCurrent }) {
  useAppTranslation();
  if (!request) return null;
  return <Modal visible animationType="slide" onRequestClose={() => onClose(request.id)}>
    {request && <Capture key={request.id} request={request} onClose={() => onClose(request.id)} onResult={onResult} isCurrent={isCurrent} />}
  </Modal>;
}
