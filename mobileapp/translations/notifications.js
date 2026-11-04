import { notificationPresentation } from "../utils/botanistNotificationStore";
import { t, translateLabel } from "./i18n";

export function localizedNotificationMessage(item) {
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
