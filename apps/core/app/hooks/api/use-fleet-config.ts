import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";

export type FleetJobType = "interactive" | "background";

export type FleetServerConfig = {
  id: string;
  baseUrl: string;
  jobTypes: FleetJobType[];
  models: string[];
};

type FleetConfigResponse = {
  configured: boolean;
  source: "file" | "environment";
  servers: FleetServerConfig[];
};

export function useFleetConfig() {
  const [servers, setServers] = useState<FleetServerConfig[]>([]);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<FleetConfigResponse["source"]>("environment");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<FleetConfigResponse>("/api/fleet-config");
      setServers(data.servers);
      setConfigured(data.configured);
      setSource(data.source);
    } catch (err) {
      console.error("Failed to fetch fleet config:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch fleet config");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (nextServers: FleetServerConfig[]): Promise<FleetServerConfig[]> => {
      setIsSaving(true);
      setError(null);
      try {
        const data = await apiFetch<FleetConfigResponse>("/api/fleet-config", {
          method: "PUT",
          body: JSON.stringify({ servers: nextServers }),
        });
        setServers(data.servers);
        setConfigured(data.configured);
        setSource(data.source);
        return data.servers;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save fleet config");
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  return { servers, configured, source, isLoading, isSaving, error, refresh, save };
}
