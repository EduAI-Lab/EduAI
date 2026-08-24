import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  AI_REVIEW_HISTORY_CLEARED_EVENT,
  getAiReviewHistoryStorageKey,
  loadAiReviewHistory,
  saveAiReviewHistory,
  type AiReviewHistoryItem,
} from "../services/aiReviewHistoryStorage";

export type { AiReviewHistoryItem } from "../services/aiReviewHistoryStorage";

export interface UseAiReviewHistoryReturn {
  items: AiReviewHistoryItem[];
  isReady: boolean;
  setItems: Dispatch<SetStateAction<AiReviewHistoryItem[]>>;
}

export function useAiReviewHistory(): UseAiReviewHistoryReturn {
  const { user } = useAuth();
  const storageKey = getAiReviewHistoryStorageKey(user?.id);
  const [history, setHistory] = useState<{
    storageKey: string | null;
    items: AiReviewHistoryItem[];
    isReady: boolean;
  }>({ storageKey: null, items: [], isReady: false });

  const isCurrentAccount = history.storageKey === storageKey;
  const items = isCurrentAccount ? history.items : [];
  const isReady = isCurrentAccount && history.isReady;

  useEffect(() => {
    setHistory({ storageKey, items: loadAiReviewHistory(storageKey), isReady: true });
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setHistory({ storageKey, items: loadAiReviewHistory(storageKey), isReady: true });
      }
    };
    const handleHistoryCleared = (event: Event) => {
      const clearedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (clearedUserId === user?.id) {
        setHistory({ storageKey, items: [], isReady: true });
      }
    };
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(AI_REVIEW_HISTORY_CLEARED_EVENT, handleHistoryCleared);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(AI_REVIEW_HISTORY_CLEARED_EVENT, handleHistoryCleared);
    };
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (history.storageKey === storageKey && history.isReady) {
      saveAiReviewHistory(storageKey, history.items);
    }
  }, [history, storageKey]);

  const setItems = useCallback<Dispatch<SetStateAction<AiReviewHistoryItem[]>>>(
    (nextItems) => {
      setHistory((previous) => {
        if (previous.storageKey !== storageKey) return previous;
        const resolvedItems =
          typeof nextItems === "function" ? nextItems(previous.items) : nextItems;
        return { ...previous, items: resolvedItems };
      });
    },
    [storageKey],
  );

  return { items, isReady, setItems };
}
