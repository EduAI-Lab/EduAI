/**
 * Dual AI-service status for the header chips (issues #764, #1551).
 * Feeds the shared `@eduai/ui` AIServiceIndicators.
 *
 *   - cloud: still probed with the user's saved cloud key (outage when none is
 *     saved) — a live `test-api-key` round-trip via `probeCloud`, unchanged
 *     from before. This validates the caller's OWN key, which Core's shared
 *     snapshot has no way to know about.
 *   - ubc:   now read from Core's shared fleet-status snapshot via QM's own
 *     `GET /api/eduai/ai-status` backend proxy, the same DB-backed source
 *     Core's and AI Tutor's header chips already read (#764 task 14). QM no
 *     longer runs its own per-user live probe of the UBC path — that probe
 *     (`POST /api/eduai/test-api-key` with `forceProvider: 'vllm'`) has been
 *     deleted. The probe and Core's snapshot could disagree for reasons
 *     unrelated to fleet health (auth/routing on the QM→Core leg that also
 *     carries real generation calls), so removing it makes the chip consistent
 *     with Core/AI Tutor without independently proving that leg is healthy.
 *
 * The poll / abort / last-known retention loop is the shared `useAiServiceStatus`
 * hook (#1551 unification) — QM injects its own `fetcher`, combining the local
 * cloud probe with the proxied UBC snapshot.
 *
 * `checkedAt` / `stale` are reported for the UBC snapshot only (there is no
 * equivalent concept for the live cloud probe, which is always "now").
 *
 * Interval matches Core/AI Tutor's shared-snapshot cadence (5 min) rather than
 * the old two-live-probe cadence, since the UBC side no longer spends a live
 * provider round-trip on every poll.
 */
import { useCallback } from "react";
import { useAiServiceStatus, type AiServiceStatusPair, type ServiceStatus } from "@eduai/ui";
import eduaiService from "../services/eduaiService";
import {
  apiKeyStorage,
  CLOUD_PROVIDERS,
  isCloudProvider,
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

const UBC_SIGN_IN_REQUIRED: ServiceStatus = {
  state: "unknown",
  detail: "Sign in to Core to see AI status.",
};
const UBC_UNAVAILABLE: ServiceStatus = {
  state: "unknown",
  detail: "UBC-hosted AI status unavailable.",
};

/**
 * Reads the UBC-hosted status from Core's shared snapshot via QM's backend
 * proxy. On a 401 (no/expired Core session) this deliberately renders
 * `unknown` rather than `outage` — today's behaviour flattens every failure
 * mode to "needs UBC wifi/VPN", which is wrong for an auth failure. Any other
 * failure (network, 5xx, proxy misconfiguration) also renders `unknown`: QM
 * cannot tell those apart from here, and guessing "outage" would be the same
 * false diagnosis in a different shape.
 */
async function fetchUbcFromCoreSnapshot(
  signal: AbortSignal,
): Promise<Pick<AiServiceStatusPair, "ubc" | "checkedAt" | "stale">> {
  try {
    const data = await eduaiService.getAiStatus(signal);
    return {
      ubc: data?.ubc ?? UBC_UNAVAILABLE,
      checkedAt: data?.checkedAt ?? null,
      stale: data?.stale ?? true,
    };
  } catch (err: any) {
    if (err?.response?.status === 401) {
      return { ubc: UBC_SIGN_IN_REQUIRED, checkedAt: null, stale: true };
    }
    return { ubc: UBC_UNAVAILABLE, checkedAt: null, stale: true };
  }
}

/** Matches Core/AI Tutor's shared-snapshot cadence — see the file header. */
const QM_POLL_INTERVAL_MS = 300_000;

export function useAiServicesStatus() {
  const fetcher = useCallback(async (signal: AbortSignal): Promise<AiServiceStatusPair> => {
    // Forward the poll's signal to both calls so refresh / unmount / timeout
    // tears down a wedged request instead of letting it overwrite newer state
    // (issue #1551).
    const [cloud, ubcResult] = await Promise.all([
      probeCloud(signal),
      fetchUbcFromCoreSnapshot(signal),
    ]);
    return { cloud, ...ubcResult };
  }, []);

  return useAiServiceStatus({ fetcher, intervalMs: QM_POLL_INTERVAL_MS });
}

export default useAiServicesStatus;
