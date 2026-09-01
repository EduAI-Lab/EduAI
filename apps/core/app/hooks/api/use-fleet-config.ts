import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";

export type FleetJobType = "interactive" | "background";

export type FleetServerConfig = {
  id: string;
  baseUrl: string;
  jobTypes: FleetJobType[];
  models: string[];
};

export type FleetConnectionTestServer = {
  serverId: string;
  baseUrl: string;
  connected: boolean;
  models: string[];
  error?: string;
};

export type FleetConnectionTest = {
  testedAt: string;
  servers: FleetConnectionTestServer[];
};

type FleetConfigResponse = {
  configured: boolean;
  source: "file" | "environment";
  servers: FleetServerConfig[];
  connectionTest?: FleetConnectionTest;
};

export function useFleetConfig() {
  const [servers, setServers] = useState<FleetServerConfig[]>([]);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<FleetConfigResponse["source"]>("environment");
  const [connectionTest, setConnectionTest] = useState<FleetConnectionTest | null>(null);
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
      setConnectionTest(data.connectionTest ?? null);
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
        setConnectionTest(data.connectionTest ?? null);
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

  return {
    servers,
    configured,
    source,
    connectionTest,
    isLoading,
    isSaving,
    error,
    refresh,
    save,
  };
}
