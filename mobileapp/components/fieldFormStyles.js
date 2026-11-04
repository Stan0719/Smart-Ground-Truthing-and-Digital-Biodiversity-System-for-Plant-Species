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
  locationButton: { minHeight: 48, marginTop: 12, borderRadius: 12, backgroundColor: "#50B498", alignItems: "center", justifyContent: "center" },
  locationButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  photoButtonRow: { flexDirection: "row", gap: 10, marginTop: 5 },
  photoButton: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: "#EAF6E7", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#D5E8D1" },
  photoButtonText: { color: "#468585", fontSize: 13, fontWeight: "700" },
  photoPreview: { width: 112, height: 112, borderRadius: 10, backgroundColor: "#E8EEE6" },
  removePhotoButton: { position: "absolute", top: -6, right: -6, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E0EADF", elevation: 2 },
  submitButton: { minHeight: 52, borderRadius: 14, backgroundColor: "#468585", alignItems: "center", justifyContent: "center" },
  submitButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
