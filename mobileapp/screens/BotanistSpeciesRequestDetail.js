import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Image, StyleSheet, TouchableOpacity, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { fetchBotanistSpeciesRequest, fetchBotanistRecordChangeStatus, submissionStatus } from "../utils/botanistRecords";
import EditAction from "../components/EditAction";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";

export default function BotanistSpeciesRequestDetailScreen({ route, navigation }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const requestId = route.params?.requestId;
  const historicalDetail = route.params?.historicalRecordDetail === true;
  const key = `${accountId}:${requestId}`;
  const [state, setState] = useState({ key, loading: true, request: null, error: "" });
  const [revision, setRevision] = useState(0);
  const [changeInfo, setChangeInfo] = useState(null);
  const [changeError, setChangeError] = useState("");
  const [editAvailability, setEditAvailability] = useState("checking");
  useFocusEffect(useCallback(() => {
    let active = true;
    setChangeInfo(null);
    setChangeError("");
    if (historicalDetail) {
      setEditAvailability("not-required");
      const suppliedSnapshot = route.params?.historicalSnapshot;
      const snapshot = suppliedSnapshot && typeof suppliedSnapshot === "object" ? suppliedSnapshot : {};
      setState({ key, request: {
        ...snapshot, request_id: snapshot.request_id ?? requestId,
        historicalSnapshotUnavailable: Object.keys(snapshot).length === 0,
        request_status: route.params?.historicalVersionStatus || "",
        submitted_at: route.params?.historicalVersionDate,
        reviewed_at: route.params?.historicalReviewedAt,
        review_comment: route.params?.historicalReviewComment,
        photo: route.params?.historicalPhotos?.[0],
        historicalVersionLabel: route.params?.submissionVersionLabel,
        historicalCurrent: route.params?.historicalCurrent === true,
        historicalSuperseded: route.params?.historicalSuperseded === true,
      }, loading: false, error: "" });
      return () => { active = false; };
    }
    setEditAvailability("checking");
    setState((previous) => ({ key, request: previous.key === key ? previous.request : null, loading: true, error: "" }));
    fetchBotanistSpeciesRequest(accountId, requestId).then((request) => {
      if (active) setState({ key, request, loading: false, error: "" });
    }).catch((error) => {
      if (active) setState((previous) => ({ key, request: [401, 403].includes(error.status) || ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error.code) ? null : previous.request,
        loading: false, error: error.message }));
    });
    fetchBotanistRecordChangeStatus(accountId, "species", requestId).then((result) => {
      if (!active) return;
      setChangeInfo(result.pending || result.latest);
      setEditAvailability(!result.available ? "unavailable" : result.pending ? "pending" : "clear");
    }).catch((error) => {
      if (!active) return;
      setChangeError(error.message);
      setEditAvailability("unavailable");
    });
    return () => { active = false; };
  }, [key, accountId, requestId, revision, historicalDetail, route.params?.historicalSnapshot,
    route.params?.historicalVersionStatus, route.params?.historicalVersionDate, route.params?.historicalReviewedAt,
    route.params?.historicalReviewComment, route.params?.historicalPhotos, route.params?.submissionVersionLabel,
    route.params?.historicalCurrent, route.params?.historicalSuperseded]));
  const current = state.key === key ? state : { loading: true, request: null, error: "" };
  const request = current.request;
  const refresh = () => { if (!current.loading) setRevision((value) => value + 1); };
  const field = (label, value) => value || historicalDetail ? <View key={label} style={styles.field}><Text style={styles.label}>{t(`submissions.${label}`)}</Text><Text style={styles.value}>{value == null || value === "" ? t("recordEdits.historicalFieldUnavailable") : value}</Text></View> : null;
  const date = (value) => value ? new Date(value).toLocaleString() : "";
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}
    refreshControl={!historicalDetail ? <RefreshControl refreshing={current.loading} onRefresh={refresh} tintColor="#468585" /> : undefined}>
    {!!current.error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(current.error)}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!current.loading && !request && !current.error && <View style={styles.error}><Text style={styles.value}>{t("submissions.requestDetailsUnavailable")}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!!changeError && current.request?.request_status !== "Approved" && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(changeError)}</Text></View>}
    {current.loading && !request && <DetailSkeletonContent label={t("submissions.loadingRequestDetails")} sections={2} />}
    {request && <>
      {!historicalDetail && <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("RecordVersionHistory", { kind: "species", targetId: request.request_id, botanist: route.params?.botanist })}>
        <Text style={styles.value}>{t("recordEdits.versionHistory")} ›</Text></TouchableOpacity>
      }
      {!historicalDetail && changeInfo && !(request.request_status === "Approved" && editAvailability === "pending") && <View style={styles.error}><Text style={styles.value}>
        {changeInfo.status === "Pending Review" ? t("recordEdits.changesPending") : changeInfo.status === "Rejected" ? t("recordEdits.changesRejected") : t("recordEdits.changesApproved")}
      </Text>{!!changeInfo.review_comment && <Text style={styles.value}>{changeInfo.review_comment}</Text>}</View>}
      <View style={styles.hero}>
        {request.photo && <Image source={request.photo} style={styles.photo} resizeMode="cover" accessibilityLabel={t("submissions.photo")} />}
        {historicalDetail && !request.photo && <Text style={styles.missingPhoto}>{t("recordEdits.noPhotos")}</Text>}
        <View style={styles.heroText}>
          <Text style={styles.reference}>{t("submissions.requestId")} {request.request_id}</Text>
          <View style={styles.titleRow}><Text style={styles.title}>{request.scientific_name || t("recordEdits.historicalFieldUnavailable")}</Text>
            {!historicalDetail && ["Approved", "Pending Review", "Rejected", "Correction Required"].includes(request.request_status) &&
              <EditAction testID="edit-own-species" disabled={request.request_status === "Approved" && editAvailability !== "clear"}
                labelKey={request.request_status === "Approved" && editAvailability !== "clear" ? "recordEdits.editUnavailable" : undefined}
                onPress={() => navigation.navigate("EditSpeciesRequest", { requestId, botanist: route.params?.botanist })} />}
          </View>
          {!!request.common_name && <Text style={styles.common}>{request.common_name}</Text>}
          {historicalDetail && <View style={styles.versionMetaRow}>
            <Text style={styles.versionPill}>{request.historicalVersionLabel}</Text>
            {request.historicalCurrent && <Text style={styles.currentVersionPill}>{t("recordEdits.currentVersionLabel")}</Text>}
            {request.historicalSuperseded && <Text style={styles.supersededVersionPill}>{t("recordEdits.supersededLabel")}</Text>}
          </View>}
          <View style={[styles.badge, submissionStatus(request.request_status) === "approved" ? styles.approved : submissionStatus(request.request_status) === "rejected" ? styles.rejected : styles.pending]}>
            <Text style={styles.badgeText}>{request.request_status ? translateLabel(request.request_status) : t("recordEdits.historicalFieldUnavailable")}</Text>
          </View>
        </View>
      </View>
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "pending" && <View style={styles.editAvailabilityNote}>
        <Text style={styles.pendingEditLabel}>{t("recordEdits.pendingEdit")}</Text>
        <Text style={styles.value}>{t("recordEdits.pendingEditExplanation")}</Text>
        {!!changeInfo?.review_comment && <Text style={styles.value}>{changeInfo.review_comment}</Text>}
      </View>}
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "checking" && <Text style={styles.value}>{t("recordEdits.checkingEditAvailability")}</Text>}
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "unavailable" && <Text style={styles.errorText}>{t("recordEdits.editAvailabilityUnavailable")}</Text>}
      {historicalDetail && request.historicalSnapshotUnavailable && <View style={styles.error}><Text style={styles.value}>{t("recordEdits.originalSnapshotUnavailable")}</Text></View>}
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
  editAvailabilityNote: { backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#EAD9B5", borderRadius: 12, padding: 12, gap: 5 },
  pendingEditLabel: { color: "#77501D", fontSize: 12, fontWeight: "700" },
  badge: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, marginTop: 4 },
  pending: { backgroundColor: "#FFF1D6" }, approved: { backgroundColor: "#E1F4E3" }, rejected: { backgroundColor: "#FCE2E2" },
  badgeText: { color: "#234B3A", fontWeight: "700", fontSize: 12 },
  versionMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  versionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#234B3A", backgroundColor: "#E8F2E4", fontSize: 11, fontWeight: "700" },
  currentVersionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#FFFFFF", backgroundColor: "#468585", fontSize: 11, fontWeight: "700" },
  supersededVersionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#56625A", backgroundColor: "#E7EBE6", fontSize: 11, fontWeight: "700" },
  missingPhoto: { padding: 16, color: "#718078", fontSize: 13 },
  section: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "#E2EDE0", gap: 15 },
  heading: { color: "#234B3A", fontSize: 17, fontWeight: "700", marginBottom: 3 },
  field: { gap: 5 }, label: { color: "#718078", fontSize: 12, fontWeight: "600" },
  value: { color: "#234B3A", fontSize: 15, lineHeight: 23 },
  error: { backgroundColor: "#FFF2EB", borderRadius: 12, padding: 15, gap: 12 }, errorText: { color: "#A34436", lineHeight: 21 },
  retry: { alignSelf: "flex-start", padding: 12, backgroundColor: "#468585", borderRadius: 10 }, retryText: { color: "#FFFFFF", fontWeight: "700" },
});
