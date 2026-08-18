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

  // #1453: the list GET now carries a short `Cache-Control`, so a plain refetch
  // right after a mutation can be served the pre-mutation body from the browser
  // cache and make the admin's own edit look like it never landed. Mutations
  // pass `force` to bypass it; the initial load stays cacheable.
  const refresh = useCallback(
    async (opts?: { force?: boolean }) => {
      try {
        setError(null);
        const response = await apiFetch<PaginatedResponse<AIProvider>>(
          `/api/ai-providers?${paginationQuery(pagination)}`,
          opts?.force ? { cache: "no-store" } : undefined,
        );
        setProviders(response.data.map(normalizeProvider));
        setTotal(response.total);
      } catch (err) {
        console.error("Failed to fetch providers:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch providers");
      }
    },
    [pagination],
  );

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
      await refresh({ force: true });
    },
    [refresh],
  );

  const updateProvider = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      await apiFetch<AIProvider>(`/api/ai-providers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await refresh({ force: true });
    },
    [refresh],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      await apiFetch<void>(`/api/ai-providers/${id}`, { method: "DELETE" });
      await refresh({ force: true });
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
