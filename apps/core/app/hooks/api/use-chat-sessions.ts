import { useCallback, useEffect, useState } from "react";

import { apiFetch, STUB_ONLY } from "~/hooks/api/config";
import type { ChatSessionMeta } from "~/hooks/api/types";

export function useChatSession(chatId: string | null) {
  const [session, setSession] = useState<ChatSessionMeta | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatId) {
      setSession(null);
      setError(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<ChatSessionMeta>(`/api/chats/${chatId}`);
        if (!cancelled) {
          setSession(data);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load chat session:", err);
          setSession(null);
          setError(err instanceof Error ? err.message : "Failed to load chat");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  const deleteChatSession = useCallback(async (id: string) => {
    if (STUB_ONLY.deleteChat) {
      console.warn("[useChatSession] deleteChat stub — Core API #302 not implemented");
      return;
    }

    await apiFetch<void>(`/api/chats/${id}`, { method: "DELETE" });
  }, []);

  return {
    session,
    isLoading,
    error,
    deleteChatSession,
  };
}

/** Load chat metadata by id (imperative helper for routes). */
export async function fetchChatSession(
  chatId: string,
): Promise<ChatSessionMeta | null> {
  try {
    return await apiFetch<ChatSessionMeta>(`/api/chats/${chatId}`);
  } catch {
    return null;
  }
}
