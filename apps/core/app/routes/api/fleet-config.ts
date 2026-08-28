import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import {
  FleetConfigError,
  loadFleetConfigFile,
  saveFleetConfigFile,
} from "~/lib/ai/routing/fleet/config-file";
import { resetFleetHealthCache } from "~/lib/ai/routing/fleet/health";
import { getAllFleetServers, resetFleetRegistryCache } from "~/lib/ai/routing/fleet/registry";
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

function readEffectiveConfig() {
  const fileConfig = loadFleetConfigFile();
  return {
    configured: fileConfig !== null,
    source: fileConfig ? ("file" as const) : ("environment" as const),
    servers: fileConfig?.servers ?? getAllFleetServers(),
  };
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
    const config = saveFleetConfigFile(parsed.data);
    resetFleetRegistryCache();
    resetFleetHealthCache();

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

    return json({ configured: true, source: "file" as const, servers: config.servers });
  } catch (err) {
    const message = err instanceof FleetConfigError ? err.message : "Failed to save fleet config";
    return json({ error: message }, 400);
  }
}
