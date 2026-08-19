/**
 * Independent dual AI-service status for the header chips (issues #764, #1551).
 * Unlike the single-provider `useEduAIStatus` (which reports whichever one path
 * is live), this probes the cloud and UBC-hosted providers SEPARATELY so each
 * chip reflects only its own availability — neither depends on the other.
 *
 *   - cloud: probed with the user's saved cloud key (outage when none is saved).
 *   - ubc:   probed with an explicit `forceProvider: 'vllm'`, pinning the
 *            UBC-hosted path even when the server has its own cloud key.
 *
 * Feeds the shared `@eduai/ui` AIServiceIndicators. The poll / abort / last-known
 * retention loop is the shared `useAiServiceStatus` hook (#1551 unification) —
 * QM just injects its own two probes as the `fetcher`, so it now polls on the
 * same interval as Core and AI Tutor instead of checking only once on mount.
 *
 * NOTE: QM's health tiers are `operational` / `outage` only. It has no route to
 * the vLLM fleet's `/metrics`, so it can't observe the UBC `degraded` (heavy
 * load) state — that signal is Core-side. QM's probe answers a different
 * question ("does the user's key / the UBC path work from here?"), by design.
 */
import { useCallback } from "react";
import { useAiServiceStatus, type AiServiceStatusPair, type ServiceStatus } from "@eduai/ui";
import eduaiService from "../services/eduaiService";
import { apiKeyStorage, isCloudProvider, isCampusProvider } from "../services/apiKeyStorage";

async function probeCloud(): Promise<ServiceStatus> {
  let cloudKeys: Record<string, any> = {};
  try {
    const stored = await apiKeyStorage.getAllApiKeys();
    cloudKeys = Object.fromEntries(
      Object.entries(stored).map(([provider, apiKey]) => [provider, { apiKey, isEnabled: true }]),
    );
  } catch {
    // treat unreadable storage as no key
  }

  if (Object.keys(cloudKeys).length === 0) {
    return {
      state: "outage",
      detail: "Cloud AI · Not configured — add a provider key in Settings.",
    };
  }

  try {
    const res = await eduaiService.testApiKey(cloudKeys);
    if (res?.success && isCloudProvider(res.provider)) {
      return { state: "operational", detail: "Cloud AI · Online (your provider key)." };
    }
    return { state: "outage", detail: res?.error || "Cloud AI · Key could not be validated." };
  } catch {
    return { state: "outage", detail: "Cloud AI · Unreachable. Check your network." };
  }
}

async function probeUbc(): Promise<ServiceStatus> {
  try {
    // Force the UBC-hosted (vLLM) path explicitly. Sending `{}` alone is not
    // enough — with no client key the backend may fall back to its own Google key
    // and would probe Cloud, so the UBC chip must pin the provider.
    const res = await eduaiService.testApiKey({}, { forceProvider: "vllm" });
    if (res?.success && isCampusProvider(res.provider)) {
      return { state: "operational", detail: "UBC-hosted AI · Online." };
    }
    if (res?.configured === false) {
      return { state: "outage", detail: "UBC-hosted AI · Not configured on the server." };
    }
    return {
      state: "outage",
      detail: res?.error || "UBC-hosted AI · Unavailable (needs UBC wifi/VPN).",
    };
  } catch {
    return { state: "outage", detail: "UBC-hosted AI · Unavailable (needs UBC wifi/VPN)." };
  }
}

export function useAiServicesStatus() {
  const fetcher = useCallback(async (): Promise<AiServiceStatusPair> => {
    const [cloud, ubc] = await Promise.all([probeCloud(), probeUbc()]);
    return { cloud, ubc };
  }, []);

  return useAiServiceStatus({ fetcher });
}

export default useAiServicesStatus;
