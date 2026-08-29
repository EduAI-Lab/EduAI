import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import {
  FleetConfigError,
  loadFleetConfigFile,
  saveFleetConfigFile,
} from "~/lib/ai/routing/fleet/config-file";
import { getServerHealth, resetFleetHealthCache } from "~/lib/ai/routing/fleet/health";
import { getAllFleetServers, resetFleetRegistryCache } from "~/lib/ai/routing/fleet/registry";
import type { FleetServer } from "~/lib/ai/routing/fleet/types";
import { InvalidVllmBaseUrlError, resolveAllowedVllmBaseUrl } from "~/lib/ai/vllm-url.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

const FleetServerSchema = z.object({
  id: z.string().trim().min(1),
  baseUrl: z.string().trim().min(1),
  jobTypes: z.array(z.enum(["interactive", "background"])),
  models: z.array(z.string().trim().min(1)).default([]),
});

const FleetConfigSchema = z.object({
  servers: z.array(FleetServerSchema),
});

/**
 * Reject any server whose baseUrl is not a deployment-owned vLLM endpoint
 * before it is ever written to disk or probed. Without this, an admin (or a
 * compromised admin session) could point the fleet config at an arbitrary
 * host and getServerHealth() would send the internal VLLM_API_KEY to it
 * (Authorization: Bearer ... on GET {baseUrl}/v1/models) — an SSRF-adjacent
 * credential leak. resolveAllowedVllmBaseUrl enforces the same exact-base
 * allowlist (VLLM_BASE_URL / VLLM_FLEET_CHAT_URLS / VLLM_FLEET_HEAVY_URL,
 * plus loopback in dev/test) already used for outbound vLLM calls elsewhere.
 */
function assertAllowedFleetServers(servers: FleetServer[]): void {
  for (const server of servers) {
    try {
      resolveAllowedVllmBaseUrl(server.baseUrl);
    } catch (err) {
      const message =
        err instanceof InvalidVllmBaseUrlError ? err.message : "Invalid fleet server base URL";
      throw new FleetConfigError(`servers[${server.id}].baseUrl rejected: ${message}`);
    }
  }
}

function readEffectiveConfig() {
  const fileConfig = loadFleetConfigFile();
  return {
    configured: fileConfig !== null,
    source: fileConfig ? ("file" as const) : ("environment" as const),
    servers: fileConfig?.servers ?? getAllFleetServers(),
  };
}

async function testFleetConnections(servers: FleetServer[]) {
  const results = await Promise.all(
    servers.map(async (server) => {
      const health = await getServerHealth(server.baseUrl);
      const result = {
        serverId: server.id,
        baseUrl: server.baseUrl,
        connected: health.ok,
        models: health.modelIds ?? [],
      };
      return health.error ? { ...result, error: health.error } : result;
    }),
  );
  return { testedAt: new Date().toISOString(), servers: results };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  try {
    return json(readEffectiveConfig());
  } catch (err) {
    const message = err instanceof FleetConfigError ? err.message : "Failed to read fleet config";
    return json({ error: message }, 500);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PUT" && request.method !== "PATCH") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const parsed = FleetConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid fleet config", details: parsed.error.flatten() }, 400);
  }

  try {
    assertAllowedFleetServers(parsed.data.servers);
    const config = saveFleetConfigFile(parsed.data);
    resetFleetRegistryCache();
    resetFleetHealthCache();
    const connectionTest = await testFleetConnections(config.servers);

    if (session?.user) {
      fireAndForget(
        logAuditAction({
          ...getActorContext(session.user),
          ...getRequestContext(request),
          actionCode: "FLEET_CONFIG_UPDATED",
          category: "AI_CONFIG",
          entityType: "FleetConfig",
          entityId: "fleet.config.json",
          entityLabel: "fleet.config.json",
          details: { serverCount: config.servers.length },
        }),
      );
    }

    return json({
      configured: true,
      source: "file" as const,
      servers: config.servers,
      connectionTest,
    });
  } catch (err) {
    const message = err instanceof FleetConfigError ? err.message : "Failed to save fleet config";
    return json({ error: message }, 400);
  }
}
