import { useEffect, useState } from "react";
import { apiFetch } from "~/hooks/api/config";

export interface RecentChat {
  id: string;
  title: string | null;
  preview: string | null;
  courseCode: string | null;
  courseName: string | null;
  userName: string | null;
  updatedAt: string;
}

export function useRecentChats(limit = 5) {
  const [chats, setChats] = useState<RecentChat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ chats: RecentChat[] }>(`/api/chats?limit=${limit}`);
        if (!cancelled) {
          setChats(data.chats);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch chats");
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
  }, [limit]);

  return { chats, isLoading, error };
}
