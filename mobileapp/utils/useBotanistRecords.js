import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState } from "react-native";
import { createBotanistRecordsLoader, fetchBotanistRecords } from "./botanistRecords";
import { faceSession } from "./faceSession";
import { watchStatus } from "./statusRefresh";

export function useBotanistRecords(accountId) {
  const [state, setState] = useState({ accountId, plants: [], observations: [], requests: [], edits: [], recordChanges: [], loading: true, loaded: false, error: "" });
  const loader = useMemo(() => createBotanistRecordsLoader(() => fetchBotanistRecords(accountId),
    (next) => setState({ accountId, ...next })), [accountId]);
  useEffect(() => faceSession.subscribe(({ authenticated }) => { if (!authenticated) loader.clear(); }), [loader]);
  useFocusEffect(useCallback(() => {
    if (!accountId) return undefined;
    void loader.refresh();
    const stop = watchStatus(AppState, loader.refresh);
    return () => { stop(); loader.cancel(); };
  }, [accountId, loader]));
  const current = state.accountId === accountId ? state : { ...loader.getState(), plants: [], requests: [], observations: [], edits: [], recordChanges: [] };
  // Retain the verified snapshot in the loader, but never offer stale statuses as
  // current correction tasks. A successful retry makes them available again.
  return { ...current, edits: current.editsStale ? [] : current.edits, refresh: loader.refresh };
}
