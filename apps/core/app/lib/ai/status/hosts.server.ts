/**
 * The set of UBC-hosted inference hosts the status probe samples.
 *
 * Mirrors the branch `probeUbcStatus` already uses so fleet-less deployments —
 * local dev, CI, and anything not yet migrated to a fleet config — keep working.
 * Without the legacy branch those environments would write zero rows forever and
 * the chip would report a permanent cold start.
 *
 * Both the probe and the read path call this, so writer and reader can never
 * disagree about which hosts currently exist.
 */
import {
  fleetRoutingEnabled,
  getAllFleetServers,
  serverIdFromUrl,
} from "~/lib/ai/routing/fleet/registry";
import { resolveUbcBaseUrls } from "~/lib/ai/service-status.server";

export interface StatusHost {
  serverId: string;
  baseUrl: string;
  /** Models the configuration claims this host serves. Only a cold-start hint —
   *  /v1/models is ground truth, and the global VLLM_FLEET_DEFAULT_MODELS list
   *  is applied to every host, so it is wrong for any host that differs. */
  configuredModels: string[];
}

export function resolveStatusHosts(): StatusHost[] {
  if (fleetRoutingEnabled()) {
    return getAllFleetServers().map((server) => ({
      serverId: server.id,
      baseUrl: server.baseUrl,
      configuredModels: server.models ?? [],
    }));
  }

  const { vllm, ollama } = resolveUbcBaseUrls();
  const hosts: StatusHost[] = [];
  for (const baseUrl of [vllm, ollama]) {
    if (!baseUrl) continue;
    const normalized = baseUrl.replace(/\/$/, "");
    hosts.push({
      serverId: serverIdFromUrl(normalized),
      baseUrl: normalized,
      configuredModels: [],
    });
  }
  return hosts;
}
