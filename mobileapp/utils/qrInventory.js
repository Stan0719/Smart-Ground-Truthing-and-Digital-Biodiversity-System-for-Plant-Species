export function normalizeQRCodes(payload) {
  if (!Array.isArray(payload?.qr_codes)) {
    throw Error("The server returned an invalid QR inventory. Please refresh again.");
  }
  const records = new Map();
  const tokens = new Map();
  for (const code of payload.qr_codes) {
    const id = String(code?.qr_id ?? "");
    if (!/^[1-9]\d*$/.test(id) || typeof code.qr_code !== "string" ||
        !code.qr_code.trim() || code.qr_code.length > 200 ||
        typeof code.status !== "string" || !code.status.trim() ||
        (code.plant_id != null && !/^[1-9]\d*$/.test(String(code.plant_id)))) {
      throw Error("The server returned an invalid QR record. Your previous list has been kept.");
    }
    const record = {
      id,
      label: `QR-${id.padStart(4, "0")}`,
      plantId: code.plant_id == null ? null : String(code.plant_id),
      value: code.qr_code,
      status: code.status,
    };
    if (records.has(id) && JSON.stringify(records.get(id)) !== JSON.stringify(record)) {
      throw Error("The server returned conflicting QR records. Please refresh again.");
    }
    if (tokens.has(record.value) && tokens.get(record.value) !== id) {
      throw Error("The server returned duplicate QR tokens. Your previous list has been kept.");
    }
    records.set(id, record);
    tokens.set(record.value, id);
  }
  // Compare integer strings without losing precision for PostgreSQL bigint IDs.
  return [...records.values()].sort((a, b) =>
    b.id.length - a.id.length || b.id.localeCompare(a.id),
  );
}

export const emptyQRInventory = () => ({
  records: [], hasLoaded: false, loading: false, error: "",
});

// One read at a time; responses from a previous screen visit are ignored.
export function createQRInventoryLoader(fetchCodes, onChange) {
  let state = emptyQRInventory();
  let version = 0;
  let pending = null;
  const update = (changes) => {
    state = { ...state, ...changes };
    onChange(state);
  };
  return {
    getState: () => state,
    refresh() {
      if (pending) return pending;
      const requestVersion = ++version;
      update({ loading: true, error: "" });
      pending = Promise.resolve().then(fetchCodes).then((payload) => {
        if (requestVersion !== version) return false;
        const records = normalizeQRCodes(payload);
        update({ records, hasLoaded: true });
        return true;
      }).catch((error) => {
        if (requestVersion === version) {
          update({ error: error instanceof Error ? error.message : "Could not load QR codes. Check your connection and sign-in, then refresh." });
        }
        return false;
      }).finally(() => {
        if (requestVersion === version) {
          pending = null;
          update({ loading: false });
        }
      });
      return pending;
    },
    cancel() {
      version += 1;
      pending = null;
      state = { ...state, loading: false };
    },
    addGenerated(payload) {
      const generated = normalizeQRCodes(payload);
      if (!generated.length) throw Error("The server did not return the generated QR codes. Refresh before generating again.");
      version += 1;
      pending = null;
      const combined = new Map(state.records.map((qr) => [qr.id, qr]));
      for (const qr of generated) combined.set(qr.id, qr);
      update({ records: [...combined.values()].sort((a, b) => b.id.length - a.id.length || b.id.localeCompare(a.id)), hasLoaded: true, loading: false, error: "" });
      return generated.length;
    },
  };
}
