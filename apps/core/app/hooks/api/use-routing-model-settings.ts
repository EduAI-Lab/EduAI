import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";
import type {
  RoutingModelSettingKey,
  RoutingModelSettings,
} from "~/lib/routing-model-settings";
import { defaultRoutingModelSettings } from "~/lib/routing-model-settings";

export type RoutingModelSettingDefinition = {
  key: RoutingModelSettingKey;
  id: string;
  name: string;
  default: boolean;
  description: string;
};

type RoutingModelSettingsResponse = {
  settings: RoutingModelSettings;
  definitions: RoutingModelSettingDefinition[];
};

export function useRoutingModelSettings() {
  const [settings, setSettings] = useState<RoutingModelSettings>(
    defaultRoutingModelSettings,
  );
  const [definitions, setDefinitions] = useState<
    RoutingModelSettingDefinition[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<RoutingModelSettingsResponse>(
        "/api/routing-model-settings",
      );
      setSettings(data.settings);
      setDefinitions(data.definitions);
    } catch (err) {
      console.error("Failed to fetch routing model settings:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to fetch routing model settings",
      );
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const setEnabled = useCallback(
    async (key: RoutingModelSettingKey, value: boolean) => {
      const data = await apiFetch<{ settings: RoutingModelSettings }>(
        "/api/routing-model-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ key, value }),
        },
      );
      setSettings(data.settings);
    },
    [],
  );

  return { settings, definitions, isLoading, error, refresh, setEnabled };
}
