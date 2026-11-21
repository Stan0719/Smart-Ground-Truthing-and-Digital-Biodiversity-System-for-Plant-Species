export const STATUS_REFRESH_INTERVAL_MS = 120_000;

// Used from focused screens. Schedule only after the previous read finishes.
export function watchStatus(appState, refresh, { interval = STATUS_REFRESH_INTERVAL_MS } = {}) {
  if (!appState) return () => {};
  let active = appState?.currentState == null || appState.currentState === "active";
  let stopped = false;
  let busy = false;
  let timer;
  function schedule() {
    clearTimeout(timer);
    if (!stopped && active && interval) timer = setTimeout(run, interval);
  }
  async function run() {
    if (stopped || !active || busy) return;
    busy = true;
    try { await refresh(); } catch { /* The screen retains its last data and handles the error. */ }
    finally {
      busy = false;
      schedule();
    }
  }
  const listener = appState?.addEventListener("change", (state) => {
    const wasActive = active;
    active = state === "active";
    if (!active) clearTimeout(timer);
    if (active && !wasActive) void run();
  });
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    listener?.remove();
  };
}
