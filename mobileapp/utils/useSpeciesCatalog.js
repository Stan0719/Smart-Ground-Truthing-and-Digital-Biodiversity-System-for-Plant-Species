import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState } from "react-native";
import { fetchOwnedSpeciesRequests, fetchPlantSpeciesCounts, fetchSpeciesCatalog } from "./plantApi";

const empty = () => ({ species: [], ownedRequests: [], counts: null, loading: true, error: "" });
const PUBLIC_REVISIT_MS = 15_000;
const denied = (error) => [401, 403].includes(error?.status) || ["SESSION_REQUIRED", "SESSION_CHANGED", "ACCOUNT_MISMATCH"].includes(error?.code);

export function useSpeciesCatalog(accountId, { publicOnly = false, includeOwnedRequests = false } = {}) {
  const [state, setState] = useState({ accountId, publicOnly, includeOwnedRequests, ...empty() });
  const loader = useMemo(() => {
    let current = empty(), pending = null, visit = 0, lastSuccess = null;
    const publish = (next) => { current = next; setState({ accountId, publicOnly, includeOwnedRequests, ...next }); };
    return {
      cancel() { visit += 1; pending = null; },
      resume() {
        if (publicOnly && !current.loading && !current.error && lastSuccess != null &&
          Date.now() - lastSuccess < PUBLIC_REVISIT_MS) return;
        return this.refresh();
      },
      refresh() {
        if (pending) return pending;
        const generation = visit;
        publish({ ...current, loading: true, error: "" });
        const task = (async () => {
          try {
            const optional = (request, fallback, message) => request.then(
              (data) => ({ data, error: "" }),
              (error) => {
                if (denied(error)) throw error;
                return { data: fallback, error: message };
              },
            );
            let valid = true;
            try {
              const [species, requests, counts] = await Promise.all([
                fetchSpeciesCatalog({ accountId, publicOnly }).then((species) => {
                  if (valid && generation === visit) publish({ ...current, species });
                  return species;
                }),
                optional(includeOwnedRequests && !publicOnly && accountId
                  ? fetchOwnedSpeciesRequests(accountId) : Promise.resolve([]), current.ownedRequests, "species.requestsRefreshFailed"),
                optional(fetchPlantSpeciesCounts({ accountId, publicOnly }), null, "Species loaded, but plant counts could not be refreshed. Pull to refresh and retry."),
              ]);
              if (generation === visit) {
                const error = requests.error || counts.error;
                lastSuccess = error ? null : Date.now();
                publish({ species, ownedRequests: requests.data, counts: counts.data, loading: false, error });
              }
            } finally {
              valid = false;
            }
          } catch (error) {
            if (generation === visit) publish({ ...(denied(error) ? empty() : current), loading: false, error: error.message || "Unable to load species." });
          }
        })().finally(() => { if (pending === task) pending = null; });
        pending = task;
        return task;
      },
    };
  }, [accountId, publicOnly, includeOwnedRequests]);
  useFocusEffect(useCallback(() => {
    void loader.resume();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loader.refresh(); });
    return () => { subscription.remove(); loader.cancel(); };
  }, [loader]));
  return { ...(state.accountId === accountId && state.publicOnly === publicOnly && state.includeOwnedRequests === includeOwnedRequests ? state : empty()), refresh: loader.refresh };
}
