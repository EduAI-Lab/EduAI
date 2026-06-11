import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type { AIModel } from "~/hooks/api/types";

export function useAiModels() {
  const [models, setModels] = useState<AIModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<AIModel[]>("/api/ai-models");
      setModels(data);
    } catch (err) {
      console.error("Failed to fetch models:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch models");
    }
  }, []);

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
    isLoading,
    error,
    refresh,
    createModel,
    updateModel,
    deleteModel,
    toggleModelActive,
  };
}
