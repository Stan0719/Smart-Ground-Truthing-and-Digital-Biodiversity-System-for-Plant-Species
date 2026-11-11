const reviewTypes = {
  Approved: "observation_approved",
  Rejected: "observation_rejected",
  "Correction Required": "correction_requested",
};

export const notificationPresentation = {
  observation_submitted: { title: "Observation Submitted", icon: "paper-plane-outline" },
  observation_approved: { title: "Observation Approved", icon: "checkmark-circle-outline" },
  observation_rejected: { title: "Observation Rejected", icon: "close-circle-outline" },
  correction_requested: { title: "Correction Requested", icon: "create-outline" },
  sync_failed: { title: "Synchronization Failed", icon: "cloud-offline-outline" },
  sync_completed: { title: "Synchronization Completed", icon: "cloud-done-outline" },
};

export function notificationMessage(item) {
  if (item.type === "sync_failed") return "A saved draft could not synchronize. It remains on this device for retry.";
  if (item.type === "sync_completed") return `${item.count} saved record${item.count === 1 ? " has" : "s have"} synchronized successfully.`;
  const record = `Plant ${item.plantId}`;
  if (item.type === "observation_submitted") return `${record}: your observation is awaiting Officer review.`;
  if (item.comment) return `${record}: ${item.comment}`;
  return `${record}: ${notificationPresentation[item.type]?.title || "Observation updated"}. Open the record for current feedback.`;
}

const orderNewest = (items) => [...items].sort((a, b) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id),
);
const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const validObservationId = (value) => /^(?:[1-9]\d{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(String(value));
function normalizeRemoteNotification(item) {
  if (!item || typeof item.id !== "string" || !Object.hasOwn(notificationPresentation, item.type) ||
      !validDate(typeof item.createdAt === "string" ? item.createdAt : new Date(item.createdAt).toISOString()) || typeof item.read !== "boolean")
    throw Error("The server returned an invalid notification list.");
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date(item.createdAt).toISOString();
  return {
    id: item.id,
    type: item.type,
    createdAt,
    read: item.read,
    ...(typeof item.sourceKey === "string" ? { sourceKey: item.sourceKey } : {}),
    ...(item.observationId != null ? { observationId: String(item.observationId) } : {}),
    ...(item.plantId != null ? { plantId: String(item.plantId) } : {}),
    ...(typeof item.comment === "string" ? { comment: item.comment } : {}),
    ...(Number.isInteger(item.count) && item.count > 0 ? { count: item.count } : {}),
    ...(typeof item.draftKey === "string" ? { draftKey: item.draftKey } : {}),
  };
}
function notificationSourceKey(item) {
  if (item.sourceKey) return item.sourceKey;
  if (item.type === "sync_failed") return `sync:sync_failed:${item.draftKey || item.id.slice("sync_failed:".length)}`;
  if (item.type === "sync_completed") return `sync:sync_completed:${item.id.slice("sync_completed:".length)}`;
  return null;
}
function sameNotification(a, b) {
  if (a.id === b.id) return true;
  const aSource = notificationSourceKey(a), bSource = notificationSourceKey(b);
  if (aSource && bSource && aSource === bSource) return true;
  return Boolean(a.observationId && b.observationId && a.type === b.type &&
    a.observationId === b.observationId && Date.parse(a.createdAt) === Date.parse(b.createdAt));
}

export function eventsFromObservations(payload, accountId) {
  if (!Array.isArray(payload?.observations)) throw Error("The server returned an invalid observation list.");
  const events = new Map();
  for (const row of payload.observations) {
    if (row.owner_subject !== `staff:${accountId}`) throw Error("The observation list does not belong to this account.");
    if (!validObservationId(row.id) || !/^[1-9]\d*$/.test(String(row.plant_id))) throw Error("The server returned an invalid observation reference.");
    let type, date;
    if (row.review_decision && Object.hasOwn(reviewTypes, row.review_decision)) {
      type = reviewTypes[row.review_decision];
      date = row.reviewed_at;
    }
    // A Pending Review status confirms the submit endpoint completed.
    if (row.status === "Pending Review") {
      const submittedAt = row.updated_at;
      if (!validDate(submittedAt)) throw Error("The observation submission time is unavailable.");
      const id = `submitted:${row.id}:${submittedAt}`;
      events.set(id, { id, type: "observation_submitted", observationId: String(row.id), plantId: String(row.plant_id), createdAt: submittedAt });
    }
    if (type) {
      if (!validDate(date)) throw Error("The observation review time is unavailable.");
      const id = `review:${row.id}:${date}:${row.review_decision}`;
      events.set(id, { id, type, observationId: String(row.id), plantId: String(row.plant_id), createdAt: date,
        ...(typeof row.review_comment === "string" ? { comment: row.review_comment } : {}) });
    }
  }
  return orderNewest([...events.values()]);
}

// Storage contains event references/read flags, never Officer comments or field notes.
export function createBotanistNotificationStore({ storage, authorize, fetchObservations, fetchNotifications, markNotificationsRead, recordSyncRemote, backend, now = () => new Date().toISOString() }) {
  const queues = new Map();
  const comments = new Map();
  const listeners = new Set();
  const keyFor = (accountId) => `niah.notifications.v1:${encodeURIComponent(backend)}:${encodeURIComponent(accountId)}`;
  async function verify(accountId) {
    let user;
    try { user = await authorize(); }
    catch {
      throw Object.assign(Error("Your saved notifications could not be unlocked. Reconnect and sign in with your Botanist account."), { code: "NOTIFICATION_ACCESS_DENIED" });
    }
    if (!accountId || user?.id !== accountId || user.role !== "botanist") {
      throw Object.assign(Error("Sign in with the Botanist account that owns these notifications."), { code: "NOTIFICATION_ACCESS_DENIED" });
    }
    return user;
  }
  function enqueue(accountId, operation) {
    const previous = queues.get(accountId) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    queues.set(accountId, task);
    task.finally(() => { if (queues.get(accountId) === task) queues.delete(accountId); }).catch(() => {});
    return task;
  }
  async function read(accountId) {
    const raw = await storage.getItem(keyFor(accountId));
    if (!raw) return [];
    let data;
    try { data = JSON.parse(raw); } catch { throw Error("Saved notifications could not be read. No saved notifications were changed."); }
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.some((item) =>
      !item || typeof item.id !== "string" || !Object.hasOwn(notificationPresentation, item.type) ||
      !validDate(item.createdAt) || typeof item.read !== "boolean")) {
      throw Error("Saved notifications are invalid. No saved notifications were changed.");
    }
    return data.items;
  }
  async function write(accountId, items) {
    await verify(accountId);
    // Keep only serializable, non-sensitive event metadata.
    const saved = items.map(({ comment, ...item }) => item);
    await storage.setItem(keyFor(accountId), JSON.stringify({ version: 1, items: saved }));
  }
  function present(accountId, items) {
    const feedback = comments.get(accountId) || new Map();
    return orderNewest(items).map((item) => ({ ...item, ...(feedback.has(item.id) ? { comment: feedback.get(item.id) } : {}) }));
  }
  function emit(accountId) { for (const listener of listeners) listener(accountId); }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    load(accountId, { refresh = true } = {}) {
      return enqueue(accountId, async () => {
        const user = await verify(accountId);
        let items = await read(accountId);
        let error = "";
        if (refresh && !user.offline) {
          try {
            if (fetchNotifications) {
              const payload = await fetchNotifications(accountId);
              if (!Array.isArray(payload?.notifications)) throw Error("The server returned an invalid notification list.");
              await verify(accountId);
              const remoteById = new Map();
              for (const notification of payload.notifications.map(normalizeRemoteNotification)) {
                if (!remoteById.has(notification.id)) remoteById.set(notification.id, notification);
              }
              let remote = orderNewest([...remoteById.values()]);
              const pendingSync = items.filter((item) => ["sync_failed", "sync_completed"].includes(item.type));
              for (const local of pendingSync) {
                if (remote.some((item) => sameNotification(local, item)) || !recordSyncRemote) continue;
                const key = local.type === "sync_failed" ? local.draftKey : local.id.slice("sync_completed:".length);
                try {
                  const recorded = await recordSyncRemote(accountId, {
                    type: local.type, key,
                    ...(local.type === "sync_completed" ? { count: local.count } : {}),
                  });
                  const item = normalizeRemoteNotification(recorded?.notification);
                  await verify(accountId);
                  remote.push(item);
                  if (local.read && markNotificationsRead) {
                    await markNotificationsRead(accountId, { ids: [item.id] });
                    item.read = true;
                  }
                } catch { /* Keep locally saved sync notices until the backend is reachable. */ }
              }

              const pendingRead = remote.filter((item) => !item.read && items.some((saved) => saved.read && sameNotification(saved, item)));
              if (pendingRead.length && markNotificationsRead) {
                await markNotificationsRead(accountId, { ids: pendingRead.map((item) => item.id) });
                pendingRead.forEach((item) => { item.read = true; });
              }
              await verify(accountId);
              comments.set(accountId, new Map(remote.filter((item) => item.comment).map((item) => [item.id, item.comment])));
              const localOnly = items.filter((saved) => !remote.some((item) => sameNotification(saved, item)));
              const next = orderNewest([...remote, ...localOnly]);
              await write(accountId, next);
              items = next;
              return { items: present(accountId, items), error };
            }
            const payload = await fetchObservations(accountId);
            await verify(accountId);
            const events = eventsFromObservations(payload, accountId);
            const byId = new Map(items.map((item) => [item.id, item]));
            const feedback = new Map();
            for (const event of events) {
              const { comment, ...metadata } = event;
              if (comment) feedback.set(event.id, comment);
              if (!byId.has(event.id)) byId.set(event.id, { ...metadata, read: false });
            }
            const next = orderNewest([...byId.values()]);
            await write(accountId, next);
            comments.set(accountId, feedback);
            items = next;
          } catch (cause) {
            // Never expose a previous account's cache after a session change.
            await verify(accountId);
            error = cause instanceof Error ? cause.message : "Could not refresh notifications.";
          }
        } else if (user.offline) error = "You are offline. Showing notifications saved on this device.";
        await verify(accountId);
        return { items: present(accountId, items), error };
      });
    },
    markRead(accountId, ids, { all = false } = {}) {
      return enqueue(accountId, async () => {
        const user = await verify(accountId);
        const selected = new Set(ids);
        const items = await read(accountId);
        if (markNotificationsRead && !user.offline) {
          await markNotificationsRead(accountId, all ? { all: true } : { ids: [...selected] });
          await verify(accountId);
        }
        await write(accountId, items.map((item) => selected.has(item.id) || all ? { ...item, read: true } : item));
        emit(accountId);
      });
    },
    recordSync(accountId, { type, key, count }) {
      return enqueue(accountId, async () => {
        const user = await verify(accountId);
        if (!["sync_completed", "sync_failed"].includes(type) || typeof key !== "string" || !key ||
            (type === "sync_completed" && (!Number.isInteger(count) || count < 1))) throw Error("Invalid synchronization notification.");
        const items = await read(accountId);
        const id = `${type}:${key}`;
        if (items.some((item) => item.id === id || notificationSourceKey(item) === `sync:${type}:${key}`)) return;
        let item = null;
        if (!user.offline && recordSyncRemote) {
          try {
            const result = await recordSyncRemote(accountId, { type, key, ...(type === "sync_completed" ? { count } : {}) });
            item = normalizeRemoteNotification(result?.notification);
            await verify(accountId);
          } catch { /* Preserve sync outcomes locally if notification delivery is unavailable. */ }
        }
        if (!item) item = { id, sourceKey: `sync:${type}:${key}`, type, createdAt: now(), read: false, ...(type === "sync_completed" ? { count } : { draftKey: key }) };
        const next = orderNewest([...items.filter((saved) => !sameNotification(saved, item)), item]);
        await write(accountId, next);
        emit(accountId);
      });
    },
  };
}
