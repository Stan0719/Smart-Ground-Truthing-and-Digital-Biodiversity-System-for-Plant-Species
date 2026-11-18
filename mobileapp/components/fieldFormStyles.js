import { StyleSheet } from "react-native";

// Shared visual primitives used by Add Plant and observation entry forms.
export const fieldFormStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F9F3" },
  scrollView: { flex: 1 },
  scrollContent: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 20, paddingBottom: 50 },
  card: { width: "100%", marginBottom: 18, padding: 18, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E0EADF", elevation: 2, shadowColor: "#234B3A", shadowOpacity: 0.05, shadowRadius: 6 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#234B3A", marginBottom: 6 },
  label: { marginTop: 15, marginBottom: 7, fontSize: 13, fontWeight: "600", color: "#234B3A" },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#DCE8D6", backgroundColor: "#FAFCF9", color: "#234B3A", fontSize: 14 },
  textArea: { minHeight: 110, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: "#DCE8D6", backgroundColor: "#FAFCF9", color: "#234B3A", fontSize: 14, textAlignVertical: "top" },
  locationButton: { minHeight: 48, marginTop: 12, borderRadius: 12, backgroundColor: "#2F6B4F", alignItems: "center", justifyContent: "center" },
  locationButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  photoButtonRow: { flexDirection: "row", gap: 10, marginTop: 5 },
  photoButton: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: "#EAF6E7", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#D5E8D1" },
  photoButtonText: { color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
  qrRefreshButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: "#CDE3DC", borderRadius: 12, backgroundColor: "#EFF8F4", marginTop: 6, marginBottom: 8 },
  qrRefreshText: { color: "#28665E", fontSize: 14, fontWeight: "700" },
  photoPreview: { width: 112, height: 112, borderRadius: 10, backgroundColor: "#E8EEE6" },
  removePhotoButton: { position: "absolute", top: -6, right: -6, width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4" },
  submitButton: { minHeight: 48, borderRadius: 12, backgroundColor: "#2F6B4F", alignItems: "center", justifyContent: "center" },
  submitButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", textAlign: "center" },
});
