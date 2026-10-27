import { readDrafts, removeDraft } from "./fieldStorage";
import { plantApi } from "./plantApi";
import { faceSession } from "./faceSession";
const running = new Map();
export function syncDrafts(accountId) {
  if (running.has(accountId)) return running.get(accountId);
  const task = (async () => {
    const user = await faceSession.restore();
    if (user?.id !== accountId || user.role !== "botanist")
      throw Error("Sign in with the draft owner account to synchronize.");
    let synced = 0;
    for (const draft of await readDrafts(accountId)) {
      const current = await faceSession.restore();
      if (current?.id !== accountId || current.role !== "botanist")
        throw Error("The draft owner session changed.");
      let saved;
      const changed = (row) =>
        row.content &&
        Object.keys({ ...row.content, ...draft.body.content }).some(
          (key) => row.content[key] !== draft.body.content[key],
        );
      if (draft.method === "PATCH") {
        const result = await plantApi("/observations", {
          expectedAccountId: accountId,
        });
        saved = result.observations.find(
          (row) => row.id === draft.path.split("/").pop(),
        );
        if (!saved)
          throw Error(
            "The owned observation is unavailable. Its correction remains saved locally.",
          );
        if (
          changed(saved) ||
          (saved.status !== "Draft" && saved.revision === draft.body.revision)
        ) {
          saved = await plantApi(draft.path, {
            method: "PATCH",
            body: draft.body,
            expectedAccountId: accountId,
          });
        }
      } else {
        saved = await plantApi(draft.path, {
          method: "POST",
          body: draft.body,
          expectedAccountId: accountId,
        });
        if (changed(saved)) {
          if (saved.status !== "Draft")
            throw Error(
              "The server has a submitted version of this draft. Local changes remain saved; refresh observations before editing.",
            );
          saved = await plantApi(`/observations/${saved.id}`, {
            method: "PATCH",
            body: { content: draft.body.content, revision: saved.revision },
            expectedAccountId: accountId,
          });
        }
      }
      for (const asset of draft.assets || [])
        await plantApi("/assets", {
          method: "POST",
          body: {
            ...asset,
            plant_id: saved.plant_id,
            observation_id: saved.id,
          },
          expectedAccountId: accountId,
        });
      await plantApi(`/observations/${saved.id}/submit`, {
        method: "POST",
        body: {},
        expectedAccountId: accountId,
      });
      if ((await removeDraft(accountId, draft.client_key, draft)) !== false)
        synced++;
    }
    return synced;
  })().finally(() => running.delete(accountId));
  running.set(accountId, task);
  return task;
}
