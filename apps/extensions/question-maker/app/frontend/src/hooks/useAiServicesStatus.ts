/**
 * Dual AI-service status for the header chips (issues #764, #1551).
 * Feeds the shared `@eduai/ui` AIServiceIndicators.
 *
 *   - cloud: derived synchronously from the cached save-time verdict
 *     (task 15) — no network call on every poll. Core never sees the user's
 *     browser-stored provider key, so it cannot validate it; QM used to
 *     re-validate on every poll instead (`probeCloud`, now deleted), burning
 *     a live provider round-trip per user per poll. The verdict is checked
 *     once, when the key is saved (`SettingsPage.handleSaveKey`), and cached
 *     per-provider (`apiKeyStorage.setValidation` / `getValidation`). The
 *     cache is refreshed only on a deliberate user action — clicking the
 *     cloud chip (`revalidateCloud`, wired to `AIServiceIndicators`'
 *     `onRefresh` in `QmAppLayout`) — or self-corrected when any AI call
 *     (generation, OCR extraction, chat) hits a provider 401/403, via the
 *     shared `api` client's response interceptor
 *     (`services/api.ts`, `invalidateProviderKeyOnAuthFailure`).
 *   - ubc:   read from Core's shared fleet-status snapshot via QM's own
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
 * hook (#1551 unification) — QM injects its own `fetcher`, combining the
 * synchronous cloud-cache read with the proxied UBC snapshot.
 *
 * `checkedAt` / `stale` are reported for the UBC snapshot only (there is no
 * equivalent concept for the cached cloud verdict, which carries its own
 * "checked when saved, N days ago" detail instead).
 *
 * Interval matches Core/AI Tutor's shared-snapshot cadence (5 min) — neither
 * side of this poll spends a live provider round-trip anymore.
 */
import { useCallback } from "react";
import { useAiServiceStatus, type AiServiceStatusPair, type ServiceStatus } from "@eduai/ui";
import eduaiService from "../services/eduaiService";
import {
  apiKeyStorage,
  CLOUD_PROVIDERS,
  isCloudProvider,
  type AIProvider,
} from "../services/apiKeyStorage";
import { DEFAULT_GENERATION_MODEL_STORAGE_KEY } from "../utils/aiModels";
import { daysAgoLabel } from "../utils/relativeTime";

/** Picks which saved cloud provider the chip should reflect — same rule the old live probe used. */
function resolveConfiguredCloudProvider(
  storedKeys: Record<string, string>,
): AIProvider | undefined {
  let configuredProvider: string | undefined;
  try {
    configuredProvider = localStorage.getItem(DEFAULT_GENERATION_MODEL_STORAGE_KEY)?.split(":")[0];
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
  return (
    (isCloudProvider(configuredProvider) && storedKeys[configuredProvider]
      ? configuredProvider
      : undefined) ?? CLOUD_PROVIDERS.find((candidate) => storedKeys[candidate])
  );
}

/**
 * Synchronous read of the cached cloud verdict — no network call. Implements
 * the four required chip states:
 *   - verdict valid            → operational
 *   - verdict invalid          → outage, with the provider's own reason
 *   - never validated + a key  → unknown (NOT green — a key saved before this
 *     shipped, or one whose validation write failed, has no earned verdict;
 *     inventing an optimistic one would reintroduce the exact lie this task
 *     removes)
 *   - no key at all            → outage
 */
async function readCachedCloudStatus(): Promise<ServiceStatus> {
  let storedKeys: Record<string, string> = {};
  try {
    storedKeys = await apiKeyStorage.getAllApiKeys();
  } catch {
    // treat unreadable storage as no key
  }

  const provider = resolveConfiguredCloudProvider(storedKeys);
  if (!provider) {
    return {
      state: "outage",
      detail: "Cloud AI · Not configured — add a provider key in Settings.",
    };
  }

  const verdict = apiKeyStorage.getValidation(provider);
  if (verdict.valid === true) {
    const checked = verdict.validatedAt ? `, ${daysAgoLabel(verdict.validatedAt)}` : "";
    return { state: "operational", detail: `Cloud AI · Valid — checked when saved${checked}.` };
  }
  if (verdict.valid === false) {
    return {
      state: "outage",
      detail: verdict.error
        ? `Cloud AI · ${verdict.error}`
        : "Cloud AI · Key was rejected. Re-check in Settings.",
    };
  }
  return {
    state: "unknown",
    detail: "Cloud AI · Key not yet verified. Re-check in Settings.",
  };
}

/**
 * Re-validates the configured cloud key on demand — a deliberate user action
 * (clicking the cloud chip), never a timer. This is the one live round-trip
 * this hook otherwise avoids; it caches the result the same way
 * `SettingsPage.handleSaveKey` does, so the next `readCachedCloudStatus` call
 * (the following poll tick, or an immediate `refresh()`) reflects it.
 */
export async function revalidateCloud(signal?: AbortSignal): Promise<void> {
  let storedKeys: Record<string, string> = {};
  try {
    storedKeys = await apiKeyStorage.getAllApiKeys();
  } catch {
    // No readable key — nothing to (re)validate.
  }
  const provider = resolveConfiguredCloudProvider(storedKeys);
  if (!provider) return;

  try {
    const res = await eduaiService.testApiKey(
      { [provider]: { apiKey: storedKeys[provider], isEnabled: true } },
      { signal },
    );
    apiKeyStorage.setValidation(provider, {
      valid: !!res?.success,
      validatedAt: new Date().toISOString(),
      error: res?.success ? null : (res?.error ?? "Key could not be validated."),
    });
  } catch {
    apiKeyStorage.setValidation(provider, {
      valid: false,
      validatedAt: new Date().toISOString(),
      error: "Could not reach the validation service. Check your network.",
    });
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
    // Forward the poll's signal to the UBC proxy call so refresh / unmount /
    // timeout tears down a wedged request instead of letting it overwrite
    // newer state (issue #1551). The cloud read is synchronous (task 15) and
    // has nothing to cancel.
    const [cloud, ubcResult] = await Promise.all([
      readCachedCloudStatus(),
      fetchUbcFromCoreSnapshot(signal),
    ]);
    return { cloud, ...ubcResult };
  }, []);

  return useAiServiceStatus({ fetcher, intervalMs: QM_POLL_INTERVAL_MS });
}

export default useAiServicesStatus;
