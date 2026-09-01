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
 * QM just injects its own two probes as the `fetcher`, so it now refreshes over
 * time instead of checking only once on mount.
 *
 * Interval is deliberately LONGER than Core/AI Tutor's 60s default. Each probe
 * here is a live `test-api-key` validation (two per cycle: cloud + vLLM), a real
 * provider round-trip — not the cheap Core-cached `/api/ai-status` the others
 * poll. A 5-minute cadence keeps the chips fresh while bounding per-tab load on
 * the key-validation endpoint and any upstream provider rate limits.
 *
 * NOTE: QM's health tiers are `operational` / `outage` only. It has no route to
 * the vLLM fleet's `/metrics`, so it can't observe the UBC `degraded` (heavy
 * load) state — that signal is Core-side. QM's probe answers a different
 * question ("does the user's key / the UBC path work from here?"), by design.
 */
import { useCallback } from "react";
import { useAiServiceStatus, type AiServiceStatusPair, type ServiceStatus } from "@eduai/ui";
import eduaiService from "../services/eduaiService";
import {
  apiKeyStorage,
  CLOUD_PROVIDERS,
  isCloudProvider,
  isCampusProvider,
  type ProviderApiKeys,
} from "../services/apiKeyStorage";
import { DEFAULT_GENERATION_MODEL_STORAGE_KEY } from "../utils/aiModels";

async function probeCloud(signal: AbortSignal): Promise<ServiceStatus> {
  let storedKeys: Record<string, string> = {};
  try {
    storedKeys = await apiKeyStorage.getAllApiKeys();
  } catch {
    // treat unreadable storage as no key
  }

  let configuredProvider: string | undefined;
  try {
    configuredProvider = localStorage.getItem(DEFAULT_GENERATION_MODEL_STORAGE_KEY)?.split(":")[0];
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  const provider =
    (isCloudProvider(configuredProvider) && storedKeys[configuredProvider]
      ? configuredProvider
      : undefined) ?? CLOUD_PROVIDERS.find((candidate) => storedKeys[candidate]);

  if (!provider) {
    return {
      state: "outage",
      detail: "Cloud AI · Not configured — add a provider key in Settings.",
    };
  }

  // The backend intentionally accepts exactly one active provider path. Probe
  // the configured default (or the first available key) instead of forwarding
  // every saved credential and turning a valid multi-key setup into a 400.
  const cloudKeys: ProviderApiKeys = {
    [provider]: { apiKey: storedKeys[provider], isEnabled: true },
  };

  try {
    const res = await eduaiService.testApiKey(cloudKeys, { signal });
    if (res?.success && isCloudProvider(res.provider)) {
      return { state: "operational", detail: "Cloud AI · Online (your provider key)." };
    }
    return { state: "outage", detail: res?.error || "Cloud AI · Key could not be validated." };
  } catch {
    return { state: "outage", detail: "Cloud AI · Unreachable. Check your network." };
  }
}

async function probeUbc(signal: AbortSignal): Promise<ServiceStatus> {
  try {
    // Force the UBC-hosted (vLLM) path explicitly. Sending `{}` alone is not
    // enough — with no client key the backend may fall back to its own Google key
    // and would probe Cloud, so the UBC chip must pin the provider.
    const res = await eduaiService.testApiKey({}, { forceProvider: "vllm", signal });
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

/** 5 min — see the interval note in the file header (live key-validation probes). */
const QM_POLL_INTERVAL_MS = 300_000;

export function useAiServicesStatus() {
  const fetcher = useCallback(async (signal: AbortSignal): Promise<AiServiceStatusPair> => {
    // Forward the poll's signal to both live probes so refresh / unmount /
    // timeout tears down a wedged request instead of letting it overwrite
    // newer state (issue #1551).
    const [cloud, ubc] = await Promise.all([probeCloud(signal), probeUbc(signal)]);
    return { cloud, ubc };
  }, []);

  return useAiServiceStatus({ fetcher, intervalMs: QM_POLL_INTERVAL_MS });
}

export default useAiServicesStatus;
