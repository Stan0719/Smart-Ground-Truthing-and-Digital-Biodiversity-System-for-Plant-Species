import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState } from "react-native";
import { fetchPlantRecords, fetchSpeciesCatalog } from "./plantApi";

const empty = () => ({ species: [], counts: {}, loading: true, error: "" });
const denied = (error) => [401, 403].includes(error?.status) || ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error?.code);

export function useSpeciesCatalog(accountId, { publicOnly = false } = {}) {
  const [state, setState] = useState({ accountId, publicOnly, ...empty() });
  const loader = useMemo(() => {
    let current = empty(), pending = null, visit = 0;
    const publish = (next) => { current = next; setState({ accountId, publicOnly, ...next }); };
    return {
      cancel() { visit += 1; pending = null; },
      refresh() {
        if (pending) return pending;
        const generation = visit;
        publish({ ...current, loading: true, error: "" });
        const task = (async () => {
          try {
            const species = await fetchSpeciesCatalog({ accountId, publicOnly });
            if (generation !== visit) return;
            publish({ ...current, species, loading: true });
            try {
              const records = await fetchPlantRecords(species, { accountId, publicOnly });
              const counts = {};
              records.filter((record) => record.currentStatus === "Approved").forEach((record) => {
                counts[record.speciesId] = (counts[record.speciesId] || 0) + 1;
              });
              if (generation === visit) publish({ ...current, counts, loading: false });
            } catch (error) {
              if (denied(error)) throw error;
              if (generation === visit) publish({ ...current, counts: null, loading: false, error: "Species loaded, but plant counts could not be refreshed. Pull to refresh and retry." });
            }
          } catch (error) {
            if (generation === visit) publish({ ...(denied(error) ? empty() : current), loading: false, error: error.message || "Unable to load species." });
          }
        })().finally(() => { if (pending === task) pending = null; });
        pending = task;
        return task;
      },
    };
  }, [accountId, publicOnly]);
  useFocusEffect(useCallback(() => {
    void loader.refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loader.refresh(); });
    return () => { subscription.remove(); loader.cancel(); };
  }, [loader]));
  return { ...(state.accountId === accountId && state.publicOnly === publicOnly ? state : empty()), refresh: loader.refresh };
}
