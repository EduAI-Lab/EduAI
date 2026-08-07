/**
 * Independent dual AI-service status for the header chips (issue #764). Unlike the
 * single-provider `useEduAIStatus` (which reports whichever one path is live), this
 * probes the cloud and UBC-hosted providers SEPARATELY so each chip reflects only
 * its own availability — neither depends on the other.
 *
 *   - cloud: probed with the user's saved cloud key (offline when none is saved).
 *   - ubc:   probed with an explicit `forceProvider: 'vllm'`, pinning the
 *            UBC-hosted path even when the server has its own cloud key.
 *
 * Feeds the shared `@eduai/ui` AIServiceIndicators. Checks once on mount; a manual
 * refresh re-checks both at once.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ServiceStatus } from '@eduai/ui';
import eduaiService from '../services/eduaiService';
import { apiKeyStorage, isCloudProvider, isCampusProvider } from '../services/apiKeyStorage';

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
    return { state: 'offline', detail: 'Cloud AI · Not configured — add a provider key in Settings.' };
  }

  try {
    const res = await eduaiService.testApiKey(cloudKeys);
    if (res?.success && isCloudProvider(res.provider)) {
      return { state: 'online', detail: 'Cloud AI · Online (your provider key).' };
    }
    return { state: 'offline', detail: res?.error || 'Cloud AI · Key could not be validated.' };
  } catch {
    return { state: 'offline', detail: 'Cloud AI · Unreachable. Check your network.' };
  }
}

async function probeUbc(): Promise<ServiceStatus> {
  try {
    // Force the UBC-hosted (vLLM) path explicitly. Sending `{}` alone is not
    // enough — with no client key the backend may fall back to its own Google key
    // and would probe Cloud, so the UBC chip must pin the provider.
    const res = await eduaiService.testApiKey({}, { forceProvider: 'vllm' });
    if (res?.success && isCampusProvider(res.provider)) {
      return { state: 'online', detail: 'UBC-hosted AI · Online.' };
    }
    if (res?.configured === false) {
      return { state: 'offline', detail: 'UBC-hosted AI · Not configured on the server.' };
    }
    return { state: 'offline', detail: res?.error || 'UBC-hosted AI · Unavailable (needs UBC wifi/VPN).' };
  } catch {
    return { state: 'offline', detail: 'UBC-hosted AI · Unavailable (needs UBC wifi/VPN).' };
  }
}

export function useAiServicesStatus() {
  const [cloud, setCloud] = useState<ServiceStatus>({ state: 'loading' });
  const [ubc, setUbc] = useState<ServiceStatus>({ state: 'loading' });

  const refresh = useCallback(async () => {
    const [c, u] = await Promise.all([probeCloud(), probeUbc()]);
    setCloud(c);
    setUbc(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [c, u] = await Promise.all([probeCloud(), probeUbc()]);
      if (!cancelled) {
        setCloud(c);
        setUbc(u);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { cloud, ubc, refresh };
}

export default useAiServicesStatus;
