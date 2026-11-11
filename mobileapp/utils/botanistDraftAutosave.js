import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { AppState } from "react-native";

// The first durable write starts quickly after a meaningful change. A longer
// fallback timer retries failed writes and keeps the old full-draft cadence.
const FAST_WRITE_MS = 300;
const MAX_WRITE_WAIT_MS = 1000;
const FULL_WRITE_MS = 2000;
const detachedFailures = new Map();
const failureListeners = new Set();
const activeWriters = new Map();

function emitFailures() {
  const failures = [...detachedFailures.entries()].map(([key, value]) => ({ key, message: value.message }));
  failureListeners.forEach((listener) => listener(failures));
}

export function subscribeBotanistDraftAutosaveFailures(listener) {
  failureListeners.add(listener);
  listener([...detachedFailures.entries()].map(([key, value]) => ({ key, message: value.message })));
  return () => failureListeners.delete(listener);
}

export async function retryBotanistDraftAutosave(key) {
  const failure = detachedFailures.get(key);
  if (!failure) return false;
  await failure.retry();
  return true;
}

export async function stopBotanistDraftAutosave(accountId, clientKey) {
  if (!accountId || !clientKey) return;
  const writer = activeWriters.get(`${accountId}:${clientKey}`);
  if (writer) await writer.stop();
}

/**
 * Debounced, serialized autosave backed by the caller's encrypted draft store.
 * Back/gesture navigation is deliberately never prevented: blur/unmount starts
 * a best-effort flush and the pending async write may complete after unmount.
 */
export function useBotanistDraftAutosave({ enabled, signature, save, navigation, onSaving, onError, errorKey, accountId }) {
  const config = useRef({ save, onSaving, onError, errorKey, accountId });
  const state = useRef({ fastTimer: null, maxTimer: null, fullTimer: null, latest: 0, written: 0, running: null, stopped: false, errorKey });
  const flushRef = useRef(null);
  const stopRef = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => { config.current = { save, onSaving, onError, errorKey, accountId }; }, [save, onSaving, onError, errorKey, accountId]);

  const flush = useCallback(async () => {
    const current = state.current;
    if (current.fastTimer) clearTimeout(current.fastTimer);
    if (current.maxTimer) clearTimeout(current.maxTimer);
    if (current.fullTimer) clearTimeout(current.fullTimer);
    current.fastTimer = null;
    current.maxTimer = null;
    current.fullTimer = null;

    if (current.running) await current.running;
    if (current.stopped || current.written >= current.latest) return;

    current.running = (async () => {
      while (!current.stopped && current.written < current.latest) {
        const version = current.latest;
        const attemptKey = current.errorKey;
        try {
          if (mounted.current) config.current.onSaving?.();
          // The form callback captures the current complete snapshot and writes
          // it through the existing encrypted store. No React state is needed
          // after the write starts, so it remains safe when the screen unmounts.
          const saved = await config.current.save({ isMounted: () => mounted.current, version });
          current.written = version;
          if (saved?.client_key) current.storeKey = saved.client_key;
          current.storeAccountId = config.current.accountId;
          if (current.storeAccountId && current.storeKey && stopRef.current)
            activeWriters.set(`${current.storeAccountId}:${current.storeKey}`, { stop: stopRef.current });
          if (attemptKey) {
            detachedFailures.delete(attemptKey);
            emitFailures();
          }
        } catch (error) {
          if (mounted.current) config.current.onError?.(error);
          else if (attemptKey) {
            detachedFailures.set(attemptKey, { message: error?.message || "", retry: () => flushRef.current?.() });
            emitFailures();
          }
          throw error;
        }
      }
    })();
    try {
      await current.running;
    } catch (error) {
      if (!current.stopped && current.written < current.latest && !current.fullTimer) {
        current.fullTimer = setTimeout(() => { void flushRef.current?.().catch(() => {}); }, FULL_WRITE_MS);
      }
      throw error;
    } finally { current.running = null; }
  }, []);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const retry = useCallback(() => flush(), [flush]);

  const stop = useCallback(async () => {
    const current = state.current;
    current.stopped = true;
    if (current.fastTimer) clearTimeout(current.fastTimer);
    if (current.maxTimer) clearTimeout(current.maxTimer);
    if (current.fullTimer) clearTimeout(current.fullTimer);
    current.fastTimer = null;
    current.maxTimer = null;
    current.fullTimer = null;
    if (current.running) await current.running.catch(() => {});
    if (current.errorKey) {
      detachedFailures.delete(current.errorKey);
      emitFailures();
    }
    if (current.storeAccountId && current.storeKey) activeWriters.delete(`${current.storeAccountId}:${current.storeKey}`);
  }, []);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  useLayoutEffect(() => {
    const current = state.current;
    if (current.stopped) return;
    if (!enabled || !signature) {
      if (current.fastTimer) clearTimeout(current.fastTimer);
      if (current.maxTimer) clearTimeout(current.maxTimer);
      if (current.fullTimer) clearTimeout(current.fullTimer);
      current.fastTimer = null;
      current.maxTimer = null;
      current.fullTimer = null;
      return;
    }

    current.latest += 1;
    current.errorKey = errorKey;
    if (current.fastTimer) clearTimeout(current.fastTimer);
    if (current.fullTimer) clearTimeout(current.fullTimer);
    current.fastTimer = setTimeout(() => { void flush().catch(() => {}); }, FAST_WRITE_MS);
    if (!current.maxTimer) current.maxTimer = setTimeout(() => { void flush().catch(() => {}); }, MAX_WRITE_WAIT_MS);
    current.fullTimer = setTimeout(() => { void flush().catch(() => {}); }, FULL_WRITE_MS);
  }, [enabled, signature, flush, errorKey]);

  useEffect(() => {
    const appState = AppState.addEventListener("change", (next) => {
      if (next !== "active") void flush().catch(() => {});
    });
    const blur = navigation?.addListener?.("blur", () => { void flush().catch(() => {}); });
    return () => {
      appState.remove();
      blur?.();
      // React Navigation proceeds immediately; this best-effort write does not
      // hold the transition or install a native-stack removal guard.
      void flush().catch(() => {});
    };
  }, [flush, navigation]);

  return { flush, retry, stop };
}
