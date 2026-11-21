export const emptyScanHistory = {
  mode: null,
  scans: [],
  nextOffset: null,
  phase: "idle",
  error: null,
  pageError: null,
};

export function createScanHistoryLoader({ fetchPage, fetchAll }, onChange) {
  let state = emptyScanHistory;
  let generation = 0;

  const update = (changes) => {
    state = { ...state, ...changes };
    onChange(state);
  };

  return {
    resume(mode) {
      if (mode !== "paged" || state.mode !== mode || !state.scans.length || state.error) return false;
      if (state.phase === "more") update({ phase: "idle" });
      return state.phase === "idle";
    },
    async refresh(mode, pull = false) {
      const request = ++generation;
      const sameMode = mode === state.mode;
      update({
        mode,
        scans: sameMode ? state.scans : [],
        nextOffset: null,
        phase: pull ? "refresh" : "initial",
        error: null,
        pageError: null,
      });
      try {
        const page = mode === "all"
          ? { scans: await fetchAll(() => request === generation), nextOffset: null }
          : await fetchPage(0);
        if (request !== generation) return;
        update({ ...page, scans: uniqueScans(page.scans), phase: "idle" });
      } catch (error) {
        if (request === generation) {
          update({ error, phase: "idle", ...(accessLost(error) ? { scans: [] } : {}) });
        }
      }
    },
    async loadMore({ retry = false } = {}) {
      const { mode, nextOffset, phase, pageError } = state;
      if (mode !== "paged" || nextOffset === null || phase !== "idle" || (pageError && !retry)) return;
      const request = ++generation;
      update({ phase: "more", pageError: null });
      try {
        const page = await fetchPage(nextOffset);
        if (request !== generation) return;
        update({ ...page, scans: uniqueScans([...state.scans, ...page.scans]), phase: "idle" });
      } catch (error) {
        if (request === generation) {
          update(accessLost(error)
            ? { scans: [], nextOffset: null, error, phase: "idle" }
            : { pageError: error, phase: "idle" });
        }
      }
    },
    cancel() {
      generation += 1;
    },
  };
}

function accessLost(error) {
  return [401, 403].includes(error?.status) ||
    ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error?.code);
}

function uniqueScans(scans) {
  const seen = new Set();
  return scans.filter((scan) => {
    const id = String(scan.scan_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
