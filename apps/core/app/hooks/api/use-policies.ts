import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "~/hooks/api/config";

export type PolicyDefinition = {
  key: string;
  label: string;
  description: string;
  default: boolean;
};

type PoliciesResponse = {
  policies: Record<string, boolean>;
  definitions: PolicyDefinition[];
};

/** Reads and toggles the configurable RBAC policy flags (ADMIN only). */
export function usePolicies() {
  const [policies, setPolicies] = useState<Record<string, boolean>>({});
  const [definitions, setDefinitions] = useState<PolicyDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<PoliciesResponse>("/api/policies");
      setPolicies(data.policies ?? {});
      setDefinitions(data.definitions ?? []);
    } catch (err) {
      console.error("Failed to fetch policies:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch policies");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      setIsLoading(false);
    })();
  }, [refresh]);

  const setPolicy = useCallback(async (key: string, value: boolean) => {
    // Optimistic update so the switch responds immediately. Capture the true
    // prior value first so a failed PATCH restores exactly what Core still holds
    // (don't assume it was `!value` — a race or repeat could make that wrong).
    let previous: boolean | undefined;
    setPolicies((prev) => {
      previous = prev[key];
      return { ...prev, [key]: value };
    });
    try {
      const data = await apiFetch<PoliciesResponse>("/api/policies", {
        method: "PATCH",
        body: JSON.stringify({ key, value }),
      });
      setPolicies(data.policies ?? {});
    } catch (err) {
      console.error("Failed to update policy:", err);
      setError(err instanceof Error ? err.message : "Failed to update policy");
      // Roll back to the captured prior value.
      setPolicies((prev) => ({ ...prev, [key]: previous ?? !value }));
    }
  }, []);

  return { policies, definitions, isLoading, error, refresh, setPolicy };
}
