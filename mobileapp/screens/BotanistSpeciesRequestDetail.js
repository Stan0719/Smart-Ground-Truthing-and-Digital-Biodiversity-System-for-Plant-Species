import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Image, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { fetchBotanistSpeciesRequest, fetchBotanistRecordChanges, submissionStatus } from "../utils/botanistRecords";
import EditAction from "../components/EditAction";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";

export default function BotanistSpeciesRequestDetailScreen({ route, navigation }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const requestId = route.params?.requestId;
  const key = `${accountId}:${requestId}`;
  const [state, setState] = useState({ key, loading: true, request: null, error: "" });
  const [revision, setRevision] = useState(0);
  const [changeInfo, setChangeInfo] = useState(null);
  const [changeError, setChangeError] = useState("");
  useFocusEffect(useCallback(() => {
    let active = true;
    setChangeInfo(null);
    setChangeError("");
    setState((previous) => ({ key, request: previous.key === key ? previous.request : null, loading: true, error: "" }));
    fetchBotanistSpeciesRequest(accountId, requestId).then((request) => {
      if (active) setState({ key, request, loading: false, error: "" });
    }).catch((error) => {
      if (active) setState((previous) => ({ key, request: [401, 403].includes(error.status) || ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error.code) ? null : previous.request,
        loading: false, error: error.message }));
    });
    fetchBotanistRecordChanges(accountId).then((changes) => {
      if (active) setChangeInfo(changes.find((change) => String(change.base_snapshot?.request_id) === String(requestId)) || null);
    }).catch((error) => { if (active) setChangeError(error.message); });
    return () => { active = false; };
  }, [key, accountId, requestId, revision]));
  const current = state.key === key ? state : { loading: true, request: null, error: "" };
  const request = current.request;
  const refresh = () => { if (!current.loading) setRevision((value) => value + 1); };
  const field = (label, value) => value ? <View key={label} style={styles.field}><Text style={styles.label}>{t(`submissions.${label}`)}</Text><Text style={styles.value}>{value}</Text></View> : null;
  const date = (value) => value ? new Date(value).toLocaleString() : "";
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}
    refreshControl={<RefreshControl refreshing={current.loading} onRefresh={refresh} tintColor="#468585" />}>
    {!!current.error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(current.error)}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!!changeError && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(changeError)}</Text></View>}
    {current.loading && !request && <ActivityIndicator size="large" color="#468585" accessibilityLabel={t("botanistRecords.loading")} />}
    {request && <>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("RecordVersionHistory", { kind: "species", targetId: request.request_id, botanist: route.params?.botanist })}>
        <Text style={styles.value}>{t("recordEdits.versionHistory")} ›</Text></TouchableOpacity>
      {changeInfo && <View style={styles.error}><Text style={styles.value}>
        {changeInfo.status === "Pending Review" ? t("recordEdits.changesPending") : changeInfo.status === "Rejected" ? t("recordEdits.changesRejected") : t("recordEdits.changesApproved")}
      </Text>{!!changeInfo.review_comment && <Text style={styles.value}>{changeInfo.review_comment}</Text>}</View>}
      <View style={styles.hero}>
        {request.photo && <Image source={request.photo} style={styles.photo} resizeMode="cover" accessibilityLabel={t("submissions.photo")} />}
        <View style={styles.heroText}>
          <Text style={styles.reference}>{t("submissions.requestId")} {request.request_id}</Text>
          <View style={styles.titleRow}><Text style={styles.title}>{request.scientific_name}</Text>
            {["Approved", "Pending Review", "Rejected", "Correction Required"].includes(request.request_status) &&
              <EditAction testID="edit-own-species" onPress={() => navigation.navigate("EditSpeciesRequest", { requestId, botanist: route.params?.botanist })} />}
          </View>
          {!!request.common_name && <Text style={styles.common}>{request.common_name}</Text>}
          <View style={[styles.badge, submissionStatus(request.request_status) === "approved" ? styles.approved : submissionStatus(request.request_status) === "rejected" ? styles.rejected : styles.pending]}>
            <Text style={styles.badgeText}>{translateLabel(request.request_status)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.section}><Text style={styles.heading}>{t("submissions.speciesInformation")}</Text>
        {field("speciesScientificName", request.scientific_name)}{field("commonName", request.common_name)}
        {field("genus", request.genus_name)}{field("family", request.family_name)}
        {field("conservation", translateLabel(request.conservation_status))}
        {field("description", request.description)}{field("habitat", request.habitat)}
      </View>
      <View style={styles.section}><Text style={styles.heading}>{t("submissions.reviewInformation")}</Text>
        {field("requestId", String(request.request_id))}{field("submitted", date(request.submitted_at))}
        {field("status", translateLabel(request.request_status))}{field("reviewed", date(request.reviewed_at))}
        {field("reviewComments", request.review_comment)}
      </View>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { padding: 20, gap: 18, width: "100%", maxWidth: 820, alignSelf: "center", paddingBottom: 45 },
  hero: { backgroundColor: "#FFFFFF", borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "#E2EDE0" },
  photo: { width: "100%", height: 240 }, heroText: { padding: 20, gap: 8 },
  reference: { color: "#468585", fontSize: 12, fontWeight: "700" },
  title: { fontSize: 25, fontWeight: "700", fontStyle: "italic", color: "#234B3A", flexShrink: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  common: { color: "#718078", fontSize: 16 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, marginTop: 4 },
  pending: { backgroundColor: "#FFF1D6" }, approved: { backgroundColor: "#E1F4E3" }, rejected: { backgroundColor: "#FCE2E2" },
  badgeText: { color: "#234B3A", fontWeight: "700", fontSize: 12 },
  section: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "#E2EDE0", gap: 15 },
  heading: { color: "#234B3A", fontSize: 17, fontWeight: "700", marginBottom: 3 },
  field: { gap: 5 }, label: { color: "#718078", fontSize: 12, fontWeight: "600" },
  value: { color: "#234B3A", fontSize: 15, lineHeight: 23 },
  error: { backgroundColor: "#FFF2EB", borderRadius: 12, padding: 15, gap: 12 }, errorText: { color: "#A34436", lineHeight: 21 },
  retry: { alignSelf: "flex-start", padding: 12, backgroundColor: "#468585", borderRadius: 10 }, retryText: { color: "#FFFFFF", fontWeight: "700" },
});
