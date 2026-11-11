import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { botanistNotifications } from "./botanistNotifications";

export function useBotanistNotifications(accountId) {
  const [state, setState] = useState({ accountId, items: [], loading: true, loaded: false, error: "" });
  const visit = useRef(0);
  const pending = useRef(null);
  const refresh = useCallback((remote = true) => {
    if (!accountId) return Promise.resolve();
    if (pending.current) return pending.current;
    const currentVisit = visit.current;
    setState((old) => ({ ...(old.accountId === accountId ? old : { items: [], loaded: false }), accountId, loading: true, error: "" }));
    const task = botanistNotifications.load(accountId, { refresh: remote }).then((result) => {
      if (visit.current === currentVisit) setState({ accountId, ...result, loading: false, loaded: true });
    }).catch((error) => {
      if (visit.current === currentVisit) setState((old) => ({
        ...(error.code === "NOTIFICATION_ACCESS_DENIED" || old.accountId !== accountId ? { items: [], loaded: false } : old),
        accountId, loading: false, error: error.message || "Unable to load notifications. Sign in again or check your connection.",
      }));
    }).finally(() => {
      if (pending.current === task) pending.current = null;
    });
    pending.current = task;
    return task;
  }, [accountId]);

  useFocusEffect(useCallback(() => {
    let focused = true;
    visit.current += 1;
    void refresh();
    let lastAppState = AppState.currentState;
    const appState = AppState.addEventListener("change", (next) => {
      if (focused && next === "active" && lastAppState !== "active") void refresh();
      lastAppState = next;
    });
    const unsubscribe = botanistNotifications.subscribe((owner) => {
      if (owner !== accountId) return;
      if (pending.current) void pending.current.then(() => { if (focused) return refresh(false); });
      else void refresh(false);
    });
    return () => {
      focused = false;
      visit.current += 1;
      pending.current = null;
      appState.remove();
      unsubscribe();
    };
  }, [accountId, refresh]));

  const current = state.accountId === accountId ? state : { items: [], loading: true, loaded: false, error: "" };
  return { ...current, unreadCount: current.items.filter((item) => !item.read).length, refresh };
}
