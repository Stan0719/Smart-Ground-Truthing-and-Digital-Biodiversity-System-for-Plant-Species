import AsyncStorage from "@react-native-async-storage/async-storage";
import { faceSession } from "./faceSession";
import { plantApi, plantAssetSources } from "./plantApi";
import { mobileApiConfiguration } from "./apiConfiguration";
import { createBotanistNotificationStore } from "./botanistNotificationStore";

export const botanistNotifications = createBotanistNotificationStore({
  storage: AsyncStorage,
  backend: mobileApiConfiguration.plant || "unconfigured",
  authorize: () => faceSession.restore({ allowOffline: true }),
  fetchObservations: (accountId) => plantApi("/observations", { expectedAccountId: accountId }),
  fetchNotifications: (accountId) => plantApi("/notifications", { expectedAccountId: accountId }),
  markNotificationsRead: (accountId, body) => plantApi("/notifications/read", { method: "POST", body, expectedAccountId: accountId }),
  recordSyncRemote: (accountId, body) => plantApi("/notifications/sync", { method: "POST", body, expectedAccountId: accountId }),
});

export async function ownedNotificationObservation(accountId, observationId) {
  if (!/^(?:[1-9]\d{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(String(observationId))) throw Error("This notification has no valid observation reference.");
  const payload = await plantApi(`/observations/${encodeURIComponent(observationId)}`, { expectedAccountId: accountId });
  const row = payload?.observation;
  if (!row || row.owner_subject !== `staff:${accountId}` || String(row.id) !== String(observationId)) throw Error("This observation is unavailable for your account.");
  const assets = Array.isArray(row.assets) ? row.assets.filter((asset) => asset?.id && ["image/jpeg", "image/png"].includes(String(asset.content_type || "").toLowerCase())) : [];
  let photos = [];
  if (assets.length) {
    try {
      const sources = await plantAssetSources(assets, accountId);
      photos = assets.map((asset, index) => ({ id: String(asset.id), ...sources[index] }));
    } catch {
      // Keep authorized observation details available if photo URLs cannot be resolved.
    }
  }
  return { ...row, photos };
}
