import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState } from "react-native";
import { createBotanistRecordsLoader, fetchBotanistRecords } from "./botanistRecords";

export function useBotanistRecords(accountId) {
  const [state, setState] = useState({ accountId, plants: [], observations: [], requests: [], loading: true, loaded: false, error: "" });
  const loader = useMemo(() => createBotanistRecordsLoader(() => fetchBotanistRecords(accountId),
    (next) => setState({ accountId, ...next })), [accountId]);
  useFocusEffect(useCallback(() => {
    void loader.refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loader.refresh(); });
    return () => { subscription.remove(); loader.cancel(); };
  }, [loader]));
  const current = state.accountId === accountId ? state : { ...loader.getState(), plants: [], requests: [], observations: [] };
  return { ...current, refresh: loader.refresh };
}
