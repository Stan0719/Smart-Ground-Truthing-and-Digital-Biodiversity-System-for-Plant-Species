import { useAppTranslation, t, translateLabel, translateUIMessage, formatDateTime } from "../translations/i18n";
import React, { useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBotanistNotifications } from "../utils/useBotanistNotifications";
import { botanistNotifications, ownedNotificationObservation } from "../utils/botanistNotifications";
import { isMatchingInitialObservationCorrection, notificationPresentation } from "../utils/botanistNotificationStore";
import { localizedNotificationMessage } from "../translations/notifications";
import { readDrafts } from "../utils/fieldStorage";
import { fetchBotanistSpeciesRequest, fetchBotanistRecordChange } from "../utils/botanistRecords";
import { plantApi } from "../utils/plantApi";

const speciesNotificationTitles = {
  species_request_submitted: "notifications.speciesRequestSubmitted",
  species_request_approved: "notifications.speciesRequestApproved",
  species_request_rejected: "notifications.speciesRequestRejected",
  species_correction_requested: "notifications.speciesCorrectionRequested",
  record_change_correction: "notifications.recordChangeCorrection",
};
const notificationTitle = (item) => ["record_change_approved", "record_change_rejected"].includes(item.type)
  ? t(`notifications.${item.recordKind === "plant" ? "plantEdit" : "speciesEdit"}${item.type === "record_change_approved" ? "Approved" : "Rejected"}`)
  : speciesNotificationTitles[item.type]
  ? t(speciesNotificationTitles[item.type]) : item.entityType === "observation_edit"
    ? t(`observationEdits.notifications.${item.type}`) : translateLabel(notificationPresentation[item.type].title);

export default function BotanistNotifications({ navigation, user }) {
  useAppTranslation();
  const accountId = user?.role === "botanist" ? user.id : null;
  const { items, loading, loaded, error, unreadCount, refresh } = useBotanistNotifications(accountId);
  const [busy, setBusy] = useState(null);
  const actionRunning = useRef(false);

  async function markAllRead() {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy("all");
    try {
      await botanistNotifications.markRead(accountId, [], { all: true });
      await refresh(false);
    } catch (cause) {
      Alert.alert(t("botanistNotifications.couldNotMarkNotificationsRead"), translateUIMessage(cause.message));
    } finally { actionRunning.current = false; setBusy(null); }
  }

  async function openNotification(item) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setBusy(item.id);
    try {
      await botanistNotifications.markRead(accountId, [item.id]);
      await refresh(false);
      if (item.entityType === "record_change" && item.changeId && ["plant", "species"].includes(item.recordKind)) {
        const proposal = await fetchBotanistRecordChange(accountId, item.changeId, { kind: item.recordKind, targetId: item.targetId, status: "any" });
        if (item.revision != null && proposal.revision < item.revision) throw Error(t("botanistNotifications.theRecordMayBeUnavailableYourAccessMayHaveChanged"));
        if (item.recordKind === "plant" && proposal.base_snapshot?.workflow_type === "initial_registration_observation_edit") {
          const observationId = proposal.base_snapshot.observation_id;
          const [observation, editPayload] = await Promise.all([
            ownedNotificationObservation(accountId, observationId),
            plantApi(`/observation-edits/${encodeURIComponent(proposal.id)}`, { expectedAccountId: accountId }),
          ]);
          const edit = editPayload?.edit;
          if (!isMatchingInitialObservationCorrection({ proposal, edit, observation, revision: item.revision, accountId }))
            throw Error(t("observationEdits.unavailable"));
          navigation.navigate("FieldCollectionEdit", { observation, plantId: observation.plant_id, editRequest: edit });
        } else if (proposal.status === "Correction Required") {
          if (item.recordKind === "plant") navigation.navigate("EditPlant", { plantId: proposal.plant_id, botanist: user, correction: true, correctionChangeId: proposal.id });
          else navigation.navigate("EditSpeciesRequest", { requestId: String(proposal.base_snapshot?.request_id || ""), botanist: user, correction: true, correctionChangeId: proposal.id });
        } else if (item.recordKind === "plant") navigation.navigate("BotanistPlantDetail", { plantId: proposal.plant_id, botanist: user });
        else navigation.navigate("BotanistSpeciesRequestDetail", { requestId: String(proposal.base_snapshot?.request_id || ""), botanist: user });
      } else if (item.entityType === "species_request" && item.requestId) {
        const request = await fetchBotanistSpeciesRequest(accountId, item.requestId);
        if (item.type === "species_correction_requested" && request.request_status === "Correction Required")
          navigation.navigate("EditSpeciesRequest", { requestId: item.requestId, botanist: user, correction: true });
        else navigation.navigate("BotanistSpeciesRequestDetail", { requestId: item.requestId, botanist: user });
      } else if (item.entityType === "observation_edit" && item.requestId && item.observationId) {
        const [observation, payload] = await Promise.all([
          ownedNotificationObservation(accountId, item.observationId),
          plantApi(`/observation-edits/${encodeURIComponent(item.requestId)}`, { expectedAccountId: accountId }),
        ]);
        if (payload.edit?.owner_subject !== `staff:${accountId}` || payload.edit?.observation_id !== observation.id ||
            (item.revision != null && payload.edit?.revision !== item.revision))
          throw Error(t("observationEdits.unavailable"));
        if (item.type === "observation_edit_correction" && payload.edit.status === "Correction Required")
          navigation.navigate("FieldCollectionEdit", { observation, plantId: observation.plant_id, editRequest: payload.edit });
        else navigation.navigate("NotificationObservation", { observationId: observation.id, editRequestId: payload.edit.id });
      } else if (item.observationId) {
        const observation = await ownedNotificationObservation(accountId, item.observationId);
        if (observation.origin_type === "initial_registration") {
          if (item.type === "correction_requested" && observation.status === "Correction Required")
            navigation.navigate("EditPlant", { plantId: observation.plant_id, botanist: user, correction: true });
          else navigation.navigate("BotanistPlantDetail", { plantId: observation.plant_id, botanist: user });
        } else if (item.type === "correction_requested" && observation.status === "Correction Required" && observation.origin_type === "subsequent_observation") {
          navigation.navigate("FieldCollectionEdit", { observation, plantId: observation.plant_id });
        } else navigation.navigate("NotificationObservation", { observationId: observation.id });
      } else if (item.type === "sync_failed") {
        const draft = (await readDrafts(accountId)).find((saved) => saved.client_key === item.draftKey);
        if (!draft) {
          Alert.alert(t("botanistNotifications.draftNoLongerPending"), t("botanistNotifications.thisDraftHasAlreadySynchronizedOrIsNoLongerSaved"));
          return;
        }
        navigation.navigate(["PATCH", "OBSERVATION_EDIT"].includes(draft.method) ? "FieldCollectionEdit" : draft.path === "/plants" ? "FieldCollectionPlant" : "FieldCollection", { draft });
      } else Alert.alert(notificationTitle(item), localizedNotificationMessage(item));
    } catch (cause) {
      Alert.alert(t("botanistNotifications.couldNotOpenNotification"), t("botanistNotifications.theRecordMayBeUnavailableYourAccessMayHaveChanged", { message: translateUIMessage(cause.message) }));
    } finally { actionRunning.current = false; setBusy(null); }
  }

  if (!accountId) return <View style={styles.empty}><Text style={styles.emptyTitle}>{t("botanistNotifications.signInAsABotanistToViewNotifications")}</Text></View>;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={loaded && loading} onRefresh={() => refresh()} colors={["#468585"]} tintColor="#468585" />}
      ListHeaderComponent={
        <View>
          <View style={styles.toolbar}>
            <Text style={styles.summary}>{loaded ? t("botanistNotifications.unread", { unreadCount: unreadCount }) : t("botanistNotifications.yourActivityUpdates")}</Text>
            <TouchableOpacity
              style={[styles.markAll, (!unreadCount || !!busy) && styles.disabled]}
              onPress={markAllRead}
              disabled={!unreadCount || !!busy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t("botanistNotifications.markAllNotificationsAsRead")}
            >
              {busy === "all" ? <ActivityIndicator color="#35786F" size="small" /> : <Ionicons name="checkmark-done-outline" size={18} color="#35786F" />}
              <Text style={styles.markAllText}>{t("botanistNotifications.markAllRead")}</Text>
            </TouchableOpacity>
          </View>
          {!!error && <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{translateUIMessage(error)}</Text>
            <TouchableOpacity onPress={() => refresh()} disabled={loading} style={styles.retry} accessibilityRole="button">
              <Text style={styles.markAllText}>{loading ? t("botanistNotifications.refreshing") : t("common.tryAgain")}</Text>
            </TouchableOpacity>
          </View>}
          {!loaded && loading && <ActivityIndicator color="#468585" style={styles.initialLoading} />}
        </View>
      }
      ListEmptyComponent={loaded && !loading && !error ? <View style={styles.empty}>
        <View style={styles.emptyIcon}><Ionicons name="notifications-outline" size={32} color="#468585" /></View>
        <Text style={styles.emptyTitle}>{t("botanistNotifications.noNotificationsYet")}</Text>
        <Text style={styles.emptyText}>{t("botanistNotifications.reviewAndSynchronizationUpdatesWillAppearHere")}</Text>
      </View> : null}
      renderItem={({ item }) => {
        const presentation = notificationPresentation[item.type];
        const warning = item.type === "record_change_correction";
        const destructive = ["observation_rejected", "species_request_rejected", "observation_edit_rejected", "observation_edit_cancelled", "sync_failed", "record_change_rejected"].includes(item.type);
        return <TouchableOpacity
          style={[styles.card, !item.read && styles.unreadCard, busy === item.id && styles.disabled]}
          onPress={() => openNotification(item)}
          disabled={!!busy}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t("botanistNotifications.label", { value0: translateLabel(item.read ? "Read" : "Unread"), title: notificationTitle(item), value2: localizedNotificationMessage(item) })}
        >
          <View style={[styles.icon, destructive && styles.destructiveIcon, warning && styles.warningIcon]}>
            {busy === item.id ? <ActivityIndicator color="#35786F" /> : <Ionicons name={presentation.icon} size={22} color={destructive ? "#A34740" : warning ? "#8A611C" : "#35786F"} />}
          </View>
          <View style={styles.details}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, !item.read && styles.unreadTitle]}>{notificationTitle(item)}</Text>
              {!item.read && <View style={styles.dot} />}
            </View>
            <Text style={styles.message} numberOfLines={3}>{localizedNotificationMessage(item)}</Text>
            <Text style={styles.date}>{formatDateTime(item.createdAt)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#899A90" />
        </TouchableOpacity>;
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7FBF4" },
  content: { flexGrow: 1, padding: 18, paddingBottom: 36 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 },
  summary: { color: "#6D7F75", fontSize: 13, flexShrink: 1 },
  markAll: { flexDirection: "row", gap: 7, alignItems: "center", paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: "#E7F2E2" },
  markAllText: { color: "#35786F", fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2EDE0", borderRadius: 16, padding: 14, marginBottom: 12 },
  unreadCard: { backgroundColor: "#EEF7EF", borderColor: "#BAD9CB" },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#E1F0E6", alignItems: "center", justifyContent: "center" },
  warningIcon: { backgroundColor: "#FFF0D8" },
  destructiveIcon: { backgroundColor: "#FCEAE6" },
  details: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: "#52665A", fontSize: 14, fontWeight: "600" },
  unreadTitle: { color: "#234B3A", fontWeight: "700" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#35786F" },
  message: { color: "#52665A", fontSize: 13, lineHeight: 19, marginTop: 6 },
  date: { color: "#718078", fontSize: 11, marginTop: 9 },
  error: { backgroundColor: "#FFF4E5", borderRadius: 12, padding: 14, marginBottom: 14 },
  errorText: { color: "#87562F", fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  initialLoading: { marginTop: 30 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: "#E7F2E2", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: "#234B3A", fontSize: 17, fontWeight: "700", textAlign: "center" },
  emptyText: { color: "#718078", fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
});
