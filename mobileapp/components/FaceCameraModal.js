import React, { useRef, useState } from "react";
import { Modal, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { faceApi, validateFaceSession, faceReference, faceDiagnostic } from "../utils/faceApi";
import { runFaceCapture } from "../utils/faceCaptureFlow";
export { faceCameraConfigured } from "../utils/faceApi";

function Capture({ request, onClose, onResult, isCurrent }) {
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
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onClose}><Text style={{ color: "white", fontSize: 20, padding: 16 }}>Close — use password</Text></TouchableOpacity>
    <Text style={{ color: "white", fontSize: 18, padding: 16 }}>{request.mode === "enroll"
      ? request.legacyProof
        ? "Agree to save a new live facial template for your authenticated account. Your old template will be preserved for reference and removed from active matching. Both account passwords will be verified."
        : "Agree to send a face photo to your project's computer and store a facial template for login. You can remove it from the login screen."
      : "Face login prototype: face the camera in good lighting. Your project's computer must be running."}</Text>
    {!permission?.granted ? <TouchableOpacity onPress={askPermission}><Text style={{ color: "#DEF9C4", fontSize: 22, padding: 16 }}>Allow camera</Text></TouchableOpacity>
      : <CameraView ref={camera} style={{ flex: 1 }} facing="front" mirror={false} pictureSize={pictureSize} onCameraReady={cameraReady} onMountError={() => setError("Camera could not start. Use password login.")} />}
    {permission?.granted && <Text style={{ color: "white", padding: 8 }}>Keep your forehead, chin and both cheeks visible. Hold still while capturing.</Text>}
    {busy && <Text style={{ color: "white", padding: 12 }}>{stage} Please wait before closing.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: "white", padding: 12 }}>{error}</Text>}
    <View style={{ padding: 16 }}><TouchableOpacity accessibilityRole="button" disabled={!permission?.granted || !ready || busy} onPress={() => scan(request.mode === "enroll")}>
      <Text style={{ color: "#DEF9C4", fontSize: 22 }}>{busy ? "Checking face…" : request.mode === "enroll" ? "Agree and register my face" : error ? "Retry face login" : "Scan and sign in"}</Text>
    </TouchableOpacity></View>
  </SafeAreaView>;
}
export default function FaceCameraModal({ request, onClose, onResult, isCurrent }) {
  if (!request) return null;
  return <Modal visible animationType="slide" onRequestClose={() => onClose(request.id)}>
    {request && <Capture key={request.id} request={request} onClose={() => onClose(request.id)} onResult={onResult} isCurrent={isCurrent} />}
  </Modal>;
}
