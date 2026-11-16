import { notificationPresentation } from "../utils/botanistNotificationStore";
import { t, translateLabel } from "./i18n";

export function localizedNotificationMessage(item) {
  if (item.entityType === "observation_edit" && item.observationId) return item.comment
    ? `${t("myObservations.observationId")} ${item.observationId}: ${item.comment}`
    : t("observationEdits.notificationUpdate", { observationId: item.observationId });
  if (item.entityType === "species_request" && item.requestId) return item.comment
    ? `${t("submissions.requestId")} ${item.requestId}: ${item.comment}`
    : t("notifications.speciesRequestUpdate", { requestId: item.requestId });
  if (item.entityType === "record_change" && item.changeId) return item.comment
    ? `${t(item.recordKind === "plant" ? "notifications.plant" : "notifications.speciesEditTarget", item.recordKind === "plant" ? { plantId: item.targetId } : { targetId: item.targetId })}: ${item.comment}`
    : t("notifications.recordChangeUpdate", { targetId: item.targetId });
  if (item.type === "sync_failed") return t("notifications.syncFailedMessage");
  if (item.type === "sync_completed") return t("notifications.syncCompletedMessage", { count: item.count });
  if (item.type === "observation_submitted") return t("notifications.submittedMessage", { plantId: item.plantId });
  // Officer feedback is original record content, not UI text.
  if (item.comment) return `${t("notifications.plant", { plantId: item.plantId })}: ${item.comment}`;
  return t("notifications.reviewMessage", {
    plantId: item.plantId,
    title: translateLabel(notificationPresentation[item.type]?.title || "Observation updated"),
  });
}
