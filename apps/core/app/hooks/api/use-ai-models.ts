import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import {
  initialPaginationState,
  paginationQuery,
  type PaginatedResponse,
  type PaginationState,
} from "~/hooks/api/pagination";
import type { AIModel } from "~/hooks/api/types";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Server-paginated AI model list (#1041).
 *
 * Search and the provider filter are query params, not client-side array
 * filters — filtering the loaded page would only ever search that page.
 */
export function useAiModels() {
  const [pagination, setPagination] = useState<PaginationState>(initialPaginationState());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [models, setModels] = useState<AIModel[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const query = paginationQuery(pagination, {
        search: debouncedSearch,
        providerId,
      });
      const response = await apiFetch<PaginatedResponse<AIModel>>(`/api/ai-models?${query}`);
      setModels(response.data);
      setTotal(response.total);
    } catch (err) {
      console.error("Failed to fetch models:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    }
  }, [pagination, debouncedSearch, providerId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A new filter invalidates the current offset.
  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [debouncedSearch, providerId]);

  useEffect(() => {
    void (async () => {
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const createModel = useCallback(
    async (data: Record<string, unknown>) => {
      await apiFetch<AIModel>("/api/ai-models", {
        method: "POST",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const updateModel = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      await apiFetch<AIModel>(`/api/ai-models/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      await refresh();
    },
    [refresh],
  );

  const deleteModel = useCallback(
    async (id: string) => {
      await apiFetch<void>(`/api/ai-models/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const toggleModelActive = useCallback(
    async (model: AIModel) => {
      await updateModel(model.id, { isActive: !model.isActive });
    },
    [updateModel],
  );

  return {
    models,
    total,
    pagination,
    setPagination,
    search,
    setSearch,
    providerId,
    setProviderId,
    isLoading,
    error,
    refresh,
    createModel,
    updateModel,
    deleteModel,
    toggleModelActive,
  };
}

/**
 * Fetch every model belonging to one provider (#1041).
 *
 * Local-model sync must dedupe against the provider's full set; the paged list
 * the table holds would make it recreate models that already exist.
 */
export async function fetchModelsByProvider(providerId: string): Promise<AIModel[]> {
  const params = new URLSearchParams({ providerId, page: "1", pageSize: "200" });
  const response = await apiFetch<PaginatedResponse<AIModel>>(`/api/ai-models?${params}`);
  return response.data;
}
