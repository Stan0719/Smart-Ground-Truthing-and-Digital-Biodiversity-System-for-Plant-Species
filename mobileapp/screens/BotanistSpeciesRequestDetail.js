import React, { useCallback, useRef, useState } from "react";
import { AppState, ActivityIndicator, View, Text, Image, StyleSheet, TouchableOpacity, RefreshControl, Alert } from "react-native";
import DiscoverableScrollView from "../components/DiscoverableScrollView";
import { useFocusEffect } from "@react-navigation/native";
import { fetchBotanistSpeciesRequest, fetchBotanistRecordChangeStatus, submissionStatus, canWithdrawOriginalSpecies } from "../utils/botanistRecords";
import EditAction from "../components/EditAction";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import { DetailSkeletonContent } from "../components/BotanicalSkeleton";
import { plantApi } from "../utils/plantApi";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function BotanistSpeciesRequestDetailScreen({ route, navigation }) {
  useAppTranslation();
  const accountId = route.params?.botanist?.id;
  const requestId = route.params?.requestId;
  const historicalDetail = route.params?.historicalRecordDetail === true;
  const key = `${accountId}:${requestId}`;
  const [state, setState] = useState({ key, loading: true, request: null, error: "" });
  const [revision, setRevision] = useState(0);
  const [changeInfo, setChangeInfo] = useState(null);
  const [activeSelectedChangeId, setActiveSelectedChangeId] = useState(null);
  const [changeError, setChangeError] = useState("");
  const [editAvailability, setEditAvailability] = useState("checking");
  const [cancellingEdit, setCancellingEdit] = useState(false);
  const [cancelEditError, setCancelEditError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const withdrawalInFlight = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    const subscription = AppState?.addEventListener("change", (state) => {
      if (state === "active") setRevision((value) => value + 1);
    });
    const leave = () => { active = false; subscription?.remove(); };
    setChangeInfo(null);
    setActiveSelectedChangeId(null);
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
      const selectedChangeId = route.params?.selectedChangeId == null ? null : String(route.params.selectedChangeId);
      if (selectedChangeId) fetchBotanistRecordChangeStatus(accountId, "species", requestId).then((result) => {
        if (!active) return;
        const selected = [result.pending, result.latest].find((change) =>
          change && String(change.id) === selectedChangeId);
        const exactRevision = route.params?.selectedChangeRevision != null
          ? Number(selected?.revision) === Number(route.params.selectedChangeRevision)
          : Number(selected?.revision) === 1;
        if (selected && exactRevision) setState((previous) => previous.key === key && previous.request
          ? { ...previous, request: { ...previous.request, request_status: selected.status } } : previous);
        setChangeInfo(selected && exactRevision ? selected : null);
        setActiveSelectedChangeId(result.pending && String(result.pending.id) === selectedChangeId && exactRevision
          ? selectedChangeId : null);
      }).catch((error) => {
        if (active) setChangeError(error.message);
      });
      return leave;
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
    return leave;
  }, [key, accountId, requestId, revision, historicalDetail, route.params?.historicalSnapshot,
    route.params?.selectedChangeId, route.params?.selectedChangeRevision,
    route.params?.historicalVersionStatus, route.params?.historicalVersionDate, route.params?.historicalReviewedAt,
    route.params?.historicalReviewComment, route.params?.historicalPhotos, route.params?.submissionVersionLabel,
    route.params?.historicalCurrent, route.params?.historicalSuperseded]));
  const current = state.key === key ? state : { loading: true, request: null, error: "" };
  const request = current.request;
  const refresh = () => { if (!current.loading) setRevision((value) => value + 1); };
  const canWithdraw = canWithdrawOriginalSpecies(request, accountId, historicalDetail);
  const canEditSpecies = !historicalDetail && (request?.request_status === "Approved" ||
    request?.request_status === "Correction Required" ||
    (request?.request_status === "Pending Review" && !request.reviewed_at &&
      (request.review_cycle == null || Number(request.review_cycle) === 1)));
  const canCancelSelectedEdit = route.params?.selectedChangeId != null &&
    !request?.historicalSuperseded && activeSelectedChangeId === String(route.params.selectedChangeId) &&
    ["Pending Review", "Correction Required"].includes(changeInfo?.status) &&
    (changeInfo.status === "Correction Required" || changeInfo.revision === 1) &&
    changeInfo.owner_subject === `staff:${accountId}` &&
    String(changeInfo.id) === String(route.params.selectedChangeId);
  const confirmWithdrawal = () => Alert.alert(t("speciesWithdrawal.confirmTitle"), t("speciesWithdrawal.confirmMessage"), [
    { text: t("speciesWithdrawal.keepSubmission"), style: "cancel" },
    { text: t("speciesWithdrawal.action"), style: "destructive", onPress: async () => {
      if (withdrawalInFlight.current || !canWithdraw) return;
      withdrawalInFlight.current = true;
      setWithdrawing(true);
      setWithdrawError("");
      try {
        await plantApi(`/species-requests/${encodeURIComponent(request.request_id)}/withdraw`,
          { method: "POST", expectedAccountId: accountId, body: {} });
        setState((previous) => previous.key === key && previous.request
          ? { ...previous, request: { ...previous.request, request_status: "Withdrawn" } } : previous);
        Alert.alert(t("speciesWithdrawal.successTitle"), t("speciesWithdrawal.successMessage"));
        setRevision((value) => value + 1);
      } catch (error) {
        setWithdrawError(translateUIMessage(error.message || t("speciesWithdrawal.failed")));
      } finally { withdrawalInFlight.current = false; setWithdrawing(false); }
    } },
  ]);
  const field = (label, value) => value || historicalDetail ? <View key={label} style={styles.field}><Text style={styles.label}>{t(`submissions.${label}`)}</Text><Text style={styles.value}>{value == null || value === "" ? t("recordEdits.historicalFieldUnavailable") : value}</Text></View> : null;
  const date = (value) => value ? new Date(value).toLocaleString() : "";
  return <DiscoverableScrollView style={styles.page} contentContainerStyle={styles.content}
    refreshControl={!historicalDetail ? <RefreshControl refreshing={current.loading} onRefresh={refresh} tintColor="#468585" /> : undefined}>
    {!!current.error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(current.error)}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!current.loading && !request && !current.error && <View style={styles.error}><Text style={styles.value}>{t("submissions.requestDetailsUnavailable")}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
    {!!changeError && current.request?.request_status !== "Approved" && <View style={styles.error}><Text accessibilityRole="alert" style={styles.errorText}>{translateUIMessage(changeError)}</Text></View>}
    {current.loading && !request && <DetailSkeletonContent label={t("submissions.loadingRequestDetails")} sections={2} />}
    {request && <>
      {!historicalDetail && changeInfo && !(request.request_status === "Approved" && editAvailability === "pending") && <View style={[styles.feedbackNotice, changeInfo.status === "Approved" ? styles.approvedFeedback : changeInfo.status === "Rejected" ? styles.rejectedFeedback : styles.pendingFeedback]}><Text style={styles.value}>
        {changeInfo.status === "Pending Review" ? t("recordEdits.changesPending") : changeInfo.status === "Rejected" ? t("recordEdits.changesRejected") : changeInfo.status === "Cancelled" ? t("recordEdits.cancelledStatus") : changeInfo.status === "Correction Required" ? translateLabel(changeInfo.status) : t("recordEdits.changesApproved")}
      </Text>{!!changeInfo.review_comment && <><Text style={styles.feedbackLabel}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.value}>{changeInfo.review_comment}</Text></>}</View>}
      {!!cancelEditError && <Text accessibilityRole="alert" style={styles.errorText}>{cancelEditError}</Text>}
      <View style={styles.titleRow} testID="species-detail-heading"><Text style={styles.title}>{t("submissions.speciesRecord")}</Text>
            {(canEditSpecies || canWithdraw || canCancelSelectedEdit) && <View style={styles.headingActions}>
            {canEditSpecies &&
              <EditAction testID="edit-own-species" disabled={request.request_status === "Approved" && editAvailability !== "clear"}
                labelKey={request.request_status === "Approved" && editAvailability !== "clear" ? "recordEdits.editUnavailable" : undefined}
                onPress={() => navigation.navigate("EditSpeciesRequest", { requestId, botanist: route.params?.botanist })} />}
            {canWithdraw && <TouchableOpacity testID="withdraw-original-species"
              accessibilityRole="button" accessibilityLabel={t("speciesWithdrawal.action")} disabled={withdrawing}
              style={[styles.withdrawButton, withdrawing && styles.withdrawDisabled]} onPress={confirmWithdrawal}>
              {withdrawing ? <ActivityIndicator size="small" color="#B42318" /> : <Ionicons name="trash-outline" size={21} color="#B42318" />}
            </TouchableOpacity>}
            {canCancelSelectedEdit && <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("recordEdits.cancelEditRequest")} disabled={cancellingEdit} style={[styles.deleteEditButton, cancellingEdit && { opacity: 0.65 }]} onPress={() => Alert.alert(t("recordEdits.deleteEditTitle"), t("recordEdits.deleteEditMessage"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("recordEdits.cancelEditRequest"), style: "destructive", onPress: async () => {
                setCancelEditError(""); setCancellingEdit(true);
                try {
                  await plantApi(`/record-changes/${encodeURIComponent(changeInfo.id)}/cancel`, { method: "POST", expectedAccountId: accountId, body: {} });
                  Alert.alert(t("recordEdits.cancelEditRequest"), t("recordEdits.editCancelled"));
                  if (historicalDetail) {
                    setState((previous) => previous.key === key && previous.request
                      ? { ...previous, request: { ...previous.request, request_status: "Cancelled" } } : previous);
                    setActiveSelectedChangeId(null);
                  }
                  refresh();
                } catch (error) {
                  setCancelEditError(translateUIMessage(error.message || t("recordEdits.cancelEditFailed")));
                } finally { setCancellingEdit(false); }
              } },
            ])}>
              {cancellingEdit ? <ActivityIndicator size="small" color="#B42318" /> : <Ionicons name="trash-outline" size={21} color="#B42318" />}
            </TouchableOpacity>}
            </View>}
      </View>
      <Text style={styles.subtitle}>{t("submissions.speciesRecordSubtitle")}</Text>
      <View style={styles.recordMeta} testID="species-request-record-meta">
        <View style={styles.recordMetaSummary}><View style={styles.recordMetaText}>
          <Text style={styles.reference}>{t("submissions.requestId")}</Text><Text style={styles.recordIdValue}>{request.request_id}</Text>
        </View><View style={styles.recordMetaStatus}>
          <View style={[styles.badge, submissionStatus(request.request_status) === "approved" ? styles.approved : submissionStatus(request.request_status) === "rejected" ? styles.rejected : ["withdrawn", "cancelled", "superseded"].includes(submissionStatus(request.request_status)) ? styles.neutral : styles.pending]}>
            <Text style={[styles.badgeText, submissionStatus(request.request_status) === "rejected" && styles.rejectedBadgeText]}>{request.request_status ? translateLabel(request.request_status) : t("recordEdits.historicalFieldUnavailable")}</Text>
          </View>
          {historicalDetail && <View style={styles.versionMetaRow}>
            <Text style={styles.versionPill}>{request.historicalVersionLabel}</Text>
            {request.historicalCurrent && <Text style={styles.currentVersionPill}>{t("recordEdits.currentVersionLabel")}</Text>}
            {request.historicalSuperseded && <Text style={styles.supersededVersionPill}>{t("recordEdits.supersededLabel")}</Text>}
          </View>}
        </View></View>
      </View>
      {request.request_status === "Rejected" && <Text accessibilityRole="alert" style={styles.withdrawError}>{t("recordEdits.finalRejected")}</Text>}
      {!!withdrawError && <Text accessibilityRole="alert" style={styles.withdrawError}>{withdrawError}</Text>}
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "pending" && <View style={styles.editAvailabilityNote}>
        <Text style={styles.pendingEditLabel}>{t("recordEdits.pendingEdit")}</Text>
        <Text style={styles.value}>{t("recordEdits.pendingEditExplanation")}</Text>
        {!!changeInfo?.review_comment && <Text style={styles.value}>{changeInfo.review_comment}</Text>}
      </View>}
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "checking" && <Text style={styles.value}>{t("recordEdits.checkingEditAvailability")}</Text>}
      {!historicalDetail && request.request_status === "Approved" && editAvailability === "unavailable" && <Text style={styles.errorText}>{t("recordEdits.editAvailabilityUnavailable")}</Text>}
      {historicalDetail && request.historicalSnapshotUnavailable && <View style={styles.error}><Text style={styles.value}>{t("recordEdits.originalSnapshotUnavailable")}</Text></View>}
      {!!request.review_comment && <View style={[styles.feedbackNotice, request.request_status === "Approved" ? styles.approvedFeedback : request.request_status === "Rejected" ? styles.rejectedFeedback : styles.pendingFeedback]}><Text style={styles.feedbackLabel}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.value}>{request.review_comment}</Text></View>}
      <View style={styles.section}><View style={styles.sectionHeader}><View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>01</Text></View><View style={styles.sectionHeading}><Text style={styles.heading}>{t("submissions.speciesInformation")}</Text><Text style={styles.sectionSubtitle}>{t("submissions.speciesInformationSubtitle")}</Text></View></View>
        {field("speciesScientificName", request.scientific_name)}{field("commonName", request.common_name)}
        {field("genus", request.genus_name)}{field("family", request.family_name)}
        {field("conservation", translateLabel(request.conservation_status))}
        {field("description", request.description)}{field("habitat", request.habitat)}
        {request.cultural_significance && <View style={styles.field}><Text style={styles.label}>{t("speciesDetail.traditionalAndCulturalImportance")}</Text><Text style={styles.value}>{request.cultural_significance}</Text></View>}
      </View>
      <View style={styles.section}><View style={styles.sectionHeader}><View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>02</Text></View><View style={styles.sectionHeading}><Text style={styles.heading}>{t("submissions.speciesPhoto")}</Text><Text style={styles.sectionSubtitle}>{t("submissions.speciesPhotoSubtitle")}</Text></View></View>
        {request.photo ? <Image source={request.photo} style={styles.photo} resizeMode="contain" accessibilityLabel={t("submissions.photo")} />
          : <Text style={styles.missingPhoto}>{t("recordEdits.noPhotos")}</Text>}
      </View>
      <View style={styles.section}><View style={styles.sectionHeader}><View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>03</Text></View><View style={styles.sectionHeading}><Text style={styles.heading}>{t("submissions.reviewInformation")}</Text></View></View>
        {field("requestId", String(request.request_id))}{field("submitted", date(request.submitted_at))}
        {field("status", translateLabel(request.request_status))}{field("reviewed", date(request.reviewed_at))}
      </View>
    </>}
  </DiscoverableScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { padding: 16, gap: 14, width: "100%", maxWidth: 820, alignSelf: "center", paddingBottom: 45 },
  photo: { width: "100%", height: 240, borderRadius: 12, backgroundColor: "#F7FBF4" },
  reference: { color: "#468585", fontSize: 12, fontWeight: "700" },
  recordIdValue: { marginTop: 4, color: "#234B3A", fontSize: 14, fontWeight: "700" },
  title: { fontSize: 25, fontWeight: "700", color: "#234B3A", flexShrink: 1 },
  subtitle: { color: "#718078", fontSize: 14, lineHeight: 20 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  recordMeta: { padding: 14, borderRadius: 14, backgroundColor: "#E8F2E4" },
  recordMetaSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  recordMetaText: { flex: 1, minWidth: 0 },
  recordMetaStatus: { maxWidth: "58%", alignItems: "flex-end", gap: 6 },
  editAvailabilityNote: { backgroundColor: "#FFF7E8", borderWidth: 1, borderColor: "#EAD9B5", borderRadius: 12, padding: 12, gap: 5 },
  pendingEditLabel: { color: "#77501D", fontSize: 12, fontWeight: "700" },
  badge: { maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  pending: { backgroundColor: "#F4E7D2" }, approved: { backgroundColor: "#D8EBD9" }, rejected: { backgroundColor: "#B42318" }, neutral: { backgroundColor: "#F4E9E6" },
  badgeText: { color: "#234B3A", fontWeight: "700", fontSize: 11, textAlign: "center", flexShrink: 1 }, rejectedBadgeText: { color: "#FFFFFF" },
  withdrawButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4" },
  withdrawDisabled: { opacity: 0.65 },
  withdrawError: { color: "#A34436", fontSize: 13, lineHeight: 20 },
  versionMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  versionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#234B3A", backgroundColor: "#E8F2E4", fontSize: 11, fontWeight: "700" },
  currentVersionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#FFFFFF", backgroundColor: "#468585", fontSize: 11, fontWeight: "700" },
  supersededVersionPill: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, color: "#56625A", backgroundColor: "#E7EBE6", fontSize: 11, fontWeight: "700" },
  missingPhoto: { color: "#718078", fontSize: 13 },
  section: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2EDE0" },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#EAF0E6" },
  sectionNumber: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E8F2E4" },
  sectionNumberText: { color: "#468585", fontSize: 13, fontWeight: "700" },
  sectionHeading: { flex: 1, minWidth: 0, marginLeft: 12 },
  sectionSubtitle: { marginTop: 4, color: "#718078", fontSize: 11, lineHeight: 16 },
  heading: { color: "#234B3A", fontSize: 17, fontWeight: "700" },
  field: { marginBottom: 16, gap: 5 }, label: { color: "#718078", fontSize: 12, fontWeight: "600" },
  feedbackNotice: { borderRadius: 12, padding: 12, gap: 4, borderWidth: 1 },
  feedbackLabel: { color: "#234B3A", fontSize: 13, fontWeight: "700" },
  approvedFeedback: { backgroundColor: "#E8F3ED", borderColor: "#C9DEC9" },
  pendingFeedback: { backgroundColor: "#FFF7E8", borderColor: "#EAD9B5" },
  rejectedFeedback: { backgroundColor: "#FEF2F1", borderColor: "#E8B4B0" },
  value: { color: "#234B3A", fontSize: 15, lineHeight: 23 },
  error: { backgroundColor: "#FFF2EB", borderRadius: 12, padding: 15, gap: 12 }, errorText: { color: "#A34436", lineHeight: 21 },
  retry: { alignSelf: "flex-start", padding: 12, backgroundColor: "#468585", borderRadius: 10 }, retryText: { color: "#FFFFFF", fontWeight: "700" },
  deleteEditButton: { width: 44, height: 44, alignSelf: "flex-end", alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4" },
});
