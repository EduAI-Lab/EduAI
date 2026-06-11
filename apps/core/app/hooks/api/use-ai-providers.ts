import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type { AIProvider } from "~/hooks/api/types";

function normalizeProvider(provider: AIProvider): AIProvider {
  return {
    ...provider,
    _count: provider._count ?? { models: 0 },
  };
}

export function useAiProviders() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<AIProvider[]>("/api/ai-providers");
      setProviders(data.map(normalizeProvider));
    } catch (err) {
      console.error("Failed to fetch providers:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch providers");
    }
  }, []);

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
    isLoading,
    error,
    refresh,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleProviderActive,
  };
}
