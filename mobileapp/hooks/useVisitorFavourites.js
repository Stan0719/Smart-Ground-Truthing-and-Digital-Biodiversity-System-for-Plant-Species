import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { fetchVisitorFavourites, setVisitorFavourite } from "../utils/visitorFeatures";

const emptyData = () => ({ plants: [], species: [] });
const itemId = (type, item) => String(type === "plant" ? item.plantId : item.id);
const collectionFor = (type) => type === "plant" ? "plants" : "species";

export default function useVisitorFavourites(user) {
  const isVisitor = user?.role?.toLowerCase() === "visitor";
  const accountId = isVisitor ? user.id : null;
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [pending, setPending] = useState(new Set());
  const dataRef = useRef(data);
  const pendingRef = useRef(new Set());
  dataRef.current = data;

  const refresh = useCallback(async (pull = false) => {
    if (!isVisitor) {
      setData(emptyData());
      setError("");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!accountId) {
      setData(emptyData());
      setError("Sign in as a Visitor to use favourites.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (pull) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const next = await fetchVisitorFavourites(accountId);
      dataRef.current = next;
      setData(next);
    } catch (cause) {
      setError(cause?.message || "Unable to load favourites.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accountId, isVisitor]);

  useFocusEffect(useCallback(() => {
    void refresh(false);
  }, [refresh]));

  const isFavourite = useCallback((type, id) => {
    const collection = collectionFor(type);
    return dataRef.current[collection].some((item) => itemId(type, item) === String(id));
  }, []);

  const toggle = useCallback(async (type, id) => {
    const collection = collectionFor(type);
    const key = `${type}:${id}`;
    if (!accountId || pendingRef.current.has(key)) return false;
    const before = dataRef.current;
    const wasFavourite = before[collection].some((item) => itemId(type, item) === String(id));
    const originalItem = before[collection].find((item) => itemId(type, item) === String(id));
    const optimistic = {
      ...before,
      [collection]: wasFavourite
        ? before[collection].filter((item) => itemId(type, item) !== String(id))
        : [...before[collection], type === "plant" ? { plantId: String(id) } : { id: String(id) }],
    };
    pendingRef.current = new Set(pendingRef.current).add(key);
    setPending(new Set(pendingRef.current));
    dataRef.current = optimistic;
    setData(optimistic);
    setMutationError("");
    try {
      await setVisitorFavourite(accountId, type, id, !wasFavourite);
      return true;
    } catch (cause) {
      const current = dataRef.current;
      const rolledBack = {
        ...current,
        [collection]: wasFavourite
          ? current[collection].some((item) => itemId(type, item) === String(id))
            ? current[collection]
            : [...current[collection], originalItem]
          : current[collection].filter((item) => itemId(type, item) !== String(id)),
      };
      dataRef.current = rolledBack;
      setData(rolledBack);
      setMutationError(cause?.message || "Unable to update this favourite.");
      return false;
    } finally {
      const nextPending = new Set(pendingRef.current);
      nextPending.delete(key);
      pendingRef.current = nextPending;
      setPending(nextPending);
    }
  }, [accountId]);

  const isPending = useCallback((type, id) => pending.has(`${type}:${id}`), [pending]);
  return { data, loading, refreshing, error, mutationError, refresh, isFavourite, isPending, toggle };
}
