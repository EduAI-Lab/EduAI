import { useEffect, useState } from "react";
import { apiFetch } from "~/hooks/api/config";
import type { DashboardStats } from "~/routes/api/dashboard.stats";

export type { DashboardStats };

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<DashboardStats>("/api/dashboard/stats");
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch stats");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, isLoading, error };
}
