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

/**
 * Which API a host speaks, and therefore how it must be probed.
 *
 * Not cosmetic: the vLLM check demands `VLLM_API_KEY` and a bearer token on
 * `/v1/models`, which an Ollama host neither needs nor accepts. Probing one as
 * the other reports a reachable service as unmeasurable forever.
 */
export type StatusHostKind = "vllm" | "ollama";

export interface StatusHost {
  serverId: string;
  baseUrl: string;
  kind: StatusHostKind;
  /** Models the configuration claims this host serves. Only a cold-start hint —
   *  /v1/models is ground truth, and the global VLLM_FLEET_DEFAULT_MODELS list
   *  is applied to every host, so it is wrong for any host that differs. */
  configuredModels: string[];
}

export function resolveStatusHosts(): StatusHost[] {
  if (fleetRoutingEnabled()) {
    // The fleet registry is vLLM-only by construction.
    return getAllFleetServers().map((server) => ({
      serverId: server.id,
      baseUrl: server.baseUrl,
      kind: "vllm" as const,
      configuredModels: server.models ?? [],
    }));
  }

  const { vllm, ollama } = resolveUbcBaseUrls();
  const hosts: StatusHost[] = [];
  for (const [kind, baseUrl] of [
    ["vllm", vllm],
    ["ollama", ollama],
  ] as const) {
    if (!baseUrl) continue;
    const normalized = baseUrl.replace(/\/$/, "");
    hosts.push({
      serverId: serverIdFromUrl(normalized),
      baseUrl: normalized,
      kind,
      configuredModels: [],
    });
  }
  return hosts;
}
