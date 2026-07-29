import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import {
  initialPaginationState,
  paginationQuery,
  type PaginatedResponse,
  type PaginationState,
} from "~/hooks/api/pagination";
import type { AIProvider } from "~/hooks/api/types";

function normalizeProvider(provider: AIProvider): AIProvider {
  return {
    ...provider,
    _count: provider._count ?? { models: 0 },
  };
}

export type UseAiProvidersOptions = {
  /** Rows per request. Callers that also drive a provider picker pass the max. */
  pageSize?: number;
};

/** Server-paginated AI provider list (#1041). */
export function useAiProviders(options: UseAiProvidersOptions = {}) {
  const [pagination, setPagination] = useState<PaginationState>(
    initialPaginationState(options.pageSize),
  );
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const response = await apiFetch<PaginatedResponse<AIProvider>>(
        `/api/ai-providers?${paginationQuery(pagination)}`,
      );
      setProviders(response.data.map(normalizeProvider));
      setTotal(response.total);
    } catch (err) {
      console.error("Failed to fetch providers:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch providers");
    }
  }, [pagination]);

  useEffect(() => {
    void (async () => {
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const createProvider = useCallback(
    async (data: Record<string, unknown>) => {
      await apiFetch<AIProvider>("/api/ai-providers", {
        method: "POST",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const updateProvider = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      await apiFetch<AIProvider>(`/api/ai-providers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      await apiFetch<void>(`/api/ai-providers/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const toggleProviderActive = useCallback(
    async (provider: AIProvider) => {
      await updateProvider(provider.id, { isActive: !provider.isActive });
    },
    [updateProvider],
  );

  return {
    providers,
    total,
    pagination,
    setPagination,
    isLoading,
    error,
    refresh,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleProviderActive,
  };
}
