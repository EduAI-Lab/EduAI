import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "~/hooks/api/config";

/** One row in any chat-history list (sidebar, course tab, admin per-user). */
export interface ChatHistoryItem {
  id: string;
  title: string | null;
  preview: string | null;
  courseId: string | null;
  courseCode: string | null;
  courseName: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTranscript {
  chat: {
    id: string;
    title: string | null;
    systemPrompt: string | null;
    adhdAssist: boolean;
    courseId: string | null;
    courseCode: string | null;
    courseName: string | null;
    ownerId: string;
    ownerName: string | null;
    updatedAt: string;
  };
  /** AI-SDK `Message`-shaped objects, ordered. Seed `useChat` or render read-only. */
  messages: Array<Record<string, unknown>>;
  canEdit: boolean;
}

export interface ChatHistoryFilters {
  courseId?: string;
  userId?: string;
  scope?: "own" | "all";
  limit?: number;
  /** Skip fetching until true (e.g. tab not yet opened). */
  enabled?: boolean;
}

function buildQuery(filters: ChatHistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.courseId) params.set("courseId", filters.courseId);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Lists chats the caller may read, optionally scoped by course / owner / own.
 * Backed by `GET /api/chats` (RBAC enforced server-side).
 */
export function useChatHistory(filters: ChatHistoryFilters = {}) {
  const { courseId, userId, scope, limit, enabled = true } = filters;
  const [chats, setChats] = useState<ChatHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ chats: ChatHistoryItem[] }>(
        `/api/chats${buildQuery({ courseId, userId, scope, limit })}`,
      );
      setChats(data.chats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat history");
    } finally {
      setIsLoading(false);
    }
  }, [courseId, userId, scope, limit]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ chats: ChatHistoryItem[] }>(
          `/api/chats${buildQuery({ courseId, userId, scope, limit })}`,
        );
        if (!cancelled) setChats(data.chats);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chat history");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, userId, scope, limit, enabled]);

  return { chats, isLoading, error, refresh };
}

/** Imperatively load a chat's full transcript + edit permission. */
export async function fetchChatTranscript(
  chatId: string,
): Promise<ChatTranscript | null> {
  try {
    return await apiFetch<ChatTranscript>(`/api/chats/${chatId}/messages`);
  } catch {
    return null;
  }
}
