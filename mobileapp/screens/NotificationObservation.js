import { useAppTranslation, t, translateLabel, translateUIMessage, translateFieldValue, translateFieldLabel, formatDateTime } from "../translations/i18n";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ownedNotificationObservation } from "../utils/botanistNotifications";
import { getObservationRecorderDisplayName, plantApi, plantAssetSources } from "../utils/plantApi";
import { faceSession } from "../utils/faceSession";
import { mobileApiUrl } from "../utils/apiConfiguration";
import Ionicons from "@expo/vector-icons/Ionicons";
import { observationContentFields, observationDetailContent, canStartObservationEdit } from "../utils/observationDetails";
import EditAction from "../components/EditAction";

const fieldLabel = (field) => ["zone", "altitudeM"].includes(field) ? t(`recordEdits.${field}`) : translateFieldLabel(field);
const statusTone = (status) => status === "Approved" ? styles.approvedBadge : ["Rejected", "Cancelled", "Withdrawn"].includes(status) ? styles.rejectedBadge
  : status === "Correction Required" ? styles.correctionBadge : status === "Superseded" ? styles.supersededBadge : styles.pendingBadge;
function StatusBadge({ status }) {
  useAppTranslation();
  return <View style={[styles.badge, statusTone(status)]} testID="observation-status-badge">
    <Text style={[styles.badgeText, status === "Approved" && styles.approvedBadgeText,
      ["Rejected", "Cancelled", "Withdrawn"].includes(status) && styles.rejectedBadgeText, status === "Superseded" && styles.supersededBadgeText]}>{translateLabel(status)}</Text>
  </View>;
}

export default function NotificationObservation({ route, navigation, user }) {
  useAppTranslation();
  const [state, setState] = useState({ loading: true, observation: null, editHistory: null, editHistoryError: "", photoToken: "", error: "" });
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [failedPhotoUris, setFailedPhotoUris] = useState([]);
  const [retry, setRetry] = useState(0);
  const [cancellingEdit, setCancellingEdit] = useState(false);
  const [cancelEditError, setCancelEditError] = useState("");
  const accountId = user?.role === "botanist" ? user.id : null;
  const observationId = route.params?.observationId;
  const readOnlyApproved = route.params?.readOnlyApproved === true;
  useFocusEffect(useCallback(() => {
    let active = true;
    setSelectedPhoto(null);
    setFailedPhotoUris([]);
    setState({ loading: true, observation: null, editHistory: null, editHistoryError: "", error: "" });
    if (!accountId) { setState({ loading: false, observation: null, editHistory: null, error: "Sign in as the Botanist who submitted this observation." }); return undefined; }
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
    observationRead.then(async (observation) => {
      let editHistory = null, editHistoryError = "";
      if (!readOnlyApproved) {
        try { editHistory = await plantApi(`/observations/${encodeURIComponent(observationId)}/edit-history`, { expectedAccountId: accountId }); }
        catch (error) { if (![404, 503].includes(error?.status)) editHistoryError = error?.message || t("observationEdits.historyUnavailable"); }
      }
      const photoToken = (editHistory?.versions?.some((version) => version.photo_ids?.length) ||
        editHistory?.edits?.some((edit) => edit.retained_photo_ids?.length || edit.added_photo_count) ||
        route.params?.observationVersionSnapshot?.photoIds?.length)
        ? await faceSession.withToken(async (token) => token).catch(() => "") : "";
      if (active) setState({ loading: false, observation, editHistory, editHistoryError, photoToken, error: "" });
    }).catch((error) => {
      if (active) setState({ loading: false, observation: null, editHistory: null, error: `${error.message} The record may be unavailable or you may be offline.` });
    });
    return () => { active = false; };
  }, [accountId, observationId, retry, readOnlyApproved, route.params?.observationVersionSnapshot]));

  const row = state.observation?.owner_subject === `staff:${accountId}` ||
    (readOnlyApproved && state.observation?.status === "Approved") ? state.observation : null;
  const edits = state.editHistory?.edits || [];
  const activeEdit = edits.find((edit) => ["Pending Review", "Correction Required"].includes(edit.status));
  const selectedVersion = state.editHistory?.versions?.find((version) => String(version.id) === String(route.params?.observationVersionId));
  const selectedSnapshot = route.params?.observationVersionSnapshot;
  const historicalSelection = Boolean(selectedSnapshot || selectedVersion);
  const selectedEdit = route.params?.editRequestId
    ? edits.find((edit) => String(edit.id) === String(route.params.editRequestId))
    : selectedVersion?.edit_request_id ? edits.find((edit) => String(edit.id) === String(selectedVersion.edit_request_id))
      : historicalSelection ? null : activeEdit;
  const requestSelection = Boolean(route.params?.editRequestId);
  const selectedDetail = historicalSelection || requestSelection;
  const displayContent = observationDetailContent(row, selectedSnapshot, selectedVersion, selectedEdit, selectedDetail);
  const displayStatus = selectedDetail
    ? selectedEdit?.status || selectedSnapshot?.status || (selectedVersion ? "Approved" : row?.status)
    : row?.status;
  const displayDate = selectedDetail
    ? selectedSnapshot?.createdAt || selectedEdit?.created_at || selectedVersion?.approved_at || row?.observed_at || row?.created_at
    : row?.observed_at || row?.created_at;
  const reviewStatus = selectedEdit?.status || displayStatus;
  const reviewComment = selectedEdit?.review_comment || selectedSnapshot?.reviewComment || (!selectedDetail ? row?.review_comment : "");
  const reviewedAt = selectedEdit?.reviewed_at || (!selectedDetail ? row?.reviewed_at : null);
  const reviewedBy = selectedEdit?.reviewed_by || (!selectedDetail ? row?.reviewed_by : null);
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
  const canEdit = !readOnlyApproved && canStartObservationEdit(row, state.editHistory, activeEdit, selectedDetail, accountId);
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
    <View style={styles.titleRow}>
      <Text style={styles.title}>{t("notificationObservation.recordTitle")}</Text>
      {canEdit && <EditAction testID="edit-own-observation" onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id, editRequestMode: true })} />}
    </View>
    <Text style={styles.subtitle}>{selectedDetail ? t("botanistPlantDetail.readOnlyVersionSubtitle") : t("notificationObservation.recordSubtitle")}</Text>
    <View style={styles.recordMeta} testID="observation-record-meta">
      <View style={styles.recordMetaSummary}>
        <View style={styles.recordMetaText}>
          <Text style={styles.recordId}>{t("myObservations.observationId")}</Text>
          <Text style={styles.recordIdValue} numberOfLines={2}>{row.id}</Text>
        </View>
        {!!displayStatus && <StatusBadge status={displayStatus} />}
      </View>
      <Text style={styles.reference}>{t("myObservations.plantId")}: {row.plant_id}</Text>
      {!!(row.common_name || row.scientific_name) && <Text style={styles.reference}>{row.common_name || row.scientific_name}</Text>}
      {selectedDetail && <View style={styles.versionMetaRow}>
        <Text style={styles.versionPill}>{selectedSnapshot?.original ? t("recordEdits.originalLabel")
          : selectedSnapshot?.editNumber ? t("recordEdits.editNumber", { number: selectedSnapshot.editNumber })
            : t("observationEdits.versionLabel", { number: selectedSnapshot?.versionNumber || selectedVersion?.version_number || selectedEdit?.version_number || 1 })}</Text>
        {selectedSnapshot?.current && <Text style={styles.currentVersionPill}>{t("recordEdits.currentVersionLabel")}</Text>}
        {!selectedSnapshot?.current && displayStatus === "Approved" && <Text style={styles.supersededVersionPill}>{t("recordEdits.supersededLabel")}</Text>}
      </View>}
      {selectedEdit && selectedEdit.owner_subject === `staff:${accountId}` && activeEdit?.id === selectedEdit.id && ["Pending Review", "Correction Required"].includes(selectedEdit.status) && <View style={styles.cancelEditAction}><TouchableOpacity
        style={[styles.deleteEditButton, cancellingEdit && styles.disabledButton]} disabled={cancellingEdit} accessibilityRole="button"
        onPress={() => Alert.alert(t("recordEdits.deleteEditTitle"), t("recordEdits.deleteEditMessage"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("recordEdits.cancelEditRequest"), style: "destructive", onPress: async () => {
            setCancelEditError(""); setCancellingEdit(true);
            try {
              await plantApi(`/observation-edits/${encodeURIComponent(selectedEdit.id)}/cancel`, { method: "POST", expectedAccountId: accountId, body: {} });
              Alert.alert(t("recordEdits.cancelEditRequest"), t("recordEdits.editCancelled"));
              setRetry((value) => value + 1);
            } catch (error) { setCancelEditError(translateUIMessage(error.message || t("recordEdits.cancelEditFailed"))); }
            finally { setCancellingEdit(false); }
          } },
        ])}>
        {cancellingEdit ? <ActivityIndicator size="small" color="#A33F36" /> : <Ionicons name="trash-outline" size={17} color="#A33F36" />}
        <Text style={styles.deleteEditText}>{cancellingEdit ? t("common.loading") : t("recordEdits.cancelEditRequest")}</Text>
      </TouchableOpacity></View>}
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
      {!!reviewComment && <View style={styles.field}><Text style={styles.label}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.text}>{reviewComment}</Text></View>}
      {!!reviewedAt && <View style={styles.field}><Text style={styles.label}>{t("recordEdits.reviewedAt")}</Text><Text style={styles.text}>{formatDateTime(reviewedAt)}</Text></View>}
      {!!reviewedBy && <View style={styles.field}><Text style={styles.label}>{t("recordEdits.reviewedBy")}</Text><Text style={styles.text}>{reviewedBy}</Text></View>}
    </View>
    {(selectedEdit || state.editHistory?.events?.length > 0 || state.editHistory?.versions?.length > 0 ||
      (!historicalSelection && ["Draft", "Correction Required"].includes(row.status))) && <View style={styles.card} testID="observation-section-05">
      {sectionHeader("05", t("myObservations.history"), t("notificationObservation.historySubtitle"))}
      {selectedEdit && <View style={styles.feedback}>
        <Text style={styles.label}>{t("observationEdits.editProposal")} {selectedEdit.version_number}</Text>
        {!!cancelEditError && <Text style={styles.error} accessibilityRole="alert">{cancelEditError}</Text>}
        {selectedEdit.status === "Correction Required" && activeEdit?.id === selectedEdit.id && <TouchableOpacity style={styles.button}
          onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id, editRequest: selectedEdit })}
          accessibilityRole="button"><Text style={styles.buttonText}>{t("fieldCollection.correctObservation")}</Text></TouchableOpacity>}
      </View>}
      {state.editHistory?.events?.length > 0 && <View style={styles.photoSection}>
        <Text style={styles.label}>{t("myObservations.history")}</Text>
        {state.editHistory.events.map((event) => <Text key={event.id} style={styles.text}>{t(`observationEdits.events.${event.event_type}`)} · {String(event.created_at).slice(0, 10)}{event.comment ? ` · ${event.comment}` : ""}</Text>)}
      </View>}
      {state.editHistory?.versions?.length > 0 && <View style={styles.photoSection}>
        <Text style={styles.label}>{t("observationEdits.versionHistory")}</Text>
        {state.editHistory.versions.map((version) => <View key={version.id} style={styles.feedback}>
          <Text style={styles.label}>{t("observationEdits.versionLabel", { number: version.version_number })}</Text>
          {["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes", "latitude", "longitude", "accuracy_m", "zone", "altitudeM"].map((field) =>
            version.content?.[field] != null && version.content[field] !== "" ? <Text key={field} style={styles.text}>{translateLabel(field)}: {String(version.content[field])}</Text> : null)}
          {!!state.photoToken && version.photo_ids?.length > 0 && <ScrollView horizontal contentContainerStyle={styles.photoRow}>
            {version.photo_ids.map((id, index) => <Image key={id} style={styles.photo}
              source={{ uri: `${mobileApiUrl("plant")}/api/observation-versions/${encodeURIComponent(version.id)}/photos/${index}`,
                headers: { Authorization: `Bearer ${state.photoToken}` } }} />)}
          </ScrollView>}
        </View>)}
      </View>}
      {!historicalSelection && ["Draft", "Correction Required"].includes(row.status) && <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("FieldCollectionEdit", { observation: row, plantId: row.plant_id })}
        accessibilityRole="button"
      ><Text style={styles.buttonText}>{t("fieldCollection.correctObservation")}</Text></TouchableOpacity>}
    </View>}</>}
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
  title: { fontSize: 25, fontWeight: "700", color: "#234B3A", flexShrink: 1 },
  subtitle: { marginTop: 6, marginBottom: 18, fontSize: 13, lineHeight: 19, color: "#718078" },
  recordMeta: { padding: 14, marginBottom: 18, borderRadius: 14, backgroundColor: "#E9F7E4" },
  recordMetaSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  recordMetaText: { flex: 1, minWidth: 0 },
  recordId: { fontSize: 11, color: "#718078" },
  recordIdValue: { marginTop: 4, fontSize: 14, fontWeight: "700", color: "#234B3A" },
  reference: { color: "#52665A", fontSize: 12, marginTop: 6 },
  badge: { maxWidth: "58%", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: "#FFFFFF" },
  badgeText: { color: "#468585", fontSize: 11, fontWeight: "700" },
  pendingBadge: { backgroundColor: "#F4E7D2" },
  correctionBadge: { backgroundColor: "#F4E7D2" },
  approvedBadge: { backgroundColor: "#D8EBD9" },
  approvedBadgeText: { color: "#468585" },
  rejectedBadge: { backgroundColor: "#F4E9E6" },
  rejectedBadgeText: { color: "#884B43" },
  supersededBadge: { backgroundColor: "#E7EBE6" },
  supersededBadgeText: { color: "#56625A" },
  versionMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 },
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
  feedback: { backgroundColor: "#EEF7EF", padding: 14, borderRadius: 12, marginBottom: 12 },
  field: { marginBottom: 16 },
  photoSection: { marginTop: 8, marginBottom: 10 },
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
  cancelEditAction: { borderTopWidth: 1, borderTopColor: "#C9DEC9", marginTop: 12, paddingTop: 10, alignItems: "flex-end" },
  deleteEditButton: { minHeight: 44, alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 7, justifyContent: "center", paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#FFF8F7", borderWidth: 1, borderColor: "#E8B9B2" },
  disabledButton: { opacity: 0.65 },
  deleteEditText: { color: "#A33F36", fontSize: 13, fontWeight: "700" },
});
