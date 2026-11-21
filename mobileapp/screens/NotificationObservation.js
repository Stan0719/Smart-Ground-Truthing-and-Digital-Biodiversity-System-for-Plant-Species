import { useAppTranslation, t, translateLabel, translateUIMessage, translateFieldValue, translateFieldLabel, formatDateTime } from "../translations/i18n";
import React, { useCallback, useRef, useState } from "react";
import { AppState, ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ownedNotificationObservation } from "../utils/botanistNotifications";
import { getObservationRecorderDisplayName, plantApi, plantAssetSources } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { mobileApiUrl } from "../utils/apiConfiguration";
import Ionicons from "@expo/vector-icons/Ionicons";
import { observationContentFields, observationDetailContent, canStartObservationEdit, canWithdrawOriginalObservation } from "../utils/observationDetails";
import EditAction from "../components/EditAction";
import { watchStatus } from "../utils/statusRefresh";

const fieldLabel = (field) => ["zone", "altitudeM"].includes(field) ? t(`recordEdits.${field}`) : translateFieldLabel(field);
const statusTone = (status) => status === "Approved" ? styles.approvedBadge : status === "Rejected" ? styles.rejectedBadge : ["Cancelled", "Withdrawn"].includes(status) ? styles.terminalBadge
  : status === "Correction Required" ? styles.correctionBadge : status === "Superseded" ? styles.supersededBadge : styles.pendingBadge;
function StatusBadge({ status }) {
  useAppTranslation();
  return <View style={[styles.badge, statusTone(status)]} testID="observation-status-badge">
    <Text style={[styles.badgeText, status === "Approved" && styles.approvedBadgeText,
      status === "Rejected" && styles.rejectedBadgeText, ["Cancelled", "Withdrawn"].includes(status) && styles.terminalBadgeText, status === "Superseded" && styles.supersededBadgeText]}>{translateLabel(status)}</Text>
  </View>;
}

export default function NotificationObservation({ route, navigation, user }) {
  useAppTranslation();
  const [state, setState] = useState({ loading: true, observation: null, editHistory: null, editHistoryError: "", photoToken: "", error: "",
    versioningActive: false, editCapabilityVerified: false });
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [failedPhotoUris, setFailedPhotoUris] = useState([]);
  const [retry, setRetry] = useState(0);
  const [cancellingEdit, setCancellingEdit] = useState(false);
  const [cancelEditError, setCancelEditError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState("");
  const withdrawalInFlight = useRef(false);
  const cancelEditInFlight = useRef(false);
  const accountId = user?.role === "botanist" ? user.id : null;
  const observationId = route.params?.observationId;
  const readOnlyApproved = route.params?.readOnlyApproved === true;
  useFocusEffect(useCallback(() => {
    let active = true;
    setSelectedPhoto(null);
    setFailedPhotoUris([]);
    setState({ loading: true, observation: null, editHistory: null, editHistoryError: "", error: "",
      versioningActive: false, editCapabilityVerified: false });
    if (!accountId) { setState({ loading: false, observation: null, editHistory: null, error: "Sign in as the Botanist who submitted this observation.",
      versioningActive: false, editCapabilityVerified: false }); return undefined; }
    let pending = null;
    const load = (background = false) => {
      if (pending) return pending;
      const observationRead = readOnlyApproved
        ? plantApi(`/observations/${encodeURIComponent(observationId)}`, { expectedAccountId: accountId })
          .then(async (payload) => {
            const observation = payload?.observation;
            if (observation?.status !== "Approved") throw Error(t("recordEdits.informationNotAvailable"));
            const assets = (observation.assets || []).filter((asset) => asset?.id && ["image/jpeg", "image/png"].includes(String(asset.content_type || "").toLowerCase()));
            const sources = assets.length ? await plantAssetSources(assets, accountId).catch(() => []) : [];
            return { ...observation, photos: sources.map((source, index) => ({ ...source, id: assets[index].id })) };
          })
        : ownedNotificationObservation(accountId, observationId);
      const capabilityRead = readOnlyApproved ? Promise.resolve({ available: false, versioning_available: false })
        : plantApi("/observation-edits/capabilities", { expectedAccountId: accountId }).catch(() => null);
      pending = Promise.all([observationRead, capabilityRead]).then(async ([observation, capability]) => {
        let editHistory = null, editHistoryError = "";
        if (!readOnlyApproved && capability?.available) {
          try { editHistory = await plantApi(`/observations/${encodeURIComponent(observationId)}/edit-history`, { expectedAccountId: accountId }); }
          catch (error) { if (![404, 503].includes(error?.status)) editHistoryError = error?.message || t("observationEdits.historyUnavailable"); }
        }
        const selectedPhotoContext = Boolean(route.params?.observationVersionId || route.params?.editRequestId || route.params?.observationVersionSnapshot);
        const photoToken = selectedPhotoContext && (editHistory?.versions?.some((version) => version.photo_ids?.length) ||
          editHistory?.edits?.some((edit) => edit.retained_photo_ids?.length || edit.added_photo_count) ||
          route.params?.observationVersionSnapshot?.photoIds?.length)
          ? await faceSession.withToken(async (token) => token).catch(() => "") : "";
        if (active) setState((previous) => {
          const retainHistory = background && (editHistoryError || !capability);
          return { loading: false, observation, editHistory: retainHistory ? previous.editHistory : editHistory,
            editHistoryError, photoToken: photoToken || (retainHistory ? previous.photoToken : ""), error: "",
            versioningActive: capability?.versioning_available === true || Boolean(retainHistory && previous.versioningActive),
            editCapabilityVerified: Boolean(capability) };
        });
      }).catch((error) => {
        if (active && (!background || [401, 403, 404].includes(error?.status) ||
          ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error?.code)))
          setState({ loading: false, observation: null, editHistory: null, error: `${error.message} The record may be unavailable or you may be offline.`,
          versioningActive: true, editCapabilityVerified: false });
      }).finally(() => { pending = null; });
      return pending;
    };
    void load();
    const stop = watchStatus(AppState, () => load(true));
    return () => { active = false; stop(); };
  }, [accountId, observationId, retry, readOnlyApproved, route.params?.observationVersionSnapshot, route.params?.observationVersionId, route.params?.editRequestId]));

  const row = state.observation?.owner_subject === `staff:${accountId}` ||
    (readOnlyApproved && state.observation?.status === "Approved") ? state.observation : null;
  const edits = state.editHistory?.edits || [];
  const activeEdit = edits.find((edit) => ["Pending Review", "Correction Required"].includes(edit.status));
  const selectedVersion = state.editHistory?.versions?.find((version) => String(version.id) === String(route.params?.observationVersionId));
  const selectedSnapshot = route.params?.observationVersionSnapshot;
  const originalSelection = Boolean(selectedSnapshot?.original || (selectedVersion &&
    (["original", "legacy_baseline"].includes(selectedVersion.submission_type) || Number(selectedVersion.version_number) === 0)));
  const historicalSelection = Boolean(selectedSnapshot || selectedVersion);
  const selectedEdit = originalSelection ? null : route.params?.editRequestId
    ? edits.find((edit) => String(edit.id) === String(route.params.editRequestId))
    : selectedVersion?.edit_request_id ? edits.find((edit) => String(edit.id) === String(selectedVersion.edit_request_id)) : null;
  const selectedEditIsCurrentRequest = Boolean(!originalSelection && selectedEdit && activeEdit?.id === selectedEdit.id &&
    (!selectedVersion || (selectedVersion.request_revision != null
      ? Number(selectedVersion.request_revision) === Number(selectedEdit.revision)
      : Number(selectedEdit.revision) === 1)));
  const requestSelection = !originalSelection && Boolean(route.params?.editRequestId);
  const selectedDetail = historicalSelection || requestSelection;
  const activeOriginalSnapshot = Boolean(selectedSnapshot?.original && selectedSnapshot.status === row?.status &&
    ["Pending Review", "Correction Required"].includes(row?.status));
  const displayContent = observationDetailContent(row, selectedSnapshot, selectedVersion, selectedEdit, selectedDetail);
  const displayStatus = selectedDetail
    ? (activeOriginalSnapshot && row?.status === "Withdrawn" ? "Withdrawn"
      : selectedEditIsCurrentRequest ? selectedEdit.status : selectedVersion?.status || selectedEdit?.status || selectedSnapshot?.status || row?.status)
    : row?.status;
  const displayDate = selectedDetail
    ? selectedSnapshot?.createdAt || selectedVersion?.submitted_at || selectedVersion?.baseline_captured_at ||
      selectedVersion?.created_at || selectedEdit?.created_at || selectedVersion?.approved_at || row?.observed_at || row?.created_at
    : row?.observed_at || row?.created_at;
  // An active edit request has a separate review from the current Observation.
  const reviewStatus = selectedDetail ? displayStatus : row?.status;
  const reviewComment = selectedDetail ? selectedVersion?.review_comment || selectedEdit?.review_comment || selectedSnapshot?.reviewComment || "" : row?.review_comment;
  const reviewedAt = selectedDetail ? selectedVersion?.reviewed_at || selectedEdit?.reviewed_at || selectedSnapshot?.reviewedAt || null : row?.reviewed_at;
  const reviewedBy = selectedDetail ? selectedVersion?.reviewed_by || selectedEdit?.reviewed_by || selectedSnapshot?.reviewedBy || null : row?.reviewed_by;
  const photoApi = `${mobileApiUrl("plant")}/api`;
  const photoHeaders = state.photoToken ? { Authorization: `Bearer ${state.photoToken}` } : undefined;
  const displayPhotos = selectedDetail
    ? selectedVersion
      ? photoHeaders && selectedVersion.photo_ids?.length
        ? selectedVersion.photo_ids.map((id, index) => ({ id, uri: `${photoApi}/observation-versions/${encodeURIComponent(selectedVersion.id)}/photos/${index}`, headers: photoHeaders }))
        : selectedSnapshot?.useCurrentPhotos ? row?.photos || [] : []
      : selectedEdit && photoHeaders
        ? [
          ...(selectedEdit.retained_photo_ids || []).map((id) => ({ id, uri: `${photoApi}/assets/${encodeURIComponent(id)}?scope=mine`, headers: photoHeaders })),
          ...Array.from({ length: Number(selectedEdit.added_photo_count) || 0 }, (_, index) => ({ id: `${selectedEdit.id}:added:${index}`, uri: `${photoApi}/observation-edits/${encodeURIComponent(selectedEdit.id)}/photos/${index}`, headers: photoHeaders })),
        ]
        : selectedSnapshot?.photoIds?.length && photoHeaders
          ? selectedSnapshot.photoIds.map((id) => ({ id, uri: `${photoApi}/assets/${encodeURIComponent(id)}?scope=mine`, headers: photoHeaders }))
          : selectedSnapshot?.useCurrentPhotos ? row?.photos || [] : []
    : row?.photos || [];
  const photos = displayPhotos.filter((photo) => photo?.uri && !failedPhotoUris.includes(photo.uri));
  const locationFields = new Set(["latitude", "longitude", "accuracy_m", "zone", "altitudeM"]);
  const canEdit = !readOnlyApproved && state.editCapabilityVerified &&
    canStartObservationEdit(row, state.editHistory, activeEdit, selectedDetail, accountId, state.versioningActive);
  const canWithdraw = !readOnlyApproved && Boolean(state.editHistory) &&
    canWithdrawOriginalObservation(row, activeEdit, selectedDetail && !activeOriginalSnapshot, accountId);
  const canViewPlantSubmission = row?.origin_type === "initial_registration" && row.owner_subject === `staff:${accountId}` &&
    (!selectedDetail || originalSelection);
  const canCancelSelectedEdit = selectedDetail && row?.status === "Approved" && selectedEditIsCurrentRequest &&
    selectedEdit.owner_subject === `staff:${accountId}` &&
    ["Pending Review", "Correction Required"].includes(selectedEdit.status) &&
    (selectedEdit.status === "Correction Required" || selectedEdit.revision === 1);
  const confirmWithdrawal = () => Alert.alert(t("observationWithdrawal.confirmTitle"), t("observationWithdrawal.confirmMessage"), [
    { text: t("observationWithdrawal.keepSubmission"), style: "cancel" },
    { text: t("observationWithdrawal.action"), style: "destructive", onPress: async () => {
      if (withdrawalInFlight.current || !canWithdraw) return;
      withdrawalInFlight.current = true;
      setWithdrawing(true);
      setWithdrawError("");
      try {
        await plantApi(`/observations/${encodeURIComponent(row.id)}/withdraw`,
          { method: "POST", expectedAccountId: accountId, body: {} });
        Alert.alert(t("observationWithdrawal.successTitle"), t("observationWithdrawal.successMessage"));
        setRetry((value) => value + 1);
      } catch (error) {
        setWithdrawError(translateUIMessage(error.message || t("observationWithdrawal.failed")));
      } finally {
        withdrawalInFlight.current = false;
        setWithdrawing(false);
      }
    } },
  ]);
  const confirmCancelEdit = () => Alert.alert(t("recordEdits.deleteEditTitle"), t("observationEdits.cancelConfirmation"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("recordEdits.cancelEditRequest"), style: "destructive", onPress: async () => {
      if (cancelEditInFlight.current || !canCancelSelectedEdit) return;
      cancelEditInFlight.current = true;
      setCancelEditError(""); setCancellingEdit(true);
      try {
        await plantApi(`/observation-edits/${encodeURIComponent(selectedEdit.id)}/cancel`, { method: "POST", expectedAccountId: accountId, body: {} });
        Alert.alert(t("recordEdits.cancelEditRequest"), t("recordEdits.editCancelled"));
        setRetry((value) => value + 1);
      } catch (error) { setCancelEditError(translateUIMessage(error.message || t("recordEdits.cancelEditFailed"))); }
      finally { cancelEditInFlight.current = false; setCancellingEdit(false); }
    } },
  ]);
  const sectionHeader = (number, title, subtitle) => <View style={styles.sectionHeader}>
    <View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>{number}</Text></View>
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}</View>
  </View>;
  const contentField = (field) => {
    const value = displayContent[field];
    return value != null && value !== "" ? <View key={field} style={styles.field}>
      <Text style={styles.label}>{fieldLabel(field)}</Text>
      <Text style={styles.text}>{translateFieldValue(field, String(value))}</Text>
    </View> : null;
  };
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    {state.loading && <ActivityIndicator color="#468585" />}
    {!!state.error && <View style={styles.card}>
      <Text style={styles.error} accessibilityRole="alert">{translateUIMessage(state.error)}</Text>
      <TouchableOpacity style={styles.button} onPress={() => setRetry((value) => value + 1)}><Text style={styles.buttonText}>{t("common.tryAgain")}</Text></TouchableOpacity>
    </View>}
    {row && <>
    <View style={styles.titleRow} testID="observation-detail-heading">
      <Text style={styles.title}>{t("notificationObservation.recordTitle")}</Text>
      {(canEdit || canWithdraw || canCancelSelectedEdit) && <View style={styles.headingActions}>
      {canEdit && <EditAction testID="edit-own-observation" onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id, editRequestMode: true })} />}
      {canWithdraw && <TouchableOpacity testID="withdraw-original-observation"
        accessibilityRole="button" accessibilityLabel={t("observationWithdrawal.action")} disabled={withdrawing}
        style={[styles.deleteEditButton, withdrawing && styles.disabledButton]} onPress={confirmWithdrawal}>
        {withdrawing ? <ActivityIndicator size="small" color="#B42318" /> : <Ionicons name="trash-outline" size={21} color="#B42318" />}
      </TouchableOpacity>}
      {canCancelSelectedEdit && <TouchableOpacity testID="cancel-observation-edit-request"
        style={[styles.deleteEditButton, cancellingEdit && styles.disabledButton]} disabled={cancellingEdit}
        accessibilityRole="button" accessibilityLabel={t("recordEdits.cancelEditRequest")} onPress={confirmCancelEdit}>
        {cancellingEdit ? <ActivityIndicator size="small" color="#B42318" /> : <Ionicons name="trash-outline" size={21} color="#B42318" />}
      </TouchableOpacity>}
      </View>}
    </View>
    <Text style={styles.subtitle}>{selectedDetail ? t("botanistPlantDetail.readOnlyVersionSubtitle") : t("notificationObservation.recordSubtitle")}</Text>
    {!!cancelEditError && <Text style={styles.error} accessibilityRole="alert">{cancelEditError}</Text>}
    {displayStatus === "Rejected" && <View style={styles.rejectedBanner} testID="observation-rejected-banner">
      <Ionicons name="close-circle" size={22} color="#B42318" />
      <Text style={styles.rejectedBannerText}>{t("notificationObservation.rejectedTitle")}</Text>
    </View>}
    <View style={[styles.recordMeta, displayStatus === "Rejected" && styles.rejectedRecordMeta]} testID="observation-record-meta">
      <View style={styles.recordIdHeader}>
        <Text style={styles.recordId}>{t("myObservations.observationId")}</Text>
        {selectedDetail && <View style={styles.versionMetaRow}>
          <Text style={styles.versionPill}>{selectedSnapshot?.original ? t("recordEdits.originalLabel")
            : selectedSnapshot?.editNumber ? t("recordEdits.editNumber", { number: selectedSnapshot.editNumber })
              : t("observationEdits.versionLabel", { number: selectedSnapshot?.versionNumber || selectedVersion?.version_number || selectedEdit?.version_number || 1 })}</Text>
          {selectedSnapshot?.current && <Text style={styles.currentVersionPill}>{t("recordEdits.currentVersionLabel")}</Text>}
          {!selectedSnapshot?.current && displayStatus === "Approved" && <Text style={styles.supersededVersionPill}>{t("recordEdits.supersededLabel")}</Text>}
        </View>}
      </View>
      <Text testID="observation-id-value" style={styles.recordIdValue} selectable>{row.id}</Text>
      <View style={styles.recordMetaSummary} testID="plant-id-status-row">
        <Text style={styles.recordMetaPlantId}>{t("myObservations.plantId")}: {row.plant_id}</Text>
        {!!displayStatus && <StatusBadge status={displayStatus} />}
      </View>
      {!!(row.common_name || row.scientific_name) && <Text style={styles.reference}>{row.common_name || row.scientific_name}</Text>}
      {!!withdrawError && <Text accessibilityRole="alert" style={styles.error}>{withdrawError}</Text>}
      {canViewPlantSubmission && <>
        <View style={styles.summaryDivider} />
        <TouchableOpacity testID="open-parent-plant-submission" accessibilityRole="button"
          accessibilityLabel={t("observationWithdrawal.openPlant")} style={styles.plantSubmissionRow}
          onPress={() => navigation.navigate("BotanistPlantDetail", {
            plantId: row.plant_id, botanist: { id: accountId, role: "Botanist" },
          })}>
          <View style={styles.plantSubmissionLabel}>
            <Ionicons name="leaf-outline" size={19} color="#2F6B4F" />
            <Text style={styles.plantSubmissionText}>{t("observationWithdrawal.openPlant")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color="#2F6B4F" />
        </TouchableOpacity>
      </>}
      {!!state.editHistoryError && <TouchableOpacity onPress={() => setRetry((value) => value + 1)} accessibilityRole="button"><Text style={styles.error}>{t("observationEdits.historyUnavailable")} · {t("common.tryAgain")}</Text></TouchableOpacity>}
    </View>
    <View style={styles.card} testID="observation-section-01">
      {sectionHeader("01", t("notificationObservation.information"), t("notificationObservation.informationSubtitle"))}
      <View style={styles.field}><Text style={styles.label}>{t("myObservations.observationDate")}</Text><Text style={styles.text}>{displayDate ? formatDateTime(displayDate) : t("recordEdits.informationNotAvailable")}</Text></View>
      <View style={styles.field}><Text style={styles.label}>{t("myObservations.recordedBy")}</Text><Text style={styles.text}>{getObservationRecorderDisplayName({
        recordedBy: row.owner_subject, recordedByName: row.recorded_by_name,
      }, user, t("plantDetail.unknownBotanist"))}</Text></View>
      {observationContentFields.map((field) => !locationFields.has(field) ? contentField(field) : null)}
    </View>
    <View style={styles.card} testID="observation-section-02">
      {sectionHeader("02", t("notificationObservation.locationInformation"), t("notificationObservation.locationSubtitle"))}
      {observationContentFields.filter((field) => locationFields.has(field)).map(contentField)}
    </View>
    <View style={styles.card} testID="observation-section-03">
      {sectionHeader("03", t("plantDetail.observationPhotos"), t("notificationObservation.photosSubtitle"))}
      {photos.length > 0 ? <View style={styles.photoGrid}>
        {photos.map((photo, index) => <TouchableOpacity key={photo.id || `${photo.uri}-${index}`} style={styles.photoCard}
          accessibilityRole="button" accessibilityLabel={t("plantDetail.photoNumber", { value0: index + 1 })}
          onPress={() => setSelectedPhoto(photo)}>
          <Image source={{ uri: photo.uri, ...(photo.headers ? { headers: photo.headers } : {}) }} style={styles.photo} resizeMode="cover"
            onError={() => setFailedPhotoUris((current) => current.includes(photo.uri) ? current : [...current, photo.uri])} />
          <Text style={styles.photoCaption}>{t("botanistPlantDetail.photo", { value0: index + 1 })}</Text>
        </TouchableOpacity>)}
      </View> : <View style={styles.emptyInfo}><Text style={styles.text}>{displayPhotos.length ? t("plantDetail.photoUnavailable") : t("notificationObservation.noPhotos")}</Text></View>}
    </View>
    <View style={styles.card} testID="observation-section-04">
      {sectionHeader("04", t("notificationObservation.officerReview"), t("notificationObservation.reviewSubtitle"))}
      {!!reviewStatus && <View style={styles.field}><Text style={styles.label}>{t("notificationObservation.reviewStatus")}</Text><StatusBadge status={reviewStatus} /></View>}
      {!!reviewComment && (displayStatus === "Rejected"
        ? <View style={styles.rejectedFeedbackPanel} testID="observation-rejected-feedback">
          <Text style={styles.rejectedFeedbackHeading}>{t("notificationObservation.officerFeedback")}</Text>
          <Text style={styles.rejectedFeedbackText}>{reviewComment}</Text>
        </View>
        : <View style={styles.field}><Text style={styles.label}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.text}>{reviewComment}</Text></View>)}
      {!!reviewedAt && <View style={styles.field}><Text style={styles.label}>{t("recordEdits.reviewedAt")}</Text><Text style={styles.text}>{formatDateTime(reviewedAt)}</Text></View>}
      {!!reviewedBy && <View style={styles.field}><Text style={styles.label}>{t("recordEdits.reviewedBy")}</Text><Text style={styles.text}>{reviewedBy}</Text></View>}
      {selectedEdit?.status === "Correction Required" && activeEdit?.id === selectedEdit.id && <TouchableOpacity style={styles.button}
        onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id, editRequest: selectedEdit })}
        accessibilityRole="button"><Text style={styles.buttonText}>{t("fieldCollection.correctObservation")}</Text></TouchableOpacity>}
      {!historicalSelection && ["Draft", "Correction Required"].includes(row.status) && <TouchableOpacity style={styles.button}
        onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id })}
        accessibilityRole="button"><Text style={styles.buttonText}>{t("fieldCollection.correctObservation")}</Text></TouchableOpacity>}
    </View>
    </>}
    <Modal visible={Boolean(selectedPhoto)} transparent animationType="fade" onRequestClose={() => setSelectedPhoto(null)}>
      <View style={styles.photoViewer}>
        <TouchableOpacity style={styles.photoViewerClose} accessibilityRole="button" accessibilityLabel={t("plantDetail.closeImageViewer")}
          onPress={() => setSelectedPhoto(null)}><Text style={styles.photoViewerCloseText}>×</Text></TouchableOpacity>
        {!!selectedPhoto && <Image style={styles.photoViewerImage} resizeMode="contain"
          onError={() => setSelectedPhoto(null)}
          source={{ uri: selectedPhoto.uri, ...(selectedPhoto.headers ? { headers: selectedPhoto.headers } : {}) }} />}
      </View>
    </Modal>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { padding: 20, paddingBottom: 20, width: "100%", maxWidth: 820, alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 25, fontWeight: "700", color: "#234B3A", flexShrink: 1 },
  subtitle: { marginTop: 6, marginBottom: 18, fontSize: 13, lineHeight: 19, color: "#718078" },
  rejectedBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderRadius: 12, backgroundColor: "#FDECEC", borderWidth: 1, borderColor: "#E8B4B0", borderLeftWidth: 4, borderLeftColor: "#B42318", marginBottom: 12 },
  rejectedBannerText: { flex: 1, flexShrink: 1, color: "#8F1D16", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  recordMeta: { padding: 14, marginBottom: 18, borderRadius: 14, backgroundColor: "#E9F7E4" },
  rejectedRecordMeta: { backgroundColor: "#FDECEC", borderWidth: 1, borderColor: "#E8B4B0" },
  recordIdHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  recordId: { fontSize: 11, color: "#718078" },
  recordIdValue: { marginTop: 5, fontSize: 14, lineHeight: 20, fontWeight: "700", color: "#234B3A", flexShrink: 1 },
  recordMetaSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 },
  recordMetaPlantId: { color: "#52665A", fontSize: 12, flexShrink: 1 },
  reference: { color: "#52665A", fontSize: 12, marginTop: 6 },
  badge: { maxWidth: "58%", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "#FFFFFF" },
  badgeText: { color: "#468585", fontSize: 11, fontWeight: "700" },
  pendingBadge: { backgroundColor: "#F4E7D2" },
  correctionBadge: { backgroundColor: "#F4E7D2" },
  approvedBadge: { backgroundColor: "#D8EBD9" },
  approvedBadgeText: { color: "#468585" },
  rejectedBadge: { backgroundColor: "#B42318" },
  rejectedBadgeText: { color: "#FFFFFF" },
  terminalBadge: { backgroundColor: "#F4E9E6" },
  terminalBadgeText: { color: "#884B43" },
  supersededBadge: { backgroundColor: "#E7EBE6" },
  supersededBadgeText: { color: "#56625A" },
  versionMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  versionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: "#234B3A", backgroundColor: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  currentVersionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: "#FFFFFF", backgroundColor: "#468585", fontSize: 10, fontWeight: "700" },
  supersededVersionPill: { overflow: "hidden", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, color: "#56625A", backgroundColor: "#E7EBE6", fontSize: 10, fontWeight: "700" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E2EDE0", marginBottom: 18 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#EAF0E6" },
  sectionNumber: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E9F7E4" },
  sectionNumberText: { fontSize: 13, fontWeight: "700", color: "#468585" },
  sectionHeading: { flex: 1, marginLeft: 12 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#234B3A" },
  sectionSubtitle: { marginTop: 4, fontSize: 11, lineHeight: 16, color: "#718078" },
  rejectedFeedbackPanel: { padding: 14, borderRadius: 12, backgroundColor: "#FEF2F1", borderWidth: 1, borderColor: "#E8B4B0", borderLeftWidth: 4, borderLeftColor: "#B42318", marginBottom: 12, gap: 6 },
  rejectedFeedbackHeading: { fontSize: 12, fontWeight: "800", color: "#8F1D16" },
  rejectedFeedbackText: { color: "#6F302B", fontSize: 14, lineHeight: 21 },
  field: { marginBottom: 16 },
  photoRow: { flexDirection: "row", gap: 8, paddingVertical: 6 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  photoCard: { width: "47%", overflow: "hidden", borderRadius: 12, borderWidth: 1, borderColor: "#DCE8D6", backgroundColor: "#F6FAF3" },
  photo: { width: "100%", height: 140, backgroundColor: "#E9F0E5" },
  photoCaption: { padding: 9, fontSize: 12, color: "#52665A" },
  emptyInfo: { alignItems: "center", padding: 18, borderRadius: 12, backgroundColor: "#F6FAF3" },
  photoViewer: { flex: 1, paddingHorizontal: 12, paddingTop: 30, paddingBottom: 18, backgroundColor: "#101812" },
  photoViewerClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center", alignSelf: "flex-end", borderRadius: 22, backgroundColor: "#FFFFFF20" },
  photoViewerCloseText: { color: "#FFFFFF", fontSize: 30, lineHeight: 34 },
  photoViewerImage: { flex: 1, width: "100%" },
  label: { marginBottom: 6, fontSize: 12, fontWeight: "700", color: "#234B3A" },
  text: { color: "#52665A", fontSize: 14, lineHeight: 21 },
  error: { color: "#A34740", fontSize: 14, lineHeight: 21 },
  button: { minHeight: 46, borderRadius: 12, backgroundColor: "#35786F", alignItems: "center", justifyContent: "center", marginTop: 18 },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  summaryDivider: { height: 1, marginTop: 12, backgroundColor: "#D6E6D1" },
  plantSubmissionRow: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 4 },
  plantSubmissionLabel: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  plantSubmissionText: { color: "#2F6B4F", fontSize: 14, lineHeight: 20, fontWeight: "700", flexShrink: 1 },
  deleteEditButton: { width: 44, height: 44, alignSelf: "flex-end", alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: "#FDE9E7", borderWidth: 1, borderColor: "#F2B9B4" },
  disabledButton: { opacity: 0.65 },
});
