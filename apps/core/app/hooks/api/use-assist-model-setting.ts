import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";

type AssistModelResponse = { modelId: string | null };

export function useAssistModelSetting() {
  const [modelId, setModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<AssistModelResponse>("/api/assist-model-settings");
      setModelId(data.modelId);
    } catch (err) {
      console.error("Failed to fetch Assist model setting:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch Assist model setting");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (nextModelId: string | null): Promise<string | null> => {
    setIsSaving(true);
    setError(null);
    try {
      const data = await apiFetch<AssistModelResponse>("/api/assist-model-settings", {
        method: "PUT",
        body: JSON.stringify({ modelId: nextModelId }),
      });
      setModelId(data.modelId);
      return data.modelId;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Assist model setting");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  return { modelId, isLoading, isSaving, error, refresh, save };
}
