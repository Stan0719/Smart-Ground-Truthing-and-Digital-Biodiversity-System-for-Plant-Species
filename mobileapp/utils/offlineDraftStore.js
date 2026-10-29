// Pure persistence engine; native encryption and account checks are injected.
export function createDraftStore({
  storage,
  encrypt,
  decrypt,
  authorize,
  availableBytes = async () => Infinity,
  maxBytes = 900000,
}) {
  const prefix = "@niah/field-drafts/";
  let pending = Promise.resolve();
  function serial(operation) {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  }
  async function load(accountId) {
    await authorize(accountId);
    const raw = await storage.getItem(prefix + accountId);
    if (!raw) {
      await authorize(accountId);
      return [];
    }
    try {
      const saved = JSON.parse(raw);
      const rows = Array.isArray(saved)
        ? saved
        : JSON.parse(await decrypt(accountId, saved));
      if (!Array.isArray(rows)) throw Error("Invalid drafts");
      await authorize(accountId);
      // Upgrade only after encryption and round-trip verification succeed.
      // A failed conversion leaves the original storage value untouched.
      if (Array.isArray(saved)) await write(accountId, rows, true);
      return rows;
    } catch {
      throw Error(
        "Saved drafts could not be opened. Nothing was deleted; sign in with their owner account and retry.",
      );
    }
  }
  async function write(accountId, rows, verifyConversion = false) {
    const plain = JSON.stringify(rows);
    const bytes = new TextEncoder().encode(plain).byteLength;
    if (bytes > maxBytes || (await availableBytes()) < bytes * 4 + 1048576)
      throw Error(
        "Not enough draft storage. Previous drafts are safe. Keep this form open, use fewer/smaller photos or synchronize saved drafts first.",
      );
    const payload = JSON.stringify(await encrypt(accountId, plain));
    if (verifyConversion &&
        await decrypt(accountId, JSON.parse(payload)) !== plain)
      throw Error("Draft encryption verification failed. Original drafts are safe.");
    await authorize(accountId);
    // One atomic replacement: never remove the previous value before a successful write.
    try {
      await storage.setItem(prefix + accountId, payload);
    } catch {
      throw Error(
        "Draft was not saved because device storage is unavailable. Previous drafts are safe; keep this form open and free space before retrying.",
      );
    }
  }
  return {
    readDrafts: (id) => serial(() => load(id)),
    saveDraft: (id, draft) =>
      serial(async () => {
        const rows = await load(id);
        const index = rows.findIndex(
          (row) => row.client_key === draft.client_key,
        );
        if (index < 0) rows.push(draft);
        else rows[index] = draft;
        await write(id, rows);
      }),
    removeDraft: (id, key, expected) =>
      serial(async () => {
        const rows = await load(id);
        if (
          expected &&
          JSON.stringify(rows.find((row) => row.client_key === key)) !==
            JSON.stringify(expected)
        )
          return false;
        await write(
          id,
          rows.filter((row) => row.client_key !== key),
        );
        return true;
      }),
  };
}
